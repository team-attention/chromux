#!/usr/bin/env node

// Agent-in-the-loop comparison benchmark: chromux vs agent-browser vs
// @playwright/cli.
//
// For every (tool x task x rep) the harness spawns an independent headless
// Claude session (`claude -p`, one fixed model for all tools) whose only
// browser access is the tool under test, then machine-grades the reported
// answer and records wall time, token usage, and turn count from the session
// result JSON.
//
//   node benchmarks/agent-compare-benchmark.mjs --smoke --out /tmp/agent-compare.json
//   node benchmarks/agent-compare-benchmark.mjs --out /tmp/agent-compare.json
//
// Requirements: `claude` CLI on PATH (authenticated), Google Chrome, network
// access for the npm tool install and the external-site tasks. Local-fixture
// tasks are fully deterministic; external tasks are graded against live
// ground truth (Hacker News API) or stable expected facts.
//
// Fairness rules (also documented in docs/benchmark-2026-07.md):
// - same model, same mission template, same max-turns, same grading;
// - each tool is introduced by its vendor's official SKILL.md;
// - per-tool init (binary install + first browser launch) is measured
//   separately and excluded from task metrics;
// - WebFetch/WebSearch/MCP are disabled in the agent session and fixture
//   pages flag non-browser (non-Mozilla UA) access as a failed run.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startFixtureServer, closeFixtureServer, nonBrowserAccess, orderCode, navCode, stepValue, feedStats, inventoryStats, signupCode } from './fixtures.mjs';
import { cloneMiniwob, startMiniwobServer, miniwobSucceeded } from './miniwob.mjs';

const MODULE_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CHROMUX = path.join(MODULE_DIR, 'chromux.mjs');

function argValue(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function normalizeText(text) {
  return String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function run(command, args, { env = process.env, cwd = MODULE_DIR, timeoutMs = 120_000 } = {}) {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const settle = (code, extraErr = '') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: code === 0 && !timedOut,
        code,
        timedOut,
        stdout,
        stderr: extraErr ? `${stderr}\n${extraErr}`.trim() : stderr,
        durationMs: Date.now() - startedAt,
      });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000).unref();
    }, timeoutMs);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    // Settle on 'exit', not 'close': grandchildren (e.g. a browser CLI's
    // detached daemon) can inherit the stdio pipes and hold them open
    // forever, so 'close' may never fire. A short grace period lets any
    // already-buffered output flush first.
    child.on('exit', code => { setTimeout(() => settle(code), 200); });
    child.on('close', code => settle(code));
    child.on('error', err => settle(null, err.message));
  });
}

// ---------------------------------------------------------------------------
// Tool adapters

function findFile(root, matcher, depth = 8) {
  if (depth < 0) return null;
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return null; }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isFile() && matcher(full)) return full;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === '.bin') continue;
    const found = findFile(path.join(root, entry.name), matcher, depth - 1);
    if (found) return found;
  }
  return null;
}

function makeShim(dir, name, lines) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!/bin/sh\n${lines}\n`, { mode: 0o755 });
  return file;
}

function buildTools(runRoot, toolsDir) {
  const nmBin = path.join(toolsDir, 'node_modules', '.bin');
  return [
    {
      name: 'chromux',
      bin: 'chromux',
      stateDir: path.join(runRoot, 'state-chromux'),
      setupShim(shimDir) {
        makeShim(shimDir, 'chromux', `exec "${process.execPath}" "${CHROMUX}" "$@"`);
      },
      env() {
        return {
          CHROMUX_HOME: path.join(this.stateDir, 'home'),
          CHROMUX_PROFILE: 'bench',
          CHROMUX_LAUNCH_MODE: 'headless',
          CHROMUX_OPEN_BACKGROUND: '1',
        };
      },
      skillPath: path.join(MODULE_DIR, 'skills', 'chromux', 'SKILL.md'),
      initArgs: [['launch', 'bench', '--headless']],
      teardownArgs: [['kill', 'bench']],
      async version() {
        try {
          const pkg = JSON.parse(fs.readFileSync(path.join(MODULE_DIR, 'package.json'), 'utf8'));
          return `${pkg.version} (repo working tree)`;
        } catch { return 'local working tree'; }
      },
      browser: 'installed Google Chrome (real Chrome, isolated chromux profile)',
    },
    {
      name: 'agent-browser',
      bin: 'agent-browser',
      stateDir: path.join(runRoot, 'state-agent-browser'),
      setupShim(shimDir) {
        makeShim(shimDir, 'agent-browser', `exec "${path.join(nmBin, 'agent-browser')}" "$@"`);
      },
      env() { return {}; },
      skillPath: findFile(path.join(toolsDir, 'node_modules', 'agent-browser'),
        f => f.endsWith(path.join('skills', 'agent-browser', 'SKILL.md'))),
      initArgs: [['open', 'about:blank']],
      teardownArgs: [['close', '--all']],
      async version() {
        const res = await run(path.join(nmBin, 'agent-browser'), ['--version']);
        return res.stdout.trim();
      },
      browser: 'auto-detected Chrome / Chrome for Testing (Rust daemon)',
    },
    {
      name: 'playwright-cli',
      bin: 'playwright-cli',
      stateDir: path.join(runRoot, 'state-playwright-cli'),
      setupShim(shimDir) {
        makeShim(shimDir, 'playwright-cli', `exec "${path.join(nmBin, 'playwright-cli')}" "$@"`);
      },
      env() { return {}; },
      skillPath: findFile(path.join(toolsDir, 'node_modules'),
        f => f.includes(path.join('cli-client', 'skill')) && f.endsWith('SKILL.md')),
      initArgs: [['open']],
      teardownArgs: [['close-all']],
      async version() {
        const res = await run(path.join(nmBin, 'playwright-cli'), ['--version']);
        return res.stdout.trim();
      },
      browser: 'bundled Playwright Chromium',
    },
  ];
}

// ---------------------------------------------------------------------------
// Tasks

async function hnTopStories(count = 6) {
  const ids = await (await fetch('https://hacker-news.firebaseio.com/v0/topstories.json')).json();
  const items = await Promise.all(ids.slice(0, count).map(async (id) => {
    try {
      return await (await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)).json();
    } catch { return null; }
  }));
  return items.filter(Boolean).map(item => ({ title: item.title, score: item.score }));
}

function buildTasks() {
  return [
    {
      id: 'form-order',
      kind: 'local',
      mission: base => `Open ${base}/form, fill Email with "agent@example.com", Coupon with "SAVE20", select Country "US", and click "Place order". Wait until the status line shows the confirmation code, then report it.\nANSWER JSON shape: {"code": "<confirmation code, looks like ORD-XXXXXXXX>"}`,
      grade({ answer, fixture }) {
        const expected = orderCode('agent@example.com', 'SAVE20', 'US');
        const recorded = fixture.state.orders.some(order => order.code === expected);
        if (!recorded) return { ok: false, reason: 'server did not record the expected order submission' };
        if (String(answer?.code ?? '').toUpperCase() !== expected) return { ok: false, reason: `reported code ${answer?.code} != ${expected}` };
        return { ok: true };
      },
    },
    {
      id: 'feed-extract',
      kind: 'local',
      mission: base => `Open ${base}/feed — a page listing 200 stories, each with a points value. Determine (1) how many stories have strictly more than 700 points and (2) the title of the story with the highest points.\nANSWER JSON shape: {"count": <number>, "topTitle": "<exact story title>"}`,
      grade({ answer }) {
        const expected = feedStats();
        if (Number(answer?.count) !== expected.countAboveThreshold) return { ok: false, reason: `count ${answer?.count} != ${expected.countAboveThreshold}` };
        if (normalizeText(answer?.topTitle) !== normalizeText(expected.topTitle)) return { ok: false, reason: `topTitle mismatch: ${answer?.topTitle}` };
        return { ok: true };
      },
    },
    {
      id: 'nav-tour',
      kind: 'local',
      mission: base => `Open ${base}/start and follow the "Continue" links until you reach the final page, which shows a completion code.\nANSWER JSON shape: {"code": "<completion code, looks like NAV-XXXXXXXX>"}`,
      grade({ answer }) {
        if (String(answer?.code ?? '').toUpperCase() !== navCode()) return { ok: false, reason: `reported code ${answer?.code} != ${navCode()}` };
        return { ok: true };
      },
    },
    {
      id: 'sequential-steps',
      kind: 'local',
      mission: base => `Open ${base}/steps. Click "Step 1" and wait for its value to appear next to the button; then click "Step 2" (it is enabled only after step 1's value appears) and wait for its value; then "Step 3" likewise. Report the three values in order.\nANSWER JSON shape: {"values": ["<value1>", "<value2>", "<value3>"]}`,
      grade({ answer }) {
        const expected = [stepValue(1), stepValue(2), stepValue(3)];
        const got = Array.isArray(answer?.values) ? answer.values.map(v => String(v).toUpperCase()) : [];
        if (got.length !== 3 || expected.some((v, i) => got[i] !== v)) return { ok: false, reason: `values ${JSON.stringify(answer?.values)} != ${JSON.stringify(expected)}` };
        return { ok: true };
      },
    },
    {
      id: 'inventory-aggregate',
      kind: 'local',
      mission: base => `Open ${base}/inventory?page=1 — a product inventory split across 5 pages (use the page links to visit all of them). Across ALL pages, determine (1) the SKU with the highest price and that price, and (2) how many items are priced strictly above $50.\nANSWER JSON shape: {"topSku": "<SKU-XXX>", "topPrice": <number>, "above50": <number>}`,
      grade({ answer }) {
        const expected = inventoryStats();
        if (String(answer?.topSku ?? '').toUpperCase() !== expected.topSku) return { ok: false, reason: `topSku ${answer?.topSku} != ${expected.topSku}` };
        if (Math.abs(Number(answer?.topPrice) - expected.topPrice) > 0.001) return { ok: false, reason: `topPrice ${answer?.topPrice} != ${expected.topPrice}` };
        if (Number(answer?.above50) !== expected.above50) return { ok: false, reason: `above50 ${answer?.above50} != ${expected.above50}` };
        return { ok: true };
      },
    },
    {
      id: 'signup-challenge',
      kind: 'local',
      mission: base => `Open ${base}/signup and create an account with name "Agent Smith" and email "agent@example.com". After submitting, the page will show a server-generated verification question; answer it to finish. Report the account confirmation code shown after successful verification.\nANSWER JSON shape: {"code": "<confirmation code, looks like ACT-XXXXXXXX>"}`,
      grade({ answer, fixture }) {
        const expected = signupCode('agent@example.com');
        const verified = fixture.state.signups.some(s => s.phase === 'verified' && s.code === expected);
        if (!verified) return { ok: false, reason: 'server did not record a successful verification for the expected account' };
        if (String(answer?.code ?? '').toUpperCase() !== expected) return { ok: false, reason: `reported code ${answer?.code} != ${expected}` };
        return { ok: true };
      },
    },
    {
      id: 'miniwob-email-inbox',
      kind: 'miniwob',
      path: '/miniwob/email-inbox.html',
      mission: base => `Open ${base}/miniwob/email-inbox.html — an unmodified task from the MiniWoB++ browser-agent benchmark. Click START, then follow the instruction shown in the yellow box at the top exactly (it names an email and an action such as star, delete, reply, or forward). The page grades you automatically and reports a reward. Work until the reward is positive; if an episode fails, a new one starts with a new instruction — read it and try again.\nANSWER JSON shape: {"instruction": "<the instruction you completed>"}`,
      grade({ fixture }) {
        if (!miniwobSucceeded(fixture.state, '/miniwob/email-inbox.html')) return { ok: false, reason: 'MiniWoB server recorded no positive-reward episode' };
        return { ok: true };
      },
    },
    {
      id: 'miniwob-book-flight',
      kind: 'miniwob',
      path: '/miniwob/book-flight.html',
      mission: base => `Open ${base}/miniwob/book-flight.html — an unmodified task from the MiniWoB++ browser-agent benchmark. Click START, then follow the instruction in the yellow box: fill the flight search form (From/To are autocomplete widgets — type, then pick the matching suggestion), set the departure date, search, and book the flight matching the instruction's criterion (e.g. cheapest or shortest). The page grades you automatically and reports a reward. Work until the reward is positive; if an episode fails, a new one starts with a new instruction — read it and try again.\nANSWER JSON shape: {"instruction": "<the instruction you completed>"}`,
      grade({ fixture }) {
        if (!miniwobSucceeded(fixture.state, '/miniwob/book-flight.html')) return { ok: false, reason: 'MiniWoB server recorded no positive-reward episode' };
        return { ok: true };
      },
    },
    {
      id: 'hn-top-story',
      kind: 'external',
      mission: () => `Open https://news.ycombinator.com and report the title and points of the story currently ranked #1.\nANSWER JSON shape: {"title": "<exact story title>", "points": <number>}`,
      async before(context) { context.hnBefore = await hnTopStories(); },
      async grade({ answer, context }) {
        const after = await hnTopStories();
        const candidates = [...(context.hnBefore || []), ...after];
        const reported = normalizeText(answer?.title);
        if (!reported) return { ok: false, reason: 'no title reported' };
        const match = candidates.some(c => normalizeText(c.title) === reported);
        if (!match) return { ok: false, reason: `title "${answer?.title}" not in HN API top stories around run time` };
        return { ok: true };
      },
    },
    {
      id: 'wikipedia-hop',
      kind: 'external',
      mission: () => `Open https://en.wikipedia.org/wiki/Eiffel_Tower, navigate to the Wikipedia page of the engineer the tower is named after, and report that person's full name and birth year as shown on their page.\nANSWER JSON shape: {"name": "<full name>", "birthYear": <number>}`,
      grade({ answer }) {
        if (!/eiffel/i.test(String(answer?.name ?? ''))) return { ok: false, reason: `unexpected name ${answer?.name}` };
        if (Number(answer?.birthYear) !== 1832) return { ok: false, reason: `birthYear ${answer?.birthYear} != 1832` };
        return { ok: true };
      },
    },
    {
      id: 'google-search',
      kind: 'external',
      mission: () => `Open https://www.google.com, search for "playwright github", and report the URL of the first organic (non-ad) search result.\nANSWER JSON shape: {"url": "<url>"}`,
      grade({ answer }) {
        if (!/github\.com\/microsoft\/playwright/i.test(String(answer?.url ?? ''))) return { ok: false, reason: `url ${answer?.url} is not the expected top result` };
        return { ok: true };
      },
    },
    {
      id: 'youtube-search',
      kind: 'external',
      mission: () => `Open https://www.youtube.com, search for "Never Gonna Give You Up official video", and report the title and channel name of the top video result.\nANSWER JSON shape: {"title": "<video title>", "channel": "<channel name>"}`,
      grade({ answer }) {
        if (!/rick\s*astley/i.test(String(answer?.channel ?? '') + ' ' + String(answer?.title ?? ''))) return { ok: false, reason: `top result ${JSON.stringify(answer)} does not look like the expected video` };
        return { ok: true };
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Agent session

function missionPrompt(tool, taskText) {
  return `Complete the following browser task using ONLY the \`${tool.bin}\` CLI (already installed and on PATH) for all web access. Strict rules:
- Every page access must go through \`${tool.bin}\`. Do not use curl, wget, fetch, or any other HTTP client or browser tool.
- Do not answer from memory: every reported fact must come from what you observed through \`${tool.bin}\` in this session.
- Work efficiently: prefer the smallest observation that answers the question, and avoid re-reading whole pages when a targeted check suffices.

Task: ${taskText}

When the task is complete, print as the final line of your response exactly:
ANSWER: {...}
where {...} is the JSON object described in the task.`;
}

function systemAppend(tool, skillText) {
  return `You are evaluating the "${tool.name}" browser automation CLI. Its official usage guide follows; rely on it for command syntax.\n\n${skillText}`;
}

function parseAnswer(resultText) {
  const source = String(resultText ?? '');
  const idx = source.lastIndexOf('ANSWER:');
  if (idx === -1) return null;
  const tail = source.slice(idx + 'ANSWER:'.length).trim().replace(/^```(json)?/, '').replace(/```$/, '').trim();
  const start = tail.indexOf('{');
  if (start === -1) return null;
  for (let end = tail.length; end > start; end -= 1) {
    if (tail[end - 1] !== '}') continue;
    try { return JSON.parse(tail.slice(start, end)); } catch {}
  }
  return null;
}

async function runAgentSession({ tool, task, rep, model, maxTurns, timeoutMs, shimDir, skillText, workDir, miniwobRoot }) {
  const context = {};
  let fixture = null;
  if (task.kind === 'local') fixture = await startFixtureServer();
  if (task.kind === 'miniwob') fixture = await startMiniwobServer(miniwobRoot);
  if (task.before) await task.before(context);

  const prompt = missionPrompt(tool, task.mission(fixture ? fixture.baseUrl : null));
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('CHROMUX_') || key.startsWith('AGENT_BROWSER_') || key === 'CLAUDE_SESSION_ID') delete env[key];
  }
  Object.assign(env, tool.env(), { PATH: `${shimDir}:${process.env.PATH}` });

  const args = [
    '-p', prompt,
    '--model', model,
    '--output-format', 'json',
    // Headless permission model: only Bash is pre-approved; every other tool
    // (WebFetch, WebSearch, MCP, ...) is denied by default in -p mode.
    '--allowedTools', 'Bash',
    '--max-turns', String(maxTurns),
    '--setting-sources', '',
    '--strict-mcp-config',
    '--disallowedTools', 'WebFetch', 'WebSearch', 'Task',
    '--append-system-prompt', systemAppend(tool, skillText),
  ];
  const sessionStartedAt = Date.now();
  const session = await run('claude', args, { cwd: workDir, env, timeoutMs });

  let parsed = null;
  try { parsed = JSON.parse(session.stdout); } catch {}

  const record = {
    tool: tool.name,
    task: task.id,
    kind: task.kind,
    rep,
    ok: false,
    failureKind: null,
    reason: null,
    durationMs: parsed?.duration_ms ?? session.durationMs,
    durationApiMs: parsed?.duration_api_ms ?? null,
    numTurns: parsed?.num_turns ?? null,
    costUsd: parsed?.total_cost_usd ?? null,
    tokens: parsed ? {
      input: parsed.usage?.input_tokens ?? 0,
      output: parsed.usage?.output_tokens ?? 0,
      cacheRead: parsed.usage?.cache_read_input_tokens ?? 0,
      cacheCreation: parsed.usage?.cache_creation_input_tokens ?? 0,
    } : null,
    sessionId: parsed?.session_id ?? null,
    answer: null,
  };
  if (record.tokens) {
    record.tokens.total = record.tokens.input + record.tokens.output + record.tokens.cacheRead + record.tokens.cacheCreation;
  }

  try {
    if (session.timedOut) {
      record.failureKind = 'timeout';
      record.reason = `session exceeded ${timeoutMs}ms`;
    } else if (!parsed || parsed.is_error) {
      record.failureKind = 'session-error';
      record.reason = (parsed?.result || session.stderr || session.stdout).slice(0, 400);
    } else {
      record.answer = parseAnswer(parsed.result);
      const violations = fixture ? nonBrowserAccess(fixture.state) : [];
      if (fixture && violations.length) {
        record.failureKind = 'non-browser-access';
        record.reason = `fixture saw non-browser requests: ${violations.slice(0, 3).map(v => `${v.method} ${v.route} (${v.userAgent.slice(0, 40) || 'no UA'})`).join('; ')}`;
      } else if (!record.answer) {
        record.failureKind = 'no-answer';
        record.reason = `no parsable ANSWER line in: ${String(parsed.result).slice(-300)}`;
      } else {
        const verdict = await task.grade({ answer: record.answer, fixture, context });
        record.ok = verdict.ok;
        if (!verdict.ok) {
          record.failureKind = 'wrong-answer';
          record.reason = verdict.reason;
        }
      }
    }
    if (!record.ok) {
      if (fixture) record.fixtureOrders = fixture.state.orders || fixture.state.results;
      record.resultTail = String(parsed?.result ?? '').slice(-1500) || null;
    }
    // Diagnostic only (never affects grading): chromux keeps a local activity
    // log, so record which CLI commands the agent issued during this session.
    const activityFile = tool.env().CHROMUX_HOME
      ? path.join(tool.env().CHROMUX_HOME, 'activity', 'events.jsonl') : null;
    if (activityFile && fs.existsSync(activityFile)) {
      try {
        record.commands = fs.readFileSync(activityFile, 'utf8').trim().split('\n')
          .map(line => JSON.parse(line))
          .filter(event => Date.parse(event.timestamp) >= sessionStartedAt)
          .map(event => `${event.command} ${(event.args || []).join(' ')}`.trim()
            + (event.error ? ` !! ${String(event.error).slice(0, 120)}` : ''));
      } catch {}
    }
  } finally {
    if (fixture) await closeFixtureServer(fixture.server);
  }
  return record;
}

// ---------------------------------------------------------------------------
// Main

function summarize(results, tools, tasks) {
  const byTool = {};
  for (const tool of tools) {
    const perTask = {};
    for (const task of tasks) {
      const rows = results.filter(r => r.tool === tool.name && r.task === task.id);
      if (!rows.length) continue;
      const okRows = rows.filter(r => r.ok);
      perTask[task.id] = {
        reps: rows.length,
        successRate: Number((okRows.length / rows.length).toFixed(2)),
        medianDurationMs: median(rows.map(r => r.durationMs)),
        medianTurns: median(rows.map(r => r.numTurns ?? 0)),
        medianTotalTokens: median(rows.map(r => r.tokens?.total ?? 0)),
        medianOutputTokens: median(rows.map(r => r.tokens?.output ?? 0)),
        medianCostUsd: Number((median(rows.map(r => Math.round((r.costUsd ?? 0) * 10_000))) / 10_000).toFixed(4)),
        failures: rows.filter(r => !r.ok).map(r => ({ rep: r.rep, kind: r.failureKind, reason: r.reason?.slice(0, 200) })),
      };
    }
    const all = results.filter(r => r.tool === tool.name);
    byTool[tool.name] = {
      tasks: perTask,
      overall: {
        sessions: all.length,
        successRate: all.length ? Number((all.filter(r => r.ok).length / all.length).toFixed(2)) : 0,
        totalCostUsd: Number(all.reduce((sum, r) => sum + (r.costUsd ?? 0), 0).toFixed(4)),
        totalDurationMs: all.reduce((sum, r) => sum + r.durationMs, 0),
      },
    };
  }
  return byTool;
}

function printTable(summary, tasks) {
  const toolNames = Object.keys(summary);
  console.error('\n| task | metric | ' + toolNames.join(' | ') + ' |');
  console.error('|---|---|' + toolNames.map(() => '---').join('|') + '|');
  for (const task of tasks) {
    const rows = [
      ['success', t => { const s = summary[t].tasks[task.id]; return s ? `${Math.round(s.successRate * 100)}% (${s.reps})` : '-'; }],
      ['median time', t => { const s = summary[t].tasks[task.id]; return s ? `${(s.medianDurationMs / 1000).toFixed(1)}s` : '-'; }],
      ['median turns', t => { const s = summary[t].tasks[task.id]; return s ? String(s.medianTurns) : '-'; }],
      ['median tokens', t => { const s = summary[t].tasks[task.id]; return s ? s.medianTotalTokens.toLocaleString('en-US') : '-'; }],
    ];
    for (const [metric, fn] of rows) {
      console.error(`| ${task.id} | ${metric} | ` + toolNames.map(fn).join(' | ') + ' |');
    }
  }
}

async function main() {
  const smoke = hasArg('--smoke');
  const model = argValue('--model', 'claude-opus-4-8');
  const maxTurns = Number(argValue('--max-turns', '40'));
  const timeoutMs = Number(argValue('--timeout-s', '900')) * 1000;
  const repsLocal = smoke ? 1 : Number(argValue('--reps-local', '3'));
  const repsExternal = smoke ? 0 : Number(argValue('--reps-external', '2'));
  const outPath = argValue('--out', path.join(os.tmpdir(), `agent-compare-${Date.now()}.json`));
  const onlyTools = argValue('--tools', null)?.split(',').map(s => s.trim());
  const onlyTasks = argValue('--tasks', null)?.split(',').map(s => s.trim());

  const probe = await run('claude', ['--version'], { timeoutMs: 30_000 });
  if (!probe.ok) {
    console.error('claude CLI is required on PATH for this benchmark.');
    process.exit(1);
  }

  const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-compare-'));
  const toolsDir = path.join(runRoot, 'tools');
  const shimRoot = path.join(runRoot, 'shims');
  fs.mkdirSync(toolsDir, { recursive: true });

  console.error(`[setup] installing pinned competitor CLIs into ${toolsDir} ...`);
  const install = await run('npm', ['install', '--prefix', toolsDir, 'agent-browser@latest', '@playwright/cli@latest', '--no-audit', '--no-fund'], { timeoutMs: 600_000 });
  if (!install.ok) {
    console.error(`npm install for competitor CLIs failed: ${install.stderr.slice(0, 500)}`);
    process.exit(1);
  }

  let tools = buildTools(runRoot, toolsDir);
  if (onlyTools) tools = tools.filter(t => onlyTools.includes(t.name));
  let tasks = buildTasks();
  if (onlyTasks) tasks = tasks.filter(t => onlyTasks.includes(t.id));
  if (smoke && !onlyTasks) tasks = tasks.filter(t => t.id === 'form-order');

  const init = { npmInstallMs: install.durationMs, tools: {} };
  // MiniWoB++ tasks serve pages from a benchmark checkout fetched at run
  // start (never vendored). If the clone fails, only those tasks are skipped.
  let miniwobRoot = null;
  if (tasks.some(t => t.kind === 'miniwob')) {
    console.error('[setup] fetching MiniWoB++ task pages ...');
    const cloned = await cloneMiniwob(path.join(runRoot, 'miniwob'));
    if (cloned.ok) {
      miniwobRoot = path.join(runRoot, 'miniwob', 'miniwob', 'html');
      init.miniwob = { commit: cloned.commit };
    } else {
      init.miniwob = { skipped: cloned.error };
      tasks = tasks.filter(t => t.kind !== 'miniwob');
      console.error(`[setup] MiniWoB++ unavailable, skipping those tasks: ${cloned.error}`);
    }
  }
  const skills = {};
  const active = [];
  for (const tool of tools) {
    const shimDir = path.join(shimRoot, tool.name);
    fs.mkdirSync(shimDir, { recursive: true });
    fs.mkdirSync(tool.stateDir, { recursive: true });
    tool.setupShim(shimDir);
    tool.shimDir = shimDir;
    tool.workDir = path.join(tool.stateDir, 'work');
    fs.mkdirSync(tool.workDir, { recursive: true });

    if (!tool.skillPath || !fs.existsSync(tool.skillPath)) {
      init.tools[tool.name] = { skipped: `official SKILL.md not found (looked at ${tool.skillPath})` };
      console.error(`[init] ${tool.name}: SKIPPED — ${init.tools[tool.name].skipped}`);
      continue;
    }
    skills[tool.name] = fs.readFileSync(tool.skillPath, 'utf8');

    const env = { ...process.env, ...tool.env(), PATH: `${shimDir}:${process.env.PATH}` };
    const startedAt = Date.now();
    let initOk = true;
    let initErr = '';
    for (const args of tool.initArgs) {
      const res = await run(tool.bin, args, { env, timeoutMs: 300_000 });
      if (!res.ok) { initOk = false; initErr = (res.stderr || res.stdout).slice(0, 400); break; }
    }
    const version = await tool.version(env);
    init.tools[tool.name] = initOk
      ? { browserInitMs: Date.now() - startedAt, version, browser: tool.browser, skill: path.relative(runRoot, tool.skillPath).startsWith('..') ? tool.skillPath : path.relative(runRoot, tool.skillPath) }
      : { skipped: `init failed: ${initErr}` };
    console.error(`[init] ${tool.name}: ${initOk ? `ready in ${Date.now() - startedAt}ms (${version})` : `SKIPPED — ${initErr}`}`);
    if (initOk) active.push(tool);
  }

  const plan = [];
  for (const task of tasks) {
    const reps = task.kind === 'external' ? repsExternal : repsLocal;
    for (let rep = 1; rep <= reps; rep += 1) {
      for (const tool of active) plan.push({ tool, task, rep });
    }
  }
  console.error(`[plan] ${plan.length} agent sessions (${active.map(t => t.name).join(', ')}) x (${tasks.map(t => t.id).join(', ')}), model=${model}`);

  const results = [];
  try {
    for (const [index, item] of plan.entries()) {
      console.error(`[run ${index + 1}/${plan.length}] ${item.tool.name} / ${item.task.id} rep ${item.rep} ...`);
      const record = await runAgentSession({
        tool: item.tool,
        task: item.task,
        rep: item.rep,
        model,
        maxTurns,
        timeoutMs,
        shimDir: item.tool.shimDir,
        skillText: skills[item.tool.name],
        workDir: item.tool.workDir,
        miniwobRoot,
      });
      results.push(record);
      console.error(`         ${record.ok ? 'PASS' : `FAIL (${record.failureKind})`} in ${(record.durationMs / 1000).toFixed(1)}s, turns=${record.numTurns}, tokens=${record.tokens?.total?.toLocaleString('en-US') ?? '?'}${record.ok ? '' : ` — ${record.reason?.slice(0, 160)}`}`);
    }
  } finally {
    for (const tool of active) {
      const env = { ...process.env, ...tool.env(), PATH: `${tool.shimDir}:${process.env.PATH}` };
      for (const args of tool.teardownArgs) await run(tool.bin, args, { env, timeoutMs: 60_000 });
    }
  }

  const summary = summarize(results, active, tasks);
  const report = {
    schema: 'chromux.agent-compare.v1',
    generatedAt: new Date().toISOString(),
    model,
    maxTurns,
    repsLocal,
    repsExternal,
    smoke,
    platform: `${os.type()} ${os.release()} ${os.arch()}`,
    init,
    summary,
    results,
  };
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...report, results: undefined }, null, 2));
  printTable(summary, tasks);
  console.error(`\n[done] full report with per-session records: ${outPath}`);
  const graded = results.length;
  const passed = results.filter(r => r.ok).length;
  console.error(`[done] ${passed}/${graded} sessions passed; total cost $${results.reduce((s, r) => s + (r.costUsd ?? 0), 0).toFixed(2)}`);
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
