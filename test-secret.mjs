#!/usr/bin/env node
// Automated behavior harness for the secret-store add-on (chromux secret,
// fill --secret plumbing, the memory-only secret-agent process). No real
// Chrome, no real Bitwarden vault: `bw` is a mock (test/mock-bin/bw) whose
// subcommand contract mirrors the real CLI validated pre-implementation
// (agents/interview/chromux-secret-store/qa-log.md, D-01/D-07).
//
// What this file intentionally does NOT cover (by design, not oversight):
//   - `secret set`/`secret rm`/`secret get --reveal` are TTY-gated (R7/D-23)
//     and cannot be driven from an automated subprocess — that gate is
//     exactly the property under test, and it IS asserted here (it must
//     refuse to run without a terminal). The underlying bw create/edit/
//     delete call shape was proven separately against the real vault
//     (validate-real.mjs, 6 passed/0 failed/1 skipped) and shares the same
//     runBw/encode helpers exercised below.
//   - `fill --secret` end-to-end (needs a live Chrome/daemon) and activity
//     log/redaction inspection after a real fill are covered by ./test.sh
//     at the browser/runtime verification stage (V3), not here.
//
// Usage: node test-secret.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHROMUX = path.join(HERE, 'chromux.mjs');
const MOCK_BIN = path.join(HERE, 'test', 'mock-bin');

const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chromux-secret-test-'));
const chromuxHome = path.join(workRoot, 'home');
const vaultFile = path.join(workRoot, 'vault.json');
fs.mkdirSync(chromuxHome, { recursive: true });
fs.writeFileSync(vaultFile, JSON.stringify({ items: [] }));

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
  const res = spawnSync('node', [CHROMUX, ...args], {
    env: { ...baseEnv, ...extraEnv },
    encoding: 'utf8',
    input: '', // never a TTY: stdin is a closed pipe, isTTY is false
  });
  let json = null;
  try { json = JSON.parse(res.stdout); } catch {}
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, json };
}

function sockPath() { return path.join(chromuxHome, 'run', 'secret-agent.sock'); }
function pidPath() { return path.join(chromuxHome, 'run', 'secret-agent.pid'); }

function agentRequest(op, payload = {}, timeoutMs = 2000) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (r) => { if (settled) return; settled = true; resolve(r); };
    let socket;
    try { socket = net.createConnection(sockPath()); }
    catch { finish({ ok: false, reason: 'not-running' }); return; }
    const timer = setTimeout(() => { try { socket.destroy(); } catch {} finish({ ok: false, reason: 'timeout' }); }, timeoutMs);
    let buf = '';
    socket.on('connect', () => socket.write(JSON.stringify({ op, ...payload }) + '\n'));
    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      const idx = buf.indexOf('\n');
      if (idx === -1) return;
      clearTimeout(timer);
      try { finish(JSON.parse(buf.slice(0, idx))); } catch { finish({ ok: false, reason: 'bad-response' }); }
      try { socket.destroy(); } catch {}
    });
    socket.on('error', () => { clearTimeout(timer); finish({ ok: false, reason: 'not-running' }); });
  });
}

async function spawnAgent() {
  const child = spawn('node', [CHROMUX, '--secret-agent'], { env: baseEnv, detached: true, stdio: 'ignore' });
  child.unref();
  for (let i = 0; i < 30; i++) {
    await sleep(100);
    const probe = await agentRequest('status', {}, 400);
    if (probe.ok) return true;
  }
  return false;
}

async function walkForString(dir, needle) {
  let found = false;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (await walkForString(full, needle)) found = true; continue; }
    if (entry.isSocket()) continue;
    try {
      const content = fs.readFileSync(full, 'utf8');
      if (content.includes(needle)) { found = true; console.log(`    (leak candidate: ${full})`); }
    } catch {}
  }
  return found;
}

async function main() {
  console.log('=== chromux secret store: automated behavior suite ===');
  console.log(`workRoot: ${workRoot}`);

  // ---------------------------------------------------------------
  console.log('\n-- agent lifecycle: spawn, unlock, get, TTL self-expiry --');
  check('secret status reports unlocked:false with no agent running', (await agentRequest('status', {}, 300)).ok === false || (await agentRequest('status', {}, 300)).unlocked === false);
  check('secret-agent process spawns and its socket comes up', await spawnAgent());

  const shortUnlock = await agentRequest('unlock', { session: 'TEST-SESSION-A', ttlMs: 700 });
  check('unlock over the agent socket succeeds', shortUnlock.ok === true && shortUnlock.unlocked === true);

  const getA = await agentRequest('get');
  check('get returns the exact session handed to unlock', getA.ok === true && getA.session === 'TEST-SESSION-A');

  if (process.platform !== 'win32') {
    const mode = fs.statSync(sockPath()).mode & 0o777;
    check('unix socket is 0600 (owner-only)', mode === 0o600);
  }

  const leaked = await walkForString(chromuxHome, 'TEST-SESSION-A');
  check('the session key is never written to any file under CHROMUX_HOME', !leaked);

  await sleep(900); // past the 700ms TTL
  const afterTtl = await agentRequest('status', {}, 500);
  check('status reports locked after TTL self-expiry (no explicit lock call)', afterTtl.ok === false || afterTtl.unlocked === false);

  await sleep(300); // give the agent's own self-exit timer time to fire
  const gone = await agentRequest('status', {}, 300);
  check('the agent process exits itself on TTL expiry (socket no longer reachable)', gone.ok === false && gone.reason === 'not-running');

  console.log('\n-- agent lifecycle: explicit lock --');
  check('a fresh agent spawns again', await spawnAgent());
  const unlockB = await agentRequest('unlock', { session: 'TEST-SESSION-B', ttlMs: 5 * 60 * 1000 });
  check('unlock with a long TTL succeeds', unlockB.ok === true);
  await agentRequest('evict');
  await sleep(200);
  const afterLock = await agentRequest('status', {}, 300);
  check('explicit lock evaporates the key and exits the agent process', afterLock.ok === false && afterLock.reason === 'not-running');

  console.log('\n-- agent lifecycle: hard kill (simulated crash/reboot) leaves a clean CLI experience --');
  check('a fresh agent spawns again', await spawnAgent());
  await agentRequest('unlock', { session: 'TEST-SESSION-C', ttlMs: 5 * 60 * 1000 });
  let killed = false;
  try {
    const pid = Number(fs.readFileSync(pidPath(), 'utf8').trim());
    process.kill(pid, 'SIGKILL');
    killed = true;
  } catch {}
  check('the agent process pid file was readable and killable', killed);
  await sleep(200);
  const statusAfterKill = runCli(['secret', 'status']);
  check('`chromux secret status` after a hard kill exits cleanly (no hang, no crash)', statusAfterKill.status === 0);
  check('`chromux secret status` after a hard kill reports unlocked:false', statusAfterKill.json?.ok === true && statusAfterKill.json?.unlocked === false);

  // ---------------------------------------------------------------
  console.log('\n-- TTY gate: unlock/set/rm/reveal are human-only --');
  const unlockNoTty = runCli(['secret', 'unlock']);
  check('secret unlock without a TTY refuses (no hang, clear exit)', unlockNoTty.status === 1 && /terminal/.test(unlockNoTty.stderr));
  const setNoTty = runCli(['secret', 'set', 'example.com', '--user', 'x']);
  check('secret set without a TTY refuses', setNoTty.status === 1 && /terminal/.test(setNoTty.stderr));
  const rmNoTty = runCli(['secret', 'rm', 'example.com']);
  check('secret rm without a TTY refuses', rmNoTty.status === 1 && /terminal/.test(rmNoTty.stderr));
  const revealNoTty = runCli(['secret', 'get', 'example.com', '--reveal']);
  check('secret get --reveal without a TTY refuses', revealNoTty.status === 1 && /terminal/.test(revealNoTty.stderr));

  // ---------------------------------------------------------------
  console.log('\n-- resolution: profile-local overrides global, parent-domain fallback, not-found --');
  fs.writeFileSync(vaultFile, JSON.stringify({
    items: [
      { id: 'i1', name: 'chromux/global/github.com', login: { username: 'global-user', password: 'global-pw', uris: [{ uri: 'https://github.com' }] } },
      { id: 'i2', name: 'chromux/work/github.com', login: { username: 'work-user', password: 'work-pw', uris: [{ uri: 'https://github.com' }] } },
      { id: 'i3', name: 'chromux/global/google.com', login: { username: 'g-user', password: 'g-pw', totp: 'SEEDXYZ', uris: [{ uri: 'https://google.com' }] } },
    ],
  }, null, 2));
  check('a fresh agent spawns for the resolve tests', await spawnAgent());
  check('unlock for resolve tests succeeds', (await agentRequest('unlock', { session: 'GOOD-SESSION', ttlMs: 5 * 60 * 1000 })).ok);

  const getDefault = runCli(['secret', 'get', 'github.com']);
  check('secret get with no --profile falls back to the global scope', getDefault.json?.ok === true && getDefault.json?.scope === 'global' && getDefault.json?.username === 'global-user');

  const getWork = runCli(['secret', 'get', 'github.com'], { CHROMUX_PROFILE: 'work' });
  check('secret get under CHROMUX_PROFILE=work resolves the profile-local override', getWork.json?.ok === true && getWork.json?.scope === 'work' && getWork.json?.username === 'work-user');

  const getParent = runCli(['secret', 'get', 'accounts.google.com']);
  check('secret get on a subdomain falls back to the parent-domain credential', getParent.json?.ok === true && getParent.json?.host === 'google.com' && getParent.json?.hasTotp === true);

  const getMissing = runCli(['secret', 'get', 'no-such-host.example']);
  check('secret get for an unregistered host returns a structured not-found (no crash)', getMissing.status === 1 && getMissing.json?.ok === false && getMissing.json?.secret === 'not-found');

  const list = runCli(['secret', 'list']);
  check('secret list shows registered hosts with scope, without values', list.status === 0 && /github\.com\s+\(global\)/.test(list.stdout) && /github\.com\s+\(work\)/.test(list.stdout) && !list.stdout.includes('global-pw'));

  // ---------------------------------------------------------------
  console.log('\n-- lazy invalidation: a bw auth failure evicts the cached session --');
  check('a fresh agent spawns', await spawnAgent());
  check('unlock with an invalid-marker session succeeds at the agent level', (await agentRequest('unlock', { session: 'INVALID-SESSION', ttlMs: 5 * 60 * 1000 })).ok);
  const getInvalid = runCli(['secret', 'get', 'github.com']);
  check('resolve against a server-invalidated session returns locked, not a crash', getInvalid.status === 1 && getInvalid.json?.ok === false && getInvalid.json?.secret === 'locked');
  await sleep(100);
  const statusAfterInvalidation = runCli(['secret', 'status']);
  check('the cached session is evicted after the auth failure (lazy invalidation)', statusAfterInvalidation.json?.ok === true && statusAfterInvalidation.json?.unlocked === false);

  // ---------------------------------------------------------------
  console.log('\n-- redaction (source-level): sensitive keys extended, not narrowed --');
  const source = fs.readFileSync(CHROMUX, 'utf8');
  check('receipt redaction covers bw_session/session_key/master_password/vault', /bw_session\|session_key\|master_password\|vault/.test(source));
  check('activity sanitizer has an explicit `secret` command case', /cmd === 'secret'\) \{[\s\S]{0,400}sensitiveFlags/.test(source));

  await agentRequest('evict').catch(() => {});

  console.log(`\n=== RESULT: ${PASS} passed, ${FAIL} failed ===`);
  fs.rmSync(workRoot, { recursive: true, force: true });
  process.exit(FAIL === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('test-secret.mjs crashed:', err);
  process.exit(1);
});
