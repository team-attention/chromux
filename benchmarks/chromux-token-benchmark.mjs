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

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startFixtureServer } from './fixtures.mjs';

const MODULE_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CHROMUX = path.join(MODULE_DIR, 'chromux.mjs');

function argValue(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

function estimateTokens(text) {
  return Math.ceil(String(text).length / 4);
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
  const { server, baseUrl: base } = await startFixtureServer();
  const profile = `tokens-${Date.now().toString(36)}`;
  process.env.CHROMUX_PROFILE = profile;
  const rows = [];

  try {
    const launched = await runChromux(['launch', profile, '--headless']);
    if (!launched.ok) throw new Error(`launch failed: ${launched.stderr}`);

    const pages = [
      { name: 'article', url: `${base}/`, mutate: `return await js('const b=document.createElement("button");b.textContent="Comment";document.querySelector("main").appendChild(b);return 1')` },
      { name: 'form', url: `${base}/form`, mutate: `return await js('document.getElementById("status").textContent="Saved";return 1')` },
      { name: 'feed-200', url: `${base}/feed`, findText: 'headline number 153', mutate: `return await js('const a=document.createElement("article");a.innerHTML="<h2><a href=\\'/story/new\\'>Breaking story</a></h2>";document.querySelector("main").prepend(a);return 1')` },
      // Real-sized page: sticky header, dense nav, div-based product cards
      // (clickable ratio gate fires), cookie consent dialog (occluder).
      { name: 'shop', url: `${base}/shop`, findText: 'Linen Notebook', mutate: `return await js('document.getElementById("status").textContent="Selected SHP-00: probe";return 1')` },
    ];

    // Behavior guard on the real-sized fixture (not a payload metric): the
    // content-covering cookie dialog must be flagged as an overlay, and the
    // bottom consent-bar variant must NOT be.
    {
      const opened = await runChromux(['open', 'tok-occln', `${base}/shop`]);
      if (!opened.ok) throw new Error(`open shop occlusion probe failed: ${opened.stderr}`);
      const snap = await runChromux(['snapshot', 'tok-occln']);
      if (!/overlay \(covers page/.test(snap.stdout)) {
        throw new Error('regression: shop cookie dialog not flagged as overlay');
      }
      const openedBar = await runChromux(['open', 'tok-occln', `${base}/shop?consent=bar`]);
      if (!openedBar.ok) throw new Error(`open shop consent=bar failed: ${openedBar.stderr}`);
      const snapBar = await runChromux(['snapshot', 'tok-occln']);
      if (/overlay \(covers page/.test(snapBar.stdout)) {
        throw new Error('regression: bottom consent bar wrongly flagged as page-wide overlay');
      }
      await runChromux(['close', 'tok-occln']);
    }

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
      if (page.findText) {
        rows.push(await measure('snapshot --grep (find one item)', page.name,
          ['snapshot', session, '--grep', page.findText], { session }));
      }
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

  // Regression guard: observation payload size is a first-class metric, so
  // exceeding these budgets fails the benchmark (and thereby ./test.sh).
  // Budgets are ~10% above the published Token Footprint numbers — raise them
  // only for a deliberate, documented trade-off.
  const BUDGETS = {
    'article:snapshot (full)': 900,
    'article:snapshot --interactive': 60,
    'form:snapshot (full)': 110,
    'form:snapshot --interactive': 60,
    'feed-200:snapshot (full)': 15700,
    'feed-200:snapshot --interactive': 7900,
    'feed-200:snapshot --diff after one action': 100,
    'feed-200:snapshot --grep (find one item)': 150,
    'shop:snapshot (full)': 900,
    'shop:snapshot --interactive': 640,
    'shop:snapshot --diff after one action': 100,
    'shop:snapshot --grep (find one item)': 100,
  };
  const over = [];
  for (const [page, entries] of Object.entries(byPage)) {
    for (const entry of entries) {
      const budget = BUDGETS[`${page}:${entry.label}`];
      if (budget != null && entry.estTokens > budget) {
        over.push(`${page} / ${entry.label}: ~${entry.estTokens} tokens > budget ${budget}`);
      }
    }
  }
  if (over.length) {
    console.error(`\nPayload budget exceeded:\n- ${over.join('\n- ')}`);
    process.exit(1);
  }
  console.error('\nPayload budgets: all within limits.');
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
