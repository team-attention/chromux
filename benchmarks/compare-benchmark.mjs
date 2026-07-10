#!/usr/bin/env node

// Deterministic (no-LLM) cross-tool comparison: chromux vs agent-browser vs
// @playwright/cli on identical local fixture pages.
//
// Measures, per tool:
// - agent-visible stdout bytes (~tokens at chars/4) for the idiomatic
//   observation commands: full snapshot, interactive-only snapshot,
//   post-action verification (chromux `snapshot --diff` vs re-snapshot and a
//   targeted read on the others), and structured extraction;
// - warm command latency (p50 over --reps runs) for navigate / snapshot;
// - a parallel-session isolation probe: two sessions open different URLs,
//   then each is asked for its current URL.
//
// This explains *why* the agent-in-the-loop numbers
// (agent-compare-benchmark.mjs) come out the way they do: payload size drives
// tokens, and command latency plus roundtrip count drives wall time.
//
//   node benchmarks/compare-benchmark.mjs --out /tmp/compare.json
//
// Competitor CLIs are installed on demand with npm into a temp prefix; no
// runtime dependency is added to chromux itself.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startFixtureServer, closeFixtureServer } from './fixtures.mjs';

const MODULE_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CHROMUX = path.join(MODULE_DIR, 'chromux.mjs');

function argValue(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

function estimateTokens(text) {
  return Math.ceil(String(text).length / 4);
}

function percentile(values, q) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * q)));
  return sorted[idx];
}

function run(command, args, { env = process.env, timeoutMs = 120_000 } = {}) {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    // Neutral cwd: some CLIs (playwright-cli) create a workspace directory in
    // the cwd, which must not pollute the chromux repo.
    const child = spawn(command, args, { cwd: os.tmpdir(), env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const settle = (code, extraErr = '') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        code,
        stdout,
        stderr: extraErr ? `${stderr}\n${extraErr}`.trim() : stderr,
        durationMs: Date.now() - startedAt,
      });
    };
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    // Settle on 'exit', not 'close': a detached browser daemon can inherit
    // the stdio pipes and keep 'close' from ever firing.
    child.on('exit', code => { setTimeout(() => settle(code), 200); });
    child.on('close', code => settle(code));
    child.on('error', err => settle(null, err.message));
  });
}

const MUTATE_JS = `document.getElementById('status') ? (document.getElementById('status').textContent = 'Saved') : document.querySelector('main').appendChild(Object.assign(document.createElement('button'), { textContent: 'Comment' }))`;
const EXTRACT_JS = `({ url: location.href, title: document.title, headings: [...document.querySelectorAll('h1,h2')].length, links: [...document.querySelectorAll('a[href]')].length })`;

function buildTools(toolsDir, runRoot) {
  const nmBin = path.join(toolsDir, 'node_modules', '.bin');
  return [
    {
      name: 'chromux',
      env: {
        CHROMUX_HOME: path.join(runRoot, 'chromux-home'),
        CHROMUX_PROFILE: 'cmp',
        CHROMUX_LAUNCH_MODE: 'headless',
        CHROMUX_OPEN_BACKGROUND: '1',
      },
      exec(args, opts = {}) { return run(process.execPath, [CHROMUX, ...args], { env: { ...process.env, ...this.env }, ...opts }); },
      init() { return this.exec(['launch', 'cmp', '--headless'], { timeoutMs: 120_000 }); },
      teardown() { return this.exec(['kill', 'cmp']); },
      session: name => name,
      open(session, url) { return this.exec(['open', session, url]); },
      snapshotFull(session) { return this.exec(['snapshot', session]); },
      snapshotInteractive(session) { return this.exec(['snapshot', session, '--interactive']); },
      mutate(session) { return this.exec(['run', session, `return await js(${JSON.stringify(MUTATE_JS)})`]); },
      postActionDiffOrResnap(session) { return this.exec(['snapshot', session, '--diff']); },
      postActionTargeted(session) { return this.exec(['run', session, `return await page(${JSON.stringify(`document.getElementById('status')?.textContent ?? 'n/a'`)})`]); },
      findByText(session, text) { return this.exec(['snapshot', session, '--grep', text]); },
      extract(session) { return this.exec(['run', session, `return await page(${JSON.stringify(EXTRACT_JS)})`]); },
      currentUrl(session) { return this.exec(['run', session, `return await page('location.href')`]); },
      close(session) { return this.exec(['close', session]); },
    },
    {
      name: 'agent-browser',
      bin: path.join(nmBin, 'agent-browser'),
      exec(args, session, opts = {}) {
        const env = { ...process.env };
        if (session) env.AGENT_BROWSER_SESSION = session;
        return run(this.bin, args, { env, ...opts });
      },
      init() { return this.exec(['open', 'about:blank'], 'cmp-warm', { timeoutMs: 300_000 }); },
      teardown() { return this.exec(['close', '--all'], null); },
      open(session, url) { return this.exec(['open', url], session); },
      snapshotFull(session) { return this.exec(['snapshot'], session); },
      snapshotInteractive(session) { return this.exec(['snapshot', '-i'], session); },
      mutate(session) { return this.exec(['eval', MUTATE_JS], session); },
      postActionDiffOrResnap(session) { return this.exec(['snapshot', '-i'], session); },
      postActionTargeted(session) { return this.exec(['get', 'text', '#status'], session); },
      // agent-browser has no text-search command; its documented way to locate
      // an element by text is reading the (interactive) snapshot.
      findByText(session) { return this.exec(['snapshot', '-i'], session); },
      extract(session) { return this.exec(['eval', EXTRACT_JS], session); },
      currentUrl(session) { return this.exec(['get', 'url'], session); },
      close(session) { return this.exec(['close'], session); },
    },
    {
      name: 'playwright-cli',
      bin: path.join(nmBin, 'playwright-cli'),
      exec(args, session, opts = {}) {
        const prefixed = session ? [`-s=${session}`, ...args] : args;
        return run(this.bin, prefixed, { env: process.env, ...opts });
      },
      init() { return this.exec(['open', 'about:blank'], 'cmp-warm', { timeoutMs: 300_000 }); },
      teardown() { return this.exec(['close-all'], null); },
      open(session, url) { return this.exec(['open', url], session); },
      snapshotFull(session) { return this.exec(['snapshot'], session); },
      snapshotInteractive(session) { return this.exec(['snapshot'], session); },
      mutate(session) { return this.exec(['eval', `() => { ${MUTATE_JS}; }`], session); },
      postActionDiffOrResnap(session) { return this.exec(['snapshot'], session); },
      postActionTargeted(session) { return this.exec(['eval', `() => document.getElementById('status')?.textContent ?? 'n/a'`], session); },
      findByText(session, text) { return this.exec(['find', text], session); },
      extract(session) { return this.exec(['eval', `() => (${EXTRACT_JS})`], session); },
      currentUrl(session) { return this.exec(['eval', '() => location.href'], session); },
      close(session) { return this.exec(['close'], session); },
    },
  ];
}

async function measurePayloads(tool, baseUrl, pages) {
  const rows = [];
  for (const page of pages) {
    const session = `cmp-${page}`;
    const opened = await tool.open(session, `${baseUrl}/${page === 'article' ? '' : page}`);
    if (!opened.ok) throw new Error(`${tool.name} open ${page} failed: ${(opened.stderr || opened.stdout).slice(0, 300)}`);
    const steps = [
      ['snapshot (full)', () => tool.snapshotFull(session)],
      ['snapshot (interactive-only)', () => tool.snapshotInteractive(session)],
    ];
    for (const [label, fn] of steps) {
      const res = await fn();
      if (!res.ok) throw new Error(`${tool.name} ${label} on ${page} failed: ${(res.stderr || res.stdout).slice(0, 300)}`);
      rows.push({ page, label, bytes: Buffer.byteLength(res.stdout), estTokens: estimateTokens(res.stdout) });
    }
    const mutated = await tool.mutate(session);
    if (!mutated.ok) throw new Error(`${tool.name} mutate on ${page} failed: ${(mutated.stderr || mutated.stdout).slice(0, 300)}`);
    const post = await tool.postActionDiffOrResnap(session);
    rows.push({ page, label: 'post-action verification (idiomatic)', bytes: Buffer.byteLength(post.stdout), estTokens: estimateTokens(post.stdout) });
    if (page === 'form') {
      const targeted = await tool.postActionTargeted(session);
      rows.push({ page, label: 'post-action verification (targeted read)', bytes: Buffer.byteLength(targeted.stdout), estTokens: estimateTokens(targeted.stdout) });
    }
    if (page === 'feed' && tool.findByText) {
      const found = await tool.findByText(session, 'headline number 153');
      if (!found.ok) throw new Error(`${tool.name} find-by-text on ${page} failed: ${(found.stderr || found.stdout).slice(0, 300)}`);
      rows.push({ page, label: 'find one item by text', bytes: Buffer.byteLength(found.stdout), estTokens: estimateTokens(found.stdout) });
    }
    const extract = await tool.extract(session);
    rows.push({ page, label: 'structured extract', bytes: Buffer.byteLength(extract.stdout), estTokens: estimateTokens(extract.stdout) });
    await tool.close(session);
  }
  return rows;
}

async function measureLatency(tool, baseUrl, reps) {
  const session = 'cmp-lat';
  const navigate = [];
  const snapshot = [];
  for (let i = 0; i < reps; i += 1) {
    const nav = await tool.open(session, `${baseUrl}/?rep=${i}`);
    if (!nav.ok) throw new Error(`${tool.name} latency open failed: ${(nav.stderr || nav.stdout).slice(0, 300)}`);
    navigate.push(nav.durationMs);
    const snap = await tool.snapshotInteractive(session);
    if (!snap.ok) throw new Error(`${tool.name} latency snapshot failed: ${(snap.stderr || snap.stdout).slice(0, 300)}`);
    snapshot.push(snap.durationMs);
  }
  await tool.close(session);
  return {
    navigateP50Ms: percentile(navigate, 0.5),
    navigateP95Ms: percentile(navigate, 0.95),
    snapshotP50Ms: percentile(snapshot, 0.5),
    snapshotP95Ms: percentile(snapshot, 0.95),
    reps,
  };
}

async function probeParallelIsolation(tool, baseUrl) {
  const urlA = `${baseUrl}/form`;
  const urlB = `${baseUrl}/steps`;
  const openA = await tool.open('cmp-par-a', urlA);
  const openB = await tool.open('cmp-par-b', urlB);
  if (!openA.ok || !openB.ok) return { ok: false, detail: 'session open failed' };
  const backA = await tool.currentUrl('cmp-par-a');
  const backB = await tool.currentUrl('cmp-par-b');
  await tool.close('cmp-par-a');
  await tool.close('cmp-par-b');
  const aIsolated = backA.stdout.includes('/form');
  const bIsolated = backB.stdout.includes('/steps');
  return {
    ok: aIsolated && bIsolated,
    detail: aIsolated && bIsolated
      ? 'two sessions kept independent pages'
      : `session A reported ${backA.stdout.trim().slice(0, 80)}; session B reported ${backB.stdout.trim().slice(0, 80)}`,
  };
}

async function main() {
  const outPath = argValue('--out', path.join(os.tmpdir(), `compare-benchmark-${Date.now()}.json`));
  const reps = Number(argValue('--reps', '5'));
  const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'compare-bench-'));
  const toolsDir = path.join(runRoot, 'tools');
  fs.mkdirSync(toolsDir, { recursive: true });

  console.error(`[setup] installing pinned competitor CLIs into ${toolsDir} ...`);
  const install = await run('npm', ['install', '--prefix', toolsDir, 'agent-browser@latest', '@playwright/cli@latest', '--no-audit', '--no-fund'], { timeoutMs: 600_000 });
  if (!install.ok) {
    console.error(`npm install failed: ${install.stderr.slice(0, 500)}`);
    process.exit(1);
  }

  const { server, baseUrl } = await startFixtureServer();
  const pages = ['article', 'form', 'feed'];
  const tools = buildTools(toolsDir, runRoot);
  const report = {
    schema: 'chromux.compare-benchmark.v1',
    generatedAt: new Date().toISOString(),
    platform: `${os.type()} ${os.release()} ${os.arch()}`,
    note: 'estTokens = ceil(chars/4); identical deterministic local fixtures; agent-visible stdout payloads; warm-command latency',
    tools: {},
  };

  try {
    for (const tool of tools) {
      console.error(`[${tool.name}] init ...`);
      const initRes = await tool.init();
      if (!initRes.ok) {
        report.tools[tool.name] = { skipped: `init failed: ${(initRes.stderr || initRes.stdout).slice(0, 300)}` };
        console.error(`[${tool.name}] SKIPPED — init failed`);
        continue;
      }
      try {
        console.error(`[${tool.name}] payloads ...`);
        const payloads = await measurePayloads(tool, baseUrl, pages);
        console.error(`[${tool.name}] latency (${reps} reps) ...`);
        const latency = await measureLatency(tool, baseUrl, reps);
        console.error(`[${tool.name}] parallel isolation probe ...`);
        const parallelIsolation = await probeParallelIsolation(tool, baseUrl);
        report.tools[tool.name] = { initMs: initRes.durationMs, payloads, latency, parallelIsolation };
      } catch (err) {
        report.tools[tool.name] = { failed: err.message.slice(0, 500) };
        console.error(`[${tool.name}] FAILED — ${err.message.slice(0, 200)}`);
      } finally {
        await tool.teardown();
      }
    }
  } finally {
    await closeFixtureServer(server);
  }

  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));

  const names = Object.keys(report.tools).filter(name => report.tools[name].payloads);
  if (names.length) {
    console.error('\n| page | command | ' + names.map(n => `${n} ~tokens`).join(' | ') + ' |');
    console.error('|---|---|' + names.map(() => '---').join('|') + '|');
    const seen = new Set();
    for (const { page, label } of report.tools[names[0]].payloads) {
      if (seen.has(`${page}|${label}`)) continue;
      seen.add(`${page}|${label}`);
      const cells = names.map(name => {
        const row = report.tools[name].payloads.find(r => r.page === page && r.label === label);
        return row ? row.estTokens.toLocaleString('en-US') : '-';
      });
      console.error(`| ${page} | ${label} | ${cells.join(' | ')} |`);
    }
    console.error('\n| metric | ' + names.join(' | ') + ' |');
    console.error('|---|' + names.map(() => '---').join('|') + '|');
    console.error('| navigate p50 | ' + names.map(n => `${report.tools[n].latency.navigateP50Ms}ms`).join(' | ') + ' |');
    console.error('| snapshot p50 | ' + names.map(n => `${report.tools[n].latency.snapshotP50Ms}ms`).join(' | ') + ' |');
    console.error('| parallel sessions isolated | ' + names.map(n => report.tools[n].parallelIsolation.ok ? 'yes' : `NO (${report.tools[n].parallelIsolation.detail})`).join(' | ') + ' |');
  }
  console.error(`\n[done] report: ${outPath}`);
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
