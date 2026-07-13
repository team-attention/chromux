// Pinned WebGames adapter for the agent capability benchmark.
//
// The upstream checkout and build stay under the benchmark's temporary run
// directory. Nothing from WebGames is vendored or added to chromux runtime.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

export const WEBGAMES_REPO = 'https://github.com/convergence-ai/webgames.git';
export const WEBGAMES_COMMIT = '309866f64642b864414ca2c7ff956e59e01d3317';
export const WEBGAMES_LICENSE = 'Apache-2.0';

export const WEBGAMES_VISUAL_COMMANDS = Object.freeze([
  'help',
  'open',
  'screenshot',
  'hover',
  'click',
  'drag',
  'type',
  'press',
  'scroll',
  'wait',
  'close',
  'list',
]);

const WEBGAMES_COMPLETION_PASSWORD_HASHES = Object.freeze({
  'canvas-catch-easy': '3e3af3a299f1cb323a69cb4fd892df0056dca4d3ba6e6919d83a6687f3278c89',
  'map-panner-easy': '1e71a85d68b00608dd9b5207e6572af6ca0fe73def754b3c6b887796586e98ca',
  'slider-symphony-easy': '8b1c022badb33fb18afc32e4caf305f0502aa4d0c803ede24f8a2dcba65c3a4b',
});

export const WEBGAMES_BENCHMARK_TASKS = Object.freeze([
  {
    benchmarkId: 'webgames-canvas-target',
    upstreamTaskId: 'canvas-catch-easy',
    category: 'canvas-target',
    timed: false,
  },
  {
    benchmarkId: 'webgames-drag-drop',
    upstreamTaskId: 'map-panner-easy',
    category: 'drag-drop',
    timed: false,
  },
  {
    benchmarkId: 'webgames-slider',
    upstreamTaskId: 'slider-symphony-easy',
    category: 'slider',
    timed: false,
  },
]);

function run(command, args, { cwd, timeoutMs = 600_000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000).unref();
    }, timeoutMs);
    const settle = (code, error = '') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        code,
        stdout,
        stderr: error ? `${stderr}\n${error}`.trim() : stderr,
      });
    };
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('exit', code => settle(code));
    child.on('error', error => settle(null, error.message));
  });
}

async function checked(command, args, options) {
  const result = await run(command, args, options);
  if (!result.ok) {
    const detail = (result.stderr || result.stdout).trim().slice(-1200);
    throw new Error(`${command} ${args.join(' ')} failed (${result.code}): ${detail}`);
  }
  return result;
}

export async function prepareWebgames(destDir) {
  const startedAt = Date.now();
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });

  await checked('git', ['init', '--quiet'], { cwd: destDir });
  await checked('git', ['remote', 'add', 'origin', WEBGAMES_REPO], { cwd: destDir });
  await checked('git', ['fetch', '--quiet', '--depth', '1', 'origin', WEBGAMES_COMMIT], { cwd: destDir });
  await checked('git', ['checkout', '--quiet', '--detach', 'FETCH_HEAD'], { cwd: destDir });
  const resolved = (await checked('git', ['rev-parse', 'HEAD'], { cwd: destDir })).stdout.trim();
  if (resolved !== WEBGAMES_COMMIT) {
    throw new Error(`WebGames checkout ${resolved} does not match pin ${WEBGAMES_COMMIT}`);
  }

  const licenseText = fs.readFileSync(path.join(destDir, 'LICENSE'), 'utf8');
  if (!/Apache License[\s\S]*Version 2\.0/.test(licenseText.slice(0, 1000))) {
    throw new Error('WebGames checkout does not contain the expected Apache-2.0 license');
  }

  const appRoot = path.join(destDir, 'webgames');
  await checked('pnpm', ['install', '--frozen-lockfile'], { cwd: appRoot, timeoutMs: 600_000 });
  await checked('pnpm', ['run', 'build'], { cwd: appRoot, timeoutMs: 600_000 });
  const distRoot = path.join(appRoot, 'dist');
  if (!fs.existsSync(path.join(distRoot, 'index.html'))) {
    throw new Error('WebGames build did not produce dist/index.html');
  }

  return {
    repo: WEBGAMES_REPO,
    commit: resolved,
    license: WEBGAMES_LICENSE,
    appRoot,
    distRoot,
    buildMs: Date.now() - startedAt,
  };
}

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
};

function readJson(req, callback) {
  let body = '';
  req.setEncoding('utf8');
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    let value = {};
    try { value = JSON.parse(body); } catch {}
    callback(value);
  });
}

export function startWebgamesServer(distRoot) {
  const state = { completions: [], views: [], accessLog: [] };
  const normalizedRoot = path.resolve(distRoot);
  const server = http.createServer((req, res) => {
    const route = decodeURIComponent((req.url || '/').split('?')[0]);
    state.accessLog.push({
      route,
      method: req.method,
      userAgent: req.headers['user-agent'] || '',
      at: Date.now(),
    });

    if (req.method === 'POST' && (route === '/api/record-completion' || route === '/api/record-view')) {
      readJson(req, payload => {
        const event = {
          taskId: String(payload.taskId || ''),
          at: Date.now(),
          pagePath: (() => {
            try { return new URL(payload.url).pathname; } catch { return ''; }
          })(),
        };
        if (route.endsWith('record-completion')) state.completions.push(event);
        else state.views.push(event);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end('{"success":true}');
      });
      return;
    }

    let file = path.resolve(normalizedRoot, route.replace(/^\/+/, ''));
    if (!file.startsWith(`${normalizedRoot}${path.sep}`) && file !== normalizedRoot) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('forbidden');
      return;
    }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) file = path.join(normalizedRoot, 'index.html');
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(fs.readFileSync(file));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, state, baseUrl: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

export function webgamesSucceeded(state, upstreamTaskId) {
  return state.completions.some(event => event.taskId === upstreamTaskId);
}

export function webgamesCommandAllowed(command) {
  return WEBGAMES_VISUAL_COMMANDS.includes(String(command || '').trim());
}

export function webgamesPasswordMatches(upstreamTaskId, password) {
  const expected = WEBGAMES_COMPLETION_PASSWORD_HASHES[upstreamTaskId];
  if (!expected) return false;
  const actual = crypto.createHash('sha256').update(String(password ?? '').trim()).digest();
  return crypto.timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}
