#!/usr/bin/env node
// Browser/runtime verification (V3) for the secret-store add-on: drives a
// real headless Chrome through chromux `fill --secret` against a local
// fixture login page, using the mock `bw` (test/mock-bin/bw) so no real
// vault is touched. Complements test-secret.mjs (V2, no browser).
//
// Proves: fill --secret resolves and fills a real DOM input; the fill
// response and activity log never carry the plaintext password; a
// not-found host hands off cleanly instead of crashing; a TOTP-seed item
// whose tier can't compute a code returns 'unsupported-tier', not a crash.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHROMUX = path.join(HERE, 'chromux.mjs');
const MOCK_BIN = path.join(HERE, 'test', 'mock-bin');

const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chromux-secret-browser-'));
const chromuxHome = path.join(workRoot, 'home');
const vaultFile = path.join(workRoot, 'vault.json');
fs.mkdirSync(chromuxHome, { recursive: true });

const PASSWORD = 'browsertest-pw-A1b2C3';
fs.writeFileSync(vaultFile, JSON.stringify({
  items: [
    { id: 'b1', name: 'chromux/global/127.0.0.1', login: { username: 'browsertest-user', password: PASSWORD, uris: [{ uri: 'https://127.0.0.1' }] } },
    { id: 'b2', name: 'chromux/global/tierlocked.invalid', login: { username: 'tier-user', password: 'tier-pw', totp: 'SEED', totpPremiumLocked: true, uris: [{ uri: 'https://tierlocked.invalid' }] } },
  ],
}, null, 2));

const baseEnv = {
  ...process.env,
  PATH: `${MOCK_BIN}:${process.env.PATH}`,
  CHROMUX_HOME: chromuxHome,
  MOCK_BW_VAULT_FILE: vaultFile,
};
delete baseEnv.CHROMUX_PROFILE;

let PASS = 0, FAIL = 0;
function check(desc, cond) {
  if (cond) { console.log(`  ✓ ${desc}`); PASS++; }
  else { console.log(`  ✗ ${desc}`); FAIL++; }
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function runCli(args, extraEnv = {}) {
  const res = spawnSync('node', [CHROMUX, ...args], { env: { ...baseEnv, ...extraEnv }, encoding: 'utf8' });
  let json = null;
  try { json = JSON.parse(res.stdout); } catch {}
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, json };
}

function sockPath() { return path.join(chromuxHome, 'run', 'secret-agent.sock'); }
function agentRequest(op, payload = {}, timeoutMs = 2000) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (r) => { if (settled) return; settled = true; resolve(r); };
    let socket;
    try { socket = net.createConnection(sockPath()); } catch { finish({ ok: false }); return; }
    const timer = setTimeout(() => { try { socket.destroy(); } catch {} finish({ ok: false }); }, timeoutMs);
    let buf = '';
    socket.on('connect', () => socket.write(JSON.stringify({ op, ...payload }) + '\n'));
    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      const idx = buf.indexOf('\n');
      if (idx === -1) return;
      clearTimeout(timer);
      try { finish(JSON.parse(buf.slice(0, idx))); } catch { finish({ ok: false }); }
      try { socket.destroy(); } catch {}
    });
    socket.on('error', () => { clearTimeout(timer); finish({ ok: false }); });
  });
}
async function spawnAgent() {
  const child = spawn('node', [CHROMUX, '--secret-agent'], { env: baseEnv, detached: true, stdio: 'ignore' });
  child.unref();
  for (let i = 0; i < 30; i++) {
    await sleep(100);
    if ((await agentRequest('status', {}, 400)).ok) return true;
  }
  return false;
}

async function main() {
  console.log('=== chromux secret store: browser/runtime verification (V3) ===');
  console.log(`workRoot: ${workRoot}`);

  // Local fixture: a data: URL login form — no socket/server involved at all,
  // so there is no network reachability to debug. `fill --secret` resolves
  // by the host named in --secret, independent of the current page's URL,
  // so a data: page can still exercise a real host-scoped credential lookup.
  const fixtureHtml = '<!doctype html><html><body><form>' +
    '<input id="user" name="user">' +
    '<input id="pass" name="pass" type="password">' +
    '<button id="go" type="submit">Sign in</button>' +
    '</form></body></html>';
  const url = 'data:text/html,' + encodeURIComponent(fixtureHtml);

  check('a fresh secret-agent spawns', await spawnAgent());
  check('unlock over the agent socket succeeds', (await agentRequest('unlock', { session: 'BROWSER-TEST-SESSION', ttlMs: 5 * 60 * 1000 })).ok);

  const profile = 'secrettest-' + process.pid;
  const profileEnv = { CHROMUX_PROFILE: profile };
  try {
    const launch = spawnSync('node', [CHROMUX, 'launch', profile, '--headless'], { env: { ...baseEnv, ...profileEnv }, encoding: 'utf8' });
    check('profile launches headless', launch.status === 0);

    const openRes = runCli(['open', 'main', url], profileEnv);
    check('open navigates to the local fixture', openRes.status === 0);

    const fillRes = runCli(['fill', 'main', '#pass', '--secret', '127.0.0.1:password'], profileEnv);
    check('fill --secret succeeds against a real Chrome input', fillRes.status === 0);
    check('fill response never carries the plaintext password', !fillRes.stdout.includes(PASSWORD));

    const readBack = runCli(['eval', 'main', 'document.querySelector("#pass").value'], profileEnv);
    check('the real DOM input actually received the resolved password', readBack.stdout.includes(PASSWORD));

    const artifactsDir = path.join(HERE, 'agents', 'implement', 'chromux-secret-store', 'artifacts', 'screenshots');
    fs.mkdirSync(artifactsDir, { recursive: true });
    const shotPath = path.join(artifactsDir, 'secret-fill-proof.png');
    const shotRes = runCli(['screenshot', 'main', shotPath], profileEnv);
    check('a screenshot of the filled real Chrome page is captured as evidence', shotRes.status === 0 && fs.existsSync(shotPath) && fs.statSync(shotPath).size > 0);

    const activityPath = path.join(chromuxHome, 'activity', 'events.jsonl');
    let activityContent = '';
    try { activityContent = fs.readFileSync(activityPath, 'utf8'); } catch {}
    check('the activity log never carries the plaintext password', !activityContent.includes(PASSWORD));
    check('the activity log never carries the raw session key', !activityContent.includes('BROWSER-TEST-SESSION'));

    const fillMissing = runCli(['fill', 'main', '#user', '--secret', 'no-such-host.example:password'], profileEnv);
    check('fill --secret for an unregistered host hands off instead of crashing', fillMissing.status === 1 && fillMissing.json?.ok === false && fillMissing.json?.secret === 'not-found');

    // A totp seed IS configured on this item, but the mock bw's `get totp`
    // fails for it (totpPremiumLocked), exactly like a real free-tier
    // Bitwarden account asked for a code it cannot compute. This is the
    // path AC6/D-20 require: an agent-facing structured handoff, not a
    // crash and not a silent skip.
    const fillTotpLocked = runCli(['fill', 'main', '#user', '--secret', 'tierlocked.invalid:totp'], profileEnv);
    check('fill --secret :totp on a tier-locked item returns unsupported-tier, not a crash', fillTotpLocked.status === 1 && fillTotpLocked.json?.ok === false && fillTotpLocked.json?.secret === 'unsupported-tier');
    check('the unsupported-tier response carries a next hint pointing at Premium/Vaultwarden', /Premium|Vaultwarden/.test(fillTotpLocked.json?.next || ''));

    runCli(['close', 'main'], profileEnv);
  } finally {
    spawnSync('node', [CHROMUX, 'kill', profile], { env: { ...baseEnv, ...profileEnv }, encoding: 'utf8' });
  }

  await agentRequest('evict').catch(() => {});
  console.log(`\n=== RESULT: ${PASS} passed, ${FAIL} failed ===`);
  fs.rmSync(workRoot, { recursive: true, force: true });
  process.exit(FAIL === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('test-secret-browser.mjs crashed:', err);
  process.exit(1);
});
