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
import { spawn, spawnSync } from 'node:child_process';

// ============================================================
// Constants & Config
// ============================================================

const CHROMUX_HOME = path.join(os.homedir(), '.chromux');
const PROFILES_DIR = path.join(CHROMUX_HOME, 'profiles');
const CONFIG_PATH = path.join(CHROMUX_HOME, 'config.json');
const PORT_RANGE_START = 9300;
const PORT_RANGE_END = 9399;
const DEFAULT_PROFILE = 'default';
const LAUNCH_MODES = new Set(['headless', 'headed']);
const MODES = new Set(['default', 'crawl']);
const TRUE_ENV_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_ENV_VALUES = new Set(['0', 'false', 'no', 'off']);
const CRAWL_BLOCK_URLS = [
  '*.avif',
  '*.gif',
  '*.ico',
  '*.jpeg',
  '*.jpg',
  '*.mp3',
  '*.mp4',
  '*.otf',
  '*.png',
  '*.ttf',
  '*.webm',
  '*.webp',
  '*.woff',
  '*.woff2',
  '*://*.doubleclick.net/*',
  '*://*.google-analytics.com/*',
  '*://*.googletagmanager.com/*',
  '*://*.googlesyndication.com/*',
  '*://*.facebook.com/tr/*',
];

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

function getMode() {
  const mode = process.env.CHROMUX_MODE || parseGlobalFlag('--mode') || 'default';
  if (!MODES.has(mode)) {
    console.error(`Invalid mode "${mode}". Use one of: ${[...MODES].join(', ')}`);
    process.exit(1);
  }
  return mode;
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
function profileStopPath(name) {
  validateName(name);
  fs.mkdirSync(RUN_DIR, { recursive: true, mode: 0o700 });
  return path.join(RUN_DIR, `${name}.stop`);
}
function sockPath(name) {
  validateName(name);
  fs.mkdirSync(RUN_DIR, { recursive: true, mode: 0o700 });
  return path.join(RUN_DIR, `${name}.sock`);
}

function chromeSingletonPaths(name) {
  const dir = profileDir(name);
  return [
    path.join(dir, 'SingletonCookie'),
    path.join(dir, 'SingletonLock'),
    path.join(dir, 'SingletonSocket'),
    path.join(dir, 'RunningChromeVersion'),
  ];
}

function siteKnowledgeHintForUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const host = u.hostname.replace(/^www\./, '');
    if (!host) return null;
    return {
      host,
      dir: `~/.chromux/skills/${host}`,
      hint: 'Review/update reusable non-secret site notes here if this session revealed durable behavior or stale notes.',
    };
  } catch {
    return null;
  }
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
// State file helpers (per-profile cache: pid, port, sock)
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

function stripQuotes(value) {
  if (!value) return value;
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function splitCommand(command) {
  const out = [];
  let cur = '';
  let quote = null;
  let escaped = false;
  for (const ch of command) {
    if (escaped) {
      cur += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur) {
        out.push(cur);
        cur = '';
      }
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function getArgValue(args, name) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === name && args[i + 1]) return stripQuotes(args[i + 1]);
    if (arg.startsWith(`${name}=`)) return stripQuotes(arg.slice(name.length + 1));
  }
  return null;
}

function listProcesses() {
  const psArgs = process.platform === 'darwin'
    ? ['-axo', 'pid=,command=']
    : ['-eo', 'pid=,args='];
  const res = spawnSync('ps', psArgs, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (res.error || res.status !== 0) return [];
  return res.stdout.split('\n').map(line => {
    const m = line.match(/^\s*(\d+)\s+(.*)$/);
    if (!m) return null;
    return { pid: Number(m[1]), command: m[2] };
  }).filter(Boolean);
}

function processCommand(pid) {
  return listProcesses().find(proc => proc.pid === Number(pid))?.command || '';
}

function currentProcessCommand() {
  return processCommand(process.pid) || [process.execPath, ...process.argv.slice(1)].join(' ');
}

function isChromuxCommand(command) {
  return /(^|\s|\/)chromux(?:\.mjs)?(\s|$)/.test(command || '');
}

function parseChromuxChromeProcess(proc) {
  if (!proc.command.includes('--user-data-dir')) return null;
  const args = splitCommand(proc.command);
  const userDataDir = getArgValue(args, '--user-data-dir');
  if (!userDataDir) return null;
  const resolvedUserDataDir = path.resolve(userDataDir);
  const rel = path.relative(PROFILES_DIR, resolvedUserDataDir);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || rel.includes(path.sep)) return null;
  if (!VALID_NAME.test(rel)) return null;
  const portValue = getArgValue(args, '--remote-debugging-port');
  const port = portValue ? Number(portValue) : null;
  return {
    pid: proc.pid,
    profile: rel,
    port: Number.isInteger(port) ? port : null,
    headless: args.some(arg => arg === '--headless' || arg.startsWith('--headless=')),
    browser: !args.some(arg => arg.startsWith('--type=')),
    userDataDir: resolvedUserDataDir,
  };
}

function listChromuxChromeProcesses() {
  return listProcesses().map(parseChromuxChromeProcess).filter(Boolean);
}

function commandUsesProfileDir(command, profileName) {
  const userDataDir = getArgValue(splitCommand(command), '--user-data-dir');
  if (!userDataDir) return false;
  return path.resolve(userDataDir) === path.resolve(profileDir(profileName));
}

function profileResourceSnapshot(profileName) {
  const processes = listProcesses();
  let chromeProcesses = 0;
  let renderers = 0;
  let rssKb = 0;
  for (const proc of processes) {
    if (!commandUsesProfileDir(proc.command, profileName)) continue;
    chromeProcesses++;
    if (proc.command.includes('--type=renderer')) renderers++;
  }

  const psArgs = process.platform === 'darwin'
    ? ['-axo', 'pid=,rss=,command=']
    : ['-eo', 'pid=,rss=,args='];
  const res = spawnSync('ps', psArgs, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (!res.error && res.status === 0) {
    for (const line of res.stdout.split('\n')) {
      const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
      if (!m) continue;
      if (commandUsesProfileDir(m[3], profileName)) rssKb += Number(m[2]) || 0;
    }
  }

  return {
    chromeProcesses,
    renderers,
    rssMb: Math.round(rssKb / 1024),
  };
}

function findProfileProcesses(profileName) {
  validateName(profileName);
  return listChromuxChromeProcesses().filter(proc => proc.profile === profileName);
}

function clearStaleChromeSingletons(profileName) {
  validateName(profileName);
  if (findProfileProcesses(profileName).length > 0) return [];

  const removed = [];
  for (const file of chromeSingletonPaths(profileName)) {
    try {
      fs.lstatSync(file);
      fs.rmSync(file, { force: true });
      removed.push(path.basename(file));
    } catch {}
  }
  return removed;
}

async function resolveProfileRuntime(profileName, { adopt = true } = {}) {
  validateName(profileName);

  const candidates = findProfileProcesses(profileName);
  const orderedCandidates = [...candidates].sort((a, b) =>
    Number(b.browser) - Number(a.browser)
    || Number(!!b.port) - Number(!!a.port)
    || a.pid - b.pid
  );
  const byPid = new Map(candidates.map(proc => [proc.pid, proc]));
  const state = readState(profileName);

  if (state) {
    const statePidAlive = state.pid && isProcessAlive(state.pid);
    const stateCdpOk = state.port && await checkCDP(state.port);
    if (statePidAlive && stateCdpOk) {
      const proc = byPid.get(state.pid) || candidates.find(p => p.port === state.port);
      if (!proc || proc.browser) {
        return {
          profile: profileName,
          pid: state.pid,
          port: state.port,
          headless: proc ? proc.headless : !!state.headless,
          launchMode: (proc?.headless || state.headless) ? 'headless' : 'headed',
          sock: state.sock || sockPath(profileName),
          userDataDir: proc ? proc.userDataDir : profileDir(profileName),
          source: 'state',
          status: 'running',
        };
      }
    }
    if (!statePidAlive) clearState(profileName);
  }

  for (const proc of orderedCandidates) {
    if (!proc.port) continue;
    const cdpOk = await checkCDP(proc.port);
    if (!cdpOk) continue;
    const runtime = {
      profile: profileName,
      pid: proc.pid,
      port: proc.port,
      headless: proc.headless,
      launchMode: proc.headless ? 'headless' : 'headed',
      sock: sockPath(profileName),
      userDataDir: proc.userDataDir,
      source: 'process',
      status: 'running',
    };
    if (adopt) {
      writeState(profileName, {
        pid: runtime.pid,
        port: runtime.port,
        sock: runtime.sock,
        headless: runtime.headless,
        launchMode: runtime.launchMode,
        adopted: true,
      });
    }
    return runtime;
  }

  if (state && state.pid && isProcessAlive(state.pid)) {
    return {
      profile: profileName,
      pid: state.pid,
      port: state.port || null,
      headless: !!state.headless,
      launchMode: state.headless ? 'headless' : 'headed',
      sock: state.sock || sockPath(profileName),
      userDataDir: profileDir(profileName),
      source: 'state',
      status: 'locked',
      reason: 'state pid is alive but CDP is unreachable',
    };
  }

  if (orderedCandidates.length > 0) {
    const proc = orderedCandidates[0];
    return {
      profile: profileName,
      pid: proc.pid,
      port: proc.port,
      headless: proc.headless,
      launchMode: proc.headless ? 'headless' : 'headed',
      sock: sockPath(profileName),
      userDataDir: proc.userDataDir,
      source: 'process',
      status: 'locked',
      reason: proc.port ? 'remote debugging port is not reachable' : 'remote debugging port is missing',
    };
  }

  return null;
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
  #listeners = new Map();

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
      this.#listeners.clear();
      if (this.#onDisconnect) this.#onDisconnect(reason);
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
        const cbs = this.#listeners.get(msg.method);
        if (cbs) for (const cb of cbs) cb(msg.params);
      }
    });
  }

  get connected() {
    return this.#ws?.readyState === WebSocket.OPEN;
  }

  async send(method, params = {}, timeoutMs = 10000) {
    if (!this.connected) throw new Error('CDP WebSocket not connected');
    const id = ++this.#seq;
    const msg = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`CDP ${method}: timeout after ${timeoutMs}ms`));
      }, timeoutMs);
      this.#pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      try {
        this.#ws.send(JSON.stringify({ id, method, params }));
      } catch (e) {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(new Error(`CDP send failed: ${e.message}`));
      }
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

  /** Subscribe to CDP events persistently (unlike waitForEvent which is one-shot). */
  on(method, callback) {
    if (!this.#listeners.has(method)) this.#listeners.set(method, []);
    this.#listeners.get(method).push(callback);
  }

  /** Remove all listeners for a CDP event method. */
  off(method) {
    this.#listeners.delete(method);
  }

  #onDisconnect = null;
  set onDisconnect(fn) { this.#onDisconnect = fn; }

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

async function createBackgroundTab(port, url = 'about:blank') {
  const version = await cdpFetch(port, '/json/version');
  const browserWs = version.webSocketDebuggerUrl;
  if (!browserWs) throw new Error('Browser CDP websocket unavailable');

  const browser = new CDPClient();
  await browser.connect(browserWs);
  try {
    const created = await browser.send('Target.createTarget', {
      url,
      background: true,
    });
    const targetId = created.targetId;
    for (let i = 0; i < 20; i++) {
      const targets = await cdpFetch(port, '/json/list');
      const target = Array.isArray(targets)
        ? targets.find(item => item.id === targetId)
        : null;
      if (target?.webSocketDebuggerUrl) return target;
      await sleep(100);
    }
    throw new Error(`Created target ${targetId}, but websocket did not appear`);
  } finally {
    browser.close();
  }
}

async function createTab(port, url = 'about:blank', background = false) {
  if (background) return createBackgroundTab(port, url);
  return cdpFetch(port, `/json/new?${encodeURI(url)}`, 'PUT');
}

async function closeTab(port, targetId) {
  return cdpFetch(port, `/json/close/${targetId}`);
}

async function closeInitialTabs(port) {
  const targets = await cdpFetch(port, '/json/list').catch(() => []);
  if (!Array.isArray(targets)) return;
  for (const target of targets) {
    if (target.type !== 'page') continue;
    if (target.url !== 'about:blank' && target.url !== 'chrome://newtab/') continue;
    await closeTab(port, target.id).catch(() => {});
  }
}

// ============================================================
// Snapshot — accessibility tree with @ref numbers
// ============================================================

// Stealth philosophy (inspired by Patchright):
// Real Chrome already has correct navigator.webdriver, plugins, languages, chrome.runtime.
// Adding JS patches via Page.addScriptToEvaluateOnNewDocument is ITSELF detectable.
// The best stealth is minimizing CDP footprint — remove calls, don't add patches.

const SNAPSHOT_JS = `((FILTER) => {
  const INTERACTIVE_ONLY = FILTER === 'interactive';
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
    const keep = INTERACTIVE_ONLY ? interactive : has;
    const cd = keep ? depth + 1 : depth;
    let children = '';
    for (const c of el.children) children += walk(c, cd);
    if (!keep && !children) return '';
    if (!keep) return children;
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
})`;

// ============================================================
// Daemon server (per-profile)
// ============================================================

async function startDaemon(profileName, port) {
  const sock = sockPath(profileName);
  try { fs.unlinkSync(sock); } catch {}
  const settings = modeSettings();
  settings.profileName = profileName;
  settings.stopFile = process.env.CHROMUX_STOP_FILE || profileStopPath(profileName);

  // Verify Chrome is reachable
  const alive = await checkCDP(port);
  if (!alive) { console.error(`Cannot reach Chrome at 127.0.0.1:${port}`); process.exit(1); }

  // Read profile state to check headless mode
  const profileState = readState(profileName) || {};
  const isHeadless = profileState.headless || false;

  /** @type {Map<string, {targetId: string, cdp: CDPClient, createdAt: number, lastUsedAt: number, url?: string, title?: string, navigations?: number}>} */
  const sessions = new Map();
  const gate = createGate(settings.maxConcurrentOps);

  const HANDLER_TIMEOUT = 45000; // 45s max per request

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const body = ['POST', 'PUT'].includes(req.method) ? await readBody(req) : null;

    // Wrap handler with timeout to prevent daemon hang
    const handlerPromise = routeWithGate(gate, () =>
      route(port, req.method, url.pathname + url.search, body, sessions, isHeadless, settings)
    , url.pathname, settings);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Handler timeout')), HANDLER_TIMEOUT)
    );

    try {
      const result = await Promise.race([handlerPromise, timeoutPromise]);
      if (res.writableEnded) return;
      const isText = typeof result === 'string';
      res.writeHead(200, { 'Content-Type': isText ? 'text/plain; charset=utf-8' : 'application/json' });
      res.end(isText ? result : JSON.stringify(result));
    } catch (err) {
      if (res.writableEnded) return;
      res.writeHead(err.status || 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  server.listen(sock, () => {
    try { fs.chmodSync(sock, 0o600); } catch {}
    console.log(`chromux daemon [${profileName}] mode=${settings.mode} on ${sock} → port ${port}`);
  });

  // Watchdog: prune dead, stale, or idle sessions. Crawl mode uses a shorter
  // interval so candidate-list tabs do not sit around while detail workers run.
  setInterval(async () => {
    const now = Date.now();
    for (const [id, s] of sessions) {
      const dead = !s.cdp.connected;
      const tooOld = settings.sessionTtlMs > 0 && now - s.createdAt > settings.sessionTtlMs;
      const idle = settings.idleTtlMs > 0 && now - s.lastUsedAt > settings.idleTtlMs;
      if (dead || tooOld || idle) {
        s.cdp.close();
        if (!dead) await closeTab(port, s.targetId).catch(() => {});
        sessions.delete(id);
      }
    }
  }, settings.mode === 'crawl' ? 5000 : 30000);

  // Watchdog: verify Chrome CDP is alive every 60s, exit if dead
  setInterval(async () => {
    const alive = await checkCDP(port);
    if (!alive) {
      process.stderr.write(`chromux daemon [${profileName}]: Chrome CDP unreachable, exiting.\n`);
      cleanup();
      process.exit(1);
    }
  }, 60000);

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

function createGate(maxConcurrentOps) {
  return {
    max: Math.max(0, Number(maxConcurrentOps) || 0),
    active: 0,
    queue: [],
  };
}

function isGatedRoute(routePath) {
  if (routePath === '/health' || routePath === '/list' || routePath === '/stop') return false;
  if (routePath.startsWith('/session/')) return false;
  return true;
}

function isHardStopped(settings) {
  return settings?.stopFile && fs.existsSync(settings.stopFile);
}

function routeWithGate(gate, fn, routePath, settings) {
  if (!isGatedRoute(routePath)) return fn();
  if (isHardStopped(settings)) {
    return Promise.reject(httpErr(423, `Profile "${settings.profileName}" is paused by ${settings.stopFile}`));
  }
  if (!gate.max || gate.max <= 0) return fn();
  if (settings.maxQueuedOps > 0 && gate.queue.length >= settings.maxQueuedOps) {
    return Promise.reject(httpErr(429, `Profile operation queue is full (${settings.maxQueuedOps})`));
  }
  return new Promise((resolve, reject) => {
    const run = async () => {
      gate.active++;
      try { resolve(await fn()); }
      catch (err) { reject(err); }
      finally {
        gate.active--;
        const next = gate.queue.shift();
        if (next) next();
      }
    };
    if (gate.active < gate.max) run();
    else gate.queue.push(run);
  });
}

function touchSession(session) {
  session.lastUsedAt = Date.now();
}

function shouldRecycleSession(session, settings) {
  return settings.mode === 'crawl'
    && settings.maxNavigationsPerSession > 0
    && (session.navigations || 0) >= settings.maxNavigationsPerSession;
}

const KEY_DEFS = {
  Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r' },
  Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 },
  Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 },
};

async function pressKey(cdp, key) {
  const def = KEY_DEFS[key];
  if (!def) throw httpErr(400, `Unsupported key "${key}". Supported keys: ${Object.keys(KEY_DEFS).join(', ')}`);
  await cdp.send('Page.bringToFront', {});
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...def });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...def });
}

function enforceResourceGuard(settings) {
  if (settings.mode !== 'crawl' || !settings.profileName) return;
  const resources = profileResourceSnapshot(settings.profileName);
  const over = [];
  if (settings.maxChromeProcesses > 0 && resources.chromeProcesses >= settings.maxChromeProcesses) {
    over.push(`chromeProcesses ${resources.chromeProcesses}/${settings.maxChromeProcesses}`);
  }
  if (settings.maxRenderers > 0 && resources.renderers >= settings.maxRenderers) {
    over.push(`renderers ${resources.renderers}/${settings.maxRenderers}`);
  }
  if (settings.maxRssMb > 0 && resources.rssMb >= settings.maxRssMb) {
    over.push(`rssMb ${resources.rssMb}/${settings.maxRssMb}`);
  }
  if (over.length) throw httpErr(429, `Profile resource guard active: ${over.join(', ')}`);
}

async function closeUnhealthySession(port, sessions, sessionId, session, reason) {
  session.cdp.close();
  await closeTab(port, session.targetId).catch(() => {});
  sessions.delete(sessionId);
  const err = httpErr(503, `Session "${sessionId}" became unresponsive and was closed: ${reason}`);
  return err;
}

async function navigateSession(cdp, url, settings) {
  if (settings.mode !== 'crawl') {
    const loaded = cdp.waitForEvent('Page.loadEventFired', 30000).then(() => null, err => err);
    await cdp.send('Page.navigate', { url });
    const loadError = await loaded;
    if (loadError) throw loadError;
    return;
  }

  const waitMs = Math.max(1000, settings.navigationWaitMs || 12_000);
  const loaded = cdp.waitForEvent('Page.loadEventFired', waitMs).then(() => 'load').catch(() => null);
  const domReady = cdp.waitForEvent('Page.domContentEventFired', waitMs).then(() => 'domcontent').catch(() => null);
  const timeout = sleep(waitMs).then(() => 'timeout');
  await cdp.send('Page.navigate', { url }, waitMs + 2000);
  await Promise.race([loaded, domReady, timeout]);
  await cdp.send('Page.stopLoading', {}, 2000).catch(() => {});
}

async function readPageInfo(port, targetId, cdp, settings) {
  const evalTimeout = settings.mode === 'crawl' ? 3000 : 10000;
  try {
    const r = await cdp.send('Runtime.evaluate', {
      expression: 'JSON.stringify({url:location.href,title:document.title})',
      returnByValue: true,
    }, evalTimeout);
    return JSON.parse(r.result.value);
  } catch (err) {
    if (settings.mode !== 'crawl') throw err;
    const targets = await cdpFetch(port, '/json/list').catch(() => null);
    const target = Array.isArray(targets) ? targets.find(t => t.id === targetId) : null;
    if (target) return { url: target.url || '', title: target.title || '' };
    throw err;
  }
}

async function route(port, method, routePath, body, sessions, isHeadless = false, settings = modeSettings('default')) {

  if (routePath === '/health')
    return {
      ok: true,
      sessions: sessions.size,
      mode: settings.mode,
      gate: settings.maxConcurrentOps || null,
      queued: settings.maxQueuedOps || null,
      paused: isHardStopped(settings),
      resources: settings.profileName ? profileResourceSnapshot(settings.profileName) : null,
    };

  if (routePath === '/list') {
    const out = {};
    for (const [id, s] of sessions) {
      if (!s.cdp.connected) {
        out[id] = { url: '(closed)', title: '' };
        sessions.delete(id);
        continue;
      }
      if (settings.mode === 'crawl') {
        out[id] = { url: s.url || '', title: s.title || '', ageMs: Date.now() - s.createdAt, idleMs: Date.now() - s.lastUsedAt, navigations: s.navigations || 0 };
        continue;
      }
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
    enforceResourceGuard(settings);
    let s = sessions.get(session);
    if (s && shouldRecycleSession(s, settings)) {
      s.cdp.close();
      await closeTab(port, s.targetId).catch(() => {});
      sessions.delete(session);
      s = null;
    }
    const isNewSession = !s;
    let newTab = null;
    if (!s) {
      if (settings.maxSessions > 0 && sessions.size >= settings.maxSessions) {
        throw httpErr(429, `Profile session limit reached (${settings.maxSessions}). Close sessions or increase CHROMUX_MAX_SESSIONS_PER_PROFILE.`);
      }
      const background = body.background === true;
      const tab = await createTab(port, 'about:blank', background);
      newTab = tab;
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
      if (settings.mode === 'crawl' && settings.resourceBlocking) {
        await cdp.send('Network.enable');
        await cdp.send('Network.setBlockedURLs', { urls: CRAWL_BLOCK_URLS });
      }
      cdp.onDisconnect = (reason) => {
        sessions.delete(session);
      };
      const now = Date.now();
      s = { targetId: tab.id, cdp, createdAt: now, lastUsedAt: now, url: 'about:blank', title: '', navigations: 0 };
      sessions.set(session, s);
    }
    touchSession(s);
    try {
      await navigateSession(s.cdp, url, settings);
    } catch (err) {
      if (isNewSession && newTab) {
        sessions.delete(session);
        s.cdp.close();
        await closeTab(port, newTab.id).catch(() => {});
      }
      throw err;
    }
    const pageInfo = await readPageInfo(port, s.targetId, s.cdp, settings);
    s.url = pageInfo.url;
    s.title = pageInfo.title;
    s.navigations = (s.navigations || 0) + 1;
    touchSession(s);
    const result = { session, ...pageInfo };
    // Surface host-specific hint files from ~/.chromux/skills/<host>/*.md (if any).
    try {
      const knowledgeHint = siteKnowledgeHintForUrl(result.url);
      const host = knowledgeHint?.host;
      const dir = host ? path.join(CHROMUX_HOME, 'skills', host) : null;
      if (dir && fs.existsSync(dir)) {
        const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
        if (files.length) {
          const hints = files.map(f => `# Hint: ${host}/${f}\n` + fs.readFileSync(path.join(dir, f), 'utf8').trim()).join('\n\n');
          result.hints = hints;
        }
      }
    } catch {}
    return result;
  }

  if (routePath.startsWith('/snapshot/')) {
    const u = new URL(routePath, 'http://x');
    const session = decodeURIComponent(u.pathname.split('/')[2]);
    const filter = u.searchParams.get('filter');
    const s = getSession(sessions, session);
    touchSession(s);
    const expression = `(${SNAPSHOT_JS})(${JSON.stringify(filter)})`;
    const r = await s.cdp.send('Runtime.evaluate', { expression, returnByValue: true });
    return r.result.value;
  }

  if (routePath === '/cdp' && method === 'POST') {
    const { session, method: cdpMethod, params, timeoutMs } = body;
    if (!session || !cdpMethod) throw httpErr(400, 'session and method required');
    const s = getSession(sessions, session);
    touchSession(s);
    try {
      return await s.cdp.send(cdpMethod, params || {}, timeoutMs);
    } catch (err) {
      if (settings.mode === 'crawl' && /timeout/i.test(err.message)) {
        throw await closeUnhealthySession(port, sessions, session, s, err.message);
      }
      throw err;
    }
  }

  if (routePath === '/run' && method === 'POST') {
    const { session, code, timeoutMs } = body;
    if (!session || code == null) throw httpErr(400, 'session and code required');
    const s = getSession(sessions, session);
    touchSession(s);
    const requestedTimeout = (typeof timeoutMs === 'number' && timeoutMs > 0) ? timeoutMs : undefined;
    const defaultCdpTimeout = requestedTimeout ?? (settings.mode === 'crawl' ? 5000 : undefined);
    const defaultJsTimeout = requestedTimeout ?? (settings.mode === 'crawl' ? 3000 : undefined);
    const cdp = (m, p = {}, t) => s.cdp.send(m, p, t ?? defaultCdpTimeout);
    const evalJs = async (expr, t) => {
      const evalTimeout = t ?? defaultJsTimeout;
      let r = await s.cdp.send('Runtime.evaluate', {
        expression: isolatePageExpression(expr),
        returnByValue: true,
        awaitPromise: true,
      }, evalTimeout);
      if (r.exceptionDetails && isLikelyPageExpressionSyntaxError(r.exceptionDetails)) {
        r = await s.cdp.send('Runtime.evaluate', {
          expression: isolatePageBlock(expr),
          returnByValue: true,
          awaitPromise: true,
        }, evalTimeout);
      }
      if (r.exceptionDetails) {
        throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'js error');
      }
      return r.result.value;
    };
    const waitLoad = (ms = (requestedTimeout ?? 30000)) => s.cdp.waitForEvent('Page.loadEventFired', ms);
    const page = async (expr, t) => {
      const pageExpr = expr || `({
        url: location.href,
        title: document.title,
        text: document.body ? document.body.innerText : '',
        html: document.documentElement ? document.documentElement.outerHTML : ''
      })`;
      const raw = await evalJs(`JSON.stringify(${pageExpr})`, t);
      return JSON.parse(raw);
    };
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
    const fn = new AsyncFunction('cdp', 'js', 'sleep', 'waitLoad', 'page', code);
    const runPromise = fn(cdp, evalJs, sleep, waitLoad, page);
    try {
      const result = (typeof timeoutMs === 'number' && timeoutMs > 0)
        ? await withTimeout(runPromise, timeoutMs, 'run timeout')
        : await runPromise;
      return result === undefined ? null : result;
    } catch (err) {
      if (settings.mode === 'crawl' && /timeout/i.test(err.message)) {
        throw await closeUnhealthySession(port, sessions, session, s, err.message);
      }
      throw err;
    }
  }

  if (routePath === '/click' && method === 'POST') {
    const { session, selector, xy, button = 'left', clicks = 1 } = body;
    if (!session) throw httpErr(400, 'session required');
    const s = getSession(sessions, session);
    touchSession(s);
    if (xy) {
      const [x, y] = xy.map(Number);
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw httpErr(400, 'xy must contain numeric x/y');
      const clickCount = Number.isFinite(Number(clicks)) ? Number(clicks) : 1;
      await s.cdp.send('Page.bringToFront', {});
      const viewport = await s.cdp.send('Runtime.evaluate', {
        expression: '({width: window.innerWidth, height: window.innerHeight})',
        returnByValue: true,
      });
      const { width, height } = viewport.result?.value || {};
      if (x < 0 || y < 0 || x >= width || y >= height) {
        throw httpErr(400, `xy outside viewport: [${x}, ${y}] not within ${width}x${height}`);
      }
      await s.cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed', x, y, button, clickCount,
      });
      await s.cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased', x, y, button, clickCount,
      });
      await sleep(100);
      return { clicked: { xy: [x, y], button, clicks: clickCount } };
    }
    if (!selector) throw httpErr(400, 'selector or xy required');
    const sel = selector.startsWith('@')
      ? `[data-ct-ref="${selector.slice(1)}"]`
      : selector;
    await s.cdp.send('Page.bringToFront', {});
    const r = await s.cdp.send('Runtime.evaluate', {
      expression: `((sel) => {
        function describe(node) {
          if (!node || node.nodeType !== 1) return String(node);
          const id = node.id ? '#' + node.id : '';
          const cls = node.className && typeof node.className === 'string'
            ? '.' + node.className.trim().split(/\\s+/).filter(Boolean).slice(0, 3).join('.')
            : '';
          return node.tagName.toLowerCase() + id + cls;
        }
        const el = document.querySelector(sel);
        if (!el) throw new Error('Element not found: ' + sel);
        el.scrollIntoView?.({ block: 'center', inline: 'center' });
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        const visible = rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
        if (!visible) throw new Error('Click target is not interactable: ' + sel);
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) {
          throw new Error('Click target outside viewport after scroll: ' + sel);
        }
        const hit = document.elementFromPoint(x, y);
        if (!hit) throw new Error('Click target has no element at click point: ' + sel);
        if (hit !== el && !el.contains(hit)) {
          throw new Error('Click target is covered: ' + sel + ' hit ' + describe(hit));
        }
        return {
          x,
          y,
          hit: describe(hit),
        };
      })(${JSON.stringify(sel)})`,
      returnByValue: true, awaitPromise: false,
    });
    if (r.exceptionDetails) throw httpErr(400, r.exceptionDetails.exception?.description || 'click failed');
    const point = r.result?.value;
    if (point) {
      const clickCount = Number.isFinite(Number(clicks)) ? Number(clicks) : 1;
      await s.cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', x: point.x, y: point.y, button: 'none',
      });
      await s.cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed', x: point.x, y: point.y, button, clickCount,
      });
      await s.cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased', x: point.x, y: point.y, button, clickCount,
      });
    }
    await sleep(500);
    return { clicked: selector };
  }

  if (routePath === '/fill' && method === 'POST') {
    const { session, selector, text } = body;
    const s = getSession(sessions, session);
    touchSession(s);
    const sel = selector.startsWith('@')
      ? `[data-ct-ref="${selector.slice(1)}"]`
      : selector;
    const r = await s.cdp.send('Runtime.evaluate', {
      expression: `((sel, txt) => {
        const el = document.querySelector(sel);
        if (!el) throw new Error('Element not found: ' + sel);
        if (!('value' in el)) throw new Error('Element is not fillable: ' + sel);
        el.focus();
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
          || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
        if (setter) setter.call(el, txt);
        else el.value = txt;
        try {
          el.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: txt,
          }));
        } catch {
          el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        }
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { value: el.value };
      })(${JSON.stringify(sel)}, ${JSON.stringify(text)})`,
      returnByValue: true, awaitPromise: false,
    });
    if (r.exceptionDetails) throw httpErr(400, r.exceptionDetails.exception?.description || 'fill failed');
    return { filled: selector, text };
  }

  if (routePath === '/type' && method === 'POST') {
    const { session, text } = body;
    if (!session || text == null) throw httpErr(400, 'session and text required');
    const s = getSession(sessions, session);
    touchSession(s);
    await s.cdp.send('Page.bringToFront', {});
    await s.cdp.send('Input.insertText', { text });
    return { typed: text };
  }

  if (routePath === '/press' && method === 'POST') {
    const { session, key } = body;
    if (!session || !key) throw httpErr(400, 'session and key required');
    const s = getSession(sessions, session);
    touchSession(s);
    await pressKey(s.cdp, key);
    return { pressed: key };
  }

  if ((routePath === '/wait-for-text' || routePath === '/wait-for-selector') && method === 'POST') {
    const { session, text, selector, timeoutMs = 5000 } = body;
    if (!session) throw httpErr(400, 'session required');
    const s = getSession(sessions, session);
    touchSession(s);
    const timeout = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0 ? Number(timeoutMs) : 5000;
    const deadline = Date.now() + timeout;
    const isTextWait = routePath === '/wait-for-text';
    const needle = isTextWait ? text : selector;
    if (!needle) throw httpErr(400, isTextWait ? 'text required' : 'selector required');
    let lastError = null;
    while (Date.now() <= deadline) {
      const expression = isTextWait
        ? `document.body ? document.body.innerText.includes(${JSON.stringify(needle)}) : false`
        : `((sel) => {
            const el = document.querySelector(sel);
            if (!el) return false;
            const style = getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
          })(${JSON.stringify(needle)})`;
      const r = await s.cdp.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
      }, Math.min(timeout + 1000, 30000));
      if (r.exceptionDetails) {
        lastError = r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'wait evaluation failed';
        break;
      }
      if (r.result?.value === true) {
        return isTextWait
          ? { foundText: needle, timeoutMs: timeout }
          : { foundSelector: needle, timeoutMs: timeout };
      }
      await sleep(100);
    }
    if (lastError) throw httpErr(400, lastError);
    throw httpErr(408, `${isTextWait ? 'text' : 'selector'} not found before timeout ${timeout}ms: ${needle}`);
  }

  if (routePath === '/eval' && method === 'POST') {
    const { session, code, timeoutMs } = body;
    const s = getSession(sessions, session);
    touchSession(s);
    const evalArgs = {
      expression: code, returnByValue: true, awaitPromise: true,
    };
    if (typeof timeoutMs === 'number' && timeoutMs > 0) evalArgs.timeout = timeoutMs;
    const cdpTimeout = (typeof timeoutMs === 'number' && timeoutMs > 0) ? timeoutMs + 2000 : undefined;
    const r = await s.cdp.send('Runtime.evaluate', evalArgs, cdpTimeout);
    if (r.exceptionDetails) throw httpErr(400, r.exceptionDetails.text || 'eval error');
    return r.result.value;
  }

  if (routePath === '/scroll-until' && method === 'POST') {
    const { session, selector, jsCount, count, maxScrolls = 30, delayMs = 800, target } = body;
    if ((!selector && !jsCount) || !count) throw httpErr(400, 'scroll-until requires (--selector or --js-count) and --count');
    const s = getSession(sessions, session);
    touchSession(s);
    const counts = [];
    let last = -1;
    let stagnant = 0;
    let wheelFailures = 0;
    const probeTimeout = Math.max(15000, delayMs + 5000);
    for (let i = 0; i < maxScrolls; i++) {
      // Probe + JS-side scroll (scrollTo + lastChild.scrollIntoView) in one CDP roundtrip.
      const probe = await s.cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const t = ${JSON.stringify(target || null)};
          const SEL = ${JSON.stringify(selector || '')};
          const JSC = ${JSON.stringify(jsCount || '')};
          let matches = SEL ? document.querySelectorAll(SEL) : [];
          let n;
          if (JSC) {
            try { n = Number((function(){ return eval(JSC); })()); if (!isFinite(n)) n = 0; } catch(e) { n = 0; }
          } else {
            n = matches.length;
          }
          let scroller = t ? document.querySelector(t) : null;
          if (!scroller) {
            for (const el of document.querySelectorAll('main, [role="main"], div, body, html')) {
              const cs = getComputedStyle(el);
              if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight - el.clientHeight > 40) { scroller = el; break; }
            }
            if (!scroller) scroller = document.scrollingElement || document.documentElement;
          }
          const beforeTop = scroller.scrollTop;
          const beforeH = scroller.scrollHeight;
          // Strategy 1: scrollTo bottom of detected scroller
          try { scroller.scrollTo(0, scroller.scrollHeight); } catch {}
          // Strategy 2: scrollIntoView on the last matching element (forces IntersectionObserver)
          try {
            const last = matches[matches.length - 1];
            if (last && last.scrollIntoView) last.scrollIntoView({block:'end', behavior:'instant'});
          } catch {}
          // Strategy 3: window scroll as last resort
          try { window.scrollTo(0, document.body.scrollHeight); } catch {}
          const rect = scroller.getBoundingClientRect ? scroller.getBoundingClientRect() : {left:0,top:0,width:innerWidth,height:innerHeight};
          return JSON.stringify({
            n, beforeTop, beforeH,
            afterTop: scroller.scrollTop, afterH: scroller.scrollHeight,
            scrollerTag: scroller.tagName + '.' + String(scroller.className||'').slice(0,40),
            rect: {x: Math.max(10, Math.min(2000, rect.left+rect.width/2)), y: Math.max(10, Math.min(2000, rect.top+rect.height/2))}
          });
        })()`,
        returnByValue: true,
      }, probeTimeout);
      if (probe.exceptionDetails) throw httpErr(400, probe.exceptionDetails.text);
      const info = JSON.parse(probe.result.value);
      counts.push(info.n);
      if (info.n >= count) return { reached: true, count: info.n, scrolls: i, history: counts, scroller: info.scrollerTag };
      // Optional wheel nudge — but don't let it hang the whole command if CDP input is slow.
      if (wheelFailures < 2) {
        try {
          await s.cdp.send('Input.dispatchMouseEvent', {
            type: 'mouseWheel',
            x: info.rect.x, y: info.rect.y,
            deltaX: 0, deltaY: 1500,
          }, 4000);
        } catch (e) {
          wheelFailures++;
        }
      }
      if (info.n === last) stagnant++; else stagnant = 0;
      last = info.n;
      if (stagnant >= 4) return { reached: false, count: info.n, scrolls: i + 1, history: counts, reason: 'stagnant', scroller: info.scrollerTag, wheelFailures };
      await sleep(delayMs);
    }
    return { reached: false, count: last, scrolls: maxScrolls, history: counts, reason: 'maxScrolls', wheelFailures };
  }

  if (routePath === '/screenshot' && method === 'POST') {
    const { session, path: savePath } = body;
    const s = getSession(sessions, session);
    touchSession(s);
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
    touchSession(s);
    const delta = direction === 'up' ? -500 : 500;
    await s.cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 300, y: 300, deltaX: 0, deltaY: delta });
    await sleep(300);
    return { scrolled: direction };
  }

  if (routePath === '/wait' && method === 'POST') {
    touchSession(getSession(sessions, body.session));
    await sleep(body.ms || 1000);
    return { waited: body.ms || 1000 };
  }

  if (routePath.startsWith('/session/') && method === 'DELETE') {
    const session = decodeURIComponent(routePath.split('/')[2]);
    const s = sessions.get(session);
    let knowledgeHint = null;
    if (s) {
      try {
        const r = await s.cdp.send('Runtime.evaluate', { expression: 'location.href', returnByValue: true }, 2000);
        knowledgeHint = siteKnowledgeHintForUrl(r.result?.value);
      } catch {}
      s.cdp.close();
      await closeTab(port, s.targetId).catch(() => {});
      sessions.delete(session);
    }
    const result = { closed: session };
    if (knowledgeHint) result.knowledgeHint = knowledgeHint;
    return result;
  }

  // ---- Console capture (on-demand, opt-in to preserve stealth) ----

  if (routePath === '/console' && method === 'POST') {
    const { session, off } = body;
    const s = getSession(sessions, session);

    if (off) {
      s.cdp.off('Console.messageAdded');
      try { await s.cdp.send('Console.disable'); } catch {}
      delete s._consoleBuf;
      delete s._consoleOn;
      return { console: 'disabled', session };
    }

    if (!s._consoleOn) {
      s._consoleBuf = [];
      s._consoleOn = true;
      await s.cdp.send('Console.enable');
      s.cdp.on('Console.messageAdded', (params) => {
        const m = params.message;
        s._consoleBuf.push({
          level: m.level, text: m.text,
          url: m.url || '', line: m.line || 0,
        });
        if (s._consoleBuf.length > 200) s._consoleBuf.shift();
      });
    }

    const entries = s._consoleBuf.splice(0);
    if (entries.length === 0) return 'No console messages captured.\n';
    return entries.map(e => {
      const loc = e.url ? ` (${e.url}${e.line ? ':' + e.line : ''})` : '';
      return `[${e.level.toUpperCase()}] ${e.text}${loc}`;
    }).join('\n') + '\n';
  }

  // ---- Network capture (on-demand, opt-in to preserve stealth) ----

  if (routePath === '/network' && method === 'POST') {
    const { session, off, all } = body;
    const s = getSession(sessions, session);

    if (off) {
      s.cdp.off('Network.requestWillBeSent');
      s.cdp.off('Network.responseReceived');
      s.cdp.off('Network.loadingFailed');
      // Don't disable Network in headless mode (needed for UA override)
      if (!isHeadless) { try { await s.cdp.send('Network.disable'); } catch {} }
      delete s._netBuf;
      delete s._netPending;
      delete s._netOn;
      return { network: 'disabled', session };
    }

    if (!s._netOn) {
      s._netBuf = [];
      s._netPending = new Map();
      s._netOn = true;
      // Network.enable is idempotent — safe even if already enabled for headless UA
      await s.cdp.send('Network.enable');

      s.cdp.on('Network.requestWillBeSent', (params) => {
        s._netPending.set(params.requestId, {
          method: params.request.method,
          url: params.request.url,
          ts: params.timestamp,
        });
        if (s._netPending.size > 500) {
          s._netPending.delete(s._netPending.keys().next().value);
        }
      });

      s.cdp.on('Network.responseReceived', (params) => {
        const req = s._netPending.get(params.requestId);
        if (!req) return;
        s._netPending.delete(params.requestId);
        s._netBuf.push({
          method: req.method, url: req.url,
          status: params.response.status,
          statusText: params.response.statusText,
          ms: Math.round((params.timestamp - req.ts) * 1000),
        });
        if (s._netBuf.length > 500) s._netBuf.shift();
      });

      s.cdp.on('Network.loadingFailed', (params) => {
        const req = s._netPending.get(params.requestId);
        if (!req) return;
        s._netPending.delete(params.requestId);
        s._netBuf.push({
          method: req.method, url: req.url,
          status: 0, statusText: params.errorText || 'Failed',
          ms: Math.round((params.timestamp - req.ts) * 1000),
          failed: true,
        });
        if (s._netBuf.length > 500) s._netBuf.shift();
      });
    }

    let entries = s._netBuf.splice(0);
    if (!all) entries = entries.filter(e => e.failed || e.status >= 400);

    if (entries.length === 0) {
      return all ? 'No network requests captured.\n' : 'No failed requests captured.\n';
    }
    return entries.map(e => {
      const dur = e.ms != null ? ` (${e.ms}ms)` : '';
      if (e.failed) return `[FAIL] ${e.method} ${e.url} — ${e.statusText}${dur}`;
      return `[${e.status}] ${e.method} ${e.url}${dur}`;
    }).join('\n') + '\n';
  }

  // ---- Show: get DevTools URL for a session ----

  if (routePath.startsWith('/show/') && method === 'GET') {
    const session = decodeURIComponent(routePath.split('/')[2]);
    const s = getSession(sessions, session);
    // Fetch all targets from CDP /json endpoint
    const targets = await cdpFetch(port, '/json');
    const target = targets.find(t => t.id === s.targetId);
    if (!target) throw httpErr(404, `Target not found for session: ${session}`);
    return {
      session,
      targetId: s.targetId,
      url: target.url,
      title: target.title,
      devtoolsFrontendUrl: target.devtoolsFrontendUrl,
      inspectUrl: `devtools://devtools/bundled/inspector.html?ws=127.0.0.1:${port}/devtools/page/${s.targetId}`,
    };
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

function normalizeLaunchMode(mode, fallback = 'headless') {
  const value = String(mode || '').trim().toLowerCase();
  if (value === 'hidden') {
    console.error('Hidden launch mode has been removed. Use headed mode; chromux open creates background tabs by default.');
    process.exit(1);
  }
  return LAUNCH_MODES.has(value) ? value : fallback;
}

function autoLaunchMode() {
  return normalizeLaunchMode(
    process.env.CHROMUX_LAUNCH_MODE || process.env.CHROMUX_AUTO_LAUNCH_MODE,
    'headless',
  );
}

function envFlag(name) {
  const value = process.env[name];
  if (value === undefined) return null;
  const normalized = String(value).trim().toLowerCase();
  if (TRUE_ENV_VALUES.has(normalized)) return true;
  if (FALSE_ENV_VALUES.has(normalized)) return false;
  return null;
}

function openBackgroundDefault() {
  const configured = envFlag('CHROMUX_OPEN_BACKGROUND');
  if (configured !== null) return configured;
  const legacyConfigured = envFlag('CHROMUX_BACKGROUND_TABS');
  if (legacyConfigured !== null) return legacyConfigured;
  return true;
}

function envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function modeSettings(mode = getMode()) {
  if (mode === 'crawl') {
    return {
      mode,
      maxSessions: envNumber('CHROMUX_MAX_SESSIONS_PER_PROFILE', 12),
      maxConcurrentOps: envNumber('CHROMUX_MAX_CONCURRENT_OPS_PER_PROFILE', 4),
      idleTtlMs: envNumber('CHROMUX_IDLE_TTL_MS', 20_000),
      sessionTtlMs: envNumber('CHROMUX_SESSION_TTL_MS', 300_000),
      navigationWaitMs: envNumber('CHROMUX_NAVIGATION_WAIT_MS', 5_000),
      resourceBlocking: envFlag('CHROMUX_BLOCK_RESOURCES') ?? true,
      closeInitialTabs: envFlag('CHROMUX_CLOSE_INITIAL_TABS') ?? true,
      maxNavigationsPerSession: envNumber('CHROMUX_MAX_NAVIGATIONS_PER_SESSION', 0),
      compactRenderers: envFlag('CHROMUX_COMPACT_RENDERERS') ?? false,
      maxQueuedOps: envNumber('CHROMUX_MAX_QUEUED_OPS_PER_PROFILE', 16),
      maxChromeProcesses: envNumber('CHROMUX_MAX_CHROME_PROCESSES_PER_PROFILE', 60),
      maxRenderers: envNumber('CHROMUX_MAX_RENDERERS_PER_PROFILE', 40),
      maxRssMb: envNumber('CHROMUX_MAX_RSS_MB_PER_PROFILE', 12_000),
    };
  }
  return {
    mode,
    maxSessions: envNumber('CHROMUX_MAX_SESSIONS_PER_PROFILE', 0),
    maxConcurrentOps: envNumber('CHROMUX_MAX_CONCURRENT_OPS_PER_PROFILE', 0),
    idleTtlMs: envNumber('CHROMUX_IDLE_TTL_MS', 0),
    sessionTtlMs: envNumber('CHROMUX_SESSION_TTL_MS', 0),
    navigationWaitMs: envNumber('CHROMUX_NAVIGATION_WAIT_MS', 30_000),
    resourceBlocking: false,
    closeInitialTabs: false,
    maxNavigationsPerSession: envNumber('CHROMUX_MAX_NAVIGATIONS_PER_SESSION', 0),
    compactRenderers: false,
    maxQueuedOps: envNumber('CHROMUX_MAX_QUEUED_OPS_PER_PROFILE', 0),
    maxChromeProcesses: envNumber('CHROMUX_MAX_CHROME_PROCESSES_PER_PROFILE', 0),
    maxRenderers: envNumber('CHROMUX_MAX_RENDERERS_PER_PROFILE', 0),
    maxRssMb: envNumber('CHROMUX_MAX_RSS_MB_PER_PROFILE', 0),
  };
}

function extraChromeArgs() {
  const raw = process.env.CHROMUX_EXTRA_CHROME_ARGS || '';
  return splitCommand(raw).filter(Boolean);
}

function defaultCliTimeoutMs() {
  return envNumber('CHROMUX_CLI_TIMEOUT_MS', getMode() === 'crawl' ? 90_000 : 30_000);
}

function parseOpenArgs(args) {
  const out = [];
  let background = openBackgroundDefault();
  for (const arg of args) {
    if (arg === '--background' || arg === '--no-focus') {
      background = true;
      continue;
    }
    if (arg === '--foreground') {
      background = false;
      continue;
    }
    out.push(arg);
  }
  return { session: out[0], url: out[1], background };
}

function chromeLaunchEnv() {
  const env = { ...process.env };
  // On macOS, Google Chrome may start but never expose the DevTools HTTP port
  // when HOME is an agent/runtime synthetic home (for example Hermes profile
  // homes). The explicit --user-data-dir still provides browser-profile
  // isolation, so give Chrome the real account home for macOS framework and
  // per-user service lookups while keeping chromux state under process HOME.
  if (process.platform === 'darwin') {
    const accountHome = os.userInfo().homedir;
    if (accountHome) env.HOME = accountHome;
  }
  return env;
}

function spawnChrome(chrome, chromeArgs) {
  return spawn(chrome, chromeArgs, {
    detached: true,
    stdio: 'ignore',
    env: chromeLaunchEnv(),
  });
}

async function cmdLaunch(profileName, explicitPort, launchMode = 'headless') {
  launchMode = normalizeLaunchMode(launchMode);
  const headless = launchMode === 'headless';
  const settings = modeSettings();
  const cfg = loadConfig();
  const chrome = findChrome(cfg);
  if (!chrome) {
    console.error('Chrome not found. Set chromePath in ~/.chromux/config.json');
    process.exit(1);
  }

  const existing = await resolveProfileRuntime(profileName);
  if (existing?.status === 'running') {
    console.log(JSON.stringify({
      profile: profileName,
      port: existing.port,
      pid: existing.pid,
      headless: existing.headless,
      launchMode: existing.launchMode,
      status: existing.source === 'process' ? 'adopted running profile' : 'already running',
    }, null, 2));
    return;
  }
  if (existing?.status === 'locked') {
    console.error(`Profile "${profileName}" is already locked by PID ${existing.pid}, but CDP is not reachable${existing.port ? ` on port ${existing.port}` : ''}.`);
    console.error('Close that Chrome instance or run: chromux kill ' + profileName);
    process.exit(1);
  }
  clearStaleChromeSingletons(profileName);

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
  ];
  if (headless) {
    chromeArgs.push('--headless=new');
  }
  if (settings.mode === 'crawl') {
    chromeArgs.push(
      '--blink-settings=imagesEnabled=false',
      '--mute-audio',
    );
    if (settings.compactRenderers) {
      chromeArgs.push(
        '--disable-features=IsolateOrigins,site-per-process',
        `--renderer-process-limit=${envNumber('CHROMUX_RENDERER_PROCESS_LIMIT', 8)}`,
      );
    }
  }
  chromeArgs.push(...extraChromeArgs());

  const child = spawnChrome(chrome, chromeArgs);
  child.unref();

  // Wait for CDP to become reachable
  process.stderr.write(`Launching Chrome [${profileName}] on port ${port}...`);
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    const alive = await checkCDP(port);
    if (alive) {
      if (settings.closeInitialTabs) await closeInitialTabs(port);
      const runtime = await resolveProfileRuntime(profileName, { adopt: false });
      const pid = runtime?.pid || child.pid;
      writeState(profileName, {
        pid,
        port,
        sock: sockPath(profileName),
        headless,
        launchMode,
        mode: settings.mode,
      });
      process.stderr.write(' ready.\n');
      console.log(JSON.stringify({
        profile: profileName,
        port,
        pid,
        userDataDir,
        headless,
        launchMode,
        mode: settings.mode,
      }, null, 2));
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
  const discovered = listChromuxChromeProcesses().map(proc => proc.profile);
  profiles = [...new Set([...profiles, ...discovered])];

  const rows = [];
  for (const name of profiles) {
    const runtime = await resolveProfileRuntime(name);
    if (!runtime) continue;
    const cdpOk = runtime.status === 'running';

    // Count tabs via daemon if reachable (short timeout to avoid hang)
    let tabs = '-';
    if (cdpOk) {
      try {
        const list = await cliReq('GET', '/list', null, runtime.sock, 5000);
        tabs = String(Object.keys(list).length);
      } catch {}
    }

    // Check daemon status via socket existence + health.
    // "idle" = no socket yet (daemon lazy-starts on first tab command) — not a failure.
    // "stale" = socket exists but /health fails (daemon crashed, needs cleanup).
    // "ok"   = socket exists and /health succeeds.
    let daemon = 'idle';
    if (fs.existsSync(runtime.sock)) {
      try {
        await cliReq('GET', '/health', null, runtime.sock, 2000);
        daemon = 'ok';
      } catch { daemon = 'stale'; }
    }

    rows.push({ profile: name, port: runtime.port || '-', pid: runtime.pid, status: cdpOk ? 'running' : 'locked', tabs, daemon });
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

  const pids = new Set();
  const st = readState(profileName);
  if (st && isProcessAlive(st.pid)) pids.add(st.pid);
  for (const proc of findProfileProcesses(profileName)) {
    if (isProcessAlive(proc.pid)) pids.add(proc.pid);
  }
  for (const pid of pids) {
    try { process.kill(pid, 'SIGTERM'); } catch {}
  }
  const deadline = Date.now() + 3000;
  while ([...pids].some(pid => isProcessAlive(pid)) && Date.now() < deadline) {
    await sleep(100);
  }
  for (const pid of pids) {
    if (isProcessAlive(pid)) {
      try { process.kill(pid, 'SIGKILL'); } catch {}
    }
  }
  clearState(profileName);
  try { fs.unlinkSync(sock); } catch {}
  const removedProfileFiles = clearStaleChromeSingletons(profileName);
  console.log(JSON.stringify({ profile: profileName, killed: true, pids: [...pids], removedProfileFiles }, null, 2));
}

function cmdPause(profileName) {
  const stopFile = profileStopPath(profileName);
  fs.writeFileSync(stopFile, JSON.stringify({ profile: profileName, pid: process.pid, ts: Date.now() }) + '\n');
  console.log(JSON.stringify({ profile: profileName, paused: true, stopFile }, null, 2));
}

function cmdResume(profileName) {
  const stopFile = profileStopPath(profileName);
  try { fs.unlinkSync(stopFile); } catch {}
  console.log(JSON.stringify({ profile: profileName, paused: false, stopFile }, null, 2));
}

// ============================================================
// CLI client (talks to daemon over Unix socket)
// ============================================================

/**
 * eval — supports literal arg, --file <path>, or stdin (`-`), with --timeout <ms>.
 * Examples:
 *   chromux eval s "1+1"
 *   chromux eval s --file /tmp/extract.js
 *   chromux eval s - < /tmp/extract.js
 *   chromux eval s --timeout 120000 --file /tmp/long.js
 */
async function cmdEval(args, sock) {
  if (!args[0]) { console.error('Usage: chromux eval <session> <code|--file PATH|-> [--timeout MS] [--no-iife]'); process.exit(1); }
  const session = args[0];
  let timeoutMs;
  const tIdx = args.indexOf('--timeout');
  if (tIdx >= 0) { timeoutMs = parseInt(args[tIdx + 1]); args.splice(tIdx, 2); }
  const noIife = args.includes('--no-iife');
  if (noIife) args.splice(args.indexOf('--no-iife'), 1);
  let code;
  const fIdx = args.indexOf('--file');
  if (fIdx >= 0) {
    const p = args[fIdx + 1];
    if (!p) { console.error('--file requires a path'); process.exit(1); }
    code = fs.readFileSync(p, 'utf8');
  } else if (args[1] === '-') {
    code = fs.readFileSync(0, 'utf8');
  } else {
    code = args[1];
  }
  if (code == null) { console.error('No code provided'); process.exit(1); }
  // Auto-wrap top-level statements in an IIFE so const/let don't pollute global REPL scope.
  // Match only at the start of the code — `m` flag would match `const` inside nested
  // function bodies of an expression (e.g. `JSON.stringify([...].map(x => { const y = ... }))`)
  // and wrong-wrap the expression, swallowing its return value.
  // Strip leading comments first so `// note\nconst x = ...` still gets wrapped.
  let probe = code;
  while (true) {
    const stripped = probe.replace(/^\s*(?:\/\*[\s\S]*?\*\/|\/\/.*(?:\r?\n|$))/, '');
    if (stripped === probe) break;
    probe = stripped;
  }
  if (!noIife && /^\s*(?:const|let|var|async|function)\s/.test(probe) && !/^\s*\(/.test(probe)) {
    code = `(async () => { ${code} })()`;
  }
  const httpTimeout = (timeoutMs ? timeoutMs : 30000) + 5000;
  return cliReq('POST', '/eval', { session, code, timeoutMs }, sock, httpTimeout);
}

function readCodeArg(args, usage) {
  let timeoutMs;
  const tIdx = args.indexOf('--timeout');
  if (tIdx >= 0) {
    timeoutMs = parseInt(args[tIdx + 1]);
    args.splice(tIdx, 2);
  }
  const session = args[0];
  if (!session) { console.error(usage); process.exit(1); }
  let code;
  const fIdx = args.indexOf('--file');
  if (fIdx >= 0) {
    const p = args[fIdx + 1];
    if (!p) { console.error('--file requires a path'); process.exit(1); }
    code = fs.readFileSync(p, 'utf8');
  } else if (args[1] === '-') {
    code = fs.readFileSync(0, 'utf8');
  } else {
    code = args[1];
  }
  if (code == null) { console.error('No code provided'); process.exit(1); }
  return { session, code, timeoutMs };
}

async function cmdRun(args, sock) {
  const { session, code, timeoutMs } = readCodeArg(args, 'Usage: chromux run <session> <code|--file PATH|-> [--timeout MS]');
  const httpTimeout = (timeoutMs ? timeoutMs : 30000) + 5000;
  return cliReq('POST', '/run', { session, code, timeoutMs }, sock, httpTimeout);
}

function getBatchArg(args, flag, fallback = null) {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : fallback;
}

function readBatchRecords(filePath, limit = 0) {
  const raw = filePath ? fs.readFileSync(filePath, 'utf8') : fs.readFileSync(0, 'utf8');
  const out = [];
  for (const line of raw.split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    let record;
    if (trimmed.startsWith('{')) {
      try { record = JSON.parse(trimmed); }
      catch { continue; }
      record.url = record.url || record.source_url || record.href;
    } else {
      record = { url: trimmed };
    }
    if (!record.url || !/^https?:\/\//.test(record.url)) continue;
    out.push(record);
    if (limit > 0 && out.length >= limit) break;
  }
  return out;
}

async function cmdBatch(args, sock) {
  const filePath = getBatchArg(args, '--file');
  const outPath = getBatchArg(args, '--out');
  const workers = Math.max(1, Number(getBatchArg(args, '--workers', '4')) || 4);
  const limit = Math.max(0, Number(getBatchArg(args, '--limit', '0')) || 0);
  const prefix = getBatchArg(args, '--session-prefix', `batch-${Date.now().toString(36)}`);
  if (!filePath && !args.includes('-')) {
    console.error('Usage: chromux batch --file urls.txt [--workers N] [--out results.jsonl] [--limit N] [--session-prefix P]');
    process.exit(1);
  }
  const records = readBatchRecords(filePath, limit);
  if (outPath) fs.writeFileSync(outPath, '');
  const queue = [...records];
  const results = [];
  const writeResult = (record) => {
    results.push(record);
    if (outPath) fs.appendFileSync(outPath, JSON.stringify(record) + '\n');
  };

  const worker = async (workerId) => {
    const session = `${prefix}-${workerId}`;
    while (queue.length > 0) {
      const item = queue.shift();
      const started = Date.now();
      const result = {
        workerId,
        session,
        url: item.url,
        input: item,
        ok: false,
        durationMs: 0,
      };
      try {
        const opened = await cliReq('POST', '/open', { session, url: item.url, background: true }, sock, defaultCliTimeoutMs());
        const pageInfo = await cliReq('POST', '/run', {
          session,
          code: `return await page('({url:location.href,title:document.title,textLength:(document.body?document.body.innerText.length:0),htmlLength:(document.documentElement?document.documentElement.outerHTML.length:0)})')`,
          timeoutMs: 15_000,
        }, sock, 20_000);
        result.ok = Boolean(pageInfo?.title) && Number(pageInfo?.htmlLength || 0) > 500;
        result.opened = opened;
        result.page = pageInfo;
      } catch (err) {
        result.error = err.message;
      } finally {
        result.durationMs = Date.now() - started;
        writeResult(result);
      }
    }
    await cliReq('DELETE', `/session/${encodeURIComponent(session)}`, null, sock).catch(() => {});
  };

  await Promise.all(Array.from({ length: workers }, (_, i) => worker(i)));
  const durations = results.map(r => r.durationMs).sort((a, b) => a - b);
  const p95 = durations.length ? durations[Math.min(durations.length - 1, Math.floor((durations.length - 1) * 0.95))] : 0;
  return {
    total: results.length,
    ok: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length,
    workers,
    out: outPath || null,
    p95DurationMs: p95,
  };
}

function parseJsonArg(value, label) {
  try { return JSON.parse(value || '{}'); }
  catch (e) {
    console.error(`Invalid JSON for ${label}: ${e.message}`);
    process.exit(1);
  }
}

async function cmdCdp(args, sock) {
  const session = args[0];
  const cdpMethod = args[1];
  if (!session || !cdpMethod) {
    console.error('Usage: chromux cdp <session> <Method> <params-json|--params-file PATH> [--timeout MS]');
    process.exit(1);
  }
  let timeoutMs;
  const tIdx = args.indexOf('--timeout');
  if (tIdx >= 0) {
    timeoutMs = parseInt(args[tIdx + 1]);
    args.splice(tIdx, 2);
  }
  let params = {};
  const fIdx = args.indexOf('--params-file');
  if (fIdx >= 0) {
    const p = args[fIdx + 1];
    if (!p) { console.error('--params-file requires a path'); process.exit(1); }
    params = parseJsonArg(fs.readFileSync(p, 'utf8'), '--params-file');
  } else if (args[2]) {
    params = parseJsonArg(args[2], 'params-json');
  }
  const httpTimeout = (timeoutMs ? timeoutMs : 30000) + 5000;
  return cliReq('POST', '/cdp', { session, method: cdpMethod, params, timeoutMs }, sock, httpTimeout);
}

async function cmdClick(args, sock) {
  const session = args[0];
  if (!session) { console.error('Usage: chromux click <session> (@ref|selector|--xy X Y)'); process.exit(1); }
  const xyIdx = args.indexOf('--xy');
  if (xyIdx >= 0) {
    const x = Number(args[xyIdx + 1]);
    const y = Number(args[xyIdx + 2]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) { console.error('--xy requires numeric X Y'); process.exit(1); }
    const buttonIdx = args.indexOf('--button');
    const clicksIdx = args.indexOf('--clicks');
    return cliReq('POST', '/click', {
      session,
      xy: [x, y],
      button: buttonIdx >= 0 ? args[buttonIdx + 1] : 'left',
      clicks: clicksIdx >= 0 ? parseInt(args[clicksIdx + 1]) : 1,
    }, sock);
  }
  return cliReq('POST', '/click', { session, selector: args[1] }, sock);
}

async function cmdPress(args, sock) {
  const session = args[0];
  const key = args[1];
  if (!session || !key) { console.error('Usage: chromux press <session> <Enter|Tab|Escape|Backspace>'); process.exit(1); }
  return cliReq('POST', '/press', { session, key }, sock);
}

async function cmdWaitFor(args, sock, kind) {
  const session = args[0];
  const needle = args[1];
  const timeoutMs = args[2] ? Number(args[2]) : 5000;
  if (!session || !needle || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    console.error(`Usage: chromux wait-for-${kind} <session> <${kind}> [timeout-ms]`);
    process.exit(1);
  }
  const body = kind === 'text'
    ? { session, text: needle, timeoutMs }
    : { session, selector: needle, timeoutMs };
  return cliReq('POST', `/wait-for-${kind}`, body, sock, timeoutMs + 5000);
}

async function cmdWatch(args, sock) {
  const session = args[0];
  const what = args[1];
  const off = args.includes('--off');
  const all = args.includes('--all');
  if (!session || !what) { console.error('Usage: chromux watch <session> <console|network> [--off] [--all]'); process.exit(1); }
  if (what === 'console') return cliReq('POST', '/console', { session, off }, sock);
  if (what === 'network') return cliReq('POST', '/network', { session, off, all }, sock);
  console.error('Usage: chromux watch <session> <console|network> [--off] [--all]');
  process.exit(1);
}

/**
 * scroll-until — scroll an inner scroller (auto-detected) until N elements match selector.
 * Examples:
 *   chromux scroll-until s --selector 'li.feed-item' --count 15
 *   chromux scroll-until s --selector h2 --count 50 --max-scrolls 40 --delay 600
 */
async function cmdScrollUntil(args, sock) {
  const session = args[0];
  if (!session) { console.error('Usage: chromux scroll-until <session> (--selector SEL | --js-count "expr") --count N [--max-scrolls M] [--delay MS] [--target SEL]'); process.exit(1); }
  const get = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  const selector = get('--selector');
  const jsCount = get('--js-count');
  const count = parseInt(get('--count'));
  if ((!selector && !jsCount) || !count) { console.error('Need --selector or --js-count, plus --count'); process.exit(1); }
  const maxScrolls = parseInt(get('--max-scrolls') || '30');
  const delayMs = parseInt(get('--delay') || '800');
  const target = get('--target');
  return cliReq('POST', '/scroll-until', { session, selector, jsCount, count, maxScrolls, delayMs, target }, sock, maxScrolls * (delayMs + 500) + 10000);
}

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
  const runtime = await resolveProfileRuntime(profileName);
  return runtime?.status === 'running' ? runtime.port : null;
}

async function ensureDaemon(profileName) {
  const sock = sockPath(profileName);
  const desiredMode = getMode();

  // Check if daemon already running (short timeout to fail fast)
  try {
    const health = await cliReq('GET', '/health', null, sock, 3000);
    if (!health.mode || health.mode === desiredMode) return sock;
    await cliReq('POST', '/stop', {}, sock, 3000).catch(() => {});
    await waitForSocketGone(sock, 3000);
  } catch {}

  // Acquire lockfile to prevent concurrent daemon starts (CR-008)
  const lockFile = path.join(RUN_DIR, `${profileName}.lock`);
  const lockFd = await acquireLock(lockFile);
  try {
    // Re-check after lock — another process may have started it
    try {
      const health = await cliReq('GET', '/health', null, sock, 3000);
      if (!health.mode || health.mode === desiredMode) return sock;
      await cliReq('POST', '/stop', {}, sock, 3000).catch(() => {});
      await waitForSocketGone(sock, 3000);
    } catch {}

    // Clean up stale socket only while holding the startup lock. During
    // concurrent cold-start, another CLI may be starting the daemon; deleting
    // its socket before taking the lock can produce ECONNRESET/socket hang up.
    try { fs.unlinkSync(sock); } catch {}

    // Auto-launch profile if not running
    let port = await resolveProfilePort(profileName);
    if (!port) {
      process.stderr.write(`Auto-launching profile [${profileName}]...\n`);
      await cmdLaunch(profileName, null, autoLaunchMode());
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

async function waitForSocketGone(sock, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (fs.existsSync(sock) && Date.now() < deadline) {
    await sleep(100);
  }
  try { fs.unlinkSync(sock); } catch {}
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
    if (args.includes('--hidden')) {
      console.error('chromux launch --hidden has been removed. Use headed launch; chromux open creates background tabs by default.');
      process.exit(1);
    }
    const launchMode = args.includes('--headless')
      ? 'headless'
      : 'headed';
    return cmdLaunch(name, port, launchMode);
  }
  if (cmd === 'ps') return cmdPs();
  if (cmd === 'kill') {
    if (!args[0]) { console.error('Usage: chromux kill <profile>'); process.exit(1); }
    return cmdKill(args[0]);
  }
  if (cmd === 'pause') return cmdPause(args[0] || getProfile());
  if (cmd === 'resume') return cmdResume(args[0] || getProfile());

  // Tab commands (need daemon)
  const profile = getProfile();
  const sock = await ensureDaemon(profile);

  // Special: show — open DevTools in user's browser
  if (cmd === 'show') {
    if (!args[0]) { console.error('Usage: chromux show <session>'); process.exit(1); }
    const info = await cliReq('GET', `/show/${args[0]}`, null, sock);
    const url = info.devtoolsFrontendUrl;
    if (!url) { console.error('No DevTools URL available'); process.exit(1); }
    // Open in user's default browser (macOS: open, Linux: xdg-open)
    const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
    spawn(opener, [url], { detached: true, stdio: 'ignore' }).unref();
    console.log(JSON.stringify(info, null, 2));
    return;
  }

  const routes = {
    open:       () => {
      const openArgs = parseOpenArgs(args);
      return cliReq('POST', '/open', openArgs, sock, defaultCliTimeoutMs());
    },
    snapshot:   () => {
      const filter = getArgValue(args, '--filter') || (args.includes('--interactive') ? 'interactive' : null);
      const q = filter ? `?filter=${encodeURIComponent(filter)}` : '';
      return cliReq('GET', `/snapshot/${args[0]}${q}`, null, sock);
    },
    cdp:        () => cmdCdp(args, sock),
    run:        () => cmdRun(args, sock),
    batch:      () => cmdBatch(args, sock),
    click:      () => cmdClick(args, sock),
    fill:       () => cliReq('POST', '/fill', { session: args[0], selector: args[1], text: args[2] }, sock),
    type:       () => cliReq('POST', '/type', { session: args[0], text: args[1] }, sock),
    press:      () => cmdPress(args, sock),
    'wait-for-text': () => cmdWaitFor(args, sock, 'text'),
    'wait-for-selector': () => cmdWaitFor(args, sock, 'selector'),
    eval:       () => cmdEval(args, sock),
    'scroll-until': () => cmdScrollUntil(args, sock),
    screenshot: () => cliReq('POST', '/screenshot', { session: args[0], path: args[1] }, sock),
    scroll:     () => cliReq('POST', '/scroll', { session: args[0], direction: args[1] || 'down' }, sock),
    wait:       () => cliReq('POST', '/wait', { session: args[0], ms: parseInt(args[1]) || 1000 }, sock),
    watch:      () => cmdWatch(args, sock),
    console:    () => cliReq('POST', '/console', { session: args[0], off: args.includes('--off') }, sock),
    network:    () => cliReq('POST', '/network', { session: args[0], off: args.includes('--off'), all: args.includes('--all') }, sock),
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
 * Retries with backoff for up to ~60 seconds.
 * Stale locks older than 30 seconds are force-removed unless they still belong
 * to a live chromux startup process.
 */
async function acquireLock(lockFile) {
  const STALE_MS = 30_000;
  const MAX_ATTEMPTS = 120;
  fs.mkdirSync(path.dirname(lockFile), { recursive: true, mode: 0o700 });

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const fd = fs.openSync(lockFile, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, ts: Date.now(), command: currentProcessCommand() }));
      return fd;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let liveOwner = false;
      let knownOwner = false;
      try {
        const owner = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
        if (owner.pid) {
          knownOwner = true;
          const ownerCommand = processCommand(owner.pid);
          liveOwner = !!ownerCommand;
          if (!liveOwner) {
            process.stderr.write(`Removing stale lock from dead PID ${owner.pid}: ${lockFile}\n`);
            fs.unlinkSync(lockFile);
            continue; // Retry immediately
          }
          if (owner.command && ownerCommand && owner.command !== ownerCommand) {
            process.stderr.write(`Removing stale lock from reused PID ${owner.pid}: ${lockFile}\n`);
            fs.unlinkSync(lockFile);
            continue; // Retry immediately
          }
          if (!owner.command && !isChromuxCommand(ownerCommand)) {
            liveOwner = false;
          }
        }
      } catch {}
      if (liveOwner) {
        await sleep(300 + Math.random() * 200);
        continue;
      }
      try {
        const stat = fs.statSync(lockFile);
        if ((!knownOwner || !liveOwner) && Date.now() - stat.mtimeMs > STALE_MS) {
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
function isolatePageExpression(expr) {
  return `(() => (\n${String(expr)}\n))()`;
}
function isolatePageBlock(expr) {
  return `(async () => {\n${String(expr)}\n})()`;
}
function exceptionDetailsText(details) {
  return [
    details?.exception?.description,
    details?.exception?.value,
    details?.text,
  ].filter(Boolean).join('\n');
}
function isLikelyPageExpressionSyntaxError(details) {
  return /SyntaxError|Unexpected token|Unexpected identifier|Invalid or unexpected token|missing \)/i.test(exceptionDetailsText(details));
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ============================================================
// Help
// ============================================================

const HELP = `chromux — tmux for Chrome tabs

The core surface:
  chromux open <session> <url>       Create or navigate a tab
  chromux open --background <s> <u>  Explicitly create a background tab
  chromux run <session> -            Multi-step async JS with cdp/js/page helpers
  chromux batch --file urls.txt      Crawl URLs through a worker-tab pool
  chromux cdp <session> <M> '{}'     Raw CDP method passthrough

Lifecycle:
  chromux launch [name]              Launch Chrome (default: "default")
  chromux launch <name> --headless   Launch in headless mode (no window)
  chromux launch <name> --port N     Launch with specific port
  chromux ps                         List running profiles
  chromux pause [name]               Hard-stop new tab work for a profile
  chromux resume [name]              Allow tab work again for a paused profile
  chromux kill <name>                Stop profile (Chrome + daemon)
  chromux stop                       Stop daemon (keeps Chrome)
  chromux close <session>            Close tab
  chromux list                       List active sessions

Convenience shortcuts:
  chromux snapshot <session>         Accessibility tree with @ref
  chromux snapshot <s> --interactive Only interactive elements (smaller payload)
  chromux click <session> @<ref>     Click by ref number
  chromux click <session> "selector" Click by CSS selector
  chromux click <session> --xy X Y   Click by viewport coordinates
  chromux fill <session> @<ref> "t"  Fill input field
  chromux type <session> "text"      Insert text into focused field
  chromux press <session> Enter      Press Enter, Tab, Escape, or Backspace
  chromux wait-for-text <s> "text"   Wait for visible page text
  chromux wait-for-selector <s> SEL  Wait for visible selector
  chromux screenshot <session> [p]   Take PNG screenshot
  chromux show <session>             Open DevTools in browser (inspect live tab)

Watch / debug:
  chromux watch <session> console    Capture console logs (enable + read + clear)
  chromux watch <session> console --off
  chromux watch <session> network    Capture failed requests (4xx/5xx/errors)
  chromux watch <session> network --all
  chromux watch <session> network --off

Policy:
  New browser actions should be expressed with run or cdp before adding verbs.
  Older aliases such as eval, scroll, wait, console, network, and scroll-until
  remain for compatibility but are hidden from the main surface.

Profile selection:
  chromux --profile <name> <cmd>     Use specific profile
  chromux --mode crawl <cmd>         Use crawl resource policy for this profile daemon
  CHROMUX_PROFILE=<name> chromux     Via environment variable
  CHROMUX_MODE=crawl chromux         Efficient crawl mode (default mode preserves legacy behavior)
  CHROMUX_OPEN_BACKGROUND=0 chromux open ...    Create new tabs in foreground
  (default profile: "default")

Crawl mode:
  Caps expensive profile operations, blocks heavy media/font/analytics resources,
  uses shorter navigation waits, prunes idle sessions, and closes unresponsive
  sessions so worker-tab pools can keep moving. It also applies resource guards
  and honors chromux pause/resume hard-stop files.

Paths:
  ~/.chromux/config.json             Global config
  ~/.chromux/profiles/<name>/        Chrome user-data-dir per profile
  ~/.chromux/run/<name>.sock          Daemon socket per profile
  ~/.chromux/run/<name>.lock          Daemon startup lock (transient)`;

// ============================================================
// Entry
// ============================================================

// Extract global flags before positional parsing so they work in any position.
// Without this, `chromux --profile foo open ...` would treat `--profile` as the command.
{
  const idx = process.argv.indexOf('--profile');
  if (idx >= 2 && process.argv[idx + 1]) {
    process.env.CHROMUX_PROFILE = process.argv[idx + 1];
    process.argv.splice(idx, 2);
  }
  const modeIdx = process.argv.indexOf('--mode');
  if (modeIdx >= 2 && process.argv[modeIdx + 1]) {
    process.env.CHROMUX_MODE = process.argv[modeIdx + 1];
    process.argv.splice(modeIdx, 2);
  }
}

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
