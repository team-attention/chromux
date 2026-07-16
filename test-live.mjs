#!/usr/bin/env node
// Live-mode harness: drives the real extension -> WS -> daemon path in a
// throwaway Chrome for Testing / Chromium instance.
//
// Usage: node test-live.mjs --suite parity|safety [--keep]
//
// The harness loads extension/ into a test browser, bootstraps the pairing
// token into the extension's chrome.storage via CDP (a real user runs
// "chromux pair" + popup instead), then exercises the live CLI surface end to
// end. It never touches the user's real Chrome — it launches its own.

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHROMUX = path.join(HERE, 'chromux.mjs');
const EXTENSION = path.join(HERE, 'extension');

const args = process.argv.slice(2);
const suite = (args[args.indexOf('--suite') + 1]) || 'parity';
const keep = args.includes('--keep');

const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chromux-live-'));
const chromuxHome = path.join(workRoot, 'home');
const userDataDir = path.join(workRoot, 'chrome-profile');
const downloadsDir = path.join(workRoot, 'downloads');
fs.mkdirSync(chromuxHome, { recursive: true });
fs.mkdirSync(downloadsDir, { recursive: true });

const LIVE_PORT = 47750; // fixed test facade port (distinct from default)
const DEBUG_PORT = 9977;
const token = crypto.randomBytes(24).toString('hex');

const env = {
  ...process.env,
  CHROMUX_HOME: chromuxHome,
  CHROMUX_PROFILE: 'live',
};

let chromeProc = null;
let fixtureServer = null;
const results = [];
function log(msg) { process.stdout.write(msg + '\n'); }
function ok(name) { results.push({ name, ok: true }); log(`  PASS ${name}`); }
function fail(name, detail) { results.push({ name, ok: false, detail }); log(`  FAIL ${name}: ${detail}`); }

function findBrowser() {
  if (process.env.CHROMUX_TEST_BROWSER && fs.existsSync(process.env.CHROMUX_TEST_BROWSER)) {
    return process.env.CHROMUX_TEST_BROWSER;
  }
  const cacheRoots = [
    path.join(os.homedir(), 'Library/Caches/ms-playwright'),
    path.join(os.homedir(), '.cache/ms-playwright'),
  ];
  for (const root of cacheRoots) {
    let entries = [];
    try { entries = fs.readdirSync(root); } catch { continue; }
    const chromiums = entries.filter(e => /^chromium-\d+$/.test(e)).sort().reverse();
    for (const dir of chromiums) {
      const candidates = [
        path.join(root, dir, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
        path.join(root, dir, 'chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
        path.join(root, dir, 'chrome-linux/chrome'),
      ];
      for (const c of candidates) if (fs.existsSync(c)) return c;
    }
  }
  return null;
}

function httpGet(port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method: 'GET' }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Persistent CDP connection to the extension service worker. Real users keep
// the SW alive via the popup/alarm; the harness holds an open CDP session and
// pings it so MV3 suspension never races the test.
let swConn = null;

async function findSwTarget() {
  for (let i = 0; i < 40; i++) {
    const list = await httpGet(DEBUG_PORT, '/json/list').catch(() => []);
    const sw = Array.isArray(list) ? list.find(t => t.type === 'service_worker' && /bg\.js|background/.test(t.url)) : null;
    if (sw && sw.webSocketDebuggerUrl) return sw;
    await sleep(300);
  }
  throw new Error('extension service worker target not found');
}

async function openSwConn() {
  const { WebSocket } = globalThis;
  const sw = await findSwTarget();
  const ws = new WebSocket(sw.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, (m) => m.error ? reject(new Error(m.error.message)) : resolve(m.result));
    ws.send(JSON.stringify({ id, method, params }));
  });
  return { ws, send, close: () => { try { ws.close(); } catch {} } };
}

async function swEval(expr, awaitPromise = true) {
  if (!swConn) return null;
  const r = await swConn.send('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true }).catch(() => null);
  return r?.result?.value;
}

// Inject pairing config and keep the SW alive + reconnecting for the test.
async function cdpBootstrap() {
  swConn = await openSwConn();
  await swEval(`chrome.storage.local.set({ port: ${LIVE_PORT}, token: ${JSON.stringify(token)}, enabled: true }).then(() => 'set')`);
  // Keepalive: evaluate periodically so the SW never suspends mid-test.
  swConn.keepalive = setInterval(() => { swEval('Date.now()', false).catch(() => {}); }, 1000);
}

async function nudgeExtensionConnect() {
  // Re-assert pairing config (survives SW reloads) and force a connect. A real
  // user's popup/alarm plays this role.
  await swEval(`chrome.storage.local.set({ port: ${LIVE_PORT}, token: ${JSON.stringify(token)}, enabled: true }).then(()=>'set')`);
  await swEval(`new Promise(r => chrome.runtime.sendMessage({type:'pair', port:${LIVE_PORT}, token:${JSON.stringify(token)}}, () => r('ok')))`);
}

// Fixture server runs in its own process. The harness drives the CLI with
// spawnSync (blocking), so an in-process server would be frozen exactly when a
// download-triggering navigation needs it. A separate process stays responsive.
function startFixtureServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [path.join(HERE, 'test-live-fixture.mjs')], { stdio: ['ignore', 'pipe', 'ignore'] });
    let buf = '';
    const timer = setTimeout(() => reject(new Error('fixture server did not start')), 5000);
    proc.stdout.on('data', (chunk) => {
      buf += chunk;
      const m = buf.match(/PORT=(\d+)/);
      if (m) {
        clearTimeout(timer);
        resolve({ proc, port: Number(m[1]), close: () => { try { proc.kill('SIGKILL'); } catch {} } });
      }
    });
    proc.on('error', reject);
  });
}

function runCli(cliArgs, { allowFail = false, extraEnv = {} } = {}) {
  const r = spawnSync(process.execPath, [CHROMUX, ...cliArgs], {
    env: { ...env, ...extraEnv }, encoding: 'utf8', timeout: 90000,
  });
  if (r.status !== 0 && !allowFail) {
    throw new Error(`chromux ${cliArgs.join(' ')} failed: ${r.stderr || r.stdout}`);
  }
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function launchTestChrome(browser) {
  const chromeArgs = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${DEBUG_PORT}`,
    '--disable-features=DisableLoadExtensionCommandLineSwitch',
    `--load-extension=${EXTENSION}`,
    `--user-data-dir=${userDataDir}`,
    'about:blank',
  ];
  chromeProc = spawn(browser, chromeArgs, { detached: false, stdio: 'ignore' });
  return chromeProc;
}

async function waitForRelay(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let lastNudge = 0;
  while (Date.now() < deadline) {
    const status = await httpGet(LIVE_PORT, '/relay/status').catch(() => null);
    if (status?.extensionConnected) return status;
    // Wake the SW and force a reconnect every ~2s (facade is up now).
    if (Date.now() - lastNudge > 2000) { lastNudge = Date.now(); await nudgeExtensionConnect().catch(() => {}); }
    await sleep(400);
  }
  const diag = await swEval(`(async()=>{const c=await chrome.storage.local.get(['port','token','enabled']);return JSON.stringify({cfg:{port:c.port,hasToken:!!c.token,enabled:c.enabled},wsState: (typeof ws!=='undefined'&&ws)?ws.readyState:'none'});})()`).catch(() => 'diag-failed');
  throw new Error('extension relay did not connect; SW diag=' + diag);
}

async function cleanup() {
  if (swConn?.keepalive) clearInterval(swConn.keepalive);
  if (swConn) swConn.close();
  try { runCli(['kill', 'live'], { allowFail: true }); } catch {}
  if (chromeProc) { try { chromeProc.kill('SIGKILL'); } catch {} }
  if (fixtureServer) { try { fixtureServer.close(); } catch {} }
  if (!keep) { try { fs.rmSync(workRoot, { recursive: true, force: true }); } catch {} }
}

// Configure pairing on the chromux side (writes live.json with our fixed port).
function pairChromux() {
  fs.writeFileSync(path.join(chromuxHome, 'live.json'), JSON.stringify({ port: LIVE_PORT, token }) + '\n', { mode: 0o600 });
}

async function bringUpLive() {
  const browser = findBrowser();
  if (!browser) throw new Error('no test browser found (set CHROMUX_TEST_BROWSER)');
  pairChromux();
  // Prevent the daemon's cold-start from launching a *second* browser: point
  // the live launch command at a harmless no-op; our harness owns the browser.
  env.CHROMUX_LIVE_LAUNCH_CMD = `${process.execPath} -e process.exit(0)`;
  launchTestChrome(browser);
  await cdpBootstrap();
  // Boot the facade first, then repeatedly wake the extension SW so it
  // reconnects even after MV3 suspension (a real user's popup/alarm does this).
  await waitForFacade();
  await waitForRelay();
}

async function waitForFacade(timeoutMs = 20000) {
  // `chromux tabs` boots the daemon (which starts the facade) and waits on relay.
  // Start it in the background; poll the facade port until it answers.
  const child = spawn(process.execPath, [CHROMUX, 'tabs', '--json'], { env, stdio: 'ignore' });
  child.on('exit', () => {});
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = await httpGet(LIVE_PORT, '/json/version').catch(() => null);
    if (v && v.webSocketDebuggerUrl) return;
    await sleep(300);
  }
  throw new Error('live facade did not come up');
}

async function paritySuite() {
  fixtureServer = await startFixtureServer();
  const base = `http://127.0.0.1:${fixtureServer.port}`;

  // open (new tab) + snapshot
  let r = runCli(['open', 'p1', `${base}/`]);
  if (/live ok|Live Fixture/.test(r.stdout) || /"interactive"/.test(r.stdout)) ok('open new tab'); else fail('open new tab', r.stdout.slice(0, 200));

  r = runCli(['snapshot', 'p1']);
  if (/live ok/.test(r.stdout)) ok('snapshot reads page'); else fail('snapshot reads page', r.stdout.slice(0, 200));

  // click via selector
  r = runCli(['click', 'p1', '#btn']);
  if (r.status === 0) ok('click element'); else fail('click element', r.stderr.slice(0, 200));
  r = runCli(['snapshot', 'p1', '--grep', 'clicked'], { allowFail: true });
  if (/clicked/.test(r.stdout)) ok('click mutated page'); else fail('click mutated page', r.stdout.slice(0, 120));

  // download adapter
  r = runCli(['download', 'p1', '--url', `${base}/download.txt`, '--to', downloadsDir], { allowFail: true });
  if (/"downloaded"|hello\.txt|"path"/.test(r.stdout)) ok('download adapter'); else fail('download adapter', (r.stdout || r.stderr).slice(0, 200));

  // unsupported command errors (show)
  r = runCli(['show', 'p1'], { allowFail: true });
  if (r.status !== 0 && /cannot open DevTools|debugger client/.test(r.stderr)) ok('unsupported show errors clearly'); else fail('unsupported show errors clearly', (r.stderr || r.stdout).slice(0, 200));

  // pairing token enforcement: bad token is rejected by facade
  const badReject = await new Promise((resolve) => {
    const { WebSocket } = globalThis;
    const ws = new WebSocket(`ws://127.0.0.1:${LIVE_PORT}/relay?token=wrong`);
    ws.addEventListener('open', () => { resolve(false); ws.close(); });
    ws.addEventListener('error', () => resolve(true));
    setTimeout(() => resolve(true), 2000);
  });
  if (badReject) ok('bad pairing token rejected'); else fail('bad pairing token rejected', 'accepted a wrong token');
}

async function safetySuite() {
  fixtureServer = await startFixtureServer();
  const base = `http://127.0.0.1:${fixtureServer.port}`;

  // tabs listing shows the browser's tabs
  let r = runCli(['tabs', '--json']);
  let tabs;
  try { tabs = JSON.parse(r.stdout); } catch { tabs = []; }
  if (Array.isArray(tabs)) ok('tabs listing'); else fail('tabs listing', r.stdout.slice(0, 200));

  // Attach an existing *user* tab (one chromux did not create), so close must
  // detach only and leave the tab open.
  const userTabId = await swEval(`chrome.tabs.create({ url: ${JSON.stringify(base + '/')}, active: false }).then(async t => { for (let i=0;i<50;i++){const g=await chrome.tabs.get(t.id); if(g.status==='complete'&&g.url&&g.url!=='about:blank')break; await new Promise(r=>setTimeout(r,100));} return t.id; })`);
  if (typeof userTabId === 'number') {
    r = runCli(['open', 's2', '--tab', String(userTabId)], { allowFail: true });
    if (r.status === 0 && /live ok|"url"/.test(r.stdout)) ok('attach existing tab'); else fail('attach existing tab', (r.stdout || r.stderr).slice(0, 200));
  } else {
    fail('attach existing tab', 'could not create user tab');
  }

  // close on attached user tab = detach (tab stays open)
  const userTabAliveBefore = await swEval(`chrome.tabs.get(${userTabId}).then(()=>true).catch(()=>false)`);
  runCli(['close', 's2'], { allowFail: true });
  await sleep(500);
  const userTabAliveAfter = await swEval(`chrome.tabs.get(${userTabId}).then(()=>true).catch(()=>false)`);
  if (userTabAliveBefore && userTabAliveAfter) ok('close on attached tab detaches (tab survives)'); else fail('close on attached tab detaches (tab survives)', `tab alive before=${userTabAliveBefore} after=${userTabAliveAfter}`);

  // auto-reconnect: drop the relay (simulates a worker restart / network blip)
  // and confirm the bridge recovers on its own and a command works again.
  await swEval(`self.__chromuxDropConnection && self.__chromuxDropConnection()`);
  let reconnected = false;
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    const st = await httpGet(LIVE_PORT, '/relay/status').catch(() => null);
    if (st?.extensionConnected) { reconnected = true; break; }
  }
  if (reconnected) {
    r = runCli(['open', 'rc', `${base}/`], { allowFail: true });
    if (r.status === 0 && /live ok|"interactive"/.test(r.stdout)) ok('auto-reconnect after dropped relay'); else fail('auto-reconnect after dropped relay', (r.stdout || r.stderr).slice(0, 200));
  } else {
    fail('auto-reconnect after dropped relay', 'relay did not reconnect');
  }

  // kill switch: disable via the extension kill switch, then a live command must fail
  await triggerKillSwitch();
  await sleep(1000);
  r = runCli(['open', 'k1', `${base}/`], { allowFail: true, extraEnv: { CHROMUX_LIVE_LAUNCH_CMD: `${process.execPath} -e process.exit(0)` } });
  if (r.status !== 0 && /kill switch|blocked/.test(r.stderr)) ok('kill switch blocks commands'); else fail('kill switch blocks commands', (r.stderr || r.stdout).slice(0, 200));

  // kill live keeps the browser process alive
  const chromeAliveBefore = chromeProc && !chromeProc.killed;
  runCli(['kill', 'live'], { allowFail: true });
  await sleep(500);
  const chromeAliveAfter = chromeProc && !chromeProc.killed && isPidAlive(chromeProc.pid);
  if (chromeAliveBefore && chromeAliveAfter) ok('kill live keeps browser process'); else fail('kill live keeps browser process', `alive before=${chromeAliveBefore} after=${chromeAliveAfter}`);
}

function isPidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function triggerKillSwitch() {
  // Stop the harness keepalive so it doesn't immediately re-nudge a reconnect,
  // then invoke the extension's kill switch directly (a runtime message from
  // the worker to itself is not delivered, so use the exposed test hook).
  if (swConn?.keepalive) { clearInterval(swConn.keepalive); swConn.keepalive = null; }
  await swEval(`self.__chromuxKillSwitch ? self.__chromuxKillSwitch().then(()=>'killed') : 'no-hook'`);
}

async function main() {
  log(`live harness: suite=${suite} browser=${findBrowser() || 'NONE'}`);
  if (!findBrowser()) { log('SKIP: no test browser available'); process.exit(0); }
  try {
    await bringUpLive();
    if (suite === 'parity') await paritySuite();
    else if (suite === 'safety') await safetySuite();
    else throw new Error(`unknown suite: ${suite}`);
  } catch (err) {
    fail(`suite ${suite} setup`, err.message);
  } finally {
    await cleanup();
  }
  const failed = results.filter(r => !r.ok);
  log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main();
