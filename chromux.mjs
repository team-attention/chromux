#!/usr/bin/env node

/**
 * chromux — tmux for Chrome tabs.
 *
 * Zero-dependency parallel Chrome tab controller via raw CDP.
 * Each "session" is an independent browser tab operated by AI agents in parallel.
 * Supports named profiles with isolated Chrome instances (user-data-dir per profile).
 *
 * Dependencies: NONE — uses only Node.js ≥22 built-ins (http, WebSocket, fs, path, os).
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

// ============================================================
// Constants & Config
// ============================================================

const CHROMUX_HOME = path.join(os.homedir(), '.chromux');
const PROFILES_DIR = path.join(CHROMUX_HOME, 'profiles');
const CONFIG_PATH = path.join(CHROMUX_HOME, 'config.json');
const PORT_RANGE_START = 9300;
const PORT_RANGE_END = 9399;
const DEFAULT_PROFILE = 'default';

const CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
];

// ============================================================
// Profile resolution
// ============================================================

function getProfile() {
  return process.env.CHROMUX_PROFILE
    || parseGlobalFlag('--profile')
    || DEFAULT_PROFILE;
}

/** Extract --profile <name> from argv and remove it. */
function parseGlobalFlag(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx < 0) return null;
  const val = process.argv[idx + 1];
  process.argv.splice(idx, 2);
  return val;
}

const VALID_NAME = /^[a-zA-Z0-9._-]+$/;
function validateName(name) {
  if (!VALID_NAME.test(name)) {
    console.error(`Invalid profile/session name "${name}". Use only [a-zA-Z0-9._-]`);
    process.exit(1);
  }
  return name;
}

const RUN_DIR = path.join(CHROMUX_HOME, 'run');
function profileDir(name) { return path.join(PROFILES_DIR, validateName(name)); }
function statePath(name) { return path.join(profileDir(name), '.state'); }
function sockPath(name) {
  validateName(name);
  fs.mkdirSync(RUN_DIR, { recursive: true, mode: 0o700 });
  return path.join(RUN_DIR, `${name}.sock`);
}

// ============================================================
// Config helpers
// ============================================================

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
  catch { return {}; }
}

function saveConfig(cfg) {
  fs.mkdirSync(CHROMUX_HOME, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n');
}

function findChrome(cfg) {
  if (cfg.chromePath && fs.existsSync(cfg.chromePath)) return cfg.chromePath;
  for (const p of CHROME_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// ============================================================
// State file helpers (per-profile: pid, port, sock)
// ============================================================

function readState(profileName) {
  try { return JSON.parse(fs.readFileSync(statePath(profileName), 'utf8')); }
  catch { return null; }
}

function writeState(profileName, state) {
  const dir = profileDir(profileName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(statePath(profileName), JSON.stringify(state, null, 2) + '\n');
}

function clearState(profileName) {
  try { fs.unlinkSync(statePath(profileName)); } catch {}
}

function isProcessAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** Check if a CDP endpoint is reachable. */
function checkCDP(port) {
  return new Promise((resolve) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: '/json/version', method: 'GET' }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(true));
    });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => { req.destroy(); resolve(false); });
    req.end();
  });
}

/** Find a free port in the configured range. */
async function findFreePort(cfg) {
  const start = cfg.portRangeStart || PORT_RANGE_START;
  const end = cfg.portRangeEnd || PORT_RANGE_END;
  // Collect ports already in use by other profiles
  const usedPorts = new Set();
  try {
    for (const name of fs.readdirSync(PROFILES_DIR)) {
      const st = readState(name);
      if (st && isProcessAlive(st.pid)) usedPorts.add(st.port);
    }
  } catch {}
  for (let port = start; port <= end; port++) {
    if (usedPorts.has(port)) continue;
    const taken = await checkCDP(port);
    if (!taken) return port;
  }
  return null;
}

// ============================================================
// CDP Client — thin wrapper over Chrome DevTools Protocol
// ============================================================

class CDPClient {
  #ws;
  #seq = 0;
  #pending = new Map();
  #waiters = [];

  async connect(wsUrl) {
    this.#ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => {
      this.#ws.addEventListener('open', res, { once: true });
      this.#ws.addEventListener('error', rej, { once: true });
    });
    const drain = (reason) => {
      const err = new Error(reason);
      for (const [id, p] of this.#pending) { p.reject(err); }
      this.#pending.clear();
      for (const w of this.#waiters) { clearTimeout(w.timer); w.reject(err); }
      this.#waiters.length = 0;
    };
    this.#ws.addEventListener('close', () => drain('WebSocket closed'));
    this.#ws.addEventListener('error', () => drain('WebSocket error'));
    this.#ws.addEventListener('message', (evt) => {
      const msg = JSON.parse(evt.data);
      if ('id' in msg) {
        const p = this.#pending.get(msg.id);
        if (p) { this.#pending.delete(msg.id); p.resolve(msg); }
      }
      if ('method' in msg) {
        for (let i = this.#waiters.length - 1; i >= 0; i--) {
          if (this.#waiters[i].method === msg.method) {
            clearTimeout(this.#waiters[i].timer);
            this.#waiters[i].resolve(msg.params);
            this.#waiters.splice(i, 1);
            break;
          }
        }
      }
    });
  }

  async send(method, params = {}) {
    const id = ++this.#seq;
    const msg = await new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#ws.send(JSON.stringify({ id, method, params }));
    });
    if (msg.error) throw new Error(`CDP ${method}: ${msg.error.message}`);
    return msg.result;
  }

  waitForEvent(method, timeout = 30000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.#waiters.findIndex(w => w === entry);
        if (i >= 0) this.#waiters.splice(i, 1);
        reject(new Error(`Timeout waiting for ${method}`));
      }, timeout);
      const entry = { method, resolve, reject, timer };
      this.#waiters.push(entry);
    });
  }

  close() { this.#ws?.close(); }
}

// ============================================================
// Chrome HTTP helpers — tab CRUD via /json/* endpoints
// ============================================================

function cdpFetch(port, urlPath, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: urlPath, method }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch { resolve(d); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function createTab(port, url = 'about:blank') {
  return cdpFetch(port, `/json/new?${encodeURI(url)}`, 'PUT');
}

async function closeTab(port, targetId) {
  return cdpFetch(port, `/json/close/${targetId}`);
}

// ============================================================
// Snapshot — accessibility tree with @ref numbers
// ============================================================

// Stealth philosophy (inspired by Patchright):
// Real Chrome already has correct navigator.webdriver, plugins, languages, chrome.runtime.
// Adding JS patches via Page.addScriptToEvaluateOnNewDocument is ITSELF detectable.
// The best stealth is minimizing CDP footprint — remove calls, don't add patches.

const SNAPSHOT_JS = `(() => {
  let refId = 0;
  const ROLES = {
    a:'link', button:'button', input:'textbox', select:'combobox',
    textarea:'textbox', img:'img', nav:'navigation', main:'main',
    header:'banner', footer:'contentinfo', form:'form',
    h1:'heading', h2:'heading', h3:'heading',
    h4:'heading', h5:'heading', h6:'heading',
    ul:'list', ol:'list', li:'listitem',
    table:'table', tr:'row', td:'cell', th:'columnheader',
    dialog:'dialog', section:'region', aside:'complementary',
  };
  const INTERACTIVE = new Set(['a','button','input','select','textarea']);
  function getRole(el) {
    return el.getAttribute('role') || ROLES[el.tagName.toLowerCase()] || null;
  }
  function isInteractive(el) {
    const tag = el.tagName.toLowerCase();
    if (INTERACTIVE.has(tag)) return true;
    const role = el.getAttribute('role');
    if (role === 'button' || role === 'link' || role === 'tab' || role === 'menuitem') return true;
    if (el.getAttribute('tabindex') !== null && el.getAttribute('tabindex') !== '-1') return true;
    return false;
  }
  function getLabel(el) {
    const tag = el.tagName.toLowerCase();
    const aria = el.getAttribute('aria-label');
    if (aria) return aria;
    if (tag === 'input' || tag === 'textarea') return el.value || el.placeholder || '';
    if (tag === 'img') return el.alt || '';
    let text = '';
    for (const n of el.childNodes) { if (n.nodeType === 3) text += n.textContent; }
    return text.trim().substring(0, 100);
  }
  function walk(el, depth) {
    if (!el || el.nodeType !== 1) return '';
    try {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || el.hidden) return '';
    } catch { return ''; }
    if (el.getAttribute('aria-hidden') === 'true') return '';
    const tag = el.tagName.toLowerCase();
    if (['script','style','noscript','br','hr','svg','path'].includes(tag)) return '';
    const role = getRole(el);
    const interactive = isInteractive(el);
    const label = getLabel(el);
    const has = role || interactive || label;
    const cd = has ? depth + 1 : depth;
    let children = '';
    for (const c of el.children) children += walk(c, cd);
    if (!has && !children) return '';
    if (!has) return children;
    const indent = '  '.repeat(depth);
    let line = indent;
    if (interactive) {
      const ref = ++refId;
      el.setAttribute('data-ct-ref', String(ref));
      line += '@' + ref + ' ';
    }
    line += role || tag;
    if (label) line += ' "' + label.replace(/"/g, '\\\\"') + '"';
    if (tag === 'input') line += ' [' + (el.type || 'text') + ']';
    if (tag === 'a' && el.href) {
      const href = el.getAttribute('href');
      if (href && !href.startsWith('javascript:') && !href.startsWith('#'))
        line += ' -> ' + href.substring(0, 80);
    }
    return line + '\\n' + children;
  }
  return '# ' + document.title + '\\n# ' + location.href + '\\n\\n' + walk(document.body, 0);
})()`;

// ============================================================
// Daemon server (per-profile)
// ============================================================

async function startDaemon(profileName, port) {
  const sock = sockPath(profileName);
  try { fs.unlinkSync(sock); } catch {}

  // Verify Chrome is reachable
  const alive = await checkCDP(port);
  if (!alive) { console.error(`Cannot reach Chrome at 127.0.0.1:${port}`); process.exit(1); }

  // Read profile state to check headless mode
  const profileState = readState(profileName) || {};
  const isHeadless = profileState.headless || false;

  /** @type {Map<string, {targetId: string, cdp: CDPClient}>} */
  const sessions = new Map();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const body = ['POST', 'PUT'].includes(req.method) ? await readBody(req) : null;
    try {
      const result = await route(port, req.method, url.pathname, body, sessions, isHeadless);
      const isText = typeof result === 'string';
      res.writeHead(200, { 'Content-Type': isText ? 'text/plain; charset=utf-8' : 'application/json' });
      res.end(isText ? result : JSON.stringify(result));
    } catch (err) {
      res.writeHead(err.status || 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  server.listen(sock, () => {
    try { fs.chmodSync(sock, 0o600); } catch {}
    console.log(`chromux daemon [${profileName}] on ${sock} → port ${port}`);
  });

  const cleanup = () => {
    for (const s of sessions.values()) s.cdp.close();
    try { fs.unlinkSync(sock); } catch {};
  };
  process.on('exit', cleanup);
  process.on('SIGTERM', () => process.exit(0));
  process.on('SIGINT', () => process.exit(0));
  process.on('uncaughtException', (err) => {
    process.stderr.write(`chromux daemon [${profileName}] uncaught: ${err.message}\n`);
    cleanup();
    process.exit(1);
  });
}

async function route(port, method, routePath, body, sessions, isHeadless = false) {

  if (routePath === '/health')
    return { ok: true, sessions: sessions.size };

  if (routePath === '/list') {
    const out = {};
    for (const [id, s] of sessions) {
      try {
        const r = await s.cdp.send('Runtime.evaluate', { expression: 'JSON.stringify({url:location.href,title:document.title})', returnByValue: true });
        out[id] = JSON.parse(r.result.value);
      } catch { out[id] = { url: '(closed)', title: '' }; sessions.delete(id); }
    }
    return out;
  }

  if (routePath === '/open' && method === 'POST') {
    const { session, url } = body;
    if (!session || !url) throw httpErr(400, 'session and url required');
    let s = sessions.get(session);
    if (!s) {
      const tab = await createTab(port, 'about:blank');
      const cdp = new CDPClient();
      await cdp.connect(tab.webSocketDebuggerUrl);
      await cdp.send('Page.enable');
      // NOTE: Runtime.enable intentionally NOT called (Patchright technique).
      // Runtime.enable is the #1 CDP detection signal used by Cloudflare, DataDome, PerimeterX.
      // Runtime.evaluate works without it — no need for Runtime.executionContextCreated events.
      if (isHeadless) {
        // Override User-Agent to remove "HeadlessChrome" signature
        await cdp.send('Network.enable');
        const r = await cdp.send('Runtime.evaluate', {
          expression: 'navigator.userAgent', returnByValue: true,
        });
        const cleanUA = (r.result?.value || '').replace(/HeadlessChrome/g, 'Chrome');
        if (cleanUA) await cdp.send('Network.setUserAgentOverride', { userAgent: cleanUA });
        // Emulate OS-level focus so headless window appears focused (anti-detection)
        await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
        // NOTE: Page.addScriptToEvaluateOnNewDocument intentionally NOT called.
        // Real Chrome already has correct webdriver/plugins/languages/chrome.runtime.
        // The CDP call itself is a detectable signal — removing it is better stealth.
      }
      s = { targetId: tab.id, cdp };
      sessions.set(session, s);
    }
    const loaded = s.cdp.waitForEvent('Page.loadEventFired', 30000);
    await s.cdp.send('Page.navigate', { url });
    await loaded;
    const r = await s.cdp.send('Runtime.evaluate', { expression: 'JSON.stringify({url:location.href,title:document.title})', returnByValue: true });
    return { session, ...JSON.parse(r.result.value) };
  }

  if (routePath.startsWith('/snapshot/')) {
    const session = decodeURIComponent(routePath.split('/')[2]);
    const s = getSession(sessions, session);
    const r = await s.cdp.send('Runtime.evaluate', { expression: SNAPSHOT_JS, returnByValue: true });
    return r.result.value;
  }

  if (routePath === '/click' && method === 'POST') {
    const { session, selector } = body;
    const s = getSession(sessions, session);
    const sel = selector.startsWith('@')
      ? `[data-ct-ref="${selector.slice(1)}"]`
      : selector;
    const r = await s.cdp.send('Runtime.evaluate', {
      expression: `(sel => { const el = document.querySelector(sel); if (!el) throw new Error('Element not found: ' + sel); el.click(); return true; })(${JSON.stringify(sel)})`,
      returnByValue: true, awaitPromise: false,
    });
    if (r.exceptionDetails) throw httpErr(400, r.exceptionDetails.exception?.description || 'click failed');
    await sleep(500);
    return { clicked: selector };
  }

  if (routePath === '/fill' && method === 'POST') {
    const { session, selector, text } = body;
    const s = getSession(sessions, session);
    const sel = selector.startsWith('@')
      ? `[data-ct-ref="${selector.slice(1)}"]`
      : selector;
    const r = await s.cdp.send('Runtime.evaluate', {
      expression: `((sel, txt) => { const el = document.querySelector(sel); if (!el) throw new Error('Element not found: ' + sel); el.focus(); el.value = txt; el.dispatchEvent(new Event('input', {bubbles:true})); return true; })(${JSON.stringify(sel)}, ${JSON.stringify(text)})`,
      returnByValue: true, awaitPromise: false,
    });
    if (r.exceptionDetails) throw httpErr(400, r.exceptionDetails.exception?.description || 'fill failed');
    return { filled: selector, text };
  }

  if (routePath === '/type' && method === 'POST') {
    const { session, text } = body;
    const s = getSession(sessions, session);
    const KEY_MAP = { Enter: '\r', Tab: '\t', Escape: '\u001B', Backspace: '\b' };
    if (KEY_MAP[text] || text.length === 1) {
      await s.cdp.send('Input.dispatchKeyEvent', {
        type: 'keyDown', key: text, text: KEY_MAP[text] || text,
      });
      await s.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: text });
    } else {
      for (const ch of text) {
        await s.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch });
        await s.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
      }
    }
    return { typed: text };
  }

  if (routePath === '/eval' && method === 'POST') {
    const { session, code } = body;
    const s = getSession(sessions, session);
    const r = await s.cdp.send('Runtime.evaluate', {
      expression: code, returnByValue: true, awaitPromise: true,
    });
    if (r.exceptionDetails) throw httpErr(400, r.exceptionDetails.text || 'eval error');
    return r.result.value;
  }

  if (routePath === '/screenshot' && method === 'POST') {
    const { session, path: savePath } = body;
    const s = getSession(sessions, session);
    const r = await s.cdp.send('Page.captureScreenshot', { format: 'png' });
    const p = savePath || `/tmp/chromux-${session}-${Date.now()}.png`;
    const resolved = path.resolve(p);
    const realResolved = fs.realpathSync(path.dirname(resolved)) + path.sep + path.basename(resolved);
    const allowedBases = ['/tmp', '/private/tmp', os.tmpdir(), os.homedir()];
    if (!allowedBases.some(base => realResolved.startsWith(base + path.sep) || realResolved.startsWith(base))) {
      throw httpErr(400, `Screenshot path not allowed: ${resolved}`);
    }
    fs.writeFileSync(resolved, Buffer.from(r.data, 'base64'));
    return { path: resolved };
  }

  if (routePath === '/scroll' && method === 'POST') {
    const { session, direction } = body;
    const s = getSession(sessions, session);
    const delta = direction === 'up' ? -500 : 500;
    await s.cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 300, y: 300, deltaX: 0, deltaY: delta });
    await sleep(300);
    return { scrolled: direction };
  }

  if (routePath === '/wait' && method === 'POST') {
    getSession(sessions, body.session);
    await sleep(body.ms || 1000);
    return { waited: body.ms || 1000 };
  }

  if (routePath.startsWith('/session/') && method === 'DELETE') {
    const session = decodeURIComponent(routePath.split('/')[2]);
    const s = sessions.get(session);
    if (s) {
      s.cdp.close();
      await closeTab(port, s.targetId).catch(() => {});
      sessions.delete(session);
    }
    return { closed: session };
  }

  if (routePath === '/stop') {
    setTimeout(() => process.exit(0), 100);
    return { stopping: true };
  }

  throw httpErr(404, `Not found: ${method} ${routePath}`);
}

// ============================================================
// CLI: launch — start Chrome with isolated profile
// ============================================================

async function cmdLaunch(profileName, explicitPort, headless = false) {
  const cfg = loadConfig();
  const chrome = findChrome(cfg);
  if (!chrome) {
    console.error('Chrome not found. Set chromePath in ~/.chromux/config.json');
    process.exit(1);
  }

  // Check if already running
  const existing = readState(profileName);
  if (existing) {
    if (isProcessAlive(existing.pid)) {
      const alive = await checkCDP(existing.port);
      if (alive) {
        console.log(JSON.stringify({ profile: profileName, port: existing.port, status: 'already running' }, null, 2));
        return;
      }
      // PID alive but CDP dead — stale process, kill it
      try { process.kill(existing.pid, 'SIGTERM'); } catch {}
    }
    clearState(profileName);
  }

  const port = explicitPort || await findFreePort(cfg);
  if (!port) {
    console.error(`No free port in range ${cfg.portRangeStart || PORT_RANGE_START}-${cfg.portRangeEnd || PORT_RANGE_END}`);
    process.exit(1);
  }

  const userDataDir = profileDir(profileName);
  fs.mkdirSync(userDataDir, { recursive: true });

  const chromeArgs = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--remote-allow-origins=*',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-blink-features=AutomationControlled',  // removes navigator.webdriver at engine level (all modes)
  ];
  if (headless) {
    chromeArgs.push('--headless=new');
  }

  const child = spawn(chrome, chromeArgs, {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  // Wait for CDP to become reachable
  process.stderr.write(`Launching Chrome [${profileName}] on port ${port}...`);
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    const alive = await checkCDP(port);
    if (alive) {
      writeState(profileName, { pid: child.pid, port, sock: sockPath(profileName), headless });
      process.stderr.write(' ready.\n');
      console.log(JSON.stringify({ profile: profileName, port, pid: child.pid, userDataDir }, null, 2));
      return;
    }
  }
  console.error(' failed to start Chrome.');
  process.exit(1);
}

// ============================================================
// CLI: ps — list running profiles
// ============================================================

async function cmdPs() {
  fs.mkdirSync(PROFILES_DIR, { recursive: true });
  let profiles;
  try { profiles = fs.readdirSync(PROFILES_DIR); }
  catch { profiles = []; }

  const rows = [];
  for (const name of profiles) {
    const st = readState(name);
    if (!st) continue;
    const alive = isProcessAlive(st.pid);
    if (!alive) { clearState(name); continue; }
    const cdpOk = await checkCDP(st.port);

    // Count tabs via daemon if reachable (short timeout to avoid hang)
    let tabs = '-';
    if (cdpOk) {
      try {
        const sock = sockPath(name);
        const list = await cliReq('GET', '/list', null, sock, 5000);
        tabs = String(Object.keys(list).length);
      } catch {}
    }

    // Check daemon status via socket existence + health
    let daemon = 'dead';
    const sock = path.join(RUN_DIR, `${name}.sock`);
    if (fs.existsSync(sock)) {
      try {
        await cliReq('GET', '/health', null, sock, 2000);
        daemon = 'ok';
      } catch { daemon = 'stale'; }
    }

    rows.push({ profile: name, port: st.port, pid: st.pid, status: cdpOk ? 'running' : 'no-cdp', tabs, daemon });
  }

  if (rows.length === 0) {
    console.log('No running profiles.');
  } else {
    // Table output
    console.log('PROFILE'.padEnd(20) + 'PORT'.padEnd(8) + 'PID'.padEnd(10) + 'STATUS'.padEnd(12) + 'DAEMON'.padEnd(8) + 'TABS');
    for (const r of rows) {
      console.log(
        r.profile.padEnd(20) +
        String(r.port).padEnd(8) +
        String(r.pid).padEnd(10) +
        r.status.padEnd(12) +
        r.daemon.padEnd(8) +
        r.tabs
      );
    }
  }
}

// ============================================================
// CLI: kill — stop a profile's Chrome + daemon
// ============================================================

async function cmdKill(profileName) {
  // Stop daemon first
  const sock = sockPath(profileName);
  try { await cliReq('POST', '/stop', {}, sock); } catch {}

  const st = readState(profileName);
  if (st && isProcessAlive(st.pid)) {
    try { process.kill(st.pid, 'SIGTERM'); } catch {}
  }
  clearState(profileName);
  try { fs.unlinkSync(sock); } catch {}
  console.log(JSON.stringify({ profile: profileName, killed: true }, null, 2));
}

// ============================================================
// CLI client (talks to daemon over Unix socket)
// ============================================================

function cliReq(method, urlPath, body, sock, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const opts = {
      socketPath: sock, path: urlPath, method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      timeout: timeoutMs,
    };
    const req = http.request(opts, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          try { reject(new Error(JSON.parse(d).error)); }
          catch { reject(new Error(d)); }
          return;
        }
        if (res.headers['content-type']?.includes('text/plain')) resolve(d);
        else { try { resolve(JSON.parse(d)); } catch { resolve(d); } }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ============================================================
// Daemon auto-start & profile auto-launch
// ============================================================

async function resolveProfilePort(profileName) {
  const st = readState(profileName);
  if (st && isProcessAlive(st.pid)) {
    const alive = await checkCDP(st.port);
    if (alive) return st.port;
  }
  return null;
}

async function ensureDaemon(profileName) {
  const sock = sockPath(profileName);

  // Check if daemon already running (short timeout to fail fast)
  try { await cliReq('GET', '/health', null, sock, 3000); return sock; } catch {}

  // Daemon not reachable — clean up stale socket before acquiring lock
  try { fs.unlinkSync(sock); } catch {}

  // Acquire lockfile to prevent concurrent daemon starts (CR-008)
  const lockFile = path.join(RUN_DIR, `${profileName}.lock`);
  const lockFd = await acquireLock(lockFile);
  try {
    // Re-check after lock — another process may have started it
    try { await cliReq('GET', '/health', null, sock, 3000); return sock; } catch {}

    // Clean up stale socket again (in case it appeared during lock wait)
    try { fs.unlinkSync(sock); } catch {}

    // Auto-launch profile if not running
    let port = await resolveProfilePort(profileName);
    if (!port) {
      process.stderr.write(`Auto-launching profile [${profileName}]...\n`);
      await cmdLaunch(profileName);
      port = await resolveProfilePort(profileName);
      if (!port) {
        console.error(`Failed to launch profile "${profileName}".`);
        process.exit(1);
      }
    }

    // Start daemon
    process.stderr.write(`Starting chromux daemon [${profileName}]...`);
    const child = spawn(process.execPath, [process.argv[1], '--daemon', profileName, String(port)], {
      detached: true, stdio: 'ignore',
    });
    child.unref();

    for (let i = 0; i < 50; i++) {
      await sleep(200);
      try { await cliReq('GET', '/health', null, sock, 3000); process.stderr.write(' ready.\n'); return sock; } catch {}
    }
    console.error(' daemon failed to start.');
    process.exit(1);
  } finally {
    releaseLock(lockFd, lockFile);
  }
}

// ============================================================
// CLI router
// ============================================================

async function runCli(cmd, args) {
  // Profile-level commands (no daemon needed)
  if (cmd === 'launch') {
    const name = args[0] || DEFAULT_PROFILE;
    const portIdx = args.indexOf('--port');
    const port = portIdx >= 0 ? parseInt(args[portIdx + 1]) : null;
    const headless = args.includes('--headless');
    return cmdLaunch(name, port, headless);
  }
  if (cmd === 'ps') return cmdPs();
  if (cmd === 'kill') {
    if (!args[0]) { console.error('Usage: chromux kill <profile>'); process.exit(1); }
    return cmdKill(args[0]);
  }

  // Tab commands (need daemon)
  const profile = getProfile();
  const sock = await ensureDaemon(profile);

  const routes = {
    open:       () => cliReq('POST', '/open', { session: args[0], url: args[1] }, sock),
    snapshot:   () => cliReq('GET', `/snapshot/${args[0]}`, null, sock),
    click:      () => cliReq('POST', '/click', { session: args[0], selector: args[1] }, sock),
    fill:       () => cliReq('POST', '/fill', { session: args[0], selector: args[1], text: args[2] }, sock),
    type:       () => cliReq('POST', '/type', { session: args[0], text: args[1] }, sock),
    eval:       () => cliReq('POST', '/eval', { session: args[0], code: args[1] }, sock),
    screenshot: () => cliReq('POST', '/screenshot', { session: args[0], path: args[1] }, sock),
    scroll:     () => cliReq('POST', '/scroll', { session: args[0], direction: args[1] || 'down' }, sock),
    wait:       () => cliReq('POST', '/wait', { session: args[0], ms: parseInt(args[1]) || 1000 }, sock),
    close:      () => cliReq('DELETE', `/session/${args[0]}`, null, sock),
    list:       () => cliReq('GET', '/list', null, sock),
    stop:       () => cliReq('POST', '/stop', {}, sock),
  };

  if (!routes[cmd]) { console.error(`Unknown: ${cmd}. Run: chromux help`); process.exit(1); }
  try {
    const r = await routes[cmd]();
    console.log(typeof r === 'string' ? r : JSON.stringify(r, null, 2));
  } catch (e) { console.error(`Error: ${e.message}`); process.exit(1); }
}

// ============================================================
// Helpers
// ============================================================

// ============================================================
// Lockfile helpers (CR-008: prevent concurrent daemon starts)
// ============================================================

/**
 * Acquire an exclusive lock using O_EXCL (atomic on local FS).
 * Retries with backoff for up to ~15 seconds.
 * Stale locks older than 30 seconds are force-removed.
 */
async function acquireLock(lockFile) {
  const STALE_MS = 30_000;
  const MAX_ATTEMPTS = 30;
  fs.mkdirSync(path.dirname(lockFile), { recursive: true, mode: 0o700 });

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const fd = fs.openSync(lockFile, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, ts: Date.now() }));
      return fd;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      // Check if lock is stale
      try {
        const stat = fs.statSync(lockFile);
        if (Date.now() - stat.mtimeMs > STALE_MS) {
          process.stderr.write(`Removing stale lock: ${lockFile}\n`);
          fs.unlinkSync(lockFile);
          continue; // Retry immediately
        }
      } catch {}
      // Wait with jitter before retry
      await sleep(300 + Math.random() * 200);
    }
  }
  console.error(`Failed to acquire lock after ${MAX_ATTEMPTS} attempts: ${lockFile}`);
  process.exit(1);
}

function releaseLock(fd, lockFile) {
  try { fs.closeSync(fd); } catch {}
  try { fs.unlinkSync(lockFile); } catch {}
}

function getSession(sessions, id) {
  const s = sessions.get(id);
  if (!s) throw httpErr(404, `Session "${id}" not found`);
  return s;
}
function httpErr(status, message) { const e = new Error(message); e.status = status; return e; }
const MAX_BODY = 10 * 1024 * 1024; // 10 MB
function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { req.destroy(); reject(httpErr(413, 'Request body too large')); return; }
      d += c;
    });
    req.on('end', () => {
      try { resolve(JSON.parse(d)); }
      catch { reject(httpErr(400, 'Invalid JSON in request body')); }
    });
  });
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ============================================================
// Help
// ============================================================

const HELP = `chromux — tmux for Chrome tabs

Profile management:
  chromux launch [name]              Launch Chrome (default: "default")
  chromux launch <name> --headless   Launch in headless mode (no window)
  chromux launch <name> --port N     Launch with specific port
  chromux ps                         List running profiles
  chromux kill <name>                Stop profile (Chrome + daemon)

Tab operations:
  chromux open <session> <url>       Navigate (auto-creates tab)
  chromux snapshot <session>         Accessibility tree with @ref
  chromux click <session> @<ref>     Click by ref number
  chromux fill <session> @<ref> "t"  Fill input field
  chromux type <session> "text"      Keyboard input (Enter, Tab, etc.)
  chromux eval <session> "js"        Run JavaScript expression
  chromux screenshot <session> [p]   Take PNG screenshot
  chromux scroll <session> up|down   Scroll page
  chromux wait <session> <ms>        Wait milliseconds
  chromux close <session>            Close tab
  chromux list                       List active sessions
  chromux stop                       Stop daemon (keeps Chrome)

Profile selection:
  chromux --profile <name> <cmd>     Use specific profile
  CHROMUX_PROFILE=<name> chromux     Via environment variable
  (default profile: "default")

Paths:
  ~/.chromux/config.json             Global config
  ~/.chromux/profiles/<name>/        Chrome user-data-dir per profile
  ~/.chromux/run/<name>.sock          Daemon socket per profile
  ~/.chromux/run/<name>.lock          Daemon startup lock (transient)`;

// ============================================================
// Entry
// ============================================================

const [,, cmd, ...args] = process.argv;

if (cmd === '--daemon') {
  const profileName = args[0] || DEFAULT_PROFILE;
  const port = parseInt(args[1]);
  if (!port) { console.error('Usage: --daemon <profile> <port>'); process.exit(1); }
  await startDaemon(profileName, port);
} else if (!cmd || cmd === 'help' || cmd === '--help') {
  console.log(HELP);
} else {
  await runCli(cmd, args);
}
