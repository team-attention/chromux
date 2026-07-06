#!/usr/bin/env node

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CHROMUX = path.join(MODULE_DIR, 'chromux.mjs');

function argValue(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
}

function percentile(sorted, q) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * q)));
  return sorted[idx];
}

function fixtureHtml(route) {
  if (route.startsWith('/form')) {
    return `<!doctype html><title>Chromux Form Fixture</title>
      <main>
        <h1>Form Fixture</h1>
        <input id="name" aria-label="Name">
        <button id="save">Save</button>
        <p id="status">Waiting</p>
      </main>
      <script>
        document.getElementById('save').addEventListener('click', () => {
          const value = document.getElementById('name').value;
          setTimeout(() => { document.getElementById('status').textContent = 'Saved: ' + value.length; }, 150);
        });
      </script>`;
  }
  if (route.startsWith('/batch/')) {
    const id = route.split('/').pop();
    return `<!doctype html><title>Batch ${id}</title><article><h1>Batch ${id}</h1><p>${'content '.repeat(80)}</p></article>`;
  }
  if (route.startsWith('/broken')) {
    return `<!doctype html><title>Broken Resource Fixture</title><h1>Broken</h1><img src="/missing-image.png">`;
  }
  return `<!doctype html><title>Chromux Benchmark Fixture</title>
    <main>
      <h1>Chromux Benchmark</h1>
      <a href="/form">Form</a>
      <button id="ready" onclick="document.body.dataset.clicked='yes'">Ready</button>
      <section>${'<p>Benchmark text for snapshot and extraction.</p>'.repeat(30)}</section>
    </main>`;
}

function startFixtureServer() {
  const server = http.createServer((req, res) => {
    if (req.url === '/missing-image.png') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('missing');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(fixtureHtml(req.url || '/'));
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function runChromux(args, env, timeoutMs = 90_000) {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CHROMUX, ...args], {
      cwd: MODULE_DIR,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({ ok: false, code: null, stdout, stderr: `${stderr}\nTimed out after ${timeoutMs}ms`.trim(), durationMs: Date.now() - startedAt });
    }, timeoutMs);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code, stdout: stdout.trim(), stderr: stderr.trim(), durationMs: Date.now() - startedAt });
    });
    child.on('error', err => {
      clearTimeout(timer);
      resolve({ ok: false, code: null, stdout: stdout.trim(), stderr: err.message, durationMs: Date.now() - startedAt });
    });
  });
}

function sanitizeCommandArgs(args) {
  const out = args.map(arg => String(arg));
  const command = out[0];
  if (command !== 'run') return out;
  return out.map((arg, index) => {
    if (index <= 1) return arg;
    if (arg === '-' || arg === '--file' || out[index - 1] === '--file' || arg === '--timeout' || out[index - 1] === '--timeout' || arg === '--receipt' || out[index - 1] === '--receipt') return arg;
    return '[code]';
  });
}

function parseJsonOutput(result, label) {
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`${label} did not return JSON: ${result.stdout || result.stderr}`);
  }
}

async function checked(label, args, env, commands, timeoutMs) {
  const result = await runChromux(args, env, timeoutMs);
  commands.push({ label, args: sanitizeCommandArgs(args), ok: result.ok, code: result.code, durationMs: result.durationMs, stderr: result.stderr.slice(0, 500) });
  if (!result.ok) throw new Error(`${label} failed: ${result.stderr || result.stdout}`);
  return result;
}

async function main() {
  const outPath = argValue('--out', path.join(os.tmpdir(), `chromux-benchmark-${Date.now()}.json`));
  const smoke = hasArg('--smoke');
  const server = await startFixtureServer();
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const profile = `bench-${process.pid}-${Date.now().toString(36)}`;
  const env = {
    ...process.env,
    CHROMUX_PROFILE: profile,
    CHROMUX_MODE: 'crawl',
    CHROMUX_LAUNCH_MODE: 'headless',
    CHROMUX_OPEN_BACKGROUND: '1',
  };
  const commands = [];
  const metrics = {};
  const artifacts = {};
  let urlsPath = null;

  try {
    metrics.coldLaunchMs = (await checked('cold launch', ['launch', profile, '--headless'], env, commands)).durationMs;
    metrics.warmPsMs = (await checked('ps json', ['ps', '--json'], env, commands)).durationMs;
    metrics.openMs = (await checked('open fixture', ['open', 'bench-main', `${baseUrl}/`], env, commands)).durationMs;
    metrics.runExtractMs = (await checked('run page extract', ['run', 'bench-main', '--file', path.join('snippets', '_builtin', 'page-extract.js')], env, commands)).durationMs;
    metrics.snapshotFullMs = (await checked('snapshot full', ['snapshot', 'bench-main'], env, commands)).durationMs;
    metrics.snapshotInteractiveMs = (await checked('snapshot interactive', ['snapshot', 'bench-main', '--interactive'], env, commands)).durationMs;

    const screenshotPath = outPath.replace(/\.json$/i, '.png');
    await checked('screenshot evidence', ['screenshot', 'bench-main', screenshotPath], env, commands);
    artifacts.screenshot = screenshotPath;

    await checked('open form fixture', ['open', 'bench-form', `${baseUrl}/form`], env, commands);
    const receiptPath = outPath.replace(/\.json$/i, '-run-receipt.json');
    const formCode = `
      await waitFor('#name', { kind: 'selector', timeoutMs: 5000 });
      await js("document.getElementById('name').value='benchmark'; document.getElementById('name').dispatchEvent(new Event('input', {bubbles:true}))");
      await js("document.getElementById('save').click()");
      const ready = await waitFor('Saved:', { kind: 'text', timeoutMs: 5000 });
      return { ready, page: await page('({url:location.href,title:document.title})') };
    `;
    metrics.interactionMs = (await checked('run form flow', ['run', 'bench-form', formCode, '--receipt', receiptPath], env, commands)).durationMs;
    artifacts.runReceipt = receiptPath;

    urlsPath = path.join(os.tmpdir(), `chromux-benchmark-urls-${process.pid}.txt`);
    const batchOutPath = outPath.replace(/\.json$/i, '-batch.jsonl');
    const urls = Array.from({ length: smoke ? 3 : 6 }, (_, i) => `${baseUrl}/batch/${i + 1}`).join('\n') + '\n';
    fs.writeFileSync(urlsPath, urls);
    const batchResult = await checked('batch local fixtures', ['batch', '--file', urlsPath, '--workers', smoke ? '2' : '3', '--retries', '1', '--host-backoff-ms', '50', '--out', batchOutPath, '--session-prefix', 'bench-batch'], env, commands, 120_000);
    const batchSummary = parseJsonOutput(batchResult, 'batch');
    metrics.batchMs = batchResult.durationMs;
    metrics.batchP50DurationMs = batchSummary.p50DurationMs;
    metrics.batchP95DurationMs = batchSummary.p95DurationMs;
    metrics.batchThroughputPerSec = batchSummary.total ? Number((batchSummary.total / Math.max(0.001, batchResult.durationMs / 1000)).toFixed(2)) : 0;
    artifacts.batchJsonl = batchOutPath;
    artifacts.urls = urlsPath;

    const durations = Object.entries(metrics)
      .filter(([, value]) => typeof value === 'number')
      .map(([, value]) => value)
      .sort((a, b) => a - b);
    const output = {
      schema: 'chromux.benchmark.v1',
      ok: true,
      smoke,
      generatedAt: new Date().toISOString(),
      fixture: { baseUrl, deterministic: true },
      profile,
      metrics: {
        ...metrics,
        p50CommandMs: percentile(durations, 0.50),
        p95CommandMs: percentile(durations, 0.95),
      },
      thresholds: {
        batchFailedMustBeZero: true,
        runReceiptMustExist: true,
        screenshotMustExist: true,
      },
      batch: batchSummary,
      resources: parseJsonOutput(await checked('ps json final', ['ps', '--json'], env, commands), 'ps final'),
      artifacts,
      commands,
    };
    writeJson(outPath, output);
    console.log(JSON.stringify(output, null, 2));
  } finally {
    if (urlsPath && fs.existsSync(urlsPath)) {
      try { fs.unlinkSync(urlsPath); } catch {}
    }
    await runChromux(['kill', profile], { ...process.env, CHROMUX_PROFILE: profile }, 30_000);
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
