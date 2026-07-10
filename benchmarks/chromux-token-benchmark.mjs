#!/usr/bin/env node

// Token-footprint benchmark: measures the payload an agent actually reads for
// common chromux observation commands, on deterministic local fixture pages.
//
//   CHROMUX_HOME="$(mktemp -d /tmp/chromux-tokens-XXXXXX)" \
//     node benchmarks/chromux-token-benchmark.mjs --out /tmp/chromux-tokens.json
//
// Bytes are exact; tokens are estimated as ceil(chars / 4), the usual rough
// heuristic for English/markup text. The point is the relative footprint:
// full HTML vs full snapshot vs interactive snapshot vs post-action diff vs
// schema-shaped extraction.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CHROMUX = path.join(MODULE_DIR, 'chromux.mjs');

function argValue(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

function estimateTokens(text) {
  return Math.ceil(String(text).length / 4);
}

function fixtureHtml(route) {
  if (route.startsWith('/form')) {
    return `<!doctype html><title>Token Fixture Form</title>
      <main>
        <h1>Checkout</h1>
        <form>
          <input id="email" aria-label="Email" placeholder="you@example.com">
          <input id="coupon" aria-label="Coupon">
          <select id="country" aria-label="Country"><option>KR</option><option>US</option></select>
          <button id="submit">Place order</button>
        </form>
        <p id="status">Waiting</p>
      </main>`;
  }
  if (route.startsWith('/feed')) {
    const items = Array.from({ length: 200 }, (_, i) => `
      <article>
        <h2><a href="/story/${i}">Story headline number ${i} with some descriptive words</a></h2>
        <p>Teaser paragraph for story ${i}. ${'Filler sentence for realistic text density. '.repeat(3)}</p>
        <div><button data-id="${i}">Upvote</button> <a href="/story/${i}#comments">comments</a></div>
      </article>`).join('\n');
    return `<!doctype html><title>Token Fixture Feed</title><main><h1>Feed</h1>${items}</main>`;
  }
  return `<!doctype html><title>Token Fixture Article</title>
    <main>
      <h1>Article</h1>
      <nav><a href="/">Home</a> <a href="/feed">Feed</a> <a href="/form">Form</a></nav>
      ${'<p>Body paragraph with enough words to resemble a real article page.</p>'.repeat(40)}
      <button id="more">Read more</button>
    </main>`;
}

function startFixtureServer() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(fixtureHtml(req.url || '/'));
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function runChromux(args, timeoutMs = 90_000) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CHROMUX, ...args], {
      cwd: MODULE_DIR,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({ ok: false, stdout, stderr: `${stderr}\nTimed out after ${timeoutMs}ms`.trim() });
    }, timeoutMs);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', code => { clearTimeout(timer); resolve({ ok: code === 0, stdout, stderr }); });
    child.on('error', err => { clearTimeout(timer); resolve({ ok: false, stdout, stderr: err.message }); });
  });
}

async function measure(label, page, args, { mutate = null, session }) {
  if (mutate) {
    const mutated = await runChromux(['run', session, mutate]);
    if (!mutated.ok) throw new Error(`mutation for ${label} failed: ${mutated.stderr}`);
  }
  const result = await runChromux(args);
  if (!result.ok) throw new Error(`${label} failed: ${result.stderr}`);
  const text = result.stdout;
  return { label, page, bytes: Buffer.byteLength(text), estTokens: estimateTokens(text) };
}

async function main() {
  if (!process.env.CHROMUX_HOME) {
    console.error('Set CHROMUX_HOME to an isolated temp directory before running this benchmark.');
    process.exit(1);
  }
  const outPath = argValue('--out');
  const server = await startFixtureServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  const profile = `tokens-${Date.now().toString(36)}`;
  process.env.CHROMUX_PROFILE = profile;
  const rows = [];

  try {
    const launched = await runChromux(['launch', profile, '--headless']);
    if (!launched.ok) throw new Error(`launch failed: ${launched.stderr}`);

    const pages = [
      { name: 'article', url: `${base}/`, mutate: `return await js('const b=document.createElement("button");b.textContent="Comment";document.querySelector("main").appendChild(b);return 1')` },
      { name: 'form', url: `${base}/form`, mutate: `return await js('document.getElementById("status").textContent="Saved";return 1')` },
      { name: 'feed-200', url: `${base}/feed`, mutate: `return await js('const a=document.createElement("article");a.innerHTML="<h2><a href=\\'/story/new\\'>Breaking story</a></h2>";document.querySelector("main").prepend(a);return 1')` },
    ];

    for (const page of pages) {
      const session = `tok-${page.name}`;
      const opened = await runChromux(['open', session, page.url]);
      if (!opened.ok) throw new Error(`open ${page.name} failed: ${opened.stderr}`);

      rows.push(await measure('full HTML (run page html)', page.name,
        ['run', session, `return await js('document.documentElement.outerHTML')`], { session }));
      rows.push(await measure('snapshot (full)', page.name, ['snapshot', session], { session }));
      rows.push(await measure('snapshot --interactive', page.name, ['snapshot', session, '--interactive'], { session }));
      rows.push(await measure('snapshot --diff after one action', page.name,
        ['snapshot', session, '--diff'], { session, mutate: page.mutate }));
      rows.push(await measure('structured extract (run page meta)', page.name,
        ['run', session, `return await page('({url:location.href,title:document.title,headings:[...document.querySelectorAll("h1,h2")].length,links:[...document.querySelectorAll("a[href]")].length})')`], { session }));

      await runChromux(['close', session]);
    }
  } finally {
    await runChromux(['kill', profile]);
    server.close();
  }

  const byPage = {};
  for (const row of rows) {
    (byPage[row.page] ||= []).push({ label: row.label, bytes: row.bytes, estTokens: row.estTokens });
  }
  const report = {
    schema: 'chromux.token-benchmark.v1',
    generatedAt: new Date().toISOString(),
    note: 'estTokens = ceil(chars/4); deterministic local fixtures; agent-visible stdout payloads',
    pages: byPage,
  };
  if (outPath) fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));

  console.error('\n| page | command | bytes | ~tokens |');
  console.error('|---|---|---|---|');
  for (const [page, entries] of Object.entries(byPage)) {
    for (const entry of entries) {
      console.error(`| ${page} | ${entry.label} | ${entry.bytes.toLocaleString('en-US')} | ${entry.estTokens.toLocaleString('en-US')} |`);
    }
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
