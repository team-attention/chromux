// MiniWoB++ task server for the agent-compare benchmark.
//
// Serves the MiniWoB++ HTML tasks (Farama-Foundation/miniwob-plusplus, MIT)
// from a local checkout and injects a small hook into each task page that:
//   - raises the 10s episode time limit to an agent-friendly value,
//   - seeds the bundled seedrandom so task instances are reproducible,
//   - POSTs every episode result (raw reward) back to this server so the
//     harness can machine-grade success without touching any tool's browser.
//
// The checkout is fetched at run start (like the competitor CLIs); nothing
// from MiniWoB++ is vendored into this repo.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const MINIWOB_REPO = 'https://github.com/Farama-Foundation/miniwob-plusplus';

export function cloneMiniwob(destDir) {
  return new Promise((resolve) => {
    if (fs.existsSync(path.join(destDir, 'miniwob', 'html', 'core', 'core.js'))) {
      resolve({ ok: true, reused: true, commit: readCommit(destDir) });
      return;
    }
    const child = spawn('git', ['clone', '--depth', '1', MINIWOB_REPO, destDir], { stdio: 'ignore' });
    child.on('exit', (code) => {
      resolve(code === 0
        ? { ok: true, reused: false, commit: readCommit(destDir) }
        : { ok: false, error: `git clone exited ${code}` });
    });
    child.on('error', (err) => resolve({ ok: false, error: err.message }));
  });
}

function readCommit(destDir) {
  try {
    const head = fs.readFileSync(path.join(destDir, '.git', 'HEAD'), 'utf8').trim();
    if (head.startsWith('ref: ')) {
      return fs.readFileSync(path.join(destDir, '.git', head.slice(5)), 'utf8').trim().slice(0, 12);
    }
    return head.slice(0, 12);
  } catch { return 'unknown'; }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

// Injected before </head> of every task page. core.js loads synchronously at
// the top of head, so `core` and the seeded RNG are available here, and the
// page's own genProblem/onload handlers are not yet running.
function hookScript(seed, maxTimeMs) {
  return `<script>
(function () {
  if (!window.core) return;
  core.EPISODE_MAX_TIME = ${maxTimeMs};
  try { Math.seedrandom(${JSON.stringify(seed)}); } catch (e) {}
  var originalEnd = core.endEpisode;
  core.endEpisode = function (reward, timeProportional, reason) {
    originalEnd.apply(this, arguments);
    try {
      fetch('/api/miniwob-result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: location.pathname,
          rawReward: window.WOB_RAW_REWARD_GLOBAL,
          reward: window.WOB_REWARD_GLOBAL,
          reason: reason || '',
        }),
      });
    } catch (e) {}
  };
})();
</script>`;
}

export function startMiniwobServer(htmlRoot, { seed = 'chromux-agent-compare', maxTimeMs = 300000 } = {}) {
  const state = { results: [], accessLog: [] };
  const server = http.createServer((req, res) => {
    const route = decodeURIComponent((req.url || '/').split('?')[0]);
    state.accessLog.push({
      route,
      method: req.method,
      userAgent: req.headers['user-agent'] || '',
      at: Date.now(),
    });
    if (req.method === 'POST' && route === '/api/miniwob-result') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try { state.results.push({ ...JSON.parse(body), at: Date.now() }); } catch {}
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      });
      return;
    }
    const rel = path.normalize(route).replace(/^([/\\.])+/, '');
    const file = path.join(htmlRoot, rel);
    if (!file.startsWith(path.normalize(htmlRoot)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    if (ext === '.html') {
      const html = fs.readFileSync(file, 'utf8');
      res.end(html.includes('</head>')
        ? html.replace('</head>', `${hookScript(seed, maxTimeMs)}\n</head>`)
        : html + hookScript(seed, maxTimeMs));
      return;
    }
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, state, baseUrl: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

export function miniwobSucceeded(state, taskPath) {
  return state.results.some(r => r.task === taskPath && Number(r.rawReward) > 0);
}
