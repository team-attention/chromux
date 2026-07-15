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
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ============================================================
// Constants & Config
// ============================================================

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const CHROMUX_HOME = path.resolve(process.env.CHROMUX_HOME || path.join(os.homedir(), '.chromux'));
const PROFILES_DIR = path.join(CHROMUX_HOME, 'profiles');
const CONFIG_PATH = path.join(CHROMUX_HOME, 'config.json');
const ACTIVITY_DIR = path.join(CHROMUX_HOME, 'activity');
const ACTIVITY_EVENTS_PATH = path.join(ACTIVITY_DIR, 'events.jsonl');
const ACTIVITY_CONFIG_PATH = path.join(ACTIVITY_DIR, 'config.json');
const ACTIVITY_AGGREGATES_PATH = path.join(ACTIVITY_DIR, 'aggregates.json');
const STATUS_APP_DIR = path.join(MODULE_DIR, 'status-app');
const PORT_RANGE_START = 9300;
const PORT_RANGE_END = 9399;
const DAEMON_HOST = '127.0.0.1';
const DAEMON_PORT_RANGE_START = 9400;
const DAEMON_PORT_RANGE_END = 9499;
const DEFAULT_PROFILE = 'default';
const DEFAULT_ACTIVITY_RETENTION_DAYS = 90;
const ACTIVITY_RETENTION_OPTIONS = new Set([7, 30, 90, 365, 'unlimited']);
const ACTIVITY_IDLE_WINDOW_MS = 30 * 60 * 1000;
const ACTIVITY_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
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

const POSIX_CHROME_PATHS = [
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

function daemonEndpointForPort(port) {
  if (!Number.isInteger(Number(port))) return null;
  return { type: 'tcp', host: DAEMON_HOST, port: Number(port) };
}

function legacySocketEndpoint(sock) {
  return sock ? { type: 'unix', socketPath: sock } : null;
}

function daemonEndpointFromState(state) {
  if (!state) return null;
  if (state.daemonEndpoint?.type === 'tcp' && state.daemonEndpoint.port) {
    return daemonEndpointForPort(state.daemonEndpoint.port);
  }
  if (state.daemonPort) return daemonEndpointForPort(state.daemonPort);
  if (state.sock) return legacySocketEndpoint(state.sock);
  return null;
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

function hostFromUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    const host = u.hostname.replace(/^www\./, '');
    return host || '';
  } catch {
    return '';
  }
}

function displayChromuxPath(absPath) {
  const resolved = path.resolve(absPath);
  const rel = path.relative(CHROMUX_HOME, resolved);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
    return `~/.chromux/${rel.split(path.sep).join('/')}`;
  }
  return resolved;
}

function siteKnowledgePathsForHost(host) {
  if (!host || !VALID_NAME.test(host.replace(/\./g, '_'))) return [];
  const dir = path.join(CHROMUX_HOME, 'skills', host);
  try {
    return fs.readdirSync(dir)
      .filter(file => file.endsWith('.md'))
      .sort()
      .map(file => displayChromuxPath(path.join(dir, file)));
  } catch {
    return [];
  }
}

// Exact host first, then parent domains down to two labels, so notes saved
// under naver.com also surface on search.naver.com. Reading a nonexistent
// parent dir (e.g. co.uk) is harmless — it simply yields no files.
function siteKnowledgeHostChain(host) {
  if (!host) return [];
  const chain = [host];
  const parts = host.split('.');
  for (let i = 1; i <= parts.length - 2; i++) chain.push(parts.slice(i).join('.'));
  return chain;
}

// Read all note files for a host and its parent domains, oldest-label first.
function readSiteNotesForHostChain(host) {
  const notes = [];
  for (const h of siteKnowledgeHostChain(host)) {
    const dir = path.join(CHROMUX_HOME, 'skills', h);
    let files = [];
    try { files = fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort(); } catch { continue; }
    for (const f of files) {
      try {
        notes.push({ label: `${h}/${f}`, content: fs.readFileSync(path.join(dir, f), 'utf8').trim() });
      } catch {}
    }
  }
  return notes;
}

// ---- Saved action scripts (observe once, replay without an LLM) ----
//
// Scripts are plain `chromux run` runner scripts stored per host under
// ~/.chromux/scripts/<host>/<name>.js. They are the deterministic-replay side
// of the learning loop: an agent discovers a working flow once, saves it, and
// later runs replay it with zero model calls. When a replay fails, the CLI
// points back at the script so the calling agent can repair and re-save it.

const SCRIPTS_DIR = path.join(CHROMUX_HOME, 'scripts');

function validScriptName(name) {
  return Boolean(name) && !name.includes('/') && VALID_NAME.test(name.replace(/\./g, '_'));
}

function parseScriptLabel(raw) {
  const text = String(raw || '');
  const slash = text.indexOf('/');
  if (slash <= 0) return null;
  const host = normalizeNoteHost(text.slice(0, slash));
  let name = text.slice(slash + 1);
  if (name.endsWith('.js')) name = name.slice(0, -3);
  if (!host || !validScriptName(name)) return null;
  return { host, name, label: `${host}/${name}` };
}

function scriptPathFor(host, name) {
  return path.join(SCRIPTS_DIR, host, `${name}.js`);
}

function listScriptsForHost(host) {
  try {
    return fs.readdirSync(path.join(SCRIPTS_DIR, host))
      .filter(file => file.endsWith('.js'))
      .sort()
      .map(file => file.slice(0, -3));
  } catch {
    return [];
  }
}

// Like site notes, scripts saved under a parent domain also apply to
// subdomains: naver.com/search-extract is visible on search.naver.com.
function listScriptsForHostChain(host) {
  const scripts = [];
  for (const h of siteKnowledgeHostChain(host)) {
    for (const name of listScriptsForHost(h)) {
      scripts.push({ label: `${h}/${name}`, path: scriptPathFor(h, name) });
    }
  }
  return scripts;
}

// Resolve a script label against the host chain, so `--script search.naver.com/x`
// also finds a script saved under naver.com/x.
function resolveScriptPath(ref) {
  for (const h of siteKnowledgeHostChain(ref.host)) {
    const p = scriptPathFor(h, ref.name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// ---- Script usage confidence (the memory feedback loop) ----
//
// A saved flow is only worth replaying if it still works. Every replay already
// produces a clean machine signal — the script ran to completion, or it threw.
// We record that signal per script (confirmed vs contradicted) so `open` can
// recommend proven flows first and warn about ones that recently broke. Pure
// pass/fail counting, no per-site heuristics, so it cannot overfit.
function scriptStatsPathFor(host) {
  return path.join(SCRIPTS_DIR, host, '_stats.json');
}

function readScriptStats(host) {
  return readJsonFile(scriptStatsPathFor(host), {}) || {};
}

// Stats are keyed by the resolved file's own host/name, so a script requested
// via a subdomain label still updates the one record that backs the file.
function scriptStatForPath(scriptPath) {
  try {
    const host = path.basename(path.dirname(scriptPath));
    const name = path.basename(scriptPath).replace(/\.js$/, '');
    return readScriptStats(host)[name] || null;
  } catch {
    return null;
  }
}

function recordScriptReplayResult(codeSource, ok) {
  if (codeSource?.kind !== 'script' || !codeSource.path) return;
  try {
    const dir = path.dirname(codeSource.path);
    const host = path.basename(dir);
    const name = path.basename(codeSource.path).replace(/\.js$/, '');
    const stats = readScriptStats(host);
    const rec = stats[name] || { confirmed: 0, contradicted: 0, lastResult: null, lastUsed: null };
    if (ok) rec.confirmed = (rec.confirmed || 0) + 1;
    else rec.contradicted = (rec.contradicted || 0) + 1;
    rec.lastResult = ok ? 'ok' : 'fail';
    rec.lastUsed = new Date().toISOString();
    stats[name] = rec;
    fs.mkdirSync(dir, { recursive: true });
    // Write atomically (temp + rename) so an interrupted write never leaves a
    // corrupt _stats.json — a corrupt file would reset the confidence history
    // for every script on this host on the next record.
    const statsPath = scriptStatsPathFor(host);
    const tmpPath = `${statsPath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(stats, null, 2));
    fs.renameSync(tmpPath, statsPath);
  } catch {}
}

function siteKnowledgeHintForUrl(rawUrl) {
  const host = hostFromUrl(rawUrl);
  if (!host) return null;
  return {
    host,
    dir: `~/.chromux/skills/${host}`,
    paths: siteKnowledgePathsForHost(host),
    hint: 'Review/update reusable non-secret site notes here if this session revealed durable behavior or stale notes.',
  };
}

// ============================================================
// Activity log helpers
// ============================================================

function ensureActivityDir() {
  fs.mkdirSync(ACTIVITY_DIR, { recursive: true, mode: 0o700 });
}

function readJsonFile(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return fallback; }
}

function sha256Text(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function writeJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
}

function pathWithinBase(candidate, base) {
  const normalizedCandidate = path.resolve(candidate);
  const normalizedBase = path.resolve(base);
  const fold = value => process.platform === 'win32' ? value.toLowerCase() : value;
  const c = fold(normalizedCandidate);
  const b = fold(normalizedBase);
  return c === b || c.startsWith(b + path.sep);
}

function nearestExistingParent(dirPath) {
  let current = path.resolve(dirPath);
  while (!fs.existsSync(current)) {
    const next = path.dirname(current);
    if (next === current) return current;
    current = next;
  }
  return current;
}

function resolveSafeArtifactPath(filePath, label = 'artifact') {
  if (!filePath) throw new Error(`${label} path is required`);
  const resolved = path.resolve(filePath);
  const targetDir = path.dirname(resolved);
  const cwdPath = process.cwd();
  const cwdReal = fs.realpathSync(process.cwd());
  const allowedBases = [...new Set([
    CHROMUX_HOME,
    cwdPath,
    cwdReal,
    '/tmp',
    '/private/tmp',
    os.tmpdir(),
    os.homedir(),
  ].filter(Boolean).flatMap(base => {
    const resolvedBase = path.resolve(base);
    try { return [resolvedBase, fs.realpathSync(base)]; }
    catch { return [resolvedBase]; }
  }))];
  if (!allowedBases.some(base => pathWithinBase(resolved, base))) {
    throw new Error(`${label} path not allowed: ${resolved}`);
  }
  const existingParent = nearestExistingParent(targetDir);
  const parentReal = fs.realpathSync(existingParent);
  if (!allowedBases.some(base => pathWithinBase(parentReal, base))) {
    throw new Error(`${label} path not allowed: ${resolved}`);
  }
  fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });
  const realDir = fs.realpathSync(targetDir);
  const realResolved = path.join(realDir, path.basename(resolved));
  if (!allowedBases.some(base => pathWithinBase(realResolved, base))) {
    throw new Error(`${label} path not allowed: ${resolved}`);
  }
  return resolved;
}

function writeSafeJsonArtifact(filePath, value, label = 'artifact') {
  const resolved = resolveSafeArtifactPath(filePath, label);
  writeJsonFile(resolved, value);
  return resolved;
}

function normalizeRetentionDays(value) {
  if (value === 'unlimited' || value === null) return 'unlimited';
  const n = Number(value);
  return ACTIVITY_RETENTION_OPTIONS.has(n) ? n : DEFAULT_ACTIVITY_RETENTION_DAYS;
}

function loadActivityConfig() {
  const cfg = readJsonFile(ACTIVITY_CONFIG_PATH, {});
  const lastPrunedAt = typeof cfg.lastPrunedAt === 'string' ? cfg.lastPrunedAt : null;
  return {
    retentionDays: normalizeRetentionDays(cfg.retentionDays ?? DEFAULT_ACTIVITY_RETENTION_DAYS),
    lastPrunedAt,
  };
}

function saveActivityConfig(cfg) {
  const normalized = {
    retentionDays: normalizeRetentionDays(cfg.retentionDays),
  };
  if (typeof cfg.lastPrunedAt === 'string') normalized.lastPrunedAt = cfg.lastPrunedAt;
  writeJsonFile(ACTIVITY_CONFIG_PATH, normalized);
  return normalized;
}

function activityLoggingEnabled() {
  return process.env.CHROMUX_ACTIVITY_LOG !== '0';
}

function activityEventId(timestamp) {
  return `${timestamp.replace(/[^0-9]/g, '')}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeActivityEvent(event) {
  const timestamp = event.timestamp || new Date().toISOString();
  const url = event.url || event.fullUrl || null;
  const host = event.host || hostFromUrl(url);
  const siteKnowledgePaths = event.siteKnowledgePaths || (host ? siteKnowledgePathsForHost(host) : []);
  return {
    version: 1,
    id: event.id || activityEventId(timestamp),
    timestamp,
    profile: event.profile || DEFAULT_PROFILE,
    session: event.session || null,
    command: event.command || 'unknown',
    args: Array.isArray(event.args) ? event.args : [],
    context: event.context || {},
    task: event.task || null,
    url,
    fullUrl: url,
    host: host || null,
    title: event.title || null,
    ok: event.ok !== false,
    error: event.error || null,
    durationMs: Number.isFinite(Number(event.durationMs)) ? Number(event.durationMs) : null,
    siteKnowledgePaths,
    redacted: event.redacted === true,
    redactedAt: event.redactedAt || null,
  };
}

function parseActivityLine(line) {
  if (!line.trim()) return null;
  try { return normalizeActivityEvent(JSON.parse(line)); }
  catch { return null; }
}

function readActivityEventsRaw() {
  try {
    return fs.readFileSync(ACTIVITY_EVENTS_PATH, 'utf8')
      .split('\n')
      .map(parseActivityLine)
      .filter(Boolean);
  } catch {
    return [];
  }
}

function writeActivityEvents(events) {
  ensureActivityDir();
  const body = events.map(event => JSON.stringify(normalizeActivityEvent(event))).join('\n');
  fs.writeFileSync(ACTIVITY_EVENTS_PATH, body ? `${body}\n` : '', { mode: 0o600 });
}

function pruneActivityEvents(nowMs = Date.now(), { force = false } = {}) {
  const cfg = loadActivityConfig();
  if (cfg.retentionDays === 'unlimited') return { removed: 0, retentionDays: 'unlimited' };
  const lastPrunedMs = cfg.lastPrunedAt ? Date.parse(cfg.lastPrunedAt) : NaN;
  if (!force && Number.isFinite(lastPrunedMs) && nowMs - lastPrunedMs < ACTIVITY_PRUNE_INTERVAL_MS) {
    return { removed: 0, retentionDays: cfg.retentionDays, skipped: true };
  }
  const cutoff = nowMs - cfg.retentionDays * 24 * 60 * 60 * 1000;
  const events = readActivityEventsRaw();
  const kept = events.filter(event => {
    const ts = Date.parse(event.timestamp);
    return !Number.isFinite(ts) || ts >= cutoff;
  });
  if (kept.length !== events.length) writeActivityEvents(kept);
  saveActivityConfig({ retentionDays: cfg.retentionDays, lastPrunedAt: new Date(nowMs).toISOString() });
  return { removed: events.length - kept.length, retentionDays: cfg.retentionDays, skipped: false };
}

function readActivityEvents({ prune = true } = {}) {
  if (prune) pruneActivityEvents();
  return readActivityEventsRaw();
}

function emptyActivityAggregates() {
  return {
    version: 1,
    total: 0,
    byCommand: {},
    byProfile: {},
    byTask: {},
    updatedAt: null,
  };
}

function loadActivityAggregates() {
  return { ...emptyActivityAggregates(), ...readJsonFile(ACTIVITY_AGGREGATES_PATH, {}) };
}

function bumpActivityBucket(bucket, key, event) {
  if (!key) return;
  const row = bucket[key] || { count: 0, ok: 0, error: 0, lastAt: null };
  row.count++;
  if (event.ok) row.ok++;
  else row.error++;
  row.lastAt = event.timestamp;
  bucket[key] = row;
}

function updateActivityAggregates(event) {
  const aggregates = loadActivityAggregates();
  aggregates.total = Number(aggregates.total || 0) + 1;
  aggregates.updatedAt = event.timestamp;
  bumpActivityBucket(aggregates.byCommand, event.command, event);
  bumpActivityBucket(aggregates.byProfile, event.profile, event);
  bumpActivityBucket(aggregates.byTask, event.task || '(untasked)', event);
  writeJsonFile(ACTIVITY_AGGREGATES_PATH, aggregates);
}

function appendActivityEvent(event) {
  if (!activityLoggingEnabled()) return null;
  pruneActivityEvents();
  const normalized = normalizeActivityEvent(event);
  ensureActivityDir();
  fs.appendFileSync(ACTIVITY_EVENTS_PATH, JSON.stringify(normalized) + '\n', { mode: 0o600 });
  updateActivityAggregates(normalized);
  return normalized;
}

function activityScopeMatches(event, scope) {
  if (!scope || scope.type === 'all') return true;
  if (scope.type === 'profile') return event.profile === scope.profile;
  if (scope.type === 'task') return (event.task || '') === scope.task;
  return false;
}

function deleteActivityEvents(scope) {
  const events = readActivityEventsRaw();
  const kept = events.filter(event => !activityScopeMatches(event, scope));
  writeActivityEvents(kept);
  return { deleted: events.length - kept.length, remaining: kept.length };
}

function redactActivityEvents(scope) {
  const now = new Date().toISOString();
  const events = readActivityEventsRaw();
  let redacted = 0;
  const next = events.map(event => {
    if (!activityScopeMatches(event, scope)) return event;
    if (!event.url && !event.fullUrl && !event.title && !event.host) return event;
    redacted++;
    return {
      ...event,
      url: null,
      fullUrl: null,
      host: null,
      title: null,
      siteKnowledgePaths: [],
      redacted: true,
      redactedAt: now,
    };
  });
  writeActivityEvents(next);
  return { redacted, total: next.length };
}

function setActivityRetention(retentionDays) {
  const config = saveActivityConfig({ retentionDays });
  const prune = pruneActivityEvents(Date.now(), { force: true });
  return { config, prune };
}

function enrichActivityEvent(event) {
  if (event.redacted || !event.host) return event;
  return {
    ...event,
    siteKnowledgePaths: event.siteKnowledgePaths?.length
      ? event.siteKnowledgePaths
      : siteKnowledgePathsForHost(event.host),
  };
}

function buildActivityTimeline(events, idleWindowMs = ACTIVITY_IDLE_WINDOW_MS) {
  const sorted = [...events].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const groups = [];
  const taskGroups = new Map();
  const fallbackGroups = new Map();

  const createGroup = (event, source, key) => {
    const group = {
      id: `${source}:${key}:${groups.length}`,
      label: source === 'task' ? event.task : (event.session ? `Session ${event.session}` : `Profile ${event.profile}`),
      source,
      derived: source !== 'task',
      task: source === 'task' ? event.task : null,
      profile: event.profile,
      session: source === 'task' ? null : event.session,
      startedAt: event.timestamp,
      endedAt: event.timestamp,
      eventCount: 0,
      okCount: 0,
      errorCount: 0,
      commands: [],
      hosts: [],
      events: [],
      _commands: new Set(),
      _hosts: new Set(),
    };
    groups.push(group);
    return group;
  };

  for (const event of sorted) {
    const ts = Date.parse(event.timestamp) || 0;
    let group;
    if (event.task) {
      const key = `${event.profile}:${event.task}`;
      group = taskGroups.get(key);
      if (!group) {
        group = createGroup(event, 'task', key);
        taskGroups.set(key, group);
      }
    } else {
      const key = `${event.profile}:${event.session || '(profile)'}`;
      const current = fallbackGroups.get(key);
      if (!current || ts - current.lastTs > idleWindowMs) {
        group = createGroup(event, 'session-fallback', `${key}:${ts || groups.length}`);
        fallbackGroups.set(key, { group, lastTs: ts });
      } else {
        group = current.group;
        current.lastTs = ts;
      }
    }

    group.endedAt = event.timestamp;
    group.eventCount++;
    if (event.ok) group.okCount++;
    else group.errorCount++;
    group._commands.add(event.command);
    if (event.host) group._hosts.add(event.host);
    group.events.push(event);
  }

  return groups.map(group => {
    const { _commands, _hosts, ...clean } = group;
    return {
      ...clean,
      commands: [..._commands],
      hosts: [..._hosts],
      events: clean.events.slice(-8),
    };
  }).sort((a, b) => Date.parse(b.endedAt) - Date.parse(a.endedAt));
}

function activitySnapshot() {
  const events = readActivityEvents().map(enrichActivityEvent);
  const newest = [...events].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  const tasks = [...new Set(events.map(event => event.task).filter(Boolean))].sort();
  const hosts = [...new Set(events.map(event => event.host).filter(Boolean))].sort();
  return {
    config: loadActivityConfig(),
    aggregates: loadActivityAggregates(),
    totalEvents: events.length,
    events: newest.slice(0, 500),
    timeline: buildActivityTimeline(events),
    tasks,
    hosts,
  };
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

function chromePathCandidates(platform = process.platform, env = process.env) {
  if (platform === 'win32') {
    return [
      env.PROGRAMFILES && path.join(env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      env['PROGRAMFILES(X86)'] && path.join(env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
      env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ].filter(Boolean);
  }
  return POSIX_CHROME_PATHS;
}

function findChrome(cfg, platform = process.platform, env = process.env) {
  if (cfg.chromePath && fs.existsSync(cfg.chromePath)) return cfg.chromePath;
  for (const p of chromePathCandidates(platform, env)) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// ============================================================
// State file helpers (per-profile cache: pid, Chrome CDP port, daemon endpoint)
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

function updateState(profileName, patch) {
  const current = readState(profileName) || {};
  const next = { ...current, ...patch };
  writeState(profileName, next);
  return next;
}

function writeDaemonEndpointState(profileName, daemonPort) {
  return updateState(profileName, {
    daemonPort,
    daemonEndpoint: daemonEndpointForPort(daemonPort),
    sock: undefined,
  });
}

function clearDaemonEndpointState(profileName, expectedPort = null) {
  const state = readState(profileName);
  if (!state) return;
  if (expectedPort !== null && Number(state.daemonPort) !== Number(expectedPort)) return;
  delete state.daemonPort;
  delete state.daemonEndpoint;
  delete state.sock;
  writeState(profileName, state);
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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getCommandArgValue(command, name) {
  const re = new RegExp(`(?:^|\\s)${escapeRegExp(name)}(?:=|\\s+)(?:"([^"]*)"|'([^']*)'|(\\S+))`);
  const match = String(command || '').match(re);
  if (!match) return null;
  return stripQuotes(match[1] ?? match[2] ?? match[3] ?? '');
}

function listWindowsProcesses() {
  const script = "Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress";
  const res = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (res.error || res.status !== 0 || !res.stdout.trim()) return [];
  try {
    const parsed = JSON.parse(res.stdout);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.map(row => ({
      pid: Number(row.ProcessId),
      command: row.CommandLine || '',
    })).filter(proc => Number.isInteger(proc.pid) && proc.command);
  } catch {
    return [];
  }
}

function listProcesses() {
  if (process.platform === 'win32') return listWindowsProcesses();
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
  const userDataDir = getCommandArgValue(proc.command, '--user-data-dir') || getArgValue(args, '--user-data-dir');
  if (!userDataDir) return null;
  const resolvedUserDataDir = path.resolve(userDataDir);
  const rel = path.relative(PROFILES_DIR, resolvedUserDataDir);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || rel.includes(path.sep)) return null;
  if (!VALID_NAME.test(rel)) return null;
  const portValue = getCommandArgValue(proc.command, '--remote-debugging-port') || getArgValue(args, '--remote-debugging-port');
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
  const userDataDir = getCommandArgValue(command, '--user-data-dir') || getArgValue(splitCommand(command), '--user-data-dir');
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

  let rssAvailable = false;
  if (process.platform !== 'win32') {
    const psArgs = process.platform === 'darwin'
      ? ['-axo', 'pid=,rss=,command=']
      : ['-eo', 'pid=,rss=,args='];
    const res = spawnSync('ps', psArgs, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (!res.error && res.status === 0) {
      rssAvailable = true;
      for (const line of res.stdout.split('\n')) {
        const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
        if (!m) continue;
        if (commandUsesProfileDir(m[3], profileName)) rssKb += Number(m[2]) || 0;
      }
    }
  }

  return {
    chromeProcesses,
    renderers,
    rssMb: rssAvailable ? Math.round(rssKb / 1024) : null,
    telemetry: rssAvailable ? 'ok' : 'best-effort',
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
    const stateCdpPort = state.cdpPort || state.port;
    const stateCdpOk = stateCdpPort && await checkCDP(stateCdpPort);
    if (statePidAlive && stateCdpOk) {
      const proc = byPid.get(state.pid) || candidates.find(p => p.port === stateCdpPort);
      if (!proc || proc.browser) {
        return {
          profile: profileName,
          pid: state.pid,
          port: stateCdpPort,
          cdpPort: stateCdpPort,
          headless: proc ? proc.headless : !!state.headless,
          launchMode: (proc?.headless || state.headless) ? 'headless' : 'headed',
          daemonEndpoint: daemonEndpointFromState(state),
          sock: state.sock || null,
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
      cdpPort: proc.port,
      headless: proc.headless,
      launchMode: proc.headless ? 'headless' : 'headed',
      daemonEndpoint: daemonEndpointFromState(state),
      sock: state?.sock || null,
      userDataDir: proc.userDataDir,
      source: 'process',
      status: 'running',
    };
    if (adopt) {
      updateState(profileName, {
        pid: runtime.pid,
        port: runtime.port,
        cdpPort: runtime.cdpPort,
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
      port: state.cdpPort || state.port || null,
      cdpPort: state.cdpPort || state.port || null,
      headless: !!state.headless,
      launchMode: state.headless ? 'headless' : 'headed',
      daemonEndpoint: daemonEndpointFromState(state),
      sock: state.sock || null,
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
      cdpPort: proc.port,
      headless: proc.headless,
      launchMode: proc.headless ? 'headless' : 'headed',
      daemonEndpoint: daemonEndpointFromState(state),
      sock: state?.sock || null,
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
      if (st && isProcessAlive(st.pid)) usedPorts.add(st.cdpPort || st.port);
    }
  } catch {}
  for (let port = start; port <= end; port++) {
    if (usedPorts.has(port)) continue;
    const taken = await checkCDP(port);
    if (!taken) return port;
  }
  return null;
}

function isTcpPortAvailable(port, host = DAEMON_HOST) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

async function findFreeDaemonPort(cfg = loadConfig()) {
  const start = cfg.daemonPortRangeStart || DAEMON_PORT_RANGE_START;
  const end = cfg.daemonPortRangeEnd || DAEMON_PORT_RANGE_END;
  const usedPorts = new Set();
  try {
    for (const name of fs.readdirSync(PROFILES_DIR)) {
      const st = readState(name);
      if (st?.daemonPort) usedPorts.add(Number(st.daemonPort));
    }
  } catch {}
  for (let port = start; port <= end; port++) {
    if (usedPorts.has(port)) continue;
    if (await isTcpPortAvailable(port)) return port;
  }
  return null;
}

function listKnownProfileNames() {
  fs.mkdirSync(PROFILES_DIR, { recursive: true });
  let names = [];
  try {
    names = fs.readdirSync(PROFILES_DIR)
      .filter(name => VALID_NAME.test(name))
      .filter(name => {
        try { return fs.statSync(profileDir(name)).isDirectory(); }
        catch { return false; }
      });
  } catch {}
  for (const proc of listChromuxChromeProcesses()) names.push(proc.profile);
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

function profileFileInfo(profileName) {
  const dir = profileDir(profileName);
  try {
    const stat = fs.statSync(dir);
    return {
      exists: true,
      userDataDir: dir,
      modifiedAt: stat.mtime.toISOString(),
    };
  } catch {
    return {
      exists: false,
      userDataDir: dir,
      modifiedAt: null,
    };
  }
}

function directorySizeBytes(dir) {
  let total = 0;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return total;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    try {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) total += directorySizeBytes(full);
      else if (entry.isFile()) total += fs.statSync(full).size;
    } catch {
      // files can vanish mid-walk while Chrome runs; skip them
    }
  }
  return total;
}

const PROFILE_DISK_USAGE_TTL_MS = 60_000;
const profileDiskUsageCache = new Map();

function profileDiskUsageBytes(profileName) {
  const cached = profileDiskUsageCache.get(profileName);
  if (cached && Date.now() - cached.computedAt < PROFILE_DISK_USAGE_TTL_MS) return cached.bytes;
  const bytes = directorySizeBytes(profileDir(profileName));
  profileDiskUsageCache.set(profileName, { bytes, computedAt: Date.now() });
  return bytes;
}

async function readDaemonSnapshot(endpoint) {
  if (!endpoint) {
    return { status: 'idle', sessions: null, mode: null, paused: false, resources: null };
  }
  try {
    const health = await cliReq('GET', '/health', null, endpoint, 1500);
    return {
      status: 'ok',
      sessions: health.sessions ?? null,
      mode: health.mode || null,
      paused: Boolean(health.paused),
      resources: health.resources || null,
      gate: health.gate || null,
      queued: health.queued || null,
    };
  } catch (err) {
    return { status: 'stale', sessions: null, mode: null, paused: false, resources: null, error: err.message };
  }
}

async function readActiveTabCount(runtime) {
  if (!runtime?.port || runtime.status !== 'running') return null;
  try {
    const targets = await cdpFetch(runtime.port, '/json/list');
    if (!Array.isArray(targets)) return null;
    return targets.filter(target => target.type === 'page').length;
  } catch {
    return null;
  }
}

async function profileInventoryItem(profileName) {
  const fileInfo = profileFileInfo(profileName);
  const runtime = await resolveProfileRuntime(profileName).catch(err => ({
    profile: profileName,
    status: 'error',
    reason: err.message,
  }));
  const daemon = await readDaemonSnapshot(runtime?.daemonEndpoint || daemonEndpointFromState(readState(profileName)));
  const activeTabs = await readActiveTabCount(runtime);
  const paused = fs.existsSync(profileStopPath(profileName));
  return {
    name: profileName,
    status: runtime?.status || 'stopped',
    reason: runtime?.reason || null,
    pid: runtime?.pid || null,
    port: runtime?.port || null,
    launchMode: runtime?.launchMode || null,
    headless: runtime?.headless ?? null,
    source: runtime?.source || null,
    userDataDir: runtime?.userDataDir || fileInfo.userDataDir,
    modifiedAt: fileInfo.modifiedAt,
    diskUsageBytes: profileDiskUsageBytes(profileName),
    daemon,
    activeTabs,
    paused,
  };
}

function profileInventoryIsActive(profile) {
  return profile?.status === 'running'
    || (profile?.activeTabs ?? 0) > 0
    || profile?.daemon?.status === 'ok'
    || profile?.daemon?.status === 'running';
}

function compareProfileInventory(a, b) {
  const activeDelta = Number(profileInventoryIsActive(b)) - Number(profileInventoryIsActive(a));
  if (activeDelta !== 0) return activeDelta;
  const statusRank = { running: 0, stale: 1, error: 2, stopped: 3 };
  const rankDelta = (statusRank[a.status] ?? 4) - (statusRank[b.status] ?? 4);
  if (rankDelta !== 0) return rankDelta;
  return a.name.localeCompare(b.name);
}

async function collectProfileInventory() {
  const names = listKnownProfileNames();
  const profiles = [];
  for (const name of names) profiles.push(await profileInventoryItem(name));
  return profiles.sort(compareProfileInventory);
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
          if (this.#waiters[i].method === msg.method
            && this.#waiters[i].sessionId === (msg.sessionId || null)) {
            clearTimeout(this.#waiters[i].timer);
            this.#waiters[i].resolve(msg.params);
            this.#waiters.splice(i, 1);
            break;
          }
        }
        const cbs = this.#listeners.get(msg.method);
        if (cbs) for (const cb of cbs) cb(msg.params, msg.sessionId || null);
      }
    });
  }

  get connected() {
    return this.#ws?.readyState === WebSocket.OPEN;
  }

  async send(method, params = {}, timeoutMs = 10000, sessionId = null) {
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
        this.#ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      } catch (e) {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(new Error(`CDP send failed: ${e.message}`));
      }
    });
    if (msg.error) throw new Error(`CDP ${method}: ${msg.error.message}`);
    return msg.result;
  }

  waitForEvent(method, timeout = 30000, sessionId = null) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.#waiters.findIndex(w => w === entry);
        if (i >= 0) this.#waiters.splice(i, 1);
        reject(new Error(`Timeout waiting for ${method}`));
      }, timeout);
      const entry = { method, sessionId, resolve, reject, timer };
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

  diagnostics() {
    let listenerCount = 0;
    for (const callbacks of this.#listeners.values()) listenerCount += callbacks.length;
    return {
      connected: this.connected,
      pending: this.#pending.size,
      waiters: this.#waiters.length,
      listenerMethods: this.#listeners.size,
      listeners: listenerCount,
    };
  }

  async closeAndWait(timeoutMs = 2000) {
    const ws = this.#ws;
    if (!ws || ws.readyState === WebSocket.CLOSED) return this.diagnostics();
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        ws.removeEventListener('close', finish);
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs);
      ws.addEventListener('close', finish, { once: true });
      if (ws.readyState !== WebSocket.CLOSING) {
        try { ws.close(); } catch { finish(); }
      }
    });
    return this.diagnostics();
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

const SNAPSHOT_JS = `((FILTER, CLICKABLE, REDACT_FIELDS) => {
  const INTERACTIVE_ONLY = FILTER === 'interactive';
  // Behavior-based clickable detection ('auto' | 'on' | 'off'). Many SPAs and
  // micro-UIs build their controls from bare divs with click handlers — no
  // roles, no semantic tags — which makes an accessibility snapshot blind.
  // 'auto' turns detection on when the page is nearly dead (almost no
  // standard interactive elements) OR when behaviorally-clickable candidates
  // are dense relative to standard controls (div-heavy content behind a
  // standard nav). Ordinary link/button pages pay zero extra payload.
  const STANDARD_SEL = 'a[href],button,input,select,textarea,[role="button"],[role="link"],[role="tab"],[role="menuitem"]';
  const standardCount = [...document.querySelectorAll(STANDARD_SEL)]
    .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).length;
  function inViewport(rect) {
    return rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
  }
  function sameGeometry(a, b) {
    return Math.abs(a.left - b.left) < 2 && Math.abs(a.top - b.top) < 2
      && Math.abs(a.width - b.width) < 2 && Math.abs(a.height - b.height) < 2;
  }
  function isClickableBoundary(el, style) {
    // data-ct-listener is stamped by the daemon via CDP getEventListeners on
    // low-signal pages: it marks elements with real click handlers that have
    // no styling affordance at all (common in benchmark UIs and React apps).
    const hasHandler = el.hasAttribute('onclick') || el.hasAttribute('data-ct-listener');
    if (!hasHandler) {
      if (style.cursor !== 'pointer') return false;
      const parent = el.parentElement;
      if (parent && parent !== document.body) {
        try { if (getComputedStyle(parent).cursor === 'pointer') return false; } catch {}
      }
    } else {
      // A handler-bearing element whose clickable parent (handler or pointer
      // cursor) has the same geometry is the same control bound twice
      // (delegation patterns); keep only the outer one. Distinct nested
      // controls (a star icon inside a clickable row) differ in geometry
      // and stay visible.
      const p = el.parentElement;
      if (p) {
        let parentClickable = p.hasAttribute('onclick') || p.hasAttribute('data-ct-listener');
        if (!parentClickable) {
          try { parentClickable = getComputedStyle(p).cursor === 'pointer'; } catch {}
        }
        if (parentClickable && sameGeometry(el.getBoundingClientRect(), p.getBoundingClientRect())) return false;
      }
    }
    // A clickable wrapper is redundant only when a standard control inside it
    // covers roughly the same area — a product card with a small wishlist
    // button is still its own control and must keep its ref.
    const inner = el.querySelector(STANDARD_SEL);
    if (inner) {
      const r = el.getBoundingClientRect();
      const ir = inner.getBoundingClientRect();
      if (ir.width * ir.height >= r.width * r.height * 0.5) return false;
    }
    return true;
  }
  // Scroll-invariant capping for verify diff baselines ('stable'): a viewport
  // dependent candidate set would make every scroll look like a page change.
  const CLICK_STABLE = CLICKABLE === 'stable';
  let CLICK_ON = CLICKABLE === 'on' || CLICK_STABLE;
  if (!CLICK_ON && CLICKABLE !== 'off') {
    if (standardCount < 3) {
      CLICK_ON = true;
    } else {
      // Ratio gate, viewport-scoped: probe visible-in-viewport container-ish
      // elements for non-redundant clickable candidates and compare against
      // the standard controls currently in the viewport. Offscreen content
      // does not vote — scrolling re-evaluates the gate for what is now
      // visible. Bounded so mega-DOM pages pay a fixed cost.
      let inViewStandard = 0;
      for (const el of document.querySelectorAll(STANDARD_SEL)) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && inViewport(r)) inViewStandard++;
      }
      let candidates = 0;
      let styleChecked = 0;
      let iterated = 0;
      const enough = () => candidates >= 4 && candidates * 8 >= inViewStandard;
      for (const el of document.querySelectorAll('div,span,li,td,img,i,b,p,label,section,article')) {
        if (iterated++ >= 5000 || styleChecked >= 400 || enough()) break;
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8 || !inViewport(r)) continue;
        styleChecked++;
        try { if (isClickableBoundary(el, getComputedStyle(el))) candidates++; } catch {}
      }
      CLICK_ON = enough();
    }
  }
  // Snapshot caps are viewport-first: what the user can see must never be
  // starved of clickable refs by document-order-earlier offscreen candidates.
  // Verify baselines instead use a document-order cap so the set does not
  // flap with scroll position.
  const CLICK_CAP_VIEWPORT = 40;
  const CLICK_CAP_OFFSCREEN = 10;
  const CLICK_CAP_STABLE = 50;
  let clickInView = 0;
  let clickOffscreen = 0;
  let clickStable = 0;
  function takeClickSlot(el) {
    if (CLICK_STABLE) {
      if (clickStable >= CLICK_CAP_STABLE) return false;
      clickStable++;
      return true;
    }
    if (inViewport(el.getBoundingClientRect())) {
      if (clickInView >= CLICK_CAP_VIEWPORT) return false;
      clickInView++;
      return true;
    }
    if (clickOffscreen >= CLICK_CAP_OFFSCREEN) return false;
    clickOffscreen++;
    return true;
  }
  // Occlusion probe: if one element sits on top of most of the page's
  // standard controls (sync covers, cookie walls, modals, loading scrims),
  // it is the thing the agent must deal with first — surface it prominently
  // even on pages where clickable detection stays off.
  let OCCLUDER = null;
  (() => {
    // Probe standard controls whose center sits inside the viewport
    // (offscreen controls are excluded, not clamped), sampled across
    // top/middle/bottom bands so a header-sparing modal is caught and a
    // bottom-only consent bar is not mistaken for a page-wide overlay.
    const probes = [];
    for (const el of document.querySelectorAll('a[href],button,input,select,textarea')) {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) continue;
      probes.push({ el, x, y });
      if (probes.length >= 60) break;
    }
    if (probes.length < 2) return;
    const bands = [[], [], []];
    for (const p of probes) {
      const bandIndex = Math.min(2, Math.floor(p.y * 3 / window.innerHeight));
      p.band = bandIndex;
      bands[bandIndex].push(p);
    }
    const sample = [];
    for (const band of bands) {
      const step = Math.max(1, Math.floor(band.length / 4));
      for (let i = 0, taken = 0; i < band.length && taken < 4; i += step, taken++) sample.push(band[i]);
    }
    const hits = new Map();
    for (const p of sample) {
      const top = document.elementFromPoint(p.x, p.y);
      if (!top || top === p.el || p.el.contains(top) || top.contains(p.el)) continue;
      // Attribute the hit to the outermost covering ancestor that still does
      // not contain the probed control, so one dialog's many children tally
      // as a single occluder instead of splitting the count.
      let node = top;
      while (node.parentElement && !node.parentElement.contains(p.el)) node = node.parentElement;
      const entry = hits.get(node) || { count: 0, bands: new Set() };
      entry.count += 1;
      entry.bands.add(p.band);
      hits.set(node, entry);
    }
    let best = null;
    let bestEntry = null;
    for (const [el, entry] of hits) {
      if (!bestEntry || entry.count > bestEntry.count) { best = el; bestEntry = entry; }
    }
    if (!best || bestEntry.count < Math.max(2, Math.ceil(sample.length * 0.5))) return;
    // "Covers page" is a strong directive: when all probes live in one band
    // (header-only pages), demand that the covering element itself is
    // page-sized before promoting a local strip/ribbon to a page-wide
    // overlay.
    if (bestEntry.bands.size < 2) {
      let area = 0;
      try {
        const r = best.getBoundingClientRect();
        area = r.width * r.height;
      } catch {}
      if (area < window.innerWidth * window.innerHeight * 0.4) return;
    }
    OCCLUDER = best;
  })();
  // Refs are stable within a document: an element keeps its data-ct-ref across
  // re-snapshots, and new elements continue from the persisted counter. A
  // navigation replaces the document, so refs naturally reset to @1.
  let refMax = Number(document.documentElement.getAttribute('data-ct-ref-max')) || 0;
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
  function isEditableRoot(el) {
    const value = el.getAttribute('contenteditable');
    return value !== null && value.toLowerCase() !== 'false';
  }
  function getRole(el) {
    if (isEditableRoot(el)) return el.getAttribute('role') || 'textbox';
    return el.getAttribute('role') || ROLES[el.tagName.toLowerCase()] || null;
  }
  function isInteractive(el) {
    const tag = el.tagName.toLowerCase();
    if (isEditableRoot(el)) return true;
    if (INTERACTIVE.has(tag)) return true;
    const role = el.getAttribute('role');
    if (role === 'button' || role === 'link' || role === 'tab' || role === 'menuitem') return true;
    if (el.getAttribute('tabindex') !== null && el.getAttribute('tabindex') !== '-1') return true;
    return false;
  }
  // Never leak typed secrets into snapshot text. Password inputs are always
  // masked; card numbers, CVCs, OTPs, and national IDs usually arrive as
  // type=text|tel, so mask by autocomplete/name/id heuristics too.
  function isSensitiveInput(el) {
    if (el.type === 'password') return true;
    // Normalize separators so otp_code / otpCode-ish spellings hit the same
    // word boundaries as otp-code.
    const hints = ((el.getAttribute('autocomplete') || '') + ' ' + (el.name || '') + ' ' + (el.id || ''))
      .toLowerCase().replace(/[_\\s]+/g, '-');
    return /cc-number|cc-csc|cc-exp|card-?(number|no)|cardnumber|cvv|cvc|one-?time-?code|\\botp\\b|otpcode|verification-?code|ssn|social-?security|\\bpin\\b|pincode|passport|routing-?number|iban/.test(hints);
  }
  function getLabel(el, clickable) {
    const tag = el.tagName.toLowerCase();
    const aria = el.getAttribute('aria-label');
    if (REDACT_FIELDS && isEditableRoot(el)) return aria || '';
    if (REDACT_FIELDS && (tag === 'input' || tag === 'textarea' || tag === 'select')) {
      return aria || el.placeholder || '';
    }
    if ((tag === 'input' || tag === 'textarea' || tag === 'select') && isSensitiveInput(el)) {
      return aria || el.placeholder || '';
    }
    if (aria) return aria;
    if (tag === 'input' || tag === 'textarea') return el.value || el.placeholder || '';
    if (tag === 'select') return el.selectedOptions && el.selectedOptions[0] ? el.selectedOptions[0].textContent.trim() : '';
    if (tag === 'img') return el.alt || '';
    if (tag === 'iframe' || tag === 'frame') return el.title || '';
    let text = '';
    for (const n of el.childNodes) { if (n.nodeType === 3) text += n.textContent; }
    text = text.trim();
    // Links/buttons (and behaviorally-clickable containers) often wrap their
    // text in child elements; fall back to rendered innerText so snapshot
    // lines stay identifiable without a follow-up js().
    if (!text && (tag === 'a' || tag === 'button' || clickable)) {
      text = (el.innerText || '').trim().split('\\n').map(s => s.trim()).filter(Boolean).join(' / ');
    }
    return text.substring(0, 100);
  }
  function walk(el, depth) {
    if (!el || el.nodeType !== 1) return '';
    let style;
    try {
      // Elements inside same-origin iframes must be styled by their own
      // window, not the top one.
      style = (el.ownerDocument.defaultView || window).getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || el.hidden) return '';
    } catch { return ''; }
    if (el.getAttribute('aria-hidden') === 'true') return '';
    const tag = el.tagName.toLowerCase();
    if (['script','style','noscript','br','hr','svg','path'].includes(tag)) return '';
    const role = getRole(el);
    let interactive = isInteractive(el);
    let clickable = false;
    let overlay = false;
    let innerFrameDoc = null;
    let opaqueFrame = null;
    if (tag === 'iframe' || tag === 'frame') {
      try { innerFrameDoc = el.contentDocument; } catch {}
      if (!innerFrameDoc || !innerFrameDoc.body) {
        interactive = true;
        let origin = 'opaque';
        try {
          const parsed = new URL(el.getAttribute('src') || '', el.ownerDocument.location.href);
          if (parsed.origin && parsed.origin !== 'null') origin = parsed.origin;
        } catch {}
        const rect = el.getBoundingClientRect();
        let x = rect.left;
        let y = rect.top;
        let view = el.ownerDocument.defaultView || window;
        while (view !== view.parent && view.frameElement) {
          const frameRect = view.frameElement.getBoundingClientRect();
          x += frameRect.left + view.frameElement.clientLeft;
          y += frameRect.top + view.frameElement.clientTop;
          view = view.parent;
        }
        opaqueFrame = {
          origin,
          rect: [x, y, rect.width, rect.height].map(value => Math.round(value * 100) / 100),
        };
      }
    }
    if (!interactive && el === OCCLUDER) {
      interactive = true;
      clickable = true;
      overlay = true;
    }
    if (!interactive && CLICK_ON && isClickableBoundary(el, style) && takeClickSlot(el)) {
      interactive = true;
      clickable = true;
    }
    const label = getLabel(el, clickable);
    const has = role || interactive || label;
    const keep = INTERACTIVE_ONLY ? interactive : has;
    const cd = keep ? depth + 1 : depth;
    let children = '';
    if (tag === 'iframe' || tag === 'frame') {
      // Same-origin frames are walked like page content; cross-origin frames
      // expose only origin and geometry. Paths, queries, and child field values
      // stay behind the origin boundary.
      if (innerFrameDoc && innerFrameDoc.body) children = walk(innerFrameDoc.body, cd);
    } else if (el.shadowRoot) {
      // Flattened-tree walk: an open shadow root replaces the host's light
      // children; slotted light content re-enters through <slot> below.
      // Closed shadow roots stay invisible (no API to reach them).
      for (const c of el.shadowRoot.children) children += walk(c, cd);
    } else if (tag === 'slot') {
      let assigned = [];
      try { assigned = el.assignedElements(); } catch {}
      for (const c of assigned) children += walk(c, cd);
    } else {
      for (const c of el.children) children += walk(c, cd);
    }
    if (!keep && !children) return '';
    if (!keep) return children;
    const indent = '  '.repeat(depth);
    let line = indent;
    if (interactive) {
      let ref = Number(el.getAttribute('data-ct-ref')) || 0;
      if (!ref) {
        ref = ++refMax;
        el.setAttribute('data-ct-ref', String(ref));
      } else if (ref > refMax) {
        refMax = ref;
      }
      line += '@' + ref + ' ';
    }
    line += opaqueFrame
      ? 'iframe (cross-origin opaque)'
      : overlay ? 'overlay (covers page; interact or dismiss first)'
      : clickable ? (role ? role + ' (clickable)' : 'clickable') : (role || tag);
    if (label) line += ' "' + label.replace(/"/g, '\\\\"') + '"';
    else if (clickable) {
      // Icon-only clickables: developer-facing id/class names are the best
      // available handle ("#close-email", ".star.clicked" — state included).
      if (el.id) line += ' #' + el.id;
      else if (typeof el.className === 'string' && el.className.trim()) {
        line += ' ' + el.className.trim().split(/\\s+/).filter(c => c !== 'data-ct-listener').slice(0, 2).map(c => '.' + c).join('');
      }
    }
    if (tag === 'input') {
      const checkish = el.type === 'checkbox' || el.type === 'radio';
      line += ' [' + (el.type || 'text') + (checkish && el.checked ? ' checked' : '') + ']';
    }
    if (!REDACT_FIELDS && tag === 'select' && el.selectedOptions && el.selectedOptions[0] && !isSensitiveInput(el)) {
      const sel = el.selectedOptions[0].textContent.trim().substring(0, 40);
      if (sel && sel !== label) line += ' = "' + sel.replace(/"/g, '') + '"';
    }
    if (el.disabled) line += ' (disabled)';
    if (opaqueFrame) {
      line += ' origin=' + opaqueFrame.origin + ' rect=[' + opaqueFrame.rect.join(',') + '] CSS';
    }
    if (tag === 'a' && el.href) {
      const href = el.getAttribute('href');
      if (href && !href.startsWith('javascript:') && !href.startsWith('#')) {
        let shownHref = href;
        if (REDACT_FIELDS) {
          try {
            const parsed = new URL(href, el.ownerDocument.location.href);
            shownHref = parsed.origin && parsed.origin !== 'null' ? parsed.origin : 'opaque';
          } catch {
            shownHref = 'opaque';
          }
        }
        line += ' -> ' + shownHref.substring(0, 80);
      }
    }
    return line + '\\n' + children;
  }
  // Cap the URL line: data:/blob: URLs can be tens of KB and would drown the
  // snapshot (and every diff computed from it) in address noise. A short hash
  // of the FULL URL keeps diff navigation detection exact for long URLs that
  // share a 300-char prefix.
  let urlLine = location.href;
  if (urlLine.length > 300) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < location.href.length; i++) {
      hash ^= location.href.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    urlLine = urlLine.substring(0, 300) + '…#' + hash.toString(16);
  }
  const out = '# ' + document.title + '\\n# ' + urlLine + '\\n\\n' + walk(document.body, 0);
  document.documentElement.setAttribute('data-ct-ref-max', String(refMax));
  return out;
})`;

function originOnly(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return parsed.origin && parsed.origin !== 'null' ? parsed.origin : 'opaque';
  } catch {
    return 'opaque';
  }
}

function oopifNamespace(child) {
  return `f${child.slot}g${child.generation}`;
}

const OOPIF_EVENT_METHODS = [
  'Target.attachedToTarget',
  'Target.detachedFromTarget',
  'Target.targetCrashed',
  'Target.targetInfoChanged',
  'Inspector.targetCrashed',
  'Page.frameNavigated',
];

function disposeOopifRouting(s) {
  const state = s.oopif;
  for (const method of OOPIF_EVENT_METHODS) s.cdp.off(method);
  if (state) {
    state.enabled = false;
    state.children.clear();
    state.targetSessions.clear();
    state.detachedTargets.clear();
    state.crashedTargets.clear();
    state.pending = 0;
  }
  s.oopif = null;
  return { enabled: false, attachedFrames: 0, pending: 0 };
}

function removeOopifTarget(state, { sessionId = null, targetId = null, crashed = false } = {}) {
  const resolvedSessionId = sessionId || (targetId ? state.targetSessions.get(targetId) : null);
  const child = resolvedSessionId ? state.children.get(resolvedSessionId) : null;
  const resolvedTargetId = targetId || child?.targetId || null;
  const knownTarget = Boolean(child || (resolvedTargetId && (
    state.targetSessions.has(resolvedTargetId)
    || state.detachedTargets.has(resolvedTargetId)
    || state.crashedTargets.has(resolvedTargetId)
  )));
  if (!knownTarget) return;
  if (resolvedSessionId) state.children.delete(resolvedSessionId);
  if (resolvedTargetId) state.targetSessions.delete(resolvedTargetId);
  if (resolvedTargetId && !state.detachedTargets.has(resolvedTargetId)) {
    state.detachedTargets.add(resolvedTargetId);
    state.detachedTotal++;
  }
  if (crashed && resolvedTargetId && !state.crashedTargets.has(resolvedTargetId)) {
    state.crashedTargets.add(resolvedTargetId);
    state.crashedTotal++;
  }
}

async function enableOopifRouting(s) {
  if (s.oopif?.enabled) return s.oopif;
  const state = {
    enabled: true,
    children: new Map(),
    nextSlot: 0,
    attachedTotal: 0,
    detachedTotal: 0,
    crashedTotal: 0,
    pending: 0,
    enabledAt: Date.now(),
    targetSessions: new Map(),
    detachedTargets: new Set(),
    crashedTargets: new Set(),
  };
  s.oopif = state;
  s.cdp.on('Target.attachedToTarget', (params) => {
    const info = params.targetInfo || {};
    if (info.type !== 'iframe') return;
    const child = {
      sessionId: params.sessionId,
      targetId: info.targetId,
      url: info.url || '',
      slot: ++state.nextSlot,
      generation: 1,
      attachedAt: Date.now(),
      ready: null,
    };
    state.children.set(params.sessionId, child);
    state.targetSessions.set(info.targetId, params.sessionId);
    state.attachedTotal++;
    state.pending++;
    child.ready = Promise.all([
      s.cdp.send('Page.enable', {}, 5000, params.sessionId),
      s.cdp.send('Inspector.enable', {}, 5000, params.sessionId),
    ])
      .catch(() => null)
      .finally(() => { state.pending = Math.max(0, state.pending - 1); });
  });
  s.cdp.on('Target.detachedFromTarget', ({ sessionId, targetId }) => {
    removeOopifTarget(state, { sessionId, targetId });
  });
  s.cdp.on('Target.targetCrashed', ({ targetId }) => {
    removeOopifTarget(state, { targetId, crashed: true });
  });
  s.cdp.on('Inspector.targetCrashed', (_, eventSessionId) => {
    removeOopifTarget(state, { sessionId: eventSessionId, crashed: true });
  });
  s.cdp.on('Target.targetInfoChanged', ({ targetInfo }) => {
    for (const child of state.children.values()) {
      if (child.targetId === targetInfo?.targetId) child.url = targetInfo.url || child.url;
    }
  });
  s.cdp.on('Page.frameNavigated', ({ frame }, eventSessionId) => {
    if (!eventSessionId) return;
    const child = state.children.get(eventSessionId);
    if (!child || !frame) return;
    if (frame.id !== child.targetId && child.frameId) return;
    child.frameId = frame.id;
    child.url = frame.url || child.url;
    child.generation++;
  });
  try {
    await s.cdp.send('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
      filter: [
        { type: 'iframe', exclude: false },
        { exclude: true },
      ],
    });
  } catch (err) {
    disposeOopifRouting(s);
    throw httpErr(503, `OOPIF opt-in failed: ${err.message}`);
  }
  await sleep(100);
  return state;
}

async function reconcileOopifRouting(s) {
  const state = s.oopif;
  if (!state?.enabled || state.children.size === 0) return;
  const children = [...state.children.values()];
  await Promise.all(children.map(async (child) => {
    await child.ready;
    if (!state.children.has(child.sessionId)) return;
    try {
      await s.cdp.send('Runtime.evaluate', { expression: 'true' }, 500, child.sessionId);
      child.unresponsiveSince = null;
      return;
    } catch {}

    // A navigation transition, debugger pause, or busy renderer can reject a
    // short Runtime probe without having crashed. Chrome clears the target URL
    // after Page.crash, so require that crash-shaped state to persist before
    // reconciling a missed crash event.
    let targetInfo;
    try {
      ({ targetInfo } = await s.cdp.send('Target.getTargetInfo', { targetId: child.targetId }, 1000));
    } catch {
      removeOopifTarget(state, { sessionId: child.sessionId, targetId: child.targetId });
      return;
    }
    if (targetInfo?.type !== 'iframe') {
      removeOopifTarget(state, { sessionId: child.sessionId, targetId: child.targetId });
      return;
    }
    const now = Date.now();
    child.unresponsiveSince ||= now;
    // Linux Chrome can retain the last committed target URL after Page.crash,
    // while macOS commonly clears it. An empty URL is strong crash evidence;
    // otherwise require a longer run of failed probes so a navigation or busy
    // renderer is not mislabeled from one transient timeout.
    const crashAfterMs = targetInfo.url === '' ? 1500 : 5000;
    if (now - child.unresponsiveSince < crashAfterMs) return;
    removeOopifTarget(state, {
      sessionId: child.sessionId,
      targetId: child.targetId,
      crashed: true,
    });
  }));
}

function oopifSummary(s) {
  if (!s.oopif?.enabled) return { enabled: false };
  return {
    enabled: true,
    attachedFrames: s.oopif.children.size,
    namespaces: [...s.oopif.children.values()].map(oopifNamespace),
    attachedTotal: s.oopif.attachedTotal,
    detachedTotal: s.oopif.detachedTotal,
    crashedTotal: s.oopif.crashedTotal,
    pending: s.oopif.pending,
  };
}

function resolveOopifRef(s, rawRef) {
  const match = /^@([a-z]\d+g\d+):(\d+)$/i.exec(String(rawRef || ''));
  if (!match) return null;
  const [, namespace, ref] = match;
  const child = [...(s.oopif?.children.values() || [])]
    .find(candidate => oopifNamespace(candidate) === namespace);
  if (!child) {
    throw httpErr(400, `OOPIF ref ${rawRef} is stale or detached. Take a fresh snapshot; frame navigation changes its namespace.`);
  }
  return { child, selector: `[data-ct-ref="${ref}"]`, ref: Number(ref) };
}

async function captureOopifSnapshot(s, filter = null, clickable = 'auto', timeoutMs = 5000) {
  if (!s.oopif?.enabled || !s.oopif.children.size) return '';
  const sections = [];
  const children = [...s.oopif.children.values()].sort((a, b) => a.slot - b.slot);
  for (const child of children) {
    await child.ready;
    const namespace = oopifNamespace(child);
    const result = await s.cdp.send('Runtime.evaluate', {
      expression: `(${SNAPSHOT_JS})(${JSON.stringify(filter)}, ${JSON.stringify(clickable)}, true)`,
      returnByValue: true,
    }, timeoutMs, child.sessionId).catch(() => null);
    const text = result?.result?.value;
    if (typeof text !== 'string') continue;
    const body = text.split('\n').slice(2).join('\n').trim()
      .replace(/^(\s*)@(\d+)\s/gm, `$1@${namespace}:$2 `);
    if (!body) continue;
    sections.push(`# OOPIF ${namespace} origin=${originOnly(child.url)}\n${body}`);
  }
  return sections.length ? `\n\n${sections.join('\n\n')}\n` : '';
}

async function captureSessionSnapshot(s, filter = null, clickable = 'auto', timeoutMs = 5000) {
  const root = await s.cdp.send('Runtime.evaluate', {
    expression: `(${SNAPSHOT_JS})(${JSON.stringify(filter)}, ${JSON.stringify(clickable)})`,
    returnByValue: true,
  }, timeoutMs);
  const text = root?.result?.value;
  if (typeof text !== 'string') return text;
  return text + await captureOopifSnapshot(s, filter, clickable, timeoutMs);
}

async function resolveOopifActionPoint(s, routed, action) {
  await routed.child.ready;
  const geometry = await resolveDeepElementRect(
    s.cdp,
    routed.selector,
    action,
    routed.child.sessionId,
  );
  return { x: geometry.centerX, y: geometry.centerY };
}

function mouseButtonMask(button) {
  return { left: 1, right: 2, middle: 4, back: 8, forward: 16 }[button] || 0;
}

async function clickOopifRef(s, rawRef, routed, button = 'left', clicks = 1) {
  const point = await resolveOopifActionPoint(s, routed, 'OOPIF click');
  const clickCount = Number.isFinite(Number(clicks)) ? Number(clicks) : 1;
  await s.cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: point.x, y: point.y, button: 'none', pointerType: 'mouse',
  }, 5000, routed.child.sessionId);
  await s.cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: point.x, y: point.y, button, buttons: mouseButtonMask(button), clickCount, pointerType: 'mouse',
  }, 5000, routed.child.sessionId);
  await s.cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: point.x, y: point.y, button, buttons: 0, clickCount, pointerType: 'mouse',
  }, 5000, routed.child.sessionId);
  return {
    clicked: rawRef,
    frame: { namespace: oopifNamespace(routed.child), origin: originOnly(routed.child.url) },
  };
}

async function fillOopifRef(s, rawRef, routed, text) {
  await routed.child.ready;
  const prepared = await s.cdp.send('Runtime.evaluate', {
    expression: `((sel, txt) => {
      ${DEEP_QUERY_JS}
      const el = deepQuery(sel);
      if (!el) throw new Error('OOPIF fill target is stale: ' + sel);
      el.focus();
      const view = el.ownerDocument.defaultView || window;
      if (el.isContentEditable) {
        const selection = view.getSelection();
        const range = el.ownerDocument.createRange();
        range.selectNodeContents(el);
        selection.removeAllRanges();
        selection.addRange(range);
        return { contenteditable: true };
      }
      if (!('value' in el)) throw new Error('OOPIF target is not fillable: ' + sel);
      if (el.tagName === 'SELECT') {
        const opts = Array.from(el.options);
        const match = opts.find(o => o.value === txt)
          || opts.find(o => o.textContent.trim() === txt)
          || opts.find(o => o.textContent.trim().toLowerCase() === txt.toLowerCase());
        if (!match) {
          const known = opts.slice(0, 20).map(o => o.value + ' (' + o.textContent.trim() + ')').join(', ');
          throw new Error('No option matching "' + txt + '" in ' + sel + '. Options: ' + known);
        }
        const selectSetter = Object.getOwnPropertyDescriptor(view.HTMLSelectElement.prototype, 'value')?.set;
        if (selectSetter) selectSetter.call(el, match.value);
        else el.value = match.value;
        el.dispatchEvent(new view.Event('input', { bubbles: true }));
        el.dispatchEvent(new view.Event('change', { bubbles: true }));
        return { value: el.value, selectedLabel: match.textContent.trim() };
      }
      const proto = el.tagName === 'TEXTAREA' ? view.HTMLTextAreaElement.prototype : view.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
        || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
      if (setter) setter.call(el, txt);
      else el.value = txt;
      try {
        el.dispatchEvent(new view.InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: txt }));
      } catch {
        el.dispatchEvent(new view.Event('input', { bubbles: true, cancelable: true }));
      }
      el.dispatchEvent(new view.Event('change', { bubbles: true }));
      return { contenteditable: false };
    })(${JSON.stringify(routed.selector)}, ${JSON.stringify(text)})`,
    returnByValue: true,
  }, 5000, routed.child.sessionId);
  if (prepared.exceptionDetails) {
    const description = (prepared.exceptionDetails.exception?.description || 'OOPIF fill failed').split('\n')[0];
    throw httpErr(400, `${description}. Take a fresh OOPIF snapshot.`);
  }
  if (prepared.result?.value?.contenteditable) {
    await s.cdp.send('Input.insertText', { text }, 5000, routed.child.sessionId);
    const observed = await s.cdp.send('Runtime.evaluate', {
      expression: `((sel) => {
        ${DEEP_QUERY_JS}
        const el = deepQuery(sel);
        if (!el || !el.isContentEditable) throw new Error('OOPIF contenteditable target changed during fill: ' + sel);
        return el.innerText;
      })(${JSON.stringify(routed.selector)})`,
      returnByValue: true,
    }, 5000, routed.child.sessionId);
    if (observed.exceptionDetails) {
      const description = (observed.exceptionDetails.exception?.description || 'OOPIF contenteditable fill verification failed').split('\n')[0];
      throw httpErr(400, description);
    }
    if (observed.result?.value !== text) {
      throw httpErr(400, `OOPIF contenteditable fill was rejected: expected ${JSON.stringify(text)}, observed ${JSON.stringify(observed.result?.value ?? '')}`);
    }
  }
  return {
    filled: rawRef,
    text,
    frame: { namespace: oopifNamespace(routed.child), origin: originOnly(routed.child.url) },
  };
}

// ---- Snapshot diff (change-only reporting between snapshots) ----

function parseSnapshotText(text) {
  const lines = String(text).split('\n');
  const title = lines[0]?.startsWith('# ') ? lines[0] : '# ';
  const url = lines[1]?.startsWith('# ') ? lines[1] : '# ';
  const body = lines.slice(2).filter(line => line.trim());
  return { title, url, body };
}

// Multiset line diff between the previous and current snapshot of a session.
// Stable @refs make unchanged elements produce identical lines, so the diff
// stays small even on large pages. Falls back to the full snapshot when there
// is no baseline or the page navigated since the baseline.
function renderSnapshotDiff(previousText, currentText) {
  if (typeof currentText !== 'string') return currentText;
  const current = parseSnapshotText(currentText);
  if (typeof previousText !== 'string') {
    return `${current.title}\n${current.url}\n# diff: no previous snapshot for this session; full snapshot shown\n\n${current.body.join('\n')}\n`;
  }
  const previous = parseSnapshotText(previousText);
  if (previous.url !== current.url) {
    return `${current.title}\n${current.url}\n# diff: url changed since previous snapshot; full snapshot shown\n\n${current.body.join('\n')}\n`;
  }
  const remaining = new Map();
  for (const line of previous.body) remaining.set(line, (remaining.get(line) || 0) + 1);
  const added = [];
  for (const line of current.body) {
    const count = remaining.get(line) || 0;
    if (count > 0) remaining.set(line, count - 1);
    else added.push(line);
  }
  const removed = [];
  for (const [line, count] of remaining) {
    for (let i = 0; i < count; i++) removed.push(line);
  }
  const unchanged = current.body.length - added.length;
  if (!added.length && !removed.length) {
    return `${current.title}\n${current.url}\n# diff: no changes since previous snapshot (${unchanged} unchanged lines omitted)\n`;
  }
  const summary = `# diff vs previous snapshot: +${added.length} added, -${removed.length} removed, ${unchanged} unchanged omitted`;
  const diffLines = [
    ...added.map(line => `+ ${line}`),
    ...removed.map(line => `- ${line}`),
  ];
  return `${current.title}\n${current.url}\n${summary}\n\n${diffLines.join('\n')}\n`;
}

// Filter a snapshot down to lines matching a pattern, keeping each match's
// ancestor lines so the tree context (which form, which section) survives.
// The pattern is tried as a case-insensitive regex first; if that matches
// nothing (or fails to compile) it is retried as a literal substring, so
// text like "Price (USD)" or "$50" still greps verbatim.
function renderSnapshotGrep(text, pattern) {
  if (typeof text !== 'string') return text;
  const { title, url, body } = parseSnapshotText(text);
  const MAX_MATCHES = 100;
  const indentOf = (line) => (line.match(/^ */) || [''])[0].length;
  const collect = (re) => {
    const keep = new Set();
    const matchedIdx = new Set();
    let matches = 0;
    for (let i = 0; i < body.length; i++) {
      if (!re.test(body[i])) continue;
      matches++;
      matchedIdx.add(i);
      if (matches > MAX_MATCHES) continue;
      keep.add(i);
      let depth = indentOf(body[i]);
      for (let j = i - 1; j >= 0 && depth > 0; j--) {
        const d = indentOf(body[j]);
        if (d < depth) { keep.add(j); depth = d; }
      }
    }
    return { keep, matches, matchedIdx };
  };
  const literalRe = new RegExp(String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  let re = literalRe;
  try { re = new RegExp(pattern, 'i'); } catch {}
  let mode = 'regex';
  let { keep, matches, matchedIdx } = collect(re);
  let literalNote = '';
  if (re.source !== literalRe.source) {
    if (!matches) {
      ({ keep, matches } = collect(literalRe));
      if (matches) mode = 'literal';
    } else {
      // Silent-wrong guard: a pattern that is a valid regex can match the
      // WRONG lines (e.g. "price (USD)" as a group) while the literal text
      // matches different ones. Whenever the literal reading matches any
      // line this regex result does NOT include, say so loudly instead of
      // letting the regex result masquerade as the answer.
      const literal = collect(literalRe);
      const literalOnly = [...literal.matchedIdx].filter(i => !matchedIdx.has(i)).length;
      if (literalOnly > 0) {
        literalNote = `; NOTE: read as literal text this pattern also matches ${literalOnly} line${literalOnly === 1 ? '' : 's'} NOT shown here — escape regex metacharacters if you meant the literal string`;
      }
    }
  }
  if (!matches) {
    return `${title}\n${url}\n# grep ${JSON.stringify(pattern)}: 0 of ${body.length} lines matched (regex and literal); broaden the pattern or take a plain snapshot\n`;
  }
  const capNote = matches > MAX_MATCHES ? `; first ${MAX_MATCHES} shown` : '';
  const modeNote = mode === 'literal' ? '; matched literally' : '';
  const lines = [...keep].sort((a, b) => a - b).map((i) => body[i]);
  return `${title}\n${url}\n# grep ${JSON.stringify(pattern)}: ${matches} of ${body.length} lines matched (ancestor lines kept for context${modeNote}${capNote}${literalNote})\n\n${lines.join('\n')}\n`;
}

// Stamp data-ct-listener on elements that have real click handlers but no
// styling affordance (no cursor, no role, no onclick attribute) — invisible
// to both the a11y tree and CSS-based clickable detection. Uses CDP
// DOMDebugger.getEventListeners per candidate, so it only runs on low-signal
// pages (almost no standard interactive elements) that are small enough.
async function markListenerClickables(s, force = false) {
  try {
    const scan = await s.cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const standard = [...document.querySelectorAll(
          'a[href],button,input,select,textarea,[role="button"],[role="link"],[role="tab"],[role="menuitem"]')]
          .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).length;
        if (${force ? 'false' : 'standard >= 3'}) return null;
        const els = [...document.querySelectorAll('div,span,li,td,img,i,b,p,label')].filter(el => {
          if (el.hasAttribute('data-ct-listener')) return false;
          const r = el.getBoundingClientRect();
          return r.width >= 8 && r.height >= 8;
        });
        if (els.length > 400) return null;
        window.__ctListenerCandidates = els;
        return els.length;
      })()`,
      returnByValue: true,
    }, 3000);
    const count = scan.result?.value;
    if (!count) return;
    const arr = await s.cdp.send('Runtime.evaluate', {
      expression: 'window.__ctListenerCandidates', returnByValue: false,
    }, 3000);
    const objectId = arr.result?.objectId;
    if (!objectId) return;
    const props = await s.cdp.send('Runtime.getProperties', { objectId, ownProperties: true }, 5000);
    // Queries are independent and CDP multiplexes over one socket, so run
    // them concurrently: worst case drops from candidates x 1s to ~2s.
    await Promise.all((props.result || [])
      .filter(prop => /^\d+$/.test(prop.name) && prop.value?.objectId)
      .map(async (prop) => {
        try {
          const ls = await s.cdp.send('DOMDebugger.getEventListeners', { objectId: prop.value.objectId, depth: 0 }, 1000);
          if ((ls.listeners || []).some(l => l.type === 'click' || l.type === 'mousedown' || l.type === 'pointerdown')) {
            await s.cdp.send('Runtime.callFunctionOn', {
              objectId: prop.value.objectId,
              functionDeclaration: 'function(){ this.setAttribute("data-ct-listener","1"); }',
            }, 1000);
          }
        } catch {}
      }));
    await s.cdp.send('Runtime.evaluate', {
      expression: 'delete window.__ctListenerCandidates', returnByValue: true,
    }, 1000).catch(() => {});
  } catch {}
}

// Verify baselines are ALWAYS captured in this shape: full filter, 'stable'
// clickable capping (document order — a viewport-dependent cap would turn
// every scroll into a large fake diff). One capture function keeps the three
// baseline writers (verify itself, open-time priming, snapshot advance) from
// ever drifting in shape.
// Tradeoff, deliberate: the per-candidate CDP listener re-scan
// (markListenerClickables force=true) is skipped on this path. It costs up to
// 400 getEventListeners round-trips per capture (concurrent, but still real
// CDP traffic, and verify captures up to three times per action). The cost: on standard-rich pages where
// open/snapshot never stamped data-ct-listener, an element revealed by an
// action whose only click affordance is a JS listener (no cursor style, no
// onclick) appears in the diff as text without a clickable @ref; take a
// snapshot to get its ref.
async function captureStableSnapshot(s, timeoutMs = 5000) {
  const text = await captureSessionSnapshot(s, null, 'stable', timeoutMs);
  return typeof text === 'string' ? text : null;
}

async function primeVerifyBaseline(s, timeoutMs = 3000) {
  const text = await captureStableSnapshot(s, timeoutMs).catch(() => null);
  if (text == null) return;
  if (!s.snapshotBaselines) s.snapshotBaselines = {};
  s.snapshotBaselines.verify = text;
  // A fresh page/navigation is not a stall; start the streak over.
  s.noChangeStreak = 0;
}

// Consecutive act-and-verify rounds that produce no visible change. A single
// no-change round is normal (slow async UI); a run of them means the agent is
// almost certainly stuck — re-clicking a dead control, trapped behind an
// overlay, or looping — so surface it as a structural hint instead of letting
// the agent thrash silently. Purely structural (no per-site knowledge), so it
// generalizes and cannot overfit.
const STALL_STREAK_THRESHOLD = 3;

// Act-and-verify in one round-trip: wait for the UI to settle, snapshot
// (full filter, stable clickable capping), diff against the session
// baseline, and advance the baseline. Used by click/fill/type/press when the
// caller passes `verify`.
async function captureVerifyDiff(s, waitMs, actedSelector) {
  const capture = () => captureStableSnapshot(s, 5000);
  await sleep(Math.min(Math.max(Number(waitMs) || 300, 0), 10000));
  let text = await capture();
  if (text == null) return null;
  if (!s.snapshotBaselines) s.snapshotBaselines = {};
  const previous = s.snapshotBaselines.verify;
  if (previous != null) {
    // Re-sample once when nothing happened yet, or when the only change is
    // the acted element echoing its own new value — debounced UIs (searches,
    // autocompletes, validations) land their real update a beat later.
    const changedLines = renderSnapshotDiff(previous, text).split('\n')
      .filter(line => line.startsWith('+ ') || line.startsWith('- '));
    const refToken = actedSelector && /^@\d+$/.test(actedSelector) ? actedSelector + ' ' : null;
    const selfEchoOnly = refToken && changedLines.length > 0
      && changedLines.every(line => line.includes(refToken));
    if (!changedLines.length || selfEchoOnly) {
      await sleep(700);
      const again = await capture();
      if (again != null) text = again;
    }
    // Slow async UIs (server round-trips) land seconds later. Back off once
    // more, and if the page still shows nothing, say so in time-qualified
    // terms — a bare "no changes" reads as "the action failed" and pushes
    // agents into dangerous retries (double submits).
    const noChangeYet = () => !renderSnapshotDiff(previous, text).split('\n')
      .some(line => line.startsWith('+ ') || line.startsWith('- '));
    if (!changedLines.length && noChangeYet()) {
      await sleep(1200);
      const late = await capture();
      if (late != null) text = late;
      if (noChangeYet()) {
        s.snapshotBaselines.verify = text;
        s.noChangeStreak = (s.noChangeStreak || 0) + 1;
        let msg = '# verify: no visible change detected within ~2s — the action was dispatched, but the UI may still be updating or the result may be in a new tab/dialog; confirm with wait-for-text or snapshot --diff BEFORE retrying the action';
        if (s.noChangeStreak >= STALL_STREAK_THRESHOLD) {
          msg += `\n# stalled: ${s.noChangeStreak} actions in a row changed nothing — you are likely stuck (dead control, an overlay/dialog intercepting the click, or a loop). Do not repeat the same action; try a different element, dismiss any overlay, wait-for the state you expect, or hand off to the user.`;
        }
        return msg;
      }
    }
  }
  s.snapshotBaselines.verify = text;
  // Any path reaching here saw a real change (or a fresh baseline), so the
  // stall streak is broken.
  s.noChangeStreak = 0;
  if (previous == null && text.length > 2000) {
    return '# verify: first observation of a large page; showing changes from the next action onward';
  }
  const diff = renderSnapshotDiff(previous, text);
  if (typeof diff !== 'string') return diff;
  // Verify answers "did my action do the small thing I expected". A huge
  // diff means navigation or a churning dynamic page — summarize instead of
  // making every action on such pages expensive to read.
  const lines = diff.split('\n');
  const changed = lines.filter(line => line.startsWith('+ ') || line.startsWith('- '));
  if (changed.length > 40) {
    return lines.slice(0, 3).join('\n')
      + '\n' + changed.slice(0, 12).join('\n')
      + `\n# verify: large update (${changed.length} changed lines — navigation or dynamic page); showing first 12, use snapshot for the rest`;
  }
  if (diff.length > 4000) {
    return diff.slice(0, 4000) + '\n# verify: output truncated; take a full snapshot if needed';
  }
  return diff;
}

// One unhandled alert()/confirm() blocks every later Runtime.evaluate on the
// tab ("bricked session"). Auto-handle dialogs by session policy (beforeunload
// is always accepted so navigation can proceed) and record what happened for
// the next action response.
function attachDialogHandler(s) {
  s.cdp.on('Page.javascriptDialogOpening', (params) => {
    const accept = params.type === 'beforeunload' ? true : s.dialogPolicy === 'accept';
    s.cdp.send('Page.handleJavaScriptDialog', { accept, promptText: params.defaultPrompt || '' }, 3000).catch(() => {});
    s.lastDialog = {
      type: params.type,
      message: String(params.message || '').slice(0, 300),
      action: accept ? 'accepted' : 'dismissed',
      at: Date.now(),
    };
  });
}

// Session-wide verify policy for click/fill/type/press: explicit ms wins,
// `--no-verify` disables, crawl mode skips, everything else settles 300ms.
function resolveVerifyMs(body, settings) {
  if (body.verify === false) return null;
  if (typeof body.verify === 'number') return body.verify;
  return settings.mode === 'crawl' ? null : 300;
}

// ---- fill --pick: the type-then-choose autocomplete pattern ----
// Correctness invariant: only suggestions that APPEAR after typing count.
// markPreFillPickCandidates stamps everything visible beforehand;
// pickSuggestion polls for an unstamped match, chooses it, probes for an
// observable effect, and always removes its marks on every exit path.

function markPreFillPickCandidates(s) {
  return s.cdp.send('Runtime.evaluate', {
    expression: `(() => {
      ${DEEP_QUERY_JS}
      for (const el of document.querySelectorAll(${JSON.stringify(PICK_CANDIDATE_SEL)})) {
        if (deepVisible(el)) el.setAttribute('data-ct-pick-seen', '1');
      }
      return true;
    })()`,
    returnByValue: true,
  }, 3000).catch(() => {});
}

function cleanupPickMarks(s) {
  return s.cdp.send('Runtime.evaluate', {
    expression: `(() => { for (const el of document.querySelectorAll('[data-ct-pick-seen],[data-ct-picked]')) { el.removeAttribute('data-ct-pick-seen'); el.removeAttribute('data-ct-picked'); } return true; })()`,
    returnByValue: true,
  }, 2000).catch(() => {});
}

async function pickSuggestion(s, sel, selector, text, body) {
  const pickExpression = `((needle, inputSel) => {
    ${DEEP_QUERY_JS}
    const lower = String(needle).trim().toLowerCase();
    const labelOf = (el) => ((el.getAttribute && el.getAttribute('aria-label')) || el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ');
    const candidates = [];
    const input = deepQuery(inputSel);
    for (const el of document.querySelectorAll(${JSON.stringify(PICK_CANDIDATE_SEL)})) {
      if (el.hasAttribute('data-ct-pick-seen')) continue;
      if (input && (el === input || el.contains(input) || input.contains(el))) continue;
      if (!deepVisible(el)) continue;
      const label = labelOf(el);
      if (label && label.length <= 200) candidates.push({ el, label });
    }
    const match = candidates.find(c => c.label.toLowerCase() === lower)
      || candidates.find(c => c.label.toLowerCase().startsWith(lower))
      || candidates.find(c => c.label.toLowerCase().includes(lower));
    if (!match) return null;
    match.el.setAttribute('data-ct-picked', '1');
    const view = match.el.ownerDocument.defaultView || window;
    for (const type of ['mouseover', 'mousedown', 'mouseup', 'click']) {
      match.el.dispatchEvent(new view.MouseEvent(type, { bubbles: true, cancelable: true, view }));
    }
    return match.label.slice(0, 120);
  })(${JSON.stringify(String(body.pick))}, ${JSON.stringify(sel)})`;
  let picked = null;
  const pickDeadline = Date.now() + Math.min(Math.max(Number(body.pickTimeoutMs) || 3000, 500), 15000);
  while (Date.now() <= pickDeadline) {
    const pr = await s.cdp.send('Runtime.evaluate', { expression: pickExpression, returnByValue: true }, 5000);
    if (pr.exceptionDetails) {
      await cleanupPickMarks(s);
      throw httpErr(400, (pr.exceptionDetails.exception?.description || 'pick failed').split('\n')[0]);
    }
    if (pr.result?.value) { picked = pr.result.value; break; }
    await sleep(150);
  }
  if (!picked) {
    await cleanupPickMarks(s);
    throw httpErr(408, `No suggestion matching "${body.pick}" appeared after typing into ${selector}; the widget may render suggestions outside recognized roles/classes (snapshot --diff to locate them) or need key events (click + type + arrows) instead`);
  }
  // JS-dispatched clicks are untrusted events some widgets ignore; report
  // whether an actual effect was observed so a no-op pick cannot read as
  // success.
  await sleep(200);
  const eff = await s.cdp.send('Runtime.evaluate', {
    expression: `(() => {
      ${DEEP_QUERY_JS}
      const pickedEl = document.querySelector('[data-ct-picked]');
      let effect = 'unconfirmed — the widget may ignore synthetic clicks';
      if (!pickedEl || !deepVisible(pickedEl)) effect = 'suggestion-list closed';
      const input = deepQuery(${JSON.stringify(sel)});
      if (input && 'value' in input && input.value !== ${JSON.stringify(String(text ?? ''))}) effect = 'input value updated';
      return effect;
    })()`,
    returnByValue: true,
  }, 3000).catch(() => null);
  const pickEffect = eff?.result?.value || null;
  await cleanupPickMarks(s);
  return { picked, pickEffect };
}

// Shared action epilogue for click/press: adopt any popup the action opened
// and attach the dialog note. The action's start time is captured when the
// finisher is created.
function actionFinisher(port, sessions, session, s, browserState, settings) {
  const since = Date.now();
  return async (result) => {
    const popup = await adoptPopup(port, sessions, session, s, since, browserState, settings);
    if (popup) result.newSession = popup;
    return withDialogNote(s, since, result);
  };
}

// Attach a note about any JS dialog auto-handled since `since` to an action
// result, so the agent learns both that a dialog fired and what it said.
function withDialogNote(s, since, result) {
  const d = s.lastDialog;
  if (!d || d.at < since || !result || typeof result !== 'object') return result;
  s.lastDialog = null;
  result.dialog = `${d.type} dialog auto-${d.action}: "${d.message}" (session policy: --dialog ${s.dialogPolicy}; set at open)`;
  return result;
}

// Track in-flight page requests for waitFor({kind:'network-idle'}). Long-lived
// streams (websocket/eventsource) are ignored and stale entries are pruned so
// a single hung request cannot make a page look busy forever.
// Stealth note: this enables the Network domain on demand, like watch/network
// — an observable CDP signal the default snapshot/click paths avoid.
// `watch network --off` wipes these listeners too (CDPClient.off clears all
// listeners per event), so that path must also clear _inflightOn to re-arm.
function ensureNetworkInflightTracking(s) {
  if (s._inflightOn) return Promise.resolve();
  s._inflightOn = true;
  s._inflight = new Map();
  s._lastNetActivity = Date.now();
  s.cdp.on('Network.requestWillBeSent', (params) => {
    if (params.type === 'WebSocket' || params.type === 'EventSource') return;
    s._inflight.set(params.requestId, Date.now());
    s._lastNetActivity = Date.now();
  });
  const settle = (params) => {
    if (s._inflight.delete(params.requestId)) s._lastNetActivity = Date.now();
  };
  s.cdp.on('Network.loadingFinished', settle);
  s.cdp.on('Network.loadingFailed', settle);
  return s.cdp.send('Network.enable');
}

function inflightCount(s, staleMs = 20000) {
  if (!s._inflight) return 0;
  const now = Date.now();
  for (const [id, at] of s._inflight) {
    if (now - at > staleMs) s._inflight.delete(id);
  }
  return s._inflight.size;
}

// Adopt a popup/new tab opened by this session's page (target=_blank,
// window.open) as a first-class session, so "the result is in another tab"
// stops being a dead end. Discovery events come from the daemon's
// browser-level CDP connection.
async function adoptPopup(port, sessions, sessionName, s, since, browserState, settings) {
  if (!browserState) return null;
  // Adoption respects the same session cap as /open — popup chains must not
  // bypass CHROMUX_MAX_SESSIONS_PER_PROFILE (crawl-mode worker pools rely on
  // it).
  if (settings?.maxSessions > 0 && sessions.size >= settings.maxSessions) return null;
  const entry = browserState.popups.find(p => p.openerId === s.targetId && p.at >= since - 100);
  if (!entry) return null;
  browserState.popups.splice(browserState.popups.indexOf(entry), 1);
  let target = null;
  for (let i = 0; i < 20 && !target; i++) {
    const targets = await cdpFetch(port, '/json/list').catch(() => []);
    target = Array.isArray(targets) ? targets.find(t => t.id === entry.targetId && t.webSocketDebuggerUrl) : null;
    if (!target) await sleep(100);
  }
  if (!target) return null;
  let name = `${sessionName}-popup`;
  for (let i = 2; sessions.has(name); i++) name = `${sessionName}-popup${i}`;
  try {
    const cdp = new CDPClient();
    await cdp.connect(target.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    const now = Date.now();
    const popupSession = {
      targetId: entry.targetId, cdp, createdAt: now, lastUsedAt: now,
      url: target.url || entry.url || '', title: target.title || '', navigations: 0,
      dialogPolicy: s.dialogPolicy || 'dismiss',
    };
    attachDialogHandler(popupSession);
    cdp.onDisconnect = () => { sessions.delete(name); };
    sessions.set(name, popupSession);
    return { session: name, url: popupSession.url, next: `chromux snapshot ${name}` };
  } catch {
    return null;
  }
}

// ============================================================
// Daemon server (per-profile)
// ============================================================

async function startDaemon(profileName, port, daemonPort) {
  try { fs.unlinkSync(sockPath(profileName)); } catch {}
  daemonPort = Number(daemonPort);
  if (!Number.isInteger(daemonPort) || daemonPort <= 0 || daemonPort > 65535) {
    console.error('Usage: --daemon <profile> <chrome-cdp-port> <daemon-port>');
    process.exit(1);
  }
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

  // Browser-level CDP connection: popup discovery (Target.targetCreated) and
  // download control (Browser.setDownloadBehavior) are browser-domain
  // features that per-tab connections never see.
  const browserState = { client: null, popups: [], downloads: new Map(), downloadPath: null };
  // Concurrent callers (downloads, popup adoption) must share one in-flight
  // connection attempt instead of each opening a redundant browser socket.
  let browserConnectPromise = null;
  function connectBrowserClient() {
    if (browserState.client) return Promise.resolve();
    if (!browserConnectPromise) {
      browserConnectPromise = connectBrowserClientOnce()
        .finally(() => { browserConnectPromise = null; });
    }
    return browserConnectPromise;
  }
  async function connectBrowserClientOnce() {
    try {
      const version = await cdpFetch(port, '/json/version');
      if (!version.webSocketDebuggerUrl) return;
      const client = new CDPClient();
      await client.connect(version.webSocketDebuggerUrl);
      client.on('Target.targetCreated', ({ targetInfo }) => {
        if (targetInfo.type !== 'page' || !targetInfo.openerId) return;
        browserState.popups.push({ targetId: targetInfo.targetId, openerId: targetInfo.openerId, url: targetInfo.url, at: Date.now() });
        if (browserState.popups.length > 20) browserState.popups.shift();
      });
      client.on('Target.targetInfoChanged', ({ targetInfo }) => {
        const entry = browserState.popups.find(p => p.targetId === targetInfo.targetId);
        if (entry) entry.url = targetInfo.url;
      });
      client.on('Target.targetCrashed', ({ targetId }) => {
        for (const s of sessions.values()) {
          if (s.oopif?.enabled) removeOopifTarget(s.oopif, { targetId, crashed: true });
        }
      });
      client.on('Browser.downloadWillBegin', (params) => {
        browserState.downloads.set(params.guid, { suggestedFilename: params.suggestedFilename, url: params.url, state: 'inProgress' });
      });
      client.on('Browser.downloadProgress', (params) => {
        const d = browserState.downloads.get(params.guid);
        if (d) { d.state = params.state; d.receivedBytes = params.receivedBytes; d.totalBytes = params.totalBytes; }
      });
      client.onDisconnect = () => { browserState.client = null; };
      await client.send('Target.setDiscoverTargets', { discover: true });
      browserState.client = client;
    } catch {}
  }
  // Browser.setDownloadBehavior applies to the whole Chrome profile (default
  // browser context) — while a chromux download is in flight, a manual
  // download in a headed profile would also land in the chromux directory.
  // The behavior is therefore enabled per download and restored right after.
  browserState.ensureDownloadBehavior = async () => {
    if (!browserState.client) await connectBrowserClient();
    if (!browserState.client) throw httpErr(503, 'Browser-level CDP connection unavailable for downloads');
    if (browserState.downloadPath) return;
    const downloadPath = path.join(CHROMUX_HOME, 'downloads', profileName);
    fs.mkdirSync(downloadPath, { recursive: true });
    await browserState.client.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath, eventsEnabled: true });
    browserState.downloadPath = downloadPath;
  };
  browserState.restoreDownloadBehavior = async () => {
    if (!browserState.client || !browserState.downloadPath) return;
    await browserState.client.send('Browser.setDownloadBehavior', { behavior: 'default', eventsEnabled: false }).catch(() => {});
    browserState.downloadPath = null;
  };
  await connectBrowserClient();

  const HANDLER_TIMEOUT = 45000; // 45s max per request

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const body = ['POST', 'PUT'].includes(req.method) ? await readBody(req) : null;

    // Wrap handler with timeout to prevent daemon hang
    const handlerPromise = routeWithGate(gate, () =>
      route(port, req.method, url.pathname + url.search, body, sessions, isHeadless, settings, gate, browserState)
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

  server.listen(daemonPort, DAEMON_HOST, () => {
    writeDaemonEndpointState(profileName, daemonPort);
    console.log(`chromux daemon [${profileName}] mode=${settings.mode} on http://${DAEMON_HOST}:${daemonPort} -> CDP ${port}`);
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

  // Watchdog: verify Chrome CDP is alive every 60s, exit if dead. Also
  // re-establish the browser-level connection if it dropped.
  setInterval(async () => {
    const alive = await checkCDP(port);
    if (!alive) {
      process.stderr.write(`chromux daemon [${profileName}]: Chrome CDP unreachable, exiting.\n`);
      cleanup();
      process.exit(1);
    }
    if (!browserState.client) await connectBrowserClient();
  }, 60000);

  const cleanup = () => {
    for (const s of sessions.values()) s.cdp.close();
    clearDaemonEndpointState(profileName, daemonPort);
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
  // Read-only waits stay available while a profile is paused: the human
  // handoff loop is pause -> user acts in the browser -> wait for the
  // logged-in marker -> resume, so the wait itself must not be rejected.
  if (routePath === '/wait-for-text' || routePath === '/wait-for-selector') return false;
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
  Delete: { key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46, nativeVirtualKeyCode: 46 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38, nativeVirtualKeyCode: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37, nativeVirtualKeyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, nativeVirtualKeyCode: 39 },
  Home: { key: 'Home', code: 'Home', windowsVirtualKeyCode: 36, nativeVirtualKeyCode: 36 },
  End: { key: 'End', code: 'End', windowsVirtualKeyCode: 35, nativeVirtualKeyCode: 35 },
  PageUp: { key: 'PageUp', code: 'PageUp', windowsVirtualKeyCode: 33, nativeVirtualKeyCode: 33 },
  PageDown: { key: 'PageDown', code: 'PageDown', windowsVirtualKeyCode: 34, nativeVirtualKeyCode: 34 },
};

/** Translate a snapshot @ref handle into its data-ct-ref attribute selector. */
function refToSelector(selector) {
  return selector.startsWith('@') ? `[data-ct-ref="${selector.slice(1)}"]` : selector;
}

function pngDimensions(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24
    || buffer.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error('Chrome returned an invalid PNG screenshot');
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function mapImageCoordinateSpace(base, image, cssRect, imageSource = 'viewport') {
  if (!image?.width || !image?.height || !cssRect?.width || !cssRect?.height) {
    throw httpErr(503, 'Unable to map screenshot image coordinates');
  }
  return {
    ...base,
    image,
    imageSource,
    imageCssRect: cssRect,
    cssToImage: {
      scaleX: image.width / cssRect.width,
      scaleY: image.height / cssRect.height,
      offsetCssX: cssRect.x,
      offsetCssY: cssRect.y,
    },
    imageToCss: {
      scaleX: cssRect.width / image.width,
      scaleY: cssRect.height / image.height,
      offsetCssX: cssRect.x,
      offsetCssY: cssRect.y,
    },
  };
}

async function captureCoordinateSpace(cdp) {
  const viewportResult = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const vv = window.visualViewport;
      return {
        cssViewport: { width: window.innerWidth, height: window.innerHeight },
        visualViewport: vv ? {
          offsetLeft: vv.offsetLeft,
          offsetTop: vv.offsetTop,
          pageLeft: vv.pageLeft,
          pageTop: vv.pageTop,
          width: vv.width,
          height: vv.height,
          scale: vv.scale,
        } : {
          offsetLeft: 0,
          offsetTop: 0,
          pageLeft: window.scrollX,
          pageTop: window.scrollY,
          width: window.innerWidth,
          height: window.innerHeight,
          scale: 1,
        },
        scroll: { x: window.scrollX, y: window.scrollY },
        devicePixelRatio: window.devicePixelRatio,
      };
    })()`,
    returnByValue: true,
  });
  const viewport = viewportResult.result?.value;
  if (!viewport?.visualViewport?.width || !viewport?.visualViewport?.height) {
    throw httpErr(503, 'Unable to read viewport coordinate metadata');
  }
  const screenshot = await cdp.send('Page.captureScreenshot', {
    format: 'png',
  }, 30000);
  const buffer = Buffer.from(screenshot.data, 'base64');
  const image = pngDimensions(buffer);
  const vv = viewport.visualViewport;
  const base = {
    cssViewport: viewport.cssViewport,
    visualViewport: vv,
    scroll: viewport.scroll,
    devicePixelRatio: viewport.devicePixelRatio,
    viewportImage: image,
  };
  const coordinateSpace = mapImageCoordinateSpace(base, image, {
    x: vv.offsetLeft,
    y: vv.offsetTop,
    width: vv.width,
    height: vv.height,
  });
  return { buffer, coordinateSpace };
}

function pointToCss(x, y, space, coordinateSpace) {
  if (space === 'css') return { x, y };
  if (space !== 'image') throw httpErr(400, `Unknown coordinate space "${space}"; use css or image`);
  const image = coordinateSpace.image || coordinateSpace.viewportImage;
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) {
    throw httpErr(400, `image coordinates outside screenshot: [${x}, ${y}] not within ${image.width}x${image.height}`);
  }
  const map = coordinateSpace.imageToCss;
  return {
    x: map.offsetCssX + x * map.scaleX,
    y: map.offsetCssY + y * map.scaleY,
  };
}

async function resolveDeepElementRect(cdp, selector, action = 'Action', sessionId = null, scrollIntoView = true) {
  const sel = refToSelector(String(selector || ''));
  const result = await cdp.send('Runtime.evaluate', {
    expression: `((sel, action, shouldScroll) => {
      ${DEEP_QUERY_JS}
      function describe(node) {
        if (!node) return 'unknown';
        const id = node.id ? '#' + node.id : '';
        const cls = node.className && typeof node.className === 'string'
          ? '.' + node.className.trim().split(/\\s+/).slice(0, 2).join('.')
          : '';
        return node.tagName.toLowerCase() + id + cls;
      }
      function composedContains(ancestor, node) {
        let current = node;
        while (current) {
          if (current === ancestor) return true;
          current = current.parentNode || current.host || null;
        }
        return false;
      }
      const el = deepQuery(sel);
      if (!el) throw new Error(action + ' target not found or stale: ' + sel);
      if (shouldScroll) el.scrollIntoView?.({ block: 'center', inline: 'center' });
      const view = el.ownerDocument.defaultView || window;
      const rect = el.getBoundingClientRect();
      if (!deepVisible(el)) throw new Error(action + ' target is hidden: ' + sel);
      const lx = rect.left + rect.width / 2;
      const ly = rect.top + rect.height / 2;
      if (lx < 0 || ly < 0 || lx >= view.innerWidth || ly >= view.innerHeight) {
        throw new Error(action + ' target outside ' + (shouldScroll ? 'viewport after scroll: ' : 'the current viewport: ') + sel);
      }
      const rootNode = el.getRootNode();
      let shadowHost = rootNode.host || null;
      while (shadowHost) {
        const hostRoot = shadowHost.getRootNode();
        const hostHitBase = hostRoot.elementFromPoint ? hostRoot : shadowHost.ownerDocument;
        const hostHit = hostHitBase.elementFromPoint(lx, ly);
        if (!hostHit) throw new Error(action + ' target shadow host has no element at its center: ' + sel);
        if (!composedContains(shadowHost, hostHit) && !composedContains(hostHit, shadowHost)) {
          throw new Error(action + ' target shadow host is covered: ' + sel + ' hit ' + describe(hostHit));
        }
        shadowHost = hostRoot.host || null;
      }
      const hitBase = rootNode.elementFromPoint ? rootNode : el.ownerDocument;
      const hit = hitBase.elementFromPoint(lx, ly);
      if (!hit) throw new Error(action + ' target has no element at its center: ' + sel);
      if (!composedContains(el, hit) && !composedContains(hit, el)) {
        throw new Error(action + ' target is covered: ' + sel + ' hit ' + describe(hit));
      }
      let left = rect.left;
      let top = rect.top;
      let w = view;
      let outermostFrame = null;
      while (w !== w.parent && w.frameElement) {
        const frameEl = w.frameElement;
        const frameRect = frameEl.getBoundingClientRect();
        let padLeft = 0;
        let padTop = 0;
        try {
          const style = frameEl.ownerDocument.defaultView.getComputedStyle(frameEl);
          padLeft = parseFloat(style.paddingLeft) || 0;
          padTop = parseFloat(style.paddingTop) || 0;
        } catch {}
        left += frameRect.left + frameEl.clientLeft + padLeft;
        top += frameRect.top + frameEl.clientTop + padTop;
        outermostFrame = frameEl;
        w = w.parent;
      }
      const centerX = left + rect.width / 2;
      const centerY = top + rect.height / 2;
      if (centerX < 0 || centerY < 0 || centerX >= window.innerWidth || centerY >= window.innerHeight) {
        throw new Error(action + ' target outside top viewport: ' + sel);
      }
      if (outermostFrame) {
        const topHit = document.elementFromPoint(centerX, centerY);
        if (topHit && topHit !== outermostFrame && !outermostFrame.contains(topHit) && !topHit.contains(outermostFrame)) {
          throw new Error(action + ' target is covered by a top-page element: ' + sel + ' hit ' + describe(topHit));
        }
      }
      return {
        x: left,
        y: top,
        width: rect.width,
        height: rect.height,
        centerX,
        centerY,
        draggable: el.draggable === true,
      };
    })(${JSON.stringify(sel)}, ${JSON.stringify(action)}, ${JSON.stringify(scrollIntoView)})`,
    returnByValue: true,
  }, 10000, sessionId);
  if (result.exceptionDetails) {
    const description = (result.exceptionDetails.exception?.description || `${action} failed`).split('\n')[0];
    throw httpErr(400, `${description}. Run chromux snapshot again for a fresh ref and inspect overlays.`);
  }
  return result.result?.value;
}

async function resolveActionTarget(cdp, target, action, coordinateSpace = null, { scrollIntoView = true } = {}) {
  if (target?.selector) {
    const geometry = await resolveDeepElementRect(cdp, target.selector, action, null, scrollIntoView);
    return {
      x: geometry.centerX,
      y: geometry.centerY,
      geometry,
      target: { selector: target.selector },
      coordinateSpace,
    };
  }
  if (!Array.isArray(target?.xy) || target.xy.length !== 2) {
    throw httpErr(400, `${action} requires a selector/ref or xy coordinates`);
  }
  const [inputX, inputY] = target.xy.map(Number);
  if (!Number.isFinite(inputX) || !Number.isFinite(inputY)) {
    throw httpErr(400, `${action} coordinates must be numeric`);
  }
  const space = target.space || 'css';
  if (space === 'image' && !coordinateSpace) {
    ({ coordinateSpace } = await captureCoordinateSpace(cdp));
  }
  let x = inputX;
  let y = inputY;
  if (space === 'image') ({ x, y } = pointToCss(inputX, inputY, space, coordinateSpace));
  else if (space !== 'css') throw httpErr(400, `Unknown coordinate space "${space}"; use css or image`);
  const viewport = coordinateSpace?.cssViewport || (await cdp.send('Runtime.evaluate', {
    expression: '({width: window.innerWidth, height: window.innerHeight})',
    returnByValue: true,
  })).result?.value;
  if (x < 0 || y < 0 || x >= viewport.width || y >= viewport.height) {
    throw httpErr(400, `${action} coordinates outside viewport: [${x}, ${y}] not within ${viewport.width}x${viewport.height}. Inspect a fresh screenshot or snapshot.`);
  }
  return {
    x,
    y,
    target: { xy: [inputX, inputY], space, css: [x, y] },
    coordinateSpace,
  };
}

async function dispatchPointerDrag(cdp, start, end, steps, holdMs) {
  let mousePressed = false;
  let mousePoint = start;
  try {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x, y: start.y, button: 'none', pointerType: 'mouse' });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: start.x, y: start.y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse' });
    mousePressed = true;
    if (holdMs > 0) await sleep(holdMs);
    for (let index = 1; index <= steps; index++) {
      const progress = index / steps;
      mousePoint = {
        x: start.x + (end.x - start.x) * progress,
        y: start.y + (end.y - start.y) * progress,
      };
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: mousePoint.x,
        y: mousePoint.y,
        button: 'left',
        buttons: 1,
        pointerType: 'mouse',
      });
      await sleep(16);
    }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: end.x, y: end.y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'mouse' });
    mousePressed = false;
  } finally {
    if (mousePressed) {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased', x: mousePoint.x, y: mousePoint.y,
        button: 'left', buttons: 0, clickCount: 1, pointerType: 'mouse',
      }).catch(() => {});
    }
  }
}

async function dispatchHtml5Drag(cdp, start, end, steps, holdMs) {
  await cdp.send('Input.setInterceptDrags', { enabled: true });
  let mousePressed = false;
  let mousePoint = start;
  try {
    const intercepted = cdp.waitForEvent('Input.dragIntercepted', 3000).catch(() => null);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x, y: start.y, button: 'none', pointerType: 'mouse' });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: start.x, y: start.y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'mouse' });
    mousePressed = true;
    if (holdMs > 0) await sleep(holdMs);
    for (let index = 1; index <= steps; index++) {
      const progress = index / steps;
      mousePoint = {
        x: start.x + (end.x - start.x) * progress,
        y: start.y + (end.y - start.y) * progress,
      };
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: mousePoint.x,
        y: mousePoint.y,
        button: 'left',
        buttons: 1,
        pointerType: 'mouse',
      });
      await sleep(16);
    }
    const event = await intercepted;
    if (!event?.data) {
      throw httpErr(400, 'Native HTML5 drag did not start. Confirm the source is draggable and visible; no synthetic DragEvent fallback was used.');
    }
    await cdp.send('Input.dispatchDragEvent', { type: 'dragEnter', x: end.x, y: end.y, data: event.data });
    await cdp.send('Input.dispatchDragEvent', { type: 'dragOver', x: end.x, y: end.y, data: event.data });
    await cdp.send('Input.dispatchDragEvent', { type: 'drop', x: end.x, y: end.y, data: event.data });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: end.x, y: end.y, button: 'left', buttons: 0, clickCount: 1, pointerType: 'mouse' });
    mousePressed = false;
  } finally {
    if (mousePressed) {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased', x: mousePoint.x, y: mousePoint.y,
        button: 'left', buttons: 0, clickCount: 1, pointerType: 'mouse',
      }).catch(() => {});
    }
    await cdp.send('Input.setInterceptDrags', { enabled: false }).catch(() => {});
  }
}

// Page-side deep-query helpers shared by click/fill/wait expressions. Plain
// querySelector is the fast path; on a miss the search pierces open shadow
// roots and same-origin iframes so snapshot @refs assigned inside them stay
// actionable. Cross-origin frames and closed shadow roots remain out of reach.
const DEEP_QUERY_JS = `
  function deepQuery(sel) {
    const search = (root) => {
      let el = null;
      try { el = root.querySelector(sel); } catch (e) { throw new Error('Bad selector: ' + sel + ' (' + e.message + ')'); }
      if (el) return el;
      for (const host of root.querySelectorAll('*')) {
        if (host.shadowRoot) {
          const found = search(host.shadowRoot);
          if (found) return found;
        }
      }
      for (const frame of root.querySelectorAll('iframe,frame')) {
        let innerDoc = null;
        try { innerDoc = frame.contentDocument; } catch {}
        if (innerDoc) {
          const found = search(innerDoc);
          if (found) return found;
        }
      }
      return null;
    };
    try {
      const el = document.querySelector(sel);
      if (el) return el;
    } catch (e) { throw new Error('Bad selector: ' + sel + ' (' + e.message + ')'); }
    return search(document);
  }
  function deepVisible(el) {
    const view = el.ownerDocument.defaultView || window;
    const style = view.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  }
  // Rendered text of the page including same-origin frames (innerText already
  // covers rendered shadow DOM content).
  function deepText(doc) {
    let text = doc.body ? doc.body.innerText : '';
    for (const frame of doc.querySelectorAll('iframe,frame')) {
      try { if (frame.contentDocument) text += '\\n' + deepText(frame.contentDocument); } catch {}
    }
    return text;
  }
`;

// Where autocomplete/dropdown suggestions usually render; shared by the
// daemon fill --pick path (see also snippets/_builtin/search-and-pick.js).
const PICK_CANDIDATE_SEL = '[role="option"],[role="menuitem"],li,[class*="suggest"] *,[class*="autocomplete"] *,[class*="option"]';

// Shared page-side probe expressions for wait-for-text / wait-for-selector and
// the run() waitFor helper, so all wait paths agree on what "visible" means.
function textIncludesExpression(text) {
  return `((needle) => { ${DEEP_QUERY_JS} return deepText(document).includes(needle); })(${JSON.stringify(String(text))})`;
}

function selectorVisibleExpression(selector) {
  return `((sel) => {
    ${DEEP_QUERY_JS}
    const el = deepQuery(sel);
    return el ? deepVisible(el) : false;
  })(${JSON.stringify(String(selector))})`;
}

// Inverse probe: true when the selector matches nothing visible anywhere.
// Defined as the exact negation of "visible" so the two can never drift.
function selectorGoneExpression(selector) {
  return `!(${selectorVisibleExpression(selector)})`;
}

// First candidate that matches wins: selectors must resolve to a visible
// element, texts must be present in the page. This lets saved scripts carry
// fallback locators so a single site change does not break a replay.
function firstMatchExpression(kind, candidates) {
  const list = JSON.stringify(candidates.map(String));
  if (kind === 'text') {
    return `((cands) => {
      ${DEEP_QUERY_JS}
      const text = deepText(document);
      for (const c of cands) { if (text.includes(c)) return c; }
      return null;
    })(${list})`;
  }
  if (kind === 'gone') {
    return `((cands) => {
      ${DEEP_QUERY_JS}
      for (const c of cands) {
        const el = deepQuery(c);
        if (el && deepVisible(el)) return null;
      }
      return cands.join(' | ');
    })(${list})`;
  }
  return `((cands) => {
    ${DEEP_QUERY_JS}
    for (const c of cands) {
      let el = null;
      try { el = deepQuery(c); } catch { continue; }
      if (el && deepVisible(el)) return c;
    }
    return null;
  })(${list})`;
}

async function pressKey(cdp, key) {
  const def = KEY_DEFS[key];
  if (!def) throw httpErr(400, `Unsupported key "${key}". Supported keys: ${Object.keys(KEY_DEFS).join(', ')}`);
  await cdp.send('Page.bringToFront', {});
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...def });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...def });
}

async function typeFocusedText(cdp, text) {
  const focus = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const el = document.activeElement;
      if (!el || !/^(IFRAME|FRAME)$/.test(el.tagName)) return { opaqueFrame: false };
      try {
        return { opaqueFrame: !el.contentDocument };
      } catch {
        return { opaqueFrame: true };
      }
    })()`,
    returnByValue: true,
  });
  if (focus.result?.value?.opaqueFrame !== true) {
    await cdp.send('Input.insertText', { text });
    return;
  }
  // Chrome can acknowledge a cross-renderer click before child focus settles.
  await sleep(50);
  for (const char of String(text)) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'char', text: char });
  }
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

async function cleanupFailedOpenSession(sessions, session, s, cdp, port, targetId) {
  sessions.delete(session);
  if (s) disposeOopifRouting(s);
  const transport = s?.cdp || cdp;
  if (transport) {
    try {
      await transport.closeAndWait();
    } catch {
      try { transport.close(); } catch {}
    }
  }
  if (targetId) await closeTab(port, targetId).catch(() => {});
}

async function prepareOpenSessionNavigation({
  sessions,
  session,
  s,
  body,
  url,
  settings,
  port,
  isNewSession,
  newTab,
}) {
  try {
    if (body.oopif === true) await enableOopifRouting(s);
    touchSession(s);
    s.lastImageCoordinateSpace = null;
    await navigateSession(s.cdp, url, settings);
  } catch (err) {
    if (isNewSession && newTab) {
      await cleanupFailedOpenSession(sessions, session, s, s.cdp, port, newTab.id);
    }
    throw err;
  }
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

async function route(port, method, routePath, body, sessions, isHeadless = false, settings = modeSettings('default'), gate = null, browserState = null) {

  if (routePath === '/health')
    return {
      ok: true,
      sessions: sessions.size,
      mode: settings.mode,
      gate: gate ? {
        max: gate.max || 0,
        active: gate.active || 0,
        queueDepth: gate.queue.length,
        queueLimit: settings.maxQueuedOps || 0,
      } : null,
      queued: gate ? gate.queue.length : null,
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
      await reconcileOopifRouting(s);
      if (settings.mode === 'crawl') {
        out[id] = { url: s.url || '', title: s.title || '', ageMs: Date.now() - s.createdAt, idleMs: Date.now() - s.lastUsedAt, navigations: s.navigations || 0 };
        if (s.oopif?.enabled) out[id].oopif = oopifSummary(s);
        continue;
      }
      try {
        const r = await s.cdp.send('Runtime.evaluate', { expression: 'JSON.stringify({url:location.href,title:document.title})', returnByValue: true });
        out[id] = JSON.parse(r.result.value);
        if (s.oopif?.enabled) out[id].oopif = oopifSummary(s);
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
      try {
        await cdp.connect(tab.webSocketDebuggerUrl);
        await cdp.send('Page.enable');
        // NOTE: Runtime.enable intentionally NOT called (Patchright technique).
        // Runtime.enable is the #1 CDP detection signal used by Cloudflare, DataDome, PerimeterX.
        // Runtime.evaluate works without it - no need for Runtime.executionContextCreated events.
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
          // The CDP call itself is a detectable signal - removing it is better stealth.
        }
        if (settings.mode === 'crawl' && settings.resourceBlocking) {
          await cdp.send('Network.enable');
          await cdp.send('Network.setBlockedURLs', { urls: CRAWL_BLOCK_URLS });
        }
        cdp.onDisconnect = (reason) => {
          if (s) disposeOopifRouting(s);
          sessions.delete(session);
        };
        const now = Date.now();
        s = { targetId: tab.id, cdp, createdAt: now, lastUsedAt: now, url: 'about:blank', title: '', navigations: 0 };
        s.dialogPolicy = body.dialog === 'accept' ? 'accept' : 'dismiss';
        attachDialogHandler(s);
        sessions.set(session, s);
      } catch (err) {
        await cleanupFailedOpenSession(sessions, session, s, cdp, port, tab.id);
        throw err;
      }
    }
    if (body.dialog === 'accept' || body.dialog === 'dismiss') s.dialogPolicy = body.dialog;
    await prepareOpenSessionNavigation({
      sessions,
      session,
      s,
      body,
      url,
      settings,
      port,
      isNewSession,
      newTab,
    });
    const pageInfo = await readPageInfo(port, s.targetId, s.cdp, settings);
    s.url = pageInfo.url;
    s.title = pageInfo.title;
    s.navigations = (s.navigations || 0) + 1;
    touchSession(s);
    const result = { session, ...pageInfo };
    if (s.oopif?.enabled) result.oopif = oopifSummary(s);
    // Nudge structure-first workflows: report how many interactive elements the
    // page has and the snapshot command that reveals them. Skipped in crawl mode
    // to keep worker-tab throughput unchanged.
    if (settings.mode !== 'crawl') {
      try {
        const cr = await s.cdp.send('Runtime.evaluate', {
          expression: `document.querySelectorAll('a[href],button,input,select,textarea,[role="button"],[role="link"],[role="tab"],[role="menuitem"]').length`,
          returnByValue: true,
        }, 2000);
        const n = cr?.result?.value;
        if (typeof n === 'number') {
          result.interactive = n;
          result.next = `chromux snapshot ${session} --interactive`;
          // Small pages: ship the interactive snapshot inline so the first
          // observation rides along with navigation instead of costing the
          // agent another round-trip. Bounded so big pages stay summarized.
          // n === 0 still runs: behaviorally-clickable detection ('auto')
          // finds div-based controls that the standard count misses.
          if (n <= 20) {
            await markListenerClickables(s);
            const text = await captureSessionSnapshot(s, 'interactive', 'auto', 2000);
            const body = typeof text === 'string' ? text.split('\n').slice(2).join('\n').trim() : '';
            if (body && text.length <= 2000) {
              if (!s.snapshotBaselines) s.snapshotBaselines = {};
              s.snapshotBaselines.interactive = text;
              result.elements = body;
              result.next = `act on @refs, then verify: chromux snapshot ${session} --interactive --diff`;
            }
          }
        }
        // Prime the verify baseline at navigation time so the FIRST action on
        // a page gets a real diff instead of "first observation of a large
        // page". Local capture only — nothing is added to the response.
        await primeVerifyBaseline(s);
      } catch {}
    }
    // Surface host-specific hint files from ~/.chromux/skills/<host>/*.md,
    // including parent-domain notes (search.naver.com also reads naver.com).
    try {
      const knowledgeHint = siteKnowledgeHintForUrl(result.url);
      const hints = readSiteNotesForHostChain(knowledgeHint?.host)
        .map(note => `# Hint: ${note.label}\n${note.content}`);
      if (hints.length) result.hints = hints.join('\n\n');
      // Surface saved replay scripts for this host so agents reuse proven
      // flows instead of re-deriving them. Rank by recorded confidence
      // (confirmed − contradicted, recency tiebreak) so the recommended replay
      // is the flow most likely to still work, and warn when it recently broke.
      const scripts = listScriptsForHostChain(knowledgeHint?.host);
      if (scripts.length) {
        const scored = scripts.map(s => {
          const st = scriptStatForPath(s.path);
          return { label: s.label, st, score: st ? (st.confirmed || 0) - (st.contradicted || 0) : 0 };
        }).sort((a, b) => (b.score - a.score)
          || String(b.st?.lastUsed || '').localeCompare(String(a.st?.lastUsed || '')));
        result.scripts = scored.map(s => s.label);
        result.replay = `chromux run ${session} --script ${scored[0].label}`;
        const withStats = scored.filter(s => s.st);
        if (withStats.length) {
          result.scriptStats = withStats.map(s => ({
            label: s.label,
            confirmed: s.st.confirmed || 0,
            contradicted: s.st.contradicted || 0,
            lastResult: s.st.lastResult || null,
          }));
        }
        const top = scored[0];
        if (top.st && (top.st.contradicted || 0) > 0 && (top.st.contradicted || 0) >= (top.st.confirmed || 0)) {
          result.replayNote = 'Top saved flow recently failed at least as often as it worked — snapshot to confirm the page still matches before replaying.';
        }
      }
    } catch {}
    return result;
  }

  if (routePath.startsWith('/snapshot/')) {
    const u = new URL(routePath, 'http://x');
    const session = decodeURIComponent(u.pathname.split('/')[2]);
    const filter = u.searchParams.get('filter');
    const wantDiff = u.searchParams.get('diff') === '1';
    const grep = u.searchParams.get('grep');
    const clickable = u.searchParams.get('clickable') === '1' ? 'on' : 'auto';
    const s = getSession(sessions, session);
    touchSession(s);
    await markListenerClickables(s, clickable === 'on');
    const text = await captureSessionSnapshot(s, filter, clickable);
    if (typeof text !== 'string') return text;
    // Every snapshot (plain, --diff, or --grep) becomes the next baseline per
    // filter; grep/diff only change what is rendered, not what is stored.
    const baselineKey = filter || 'full';
    if (!s.snapshotBaselines) s.snapshotBaselines = {};
    const previous = s.snapshotBaselines[baselineKey];
    s.snapshotBaselines[baselineKey] = text;
    // The agent has now OBSERVED this state — advance the verify baseline
    // (its own capture shape) too, so the next action diffs against what the
    // agent last saw instead of the open-time primer. Without this, an
    // action that removes late-rendered UI (dismissing a cookie dialog that
    // appeared after load) would falsely report "no visible change".
    await primeVerifyBaseline(s);
    if (grep != null && grep !== '') return renderSnapshotGrep(text, grep);
    return wantDiff ? renderSnapshotDiff(previous, text) : text;
  }

  if (routePath === '/cdp' && method === 'POST') {
    const { session, method: cdpMethod, params, timeoutMs } = body;
    if (!session || !cdpMethod) throw httpErr(400, 'session and method required');
    const s = getSession(sessions, session);
    touchSession(s);
    s.lastImageCoordinateSpace = null;
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
    const { session, code, timeoutMs, args: runArgs } = body;
    if (!session || code == null) throw httpErr(400, 'session and code required');
    const s = getSession(sessions, session);
    touchSession(s);
    // Dialogs auto-handled during a run are the run's own business; clearing
    // here keeps them from being misattributed to the next click/fill/press.
    s.lastDialog = null;
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
        const desc = r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'js error';
        if (isLikelyPageExpressionSyntaxError(r.exceptionDetails)) {
          // Shell quoting is the usual culprit; echo what actually reached the
          // page so the damage is visible, and point at the escape-free path.
          const src = String(expr);
          const preview = src.slice(0, 120).replace(/\s+/g, ' ');
          throw new Error(`${desc}\njs() code as received (check shell escaping): ${preview}${src.length > 120 ? '…' : ''}\nhint: for multi-line page code prefer chromux run <session> --page-file PATH`);
        }
        throw new Error(desc);
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
    const currentPageState = async () => {
      try {
        return await page('({url:location.href,title:document.title})', Math.min(defaultJsTimeout || 3000, 5000));
      } catch {
        return { url: s.url || '', title: s.title || '' };
      }
    };
    const waitFor = async (condition, options = {}) => {
      const timeout = Number.isFinite(Number(options.timeoutMs)) && Number(options.timeoutMs) > 0
        ? Number(options.timeoutMs)
        : (requestedTimeout ?? 5000);
      const pollMs = Number.isFinite(Number(options.pollMs)) && Number(options.pollMs) > 0
        ? Number(options.pollMs)
        : 100;
      const kind = options.kind || (
        options.text != null ? 'text'
          : options.selector != null ? 'selector'
            : options.expression != null ? 'expression'
              : (typeof condition === 'string' || Array.isArray(condition)) ? 'selector'
                : 'expression'
      );
      const value = options.text ?? options.selector ?? options.expression ?? condition;
      // Network-idle wait: no in-flight page requests for `idleMs` — the
      // deterministic replacement for sleep() after XHR-driven SPA updates.
      if (kind === 'network-idle') {
        const idleMs = Number.isFinite(Number(options.idleMs)) && Number(options.idleMs) > 0 ? Number(options.idleMs) : 500;
        await ensureNetworkInflightTracking(s);
        const idleDeadline = Date.now() + timeout;
        while (Date.now() <= idleDeadline) {
          if (inflightCount(s) === 0 && Date.now() - s._lastNetActivity >= idleMs) {
            const state = await currentPageState();
            return { kind, idleMs, timeoutMs: timeout, ...state };
          }
          await sleep(50);
        }
        throw new Error(`waitFor network-idle failed after ${timeout}ms: ${inflightCount(s)} requests still in flight`);
      }
      // Selector/text waits accept an array of fallback candidates; the first
      // one that matches wins and is reported back as `matched`. For 'gone',
      // every candidate must be absent/hidden.
      const candidates = (kind === 'selector' || kind === 'text' || kind === 'gone') && Array.isArray(value)
        ? value.map(String).filter(Boolean)
        : null;
      if (candidates && !candidates.length) {
        throw new Error(`waitFor ${kind} requires at least one candidate`);
      }
      const describeValue = () => kind === 'expression'
        ? '[expression]'
        : (candidates ? candidates.join(' | ') : String(value));
      const deadline = Date.now() + timeout;
      let lastError = null;
      let lastValue = null;
      while (Date.now() <= deadline) {
        try {
          if (kind === 'settled' || kind === 'quiet') {
            await sleep(Math.min(timeout, Number(options.ms) || 300));
            return { kind, timeoutMs: timeout };
          }
          const expression = candidates
            ? firstMatchExpression(kind, candidates)
            : kind === 'text'
              ? textIncludesExpression(value)
              : kind === 'selector'
                ? selectorVisibleExpression(value)
                : kind === 'gone'
                  ? selectorGoneExpression(value)
                  : String(value);
          lastValue = await evalJs(expression, Math.min(timeout + 1000, 30000));
          const matched = candidates && typeof lastValue === 'string' ? lastValue : null;
          if (matched || lastValue === true || (!candidates && kind === 'expression' && options.truthy !== false && Boolean(lastValue))) {
            const state = await currentPageState();
            const proof = { kind, value: describeValue(), timeoutMs: timeout, ...state };
            if (candidates) proof.matched = matched;
            return proof;
          }
        } catch (err) {
          lastError = err.message;
        }
        await sleep(pollMs);
      }
      const state = await currentPageState();
      throw new Error(`waitFor ${kind} failed after ${timeout}ms: ${describeValue()} url=${state.url || ''} title=${state.title || ''} last=${JSON.stringify(redactReceiptValue(lastValue, 'lastValue'))}${lastError ? ` error=${lastError}` : ''}`);
    };
    const assertPage = async (expression, options = {}) => {
      const state = await waitFor(expression, { ...options, kind: 'expression', timeoutMs: options.timeoutMs || 1 });
      return { asserted: true, ...state };
    };
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
    const fn = new AsyncFunction('cdp', 'js', 'sleep', 'waitLoad', 'page', 'waitFor', 'assertPage', 'args', code);
    const runPromise = fn(cdp, evalJs, sleep, waitLoad, page, waitFor, assertPage, (runArgs && typeof runArgs === 'object') ? runArgs : {});
    try {
      const result = (typeof timeoutMs === 'number' && timeoutMs > 0)
        ? await withTimeout(runPromise, timeoutMs, 'run timeout')
        : await runPromise;
      return result === undefined ? null : result;
    } catch (err) {
      if (settings.mode === 'crawl' && /timeout/i.test(err.message)) {
        throw await closeUnhealthySession(port, sessions, session, s, err.message);
      }
      decorateRunError(err);
      throw err;
    }
  }

  if (routePath === '/hover' && method === 'POST') {
    const { session, selector, xy, space = 'css' } = body;
    if (!session) throw httpErr(400, 'session required');
    const s = getSession(sessions, session);
    touchSession(s);
    await s.cdp.send('Page.bringToFront', {});
    const coordinateSpace = space === 'image' ? s.lastImageCoordinateSpace : null;
    const point = await resolveActionTarget(s.cdp, { selector, xy, space }, 'Hover', coordinateSpace);
    await s.cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: point.x,
      y: point.y,
      button: 'none',
    });
    await sleep(100);
    const result = {
      hovered: point.target,
      ...(point.coordinateSpace ? { coordinateSpace: point.coordinateSpace } : {}),
    };
    const verifyMs = resolveVerifyMs(body, settings);
    if (verifyMs != null) {
      const changed = await captureVerifyDiff(s, verifyMs);
      if (changed != null) return { ...result, changed };
    }
    return { ...result, next: `chromux snapshot ${session} --diff` };
  }

  if (routePath === '/drag' && method === 'POST') {
    const { session, from, to, mode = 'auto' } = body;
    if (!session) throw httpErr(400, 'session required');
    if (!['auto', 'pointer', 'html5'].includes(mode)) throw httpErr(400, 'drag mode must be auto, pointer, or html5');
    const steps = Math.min(100, Math.max(2, Number(body.steps) || 12));
    const holdMs = Math.min(2000, Math.max(0, Number(body.holdMs) || 100));
    const s = getSession(sessions, session);
    touchSession(s);
    await s.cdp.send('Page.bringToFront', {});
    const usesImageSpace = from?.space === 'image' || to?.space === 'image';
    const coordinateSpace = usesImageSpace ? s.lastImageCoordinateSpace : null;
    const mixedSelectorCoordinates = Boolean(from?.selector) !== Boolean(to?.selector);
    const resolveOptions = { scrollIntoView: !mixedSelectorCoordinates };
    let start = await resolveActionTarget(s.cdp, from, 'Drag source', coordinateSpace, resolveOptions);
    let end = await resolveActionTarget(s.cdp, to, 'Drag destination', start.coordinateSpace, resolveOptions);
    // Resolving a selector may scroll. Refresh both selector geometries without
    // further scrolling so stale pre-scroll coordinates can never be dispatched.
    if (from?.selector) {
      start = await resolveActionTarget(s.cdp, from, 'Drag source', start.coordinateSpace, { scrollIntoView: false });
    }
    if (to?.selector) {
      end = await resolveActionTarget(s.cdp, to, 'Drag destination', end.coordinateSpace, { scrollIntoView: false });
    }
    const selectedMode = mode === 'auto' ? (start.geometry?.draggable ? 'html5' : 'pointer') : mode;
    if (selectedMode === 'html5') await dispatchHtml5Drag(s.cdp, start, end, steps, holdMs);
    else await dispatchPointerDrag(s.cdp, start, end, steps, holdMs);
    await sleep(150);
    const result = {
      dragged: {
        from: start.target,
        to: end.target,
        mode: selectedMode,
        steps,
        syntheticFallback: false,
      },
      ...(start.coordinateSpace || end.coordinateSpace
        ? { coordinateSpace: start.coordinateSpace || end.coordinateSpace }
        : {}),
    };
    const verifyMs = resolveVerifyMs(body, settings);
    if (verifyMs != null) {
      const changed = await captureVerifyDiff(s, verifyMs);
      if (changed != null) return { ...result, changed };
    }
    return { ...result, next: `chromux snapshot ${session} --diff` };
  }

  if (routePath === '/click' && method === 'POST') {
    const { session, selector, xy, button = 'left', clicks = 1, space = 'css' } = body;
    if (!session) throw httpErr(400, 'session required');
    const s = getSession(sessions, session);
    touchSession(s);
    const finishClick = actionFinisher(port, sessions, session, s, browserState, settings);
    const routed = selector ? resolveOopifRef(s, selector) : null;
    if (routed) {
      await s.cdp.send('Page.bringToFront', {});
      const result = await clickOopifRef(s, selector, routed, button, clicks);
      await sleep(150);
      const verifyMs = resolveVerifyMs(body, settings);
      if (verifyMs != null) {
        const changed = await captureVerifyDiff(s, verifyMs, selector);
        if (changed != null) return finishClick({ ...result, changed });
      }
      return finishClick({ ...result, next: `chromux snapshot ${session} --diff` });
    }
    if (xy) {
      const [inputX, inputY] = xy.map(Number);
      if (!Number.isFinite(inputX) || !Number.isFinite(inputY)) throw httpErr(400, 'xy must contain numeric x/y');
      const clickCount = Number.isFinite(Number(clicks)) ? Number(clicks) : 1;
      await s.cdp.send('Page.bringToFront', {});
      let coordinateSpace = null;
      let x = inputX;
      let y = inputY;
      if (space === 'image') {
        coordinateSpace = s.lastImageCoordinateSpace;
        if (!coordinateSpace) ({ coordinateSpace } = await captureCoordinateSpace(s.cdp));
        ({ x, y } = pointToCss(inputX, inputY, space, coordinateSpace));
      } else if (space !== 'css') {
        throw httpErr(400, `Unknown coordinate space "${space}"; use css or image`);
      }
      const viewport = coordinateSpace?.cssViewport || (await s.cdp.send('Runtime.evaluate', {
        expression: '({width: window.innerWidth, height: window.innerHeight})',
        returnByValue: true,
      })).result?.value;
      const { width, height } = viewport || {};
      if (x < 0 || y < 0 || x >= width || y >= height) {
        throw httpErr(400, `xy outside viewport: [${x}, ${y}] not within ${width}x${height}`);
      }
      await s.cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed', x, y, button, buttons: mouseButtonMask(button), clickCount, pointerType: 'mouse',
      });
      await s.cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased', x, y, button, buttons: 0, clickCount, pointerType: 'mouse',
      });
      await sleep(100);
      const xyVerifyMs = resolveVerifyMs(body, settings);
      const clicked = {
        xy: [inputX, inputY],
        space,
        css: [x, y],
        button,
        clicks: clickCount,
      };
      if (xyVerifyMs != null) {
        const changed = await captureVerifyDiff(s, xyVerifyMs);
        if (changed != null) return finishClick({ clicked, ...(coordinateSpace ? { coordinateSpace } : {}), changed });
      }
      return finishClick({ clicked, ...(coordinateSpace ? { coordinateSpace } : {}), next: `chromux snapshot ${session} --diff` });
    }
    if (!selector && !body.text) throw httpErr(400, 'selector, text, or xy required');
    // --text fallback: resolve by visible label when @refs went stale after a
    // re-render. Ambiguity is an error that lists the candidates.
    const finderJs = selector
      ? `
        const el = deepQuery(${JSON.stringify(refToSelector(selector))});
        if (!el) throw new Error('Element not found: ' + ${JSON.stringify(refToSelector(selector))});
        return el;`
      : `
        const needle = ${JSON.stringify(String(body.text))}.trim().toLowerCase();
        const matches = [];
        let scanned = 0;
        const labelOf = (node) => {
          const aria = node.getAttribute && node.getAttribute('aria-label');
          if (aria) return aria.trim().replace(/\\s+/g, ' ');
          // input.value is a label only for button-shaped inputs; a text
          // field whose TYPED value matches must not become a click target.
          if (node.tagName === 'INPUT') {
            return /^(button|submit|reset)$/.test(node.type) ? (node.value || '').trim() : (node.getAttribute('aria-label') || '');
          }
          return (node.innerText || '').trim().replace(/\\s+/g, ' ');
        };
        const collect = (doc) => {
          for (const node of doc.querySelectorAll('a[href],button,input,select,textarea,[role="button"],[role="link"],[role="tab"],[role="menuitem"],[onclick],[data-ct-listener]')) {
            if (scanned++ >= 3000 || matches.length > 12) return;
            if (!deepVisible(node)) continue;
            const label = labelOf(node).toLowerCase();
            if (!label) continue;
            if (label === needle) matches.push({ node, label: labelOf(node), exact: true });
            else if (label.includes(needle)) matches.push({ node, label: labelOf(node), exact: false });
          }
          for (const frame of doc.querySelectorAll('iframe,frame')) {
            try { if (frame.contentDocument) collect(frame.contentDocument); } catch {}
          }
        };
        collect(document);
        const exact = matches.filter(m => m.exact);
        // Substring matches on huge containers (an [onclick] card wrapper
        // whose section text merely CONTAINS the needle) would center-click
        // an arbitrary child — keep only tightly-labeled, innermost matches.
        let pool = exact.length ? exact : matches.filter(m => m.label.length <= 100);
        pool = pool.filter(m => !pool.some(o => o !== m && m.node.contains(o.node)));
        if (!pool.length) throw new Error('No clickable element with text ' + JSON.stringify(${JSON.stringify(String(body.text))}) + '; try snapshot --grep to locate it');
        if (pool.length > 1) {
          const list = pool.slice(0, 8).map(m => m.node.tagName.toLowerCase() + (m.node.id ? '#' + m.node.id : '') + ' "' + m.label.slice(0, 60) + '"').join('; ');
          throw new Error('Text matches ' + pool.length + ' elements — use a selector/@ref or a longer text: ' + list);
        }
        return pool[0].node;`;
    const targetLabel = selector || `text:${String(body.text)}`;
    await s.cdp.send('Page.bringToFront', {});
    const r = await s.cdp.send('Runtime.evaluate', {
      expression: `((sel) => {
        ${DEEP_QUERY_JS}
        function describe(node) {
          if (!node || node.nodeType !== 1) return String(node);
          const id = node.id ? '#' + node.id : '';
          const cls = node.className && typeof node.className === 'string'
            ? '.' + node.className.trim().split(/\\s+/).filter(Boolean).slice(0, 3).join('.')
            : '';
          return node.tagName.toLowerCase() + id + cls;
        }
        const el = (() => { ${finderJs}
        })();
        el.scrollIntoView?.({ block: 'center', inline: 'center' });
        const view = el.ownerDocument.defaultView || window;
        const rect = el.getBoundingClientRect();
        if (!deepVisible(el)) throw new Error('Click target is not interactable: ' + sel);
        // Local (own-frame) coordinates for hit-testing…
        const lx = rect.left + rect.width / 2;
        const ly = rect.top + rect.height / 2;
        if (lx < 0 || ly < 0 || lx >= view.innerWidth || ly >= view.innerHeight) {
          throw new Error('Click target outside viewport after scroll: ' + sel);
        }
        // …tested in the element's own root so shadow content retargets
        // correctly and frame content is checked against its own document.
        const rootNode = el.getRootNode();
        const hitBase = rootNode.elementFromPoint ? rootNode : el.ownerDocument;
        const hit = hitBase.elementFromPoint(lx, ly);
        if (!hit) throw new Error('Click target has no element at click point: ' + sel);
        if (hit !== el && !el.contains(hit) && !hit.contains(el)) {
          throw new Error('Click target is covered: ' + sel + ' hit ' + describe(hit));
        }
        // CDP input events use top-viewport coordinates: add each ancestor
        // frame's offset (border and padding shift the inner viewport) up to
        // the top window.
        let x = lx;
        let y = ly;
        let w = view;
        let outermostFrame = null;
        while (w !== w.parent && w.frameElement) {
          const frameEl = w.frameElement;
          const fr = frameEl.getBoundingClientRect();
          let padLeft = 0;
          let padTop = 0;
          try {
            const fcs = frameEl.ownerDocument.defaultView.getComputedStyle(frameEl);
            padLeft = parseFloat(fcs.paddingLeft) || 0;
            padTop = parseFloat(fcs.paddingTop) || 0;
          } catch {}
          x += fr.left + frameEl.clientLeft + padLeft;
          y += fr.top + frameEl.clientTop + padTop;
          outermostFrame = frameEl;
          w = w.parent;
        }
        if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) {
          throw new Error('Click target outside top viewport (scroll its frame into view): ' + sel);
        }
        // A frame-local hit test cannot see top-document overlays covering
        // the frame; confirm the top document still exposes the frame at the
        // final click point.
        if (outermostFrame) {
          const topHit = document.elementFromPoint(x, y);
          if (topHit && topHit !== outermostFrame && !outermostFrame.contains(topHit) && !topHit.contains(outermostFrame)) {
            throw new Error('Click target is covered by a top-page element: ' + sel + ' hit ' + describe(topHit));
          }
        }
        return {
          x,
          y,
          hit: describe(hit),
          opaqueFrame: /^(IFRAME|FRAME)$/.test(el.tagName) && (() => {
            try { return !el.contentDocument; } catch { return true; }
          })(),
        };
      })(${JSON.stringify(targetLabel)})`,
      returnByValue: true, awaitPromise: false,
    });
    if (r.exceptionDetails) {
      // First line only: page-side finder errors carry a JS stack that is
      // noise in a CLI error message.
      const desc = (r.exceptionDetails.exception?.description || 'click failed').split('\n')[0];
      throw httpErr(400, desc);
    }
    const point = r.result?.value;
    if (point) {
      const clickCount = Number.isFinite(Number(clicks)) ? Number(clicks) : 1;
      await s.cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', x: point.x, y: point.y, button: 'none', pointerType: 'mouse',
      });
      // Entering an OOPIF can require one renderer turn before Chrome routes
      // the following press into the child. Settle the move instead of
      // duplicating the click, which could trigger the child control twice.
      if (point.opaqueFrame) await sleep(100);
      await s.cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed', x: point.x, y: point.y, button, buttons: mouseButtonMask(button), clickCount, pointerType: 'mouse',
      });
      await s.cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased', x: point.x, y: point.y, button, buttons: 0, clickCount, pointerType: 'mouse',
      });
    }
    await sleep(500);
    const clickedValue = selector || { text: body.text };
    const verifyMs = resolveVerifyMs(body, settings);
    if (verifyMs != null) {
      const changed = await captureVerifyDiff(s, verifyMs);
      if (changed != null) return finishClick({ clicked: clickedValue, changed });
    }
    return finishClick({ clicked: clickedValue, next: `chromux snapshot ${session} --diff` });
  }

  if (routePath === '/fill' && method === 'POST') {
    const { session, selector, text, files } = body;
    const s = getSession(sessions, session);
    touchSession(s);
    const actionStart = Date.now();
    const routed = selector ? resolveOopifRef(s, selector) : null;
    if (routed) {
      if (Array.isArray(files) && files.length) throw httpErr(400, 'OOPIF file fill is not supported');
      if (body.pick != null) throw httpErr(400, 'OOPIF fill --pick is not supported; use fill and a fresh snapshot');
      const result = await fillOopifRef(s, selector, routed, text);
      const verifyMs = resolveVerifyMs(body, settings);
      if (verifyMs != null) {
        const changed = await captureVerifyDiff(s, verifyMs, selector);
        if (changed != null) return withDialogNote(s, actionStart, { ...result, changed });
      }
      return withDialogNote(s, actionStart, { ...result, next: `chromux snapshot ${session} --diff` });
    }
    const sel = refToSelector(selector);
    // File upload path: resolve the input element to an objectId and hand the
    // local paths to Chrome via DOM.setFileInputFiles (no synthetic dialogs).
    if (Array.isArray(files) && files.length) {
      const found = await s.cdp.send('Runtime.evaluate', {
        expression: `((sel) => {
          ${DEEP_QUERY_JS}
          const el = deepQuery(sel);
          if (!el) throw new Error('Element not found: ' + sel);
          if (el.tagName !== 'INPUT' || el.type !== 'file') throw new Error('Not a file input: ' + sel + ' (' + el.tagName.toLowerCase() + ')');
          return el;
        })(${JSON.stringify(sel)})`,
        returnByValue: false, awaitPromise: false,
      });
      if (found.exceptionDetails) throw httpErr(400, found.exceptionDetails.exception?.description || 'upload target not found');
      const objectId = found.result?.objectId;
      if (!objectId) throw httpErr(400, `Upload target did not resolve: ${sel}`);
      await s.cdp.send('DOM.setFileInputFiles', { files, objectId });
      // Chrome sets the files without firing framework-visible events.
      await s.cdp.send('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: `function () {
          this.dispatchEvent(new Event('input', { bubbles: true }));
          this.dispatchEvent(new Event('change', { bubbles: true }));
        }`,
      }, 3000).catch(() => {});
      const names = files.map(f => path.basename(f));
      const verifyUploadMs = resolveVerifyMs(body, settings);
      if (verifyUploadMs != null) {
        const changed = await captureVerifyDiff(s, verifyUploadMs, selector);
        if (changed != null) return withDialogNote(s, actionStart, { filled: selector, files: names, changed });
      }
      return withDialogNote(s, actionStart, { filled: selector, files: names, next: `chromux snapshot ${session} --diff` });
    }
    const wantsPick = body.pick != null && body.pick !== '';
    // --pick correctness: a suggestion must have APPEARED after typing. Mark
    // the candidates already visible now so a static nav/list item whose text
    // matches the pick can never win the race against the real popup.
    if (wantsPick) await markPreFillPickCandidates(s);
    const r = await s.cdp.send('Runtime.evaluate', {
      expression: `((sel, txt) => {
        ${DEEP_QUERY_JS}
        const el = deepQuery(sel);
        if (!el) throw new Error('Element not found: ' + sel);
        el.focus();
        // Constructors and prototypes must come from the element's own realm,
        // or elements inside same-origin iframes fail instanceof/setter paths.
        const view = el.ownerDocument.defaultView || window;
        if (el.isContentEditable) {
          const selection = view.getSelection();
          const range = el.ownerDocument.createRange();
          range.selectNodeContents(el);
          selection.removeAllRanges();
          selection.addRange(range);
          return { contenteditable: true };
        }
        if (!('value' in el)) throw new Error('Element is not fillable: ' + sel);
        if (el.tagName === 'SELECT') {
          const opts = Array.from(el.options);
          const match = opts.find(o => o.value === txt)
            || opts.find(o => o.textContent.trim() === txt)
            || opts.find(o => o.textContent.trim().toLowerCase() === txt.toLowerCase());
          if (!match) {
            const known = opts.slice(0, 20).map(o => o.value + ' (' + o.textContent.trim() + ')').join(', ');
            throw new Error('No option matching "' + txt + '" in ' + sel + '. Options: ' + known);
          }
          const selectSetter = Object.getOwnPropertyDescriptor(view.HTMLSelectElement.prototype, 'value')?.set;
          if (selectSetter) selectSetter.call(el, match.value);
          else el.value = match.value;
          el.dispatchEvent(new view.Event('input', { bubbles: true }));
          el.dispatchEvent(new view.Event('change', { bubbles: true }));
          return { value: el.value, selectedLabel: match.textContent.trim() };
        }
        const proto = el.tagName === 'TEXTAREA' ? view.HTMLTextAreaElement.prototype : view.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
          || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
        if (setter) setter.call(el, txt);
        else el.value = txt;
        try {
          el.dispatchEvent(new view.InputEvent('input', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: txt,
          }));
        } catch {
          el.dispatchEvent(new view.Event('input', { bubbles: true, cancelable: true }));
        }
        el.dispatchEvent(new view.Event('change', { bubbles: true }));
        return { value: el.value };
      })(${JSON.stringify(sel)}, ${JSON.stringify(text)})`,
      returnByValue: true, awaitPromise: false,
    });
    if (r.exceptionDetails) {
      // A failed fill must not leave pick markers behind: stale
      // data-ct-pick-seen on reused suggestion nodes would break the NEXT
      // genuine pick on this page.
      if (wantsPick) await cleanupPickMarks(s);
      throw httpErr(400, (r.exceptionDetails.exception?.description || 'fill failed').split('\n')[0]);
    }
    let fillDetails = {};
    if (r.result?.value?.contenteditable) {
      await s.cdp.send('Page.bringToFront', {});
      await s.cdp.send('Input.insertText', { text });
      const observed = await s.cdp.send('Runtime.evaluate', {
        expression: `((sel) => {
          ${DEEP_QUERY_JS}
          const el = deepQuery(sel);
          if (!el || !el.isContentEditable) throw new Error('Contenteditable target changed during fill: ' + sel);
          return { observedText: el.innerText, contenteditable: true };
        })(${JSON.stringify(sel)})`,
        returnByValue: true,
      });
      if (observed.exceptionDetails) {
        throw httpErr(400, (observed.exceptionDetails.exception?.description || 'contenteditable fill verification failed').split('\n')[0]);
      }
      fillDetails = observed.result?.value || { contenteditable: true };
      if (fillDetails.observedText !== text) {
        throw httpErr(400, `Contenteditable fill was rejected: expected ${JSON.stringify(text)}, observed ${JSON.stringify(fillDetails.observedText ?? '')}`);
      }
    }
    let picked = null;
    let pickEffect = null;
    if (wantsPick) ({ picked, pickEffect } = await pickSuggestion(s, sel, selector, text, body));
    const verifyMs = resolveVerifyMs(body, settings);
    const buildResult = (extra) => {
      const result = { filled: selector, text, ...fillDetails, ...extra };
      if (picked != null) {
        result.picked = picked;
        if (pickEffect) result.pickEffect = pickEffect;
      }
      return withDialogNote(s, actionStart, result);
    };
    if (verifyMs != null) {
      const changed = await captureVerifyDiff(s, verifyMs, selector);
      if (changed != null) return buildResult({ changed });
    }
    return buildResult({ next: `chromux snapshot ${session} --diff` });
  }

  if (routePath === '/type' && method === 'POST') {
    const { session, text } = body;
    if (!session || text == null) throw httpErr(400, 'session and text required');
    const s = getSession(sessions, session);
    touchSession(s);
    await s.cdp.send('Page.bringToFront', {});
    await typeFocusedText(s.cdp, text);
    const verifyMs = resolveVerifyMs(body, settings);
    if (verifyMs != null) {
      const changed = await captureVerifyDiff(s, verifyMs);
      if (changed != null) return { typed: text, changed };
    }
    return { typed: text, next: `chromux snapshot ${session} --diff` };
  }

  if (routePath === '/press' && method === 'POST') {
    const { session, key } = body;
    if (!session || !key) throw httpErr(400, 'session and key required');
    const s = getSession(sessions, session);
    touchSession(s);
    const finishPress = actionFinisher(port, sessions, session, s, browserState, settings);
    await pressKey(s.cdp, key);
    const verifyMs = resolveVerifyMs(body, settings);
    if (verifyMs != null) {
      const changed = await captureVerifyDiff(s, verifyMs);
      if (changed != null) return finishPress({ pressed: key, changed });
    }
    return finishPress({ pressed: key, next: `chromux snapshot ${session} --diff` });
  }

  // First-class download: set browser download behavior, trigger via element
  // click or direct URL, then wait for Browser.downloadProgress completion.
  if (routePath === '/download' && method === 'POST') {
    const { session, selector, url: fileUrl, timeoutMs = 60000, to } = body;
    if (!session || (!selector && !fileUrl)) throw httpErr(400, 'session and (selector or url) required');
    const s = getSession(sessions, session);
    touchSession(s);
    if (!browserState?.ensureDownloadBehavior) throw httpErr(503, 'Downloads need the daemon browser-level CDP connection');
    await browserState.ensureDownloadBehavior();
    const downloadDir = browserState.downloadPath;
    const before = new Set(browserState.downloads.keys());
    let guid = null;
    let record = null;
    try {
      if (selector) {
        const sel = refToSelector(selector);
        const r = await s.cdp.send('Runtime.evaluate', {
          expression: `((sel) => {
            ${DEEP_QUERY_JS}
            const el = deepQuery(sel);
            if (!el) throw new Error('Element not found: ' + sel);
            el.click();
            return true;
          })(${JSON.stringify(sel)})`,
          returnByValue: true, awaitPromise: false,
        });
        if (r.exceptionDetails) throw httpErr(400, r.exceptionDetails.exception?.description || 'download trigger failed');
      } else {
        // Navigating to a downloadable resource aborts the navigation
        // (net::ERR_ABORTED) while the download proceeds — that is expected.
        await s.cdp.send('Page.navigate', { url: fileUrl }).catch(() => {});
      }
      const deadline = Date.now() + Math.min(Math.max(Number(timeoutMs) || 60000, 1000), 600000);
      while (Date.now() <= deadline) {
        const started = [...browserState.downloads.keys()].filter(g => !before.has(g));
        if (started.length > 1) {
          throw httpErr(409, `The trigger started ${started.length} downloads at once — download them one at a time`);
        }
        if (started.length === 1) {
          guid = started[0];
          record = browserState.downloads.get(guid);
          if (record.state !== 'inProgress') break;
        }
        await sleep(150);
      }
    } finally {
      // Restore profile-wide download behavior as soon as the wait ends so a
      // headed profile's manual downloads are only redirected while a chromux
      // download is actually in flight.
      await browserState.restoreDownloadBehavior();
    }
    if (!record) throw httpErr(408, 'No download started before timeout — the click/url may not trigger a download');
    if (record.state !== 'completed') throw httpErr(408, `Download did not complete (state: ${record.state || 'inProgress'})`);
    const savedAs = path.join(downloadDir, guid);
    let destDir = browserState.downloadPath;
    if (to) {
      const resolvedTo = path.resolve(to);
      const allowedBases = ['/tmp', '/private/tmp', os.tmpdir(), os.homedir()];
      if (!allowedBases.some(base => pathWithinBase(resolvedTo, base))) {
        throw httpErr(400, `Download path not allowed: ${resolvedTo}`);
      }
      fs.mkdirSync(resolvedTo, { recursive: true });
      destDir = resolvedTo;
    }
    const suggested = path.basename(record.suggestedFilename || guid);
    const ext = path.extname(suggested);
    const stem = path.basename(suggested, ext);
    let dest = path.join(destDir, suggested);
    for (let i = 2; fs.existsSync(dest); i++) dest = path.join(destDir, `${stem}-${i}${ext}`);
    try {
      fs.renameSync(savedAs, dest);
    } catch {
      fs.copyFileSync(savedAs, dest);
      fs.unlinkSync(savedAs);
    }
    browserState.downloads.delete(guid);
    return { downloaded: path.basename(dest), path: dest, bytes: fs.statSync(dest).size, url: record.url };
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
    const waitGone = !isTextWait && body.gone === true;
    const routed = !isTextWait ? resolveOopifRef(s, selector) : null;
    let lastError = null;
    while (Date.now() <= deadline) {
      const expression = isTextWait
        ? textIncludesExpression(needle)
        : waitGone
          ? selectorGoneExpression(routed?.selector || needle)
          : selectorVisibleExpression(routed?.selector || needle);
      const targets = routed
        ? [routed.child]
        : isTextWait && s.oopif?.enabled
          ? [null, ...s.oopif.children.values()]
          : [null];
      let matched = false;
      for (const child of targets) {
        if (child) await child.ready;
        const r = await s.cdp.send('Runtime.evaluate', {
          expression,
          returnByValue: true,
        }, Math.min(timeout + 1000, 30000), child?.sessionId || null);
        if (r.exceptionDetails) {
          lastError = r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'wait evaluation failed';
          continue;
        }
        if (r.result?.value === true) {
          matched = true;
          break;
        }
      }
      if (matched) {
        if (isTextWait) return { foundText: needle, timeoutMs: timeout, ...(s.oopif?.enabled ? { searchedOopif: true } : {}) };
        return waitGone
          ? { goneSelector: needle, timeoutMs: timeout, ...(routed ? { frame: oopifNamespace(routed.child) } : {}) }
          : { foundSelector: needle, timeoutMs: timeout, ...(routed ? { frame: oopifNamespace(routed.child) } : {}) };
      }
      await sleep(100);
    }
    if (lastError) throw httpErr(400, lastError);
    if (waitGone) throw httpErr(408, `selector still visible after timeout ${timeout}ms: ${needle}`);
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
    const { session, path: savePath, region, ref, space = 'css' } = body;
    const s = getSession(sessions, session);
    touchSession(s);
    if (isHeadless) await s.cdp.send('Page.bringToFront');
    let captured = null;
    let inputCoordinateSpace = null;
    let output = null;
    let crop = null;
    if (region || ref) {
      if (region && ref) throw httpErr(400, 'Use either screenshot --region or --ref, not both');
      let cssRect;
      if (ref) {
        cssRect = await resolveDeepElementRect(s.cdp, ref, 'Screenshot');
        // Ref resolution may scroll a reachable offscreen element into view.
        // Capture viewport and scroll metadata only after that movement.
        captured = await captureCoordinateSpace(s.cdp);
      } else {
        if (space === 'image') inputCoordinateSpace = s.lastImageCoordinateSpace;
        captured = await captureCoordinateSpace(s.cdp);
        const values = region.map(Number);
        if (values.length !== 4 || values.some(value => !Number.isFinite(value))) {
          throw httpErr(400, 'region must contain numeric x, y, width, and height');
        }
        let [x, y, width, height] = values;
        if (width <= 0 || height <= 0) throw httpErr(400, 'screenshot region width and height must be positive');
        if (space === 'image') {
          const sourceSpace = inputCoordinateSpace || captured.coordinateSpace;
          const start = pointToCss(x, y, space, sourceSpace);
          const end = pointToCss(x + width - 1, y + height - 1, space, sourceSpace);
          x = start.x;
          y = start.y;
          width = end.x - start.x + sourceSpace.imageToCss.scaleX;
          height = end.y - start.y + sourceSpace.imageToCss.scaleY;
        } else if (space !== 'css') {
          throw httpErr(400, `Unknown coordinate space "${space}"; use css or image`);
        }
        cssRect = { x, y, width, height };
      }
      const vv = captured.coordinateSpace.visualViewport;
      const left = Math.max(vv.offsetLeft, cssRect.x);
      const top = Math.max(vv.offsetTop, cssRect.y);
      const right = Math.min(vv.offsetLeft + vv.width, cssRect.x + cssRect.width);
      const bottom = Math.min(vv.offsetTop + vv.height, cssRect.y + cssRect.height);
      if (right <= left || bottom <= top) throw httpErr(400, 'Screenshot crop is outside the visible viewport');
      const visibleRect = { x: left, y: top, width: right - left, height: bottom - top };
      const scroll = captured.coordinateSpace.scroll;
      const clipped = await s.cdp.send('Page.captureScreenshot', {
        format: 'png',
        clip: {
          x: scroll.x + visibleRect.x,
          y: scroll.y + visibleRect.y,
          width: visibleRect.width,
          height: visibleRect.height,
          scale: 1,
        },
      }, 30000);
      output = Buffer.from(clipped.data, 'base64');
      crop = {
        source: ref ? 'ref' : 'region',
        ...(ref ? { ref } : { requested: region, space }),
        cssRect: visibleRect,
        clipped: visibleRect.x !== cssRect.x || visibleRect.y !== cssRect.y
          || visibleRect.width !== cssRect.width || visibleRect.height !== cssRect.height,
      };
    } else {
      captured = await captureCoordinateSpace(s.cdp);
      output = captured.buffer;
    }
    const p = savePath || `/tmp/chromux-${session}-${Date.now()}.png`;
    let resolved;
    try {
      resolved = resolveSafeArtifactPath(p, 'Screenshot');
    } catch (error) {
      throw httpErr(400, error.message);
    }
    fs.writeFileSync(resolved, output);
    const image = pngDimensions(output);
    const coordinateSpace = crop
      ? mapImageCoordinateSpace(captured.coordinateSpace, image, crop.cssRect, crop.source)
      : captured.coordinateSpace;
    s.lastImageCoordinateSpace = coordinateSpace;
    return {
      path: resolved,
      image,
      coordinateSpace,
      ...(crop ? { crop: { ...crop, image } } : {}),
    };
  }

  if (routePath === '/scroll' && method === 'POST') {
    const { session, direction } = body;
    const s = getSession(sessions, session);
    touchSession(s);
    s.lastImageCoordinateSpace = null;
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
    let pageInfo = null;
    let cleanup = null;
    if (s) {
      try {
        pageInfo = await readPageInfo(port, s.targetId, s.cdp, settings);
        knowledgeHint = siteKnowledgeHintForUrl(pageInfo.url);
      } catch {}
      const oopifBefore = s.oopif?.enabled ? oopifSummary(s) : null;
      const transport = await s.cdp.closeAndWait();
      const oopifAfter = disposeOopifRouting(s);
      if (oopifBefore) cleanup = { oopif: { before: oopifBefore, after: oopifAfter }, transport };
      await closeTab(port, s.targetId).catch(() => {});
      sessions.delete(session);
    }
    const result = { closed: session };
    if (pageInfo?.url) result.url = pageInfo.url;
    if (pageInfo?.title) result.title = pageInfo.title;
    if (knowledgeHint) result.knowledgeHint = knowledgeHint;
    if (cleanup) result.cleanup = cleanup;
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
      s.cdp.off('Network.loadingFinished');
      // Don't disable Network in headless mode (needed for UA override)
      if (!isHeadless) { try { await s.cdp.send('Network.disable'); } catch {} }
      delete s._netBuf;
      delete s._netPending;
      delete s._netOn;
      // The off() calls above also wiped the network-idle inflight tracker's
      // listeners; clear its state so the next waitFor network-idle re-arms
      // instead of reading a frozen counter.
      delete s._inflightOn;
      delete s._inflight;
      delete s._lastNetActivity;
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

  throw httpErr(404, `Not found: ${method} ${routePath}. Known routes: POST /open /run /eval /cdp /click /hover /drag /fill /type /press /screenshot /scroll /scroll-until /wait /wait-for-text /console /network /stop, GET /health /list /snapshot/<session> /show/<session>, DELETE /session/<session>`);
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
  let dialog = null;
  let oopif = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--background' || arg === '--no-focus') {
      background = true;
      continue;
    }
    if (arg === '--foreground') {
      background = false;
      continue;
    }
    if (arg === '--oopif') {
      oopif = true;
      continue;
    }
    if (arg === '--dialog') {
      const value = args[i + 1];
      if (value !== 'accept' && value !== 'dismiss') {
        console.error('Usage: chromux open <session> <url> [--dialog accept|dismiss]');
        process.exit(1);
      }
      dialog = value;
      i++;
      continue;
    }
    out.push(arg);
  }
  const parsed = { session: out[0], url: out[1], background };
  if (dialog) parsed.dialog = dialog;
  if (oopif) parsed.oopif = true;
  return parsed;
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

function externalOpenerCommand(url, platform = process.platform) {
  if (platform === 'darwin') return { command: 'open', args: [url] };
  if (platform === 'win32') return { command: 'cmd.exe', args: ['/c', 'start', '', url] };
  return { command: 'xdg-open', args: [url] };
}

function openExternal(url) {
  const opener = externalOpenerCommand(url);
  return spawn(opener.command, opener.args, { detached: true, stdio: 'ignore' }).unref();
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
        cdpPort: port,
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

async function cmdPs(args = []) {
  const json = args.includes('--json');
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
        const list = await cliReq('GET', '/list', null, runtime.daemonEndpoint, 5000);
        tabs = String(Object.keys(list).length);
      } catch {}
    }

    // Check daemon status via endpoint state + health.
    // "idle" = no daemon endpoint yet (daemon lazy-starts on first tab command) — not a failure.
    // "stale" = endpoint state exists but /health fails (daemon crashed, needs cleanup).
    // "ok"   = endpoint state exists and /health succeeds.
    let daemon = 'idle';
    if (runtime.daemonEndpoint) {
      try {
        await cliReq('GET', '/health', null, runtime.daemonEndpoint, 2000);
        daemon = 'ok';
      } catch { daemon = 'stale'; }
    }

    const paused = fs.existsSync(profileStopPath(name));
    const resources = cdpOk ? profileResourceSnapshot(name) : null;
    rows.push({
      profile: name,
      port: runtime.port || null,
      pid: runtime.pid,
      status: cdpOk ? 'running' : 'locked',
      reason: runtime.reason || null,
      tabs,
      daemon,
      paused,
      launchMode: runtime.launchMode || null,
      resources,
    });
  }

  if (json) {
    const totals = rows.reduce((acc, row) => {
      acc.profiles += 1;
      if (row.status === 'running') acc.running += 1;
      if (row.status === 'locked') acc.locked += 1;
      if (row.paused) acc.paused += 1;
      if (row.daemon === 'stale') acc.staleDaemons += 1;
      return acc;
    }, { profiles: 0, running: 0, locked: 0, paused: 0, staleDaemons: 0 });
    console.log(JSON.stringify({
      ok: true,
      generatedAt: new Date().toISOString(),
      chromuxHome: CHROMUX_HOME,
      totals,
      profiles: rows,
    }, null, 2));
    return;
  }

  if (rows.length === 0) {
    console.log('No running profiles.');
  } else {
    // Table output
    console.log('PROFILE'.padEnd(20) + 'PORT'.padEnd(8) + 'PID'.padEnd(10) + 'STATUS'.padEnd(12) + 'DAEMON'.padEnd(8) + 'TABS');
    for (const r of rows) {
      console.log(
        r.profile.padEnd(20) +
        String(r.port || '-').padEnd(8) +
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

function terminateProcess(pid, force = false) {
  if (!isProcessAlive(pid)) return;
  try {
    process.kill(pid, force ? 'SIGKILL' : 'SIGTERM');
    return;
  } catch {}
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(pid), force ? '/F' : '', '/T'].filter(Boolean), {
      stdio: 'ignore',
    });
  }
}

// ---- Site knowledge notes (write side of the learning loop) ----

function normalizeNoteHost(raw) {
  const fromUrl = hostFromUrl(raw);
  const host = fromUrl || String(raw || '').replace(/^www\./, '').trim().toLowerCase();
  if (!host || !host.includes('.') || !VALID_NAME.test(host.replace(/\./g, '_'))) return null;
  return host;
}

async function cmdNote(args) {
  const skillsRoot = path.join(CHROMUX_HOME, 'skills');
  if (!args[0]) {
    let hosts = [];
    try {
      hosts = fs.readdirSync(skillsRoot).filter(h => siteKnowledgePathsForHost(h).length);
    } catch {}
    if (!hosts.length) {
      console.log('No site notes yet. Add one: chromux note <host> --add "durable finding"');
      return;
    }
    for (const h of hosts.sort()) {
      console.log(h);
      for (const p of siteKnowledgePathsForHost(h)) console.log(`  ${p}`);
    }
    return;
  }
  const host = normalizeNoteHost(args[0]);
  if (!host) { console.error(`Invalid host: ${args[0]}. Use a hostname like naver.com`); process.exit(1); }
  const addIdx = args.indexOf('--add');
  if (addIdx >= 0) {
    const text = args[addIdx + 1];
    if (!text || !text.trim()) { console.error('--add requires note text'); process.exit(1); }
    const fIdx = args.indexOf('--file');
    const fileName = fIdx >= 0 ? args[fIdx + 1] : 'notes.md';
    if (!fileName || !fileName.endsWith('.md') || !VALID_NAME.test(fileName.replace(/\./g, '_'))) {
      console.error(`Invalid note file name: ${fileName}. Use a simple name ending in .md`);
      process.exit(1);
    }
    const dir = path.join(skillsRoot, host);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, fileName);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, `# ${host}\n\nDurable, non-secret site notes. Surfaced by \`chromux open\` on ${host} pages (and subdomains).\n\n`);
    }
    fs.appendFileSync(filePath, `- ${text.trim()} (${new Date().toISOString().slice(0, 10)})\n`);
    console.log(JSON.stringify({ host, path: displayChromuxPath(filePath), added: text.trim() }, null, 2));
    return;
  }
  // Show notes for the host, including parent-domain notes.
  const notes = readSiteNotesForHostChain(host);
  for (const note of notes) console.log(`# ${note.label}\n${note.content}\n`);
  if (!notes.length) console.log(`No notes for ${host}. Add one: chromux note ${host} --add "durable finding"`);
}

// ---- Saved action scripts CLI (list, show, save, rm) ----

function requireScriptLabel(raw, usage) {
  const ref = parseScriptLabel(raw);
  if (!ref) {
    console.error(`Invalid script label "${raw || ''}". Use <host>/<name>, e.g. naver.com/search-extract`);
    console.error(usage);
    process.exit(1);
  }
  return ref;
}

async function cmdScript(args) {
  const usage = 'Usage: chromux script [<host> | show <host>/<name> | save <host>/<name> (--file PATH|-) | rm <host>/<name>]';
  const sub = args[0];

  if (!sub) {
    let hosts = [];
    try {
      hosts = fs.readdirSync(SCRIPTS_DIR).filter(h => listScriptsForHost(h).length);
    } catch {}
    if (!hosts.length) {
      console.log('No saved scripts yet. Save one: chromux script save <host>/<name> --file flow.js');
      return;
    }
    for (const h of hosts.sort()) {
      console.log(h);
      for (const name of listScriptsForHost(h)) {
        console.log(`  ${h}/${name} -> ${displayChromuxPath(scriptPathFor(h, name))}`);
      }
    }
    return;
  }

  if (sub === 'save') {
    const ref = requireScriptLabel(args[1], usage);
    let code;
    const fileArg = takeFlagValue(args, '--file', { required: 'a path' });
    if (fileArg) code = fs.readFileSync(fileArg, 'utf8');
    else if (args.includes('-')) code = fs.readFileSync(0, 'utf8');
    if (code == null || !code.trim()) {
      console.error('script save requires code via --file PATH or stdin (-)');
      process.exit(1);
    }
    const filePath = scriptPathFor(ref.host, ref.name);
    const existed = fs.existsSync(filePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(filePath, code.endsWith('\n') ? code : `${code}\n`, { mode: 0o600 });
    console.log(JSON.stringify({
      script: ref.label,
      path: displayChromuxPath(filePath),
      bytes: Buffer.byteLength(code),
      updated: existed,
      replay: `chromux run <session> --script ${ref.label}`,
    }, null, 2));
    return;
  }

  if (sub === 'show') {
    const ref = requireScriptLabel(args[1], usage);
    const filePath = resolveScriptPath(ref);
    if (!filePath) {
      console.error(`No script "${ref.label}". Save one: chromux script save ${ref.label} --file flow.js`);
      process.exit(1);
    }
    console.log(fs.readFileSync(filePath, 'utf8'));
    return;
  }

  if (sub === 'rm') {
    const ref = requireScriptLabel(args[1], usage);
    const filePath = scriptPathFor(ref.host, ref.name);
    if (!fs.existsSync(filePath)) {
      console.error(`No script "${ref.label}" at ${displayChromuxPath(filePath)}`);
      process.exit(1);
    }
    fs.unlinkSync(filePath);
    console.log(JSON.stringify({ script: ref.label, removed: true }, null, 2));
    return;
  }

  // `chromux script <host>` — list scripts for the host, including parents.
  const host = normalizeNoteHost(sub);
  if (!host) {
    console.error(`Unknown script subcommand or host: ${sub}`);
    console.error(usage);
    process.exit(1);
  }
  const scripts = listScriptsForHostChain(host);
  if (!scripts.length) {
    console.log(`No scripts for ${host}. Save one: chromux script save ${host}/<name> --file flow.js`);
    return;
  }
  for (const s of scripts) {
    console.log(`${s.label} -> ${displayChromuxPath(s.path)}`);
    console.log(`  replay: chromux run <session> --script ${s.label}`);
  }
}

// After close/kill, if this session/profile hit failures on hosts that have no
// site notes yet, point at `chromux note` once. The raw material (per-command
// ok/error events) is already in the activity log; this closes the loop.
function printFailureLearningReminder(profile, session = null) {
  try {
    const cutoff = Date.now() - 6 * 60 * 60 * 1000;
    const relevant = readActivityEvents({ prune: false }).filter(e =>
      e.profile === profile
      && (!session || e.session === session)
      && Date.parse(e.timestamp) >= cutoff);
    const failures = relevant.filter(e => e.ok === false);
    if (!failures.length) return;
    const hosts = [...new Set(relevant.map(e => e.host).filter(Boolean))];
    const noteless = hosts.filter(h =>
      !siteKnowledgeHostChain(h).some(p => siteKnowledgePathsForHost(p).length));
    if (!noteless.length) return;
    const scope = session ? `session "${session}"` : `profile "${profile}"`;
    console.error(`note: ${failures.length} failed command${failures.length === 1 ? '' : 's'} in recent ${scope} on ${noteless.join(', ')} — if you learned durable site behavior, save it: chromux note ${noteless[0]} --add "..."`);
  } catch {}
}

async function cmdKill(profileName) {
  // Stop daemon first
  const st = readState(profileName);
  const endpoint = daemonEndpointFromState(st);
  try { await cliReq('POST', '/stop', {}, endpoint); } catch {}
  if (st?.sock) {
    try { await cliReq('POST', '/stop', {}, legacySocketEndpoint(st.sock)); } catch {}
  }

  const pids = new Set();
  if (st && isProcessAlive(st.pid)) pids.add(st.pid);
  for (const proc of findProfileProcesses(profileName)) {
    if (isProcessAlive(proc.pid)) pids.add(proc.pid);
  }
  for (const pid of pids) {
    terminateProcess(pid, false);
  }
  const deadline = Date.now() + 3000;
  while ([...pids].some(pid => isProcessAlive(pid)) && Date.now() < deadline) {
    await sleep(100);
  }
  for (const pid of pids) {
    if (isProcessAlive(pid)) {
      terminateProcess(pid, true);
    }
  }
  clearState(profileName);
  try { fs.unlinkSync(sockPath(profileName)); } catch {}
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
// CLI client (talks to the profile daemon endpoint)
// ============================================================

/** Remove `<flag> <value>` from args and return the value (null when absent). */
function takeFlagValue(args, flag, { required = 'a value' } = {}) {
  const idx = args.indexOf(flag);
  if (idx < 0) return null;
  const value = args[idx + 1];
  if (value == null) { console.error(`${flag} requires ${required}`); process.exit(1); }
  args.splice(idx, 2);
  return value;
}

/** Remove `--timeout <ms>` from args and return the parsed number (undefined when absent). */
function takeTimeoutFlag(args) {
  const raw = takeFlagValue(args, '--timeout', { required: 'a millisecond value' });
  return raw == null ? undefined : parseInt(raw);
}

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
  const timeoutMs = takeTimeoutFlag(args);
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
    // Wrapping in an IIFE makes a trailing standalone expression evaluate to
    // undefined, so scripts like `var x = ...; JSON.stringify(x)` print
    // nothing. Recover REPL behavior by returning the trailing expression.
    const hasReturn = /\breturn\b/.test(code);
    const auto = hasReturn ? null : autoReturnLastExpression(code);
    if (auto) {
      code = auto;
    } else {
      code = `(async () => { ${code} })()`;
      if (!hasReturn) {
        console.error('note: eval script was wrapped in an IIFE; use `return <value>` (or end with a standalone expression) to print a result.');
      }
    }
  }
  const httpTimeout = (timeoutMs ? timeoutMs : 30000) + 5000;
  return cliReq('POST', '/eval', { session, code, timeoutMs }, sock, httpTimeout);
}

// Best-effort REPL semantics for auto-wrapped eval scripts: if the script ends
// with a standalone expression statement, return its value from the IIFE.
// Returns the wrapped code, or null when the trailer is not clearly an
// expression or the rewrite does not parse.
const EVAL_STATEMENT_KEYWORDS = new Set([
  'return', 'const', 'let', 'var', 'if', 'else', 'for', 'while', 'do',
  'switch', 'case', 'try', 'catch', 'finally', 'function', 'class', 'throw',
  'break', 'continue', 'import', 'export',
]);
function autoReturnLastExpression(code) {
  const isStatementKeyword = (s) => {
    const w = s.match(/^[A-Za-z_$][A-Za-z0-9_$]*/)?.[0];
    return Boolean(w && EVAL_STATEMENT_KEYWORDS.has(w));
  };
  const lines = String(code).replace(/\s+$/, '').split('\n');
  let i = lines.length - 1;
  while (i >= 0 && (!lines[i].trim() || /^\s*\/\//.test(lines[i]))) i--;
  if (i < 0) return null;
  let head = lines.slice(0, i).join('\n');
  let last = lines[i].trim().replace(/;+$/, '');
  if (!last) return null;
  // One-line scripts like `var x = ...; JSON.stringify(x)`: peel statements off
  // the front so the trailer after the final `;` becomes the returned value.
  if (isStatementKeyword(last) && last.includes(';')) {
    const cut = last.lastIndexOf(';');
    const trailer = last.slice(cut + 1).trim();
    if (!trailer || isStatementKeyword(trailer)) return null;
    head = head ? `${head}\n${last.slice(0, cut + 1)}` : last.slice(0, cut + 1);
    last = trailer;
  } else if (isStatementKeyword(last)) {
    return null;
  }
  const candidate = `(async () => { ${head}\nreturn (${last}); })()`;
  // A parse check guards against mangling multi-line statements or strings
  // containing `;` — on any doubt we fall back to the plain IIFE wrap.
  try { new Function(`return ${candidate}`); return candidate; } catch { return null; }
}

function redactReceiptValue(value, key = '', depth = 0) {
  const lowerKey = String(key || '').toLowerCase();
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (/^(url|href)$/i.test(key)) {
      return redactReceiptUrl(value);
    }
    if (/^(title|host|hostname|status|statusText|method|session|profile|mode|failureKind|reason)$/i.test(key)) {
      return value;
    }
    return {
      type: 'string',
      length: value.length,
      sha256: sha256Text(value).slice(0, 16),
    };
  }
  if (Array.isArray(value)) {
    if (depth >= 3) return { type: 'array', length: value.length };
    return value.slice(0, 20).map(item => redactReceiptValue(item, key, depth + 1));
  }
  if (typeof value === 'object') {
    if (depth >= 3) return { type: 'object', keys: Object.keys(value).slice(0, 20) };
    const out = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      const childLower = childKey.toLowerCase();
      if (/(authorization|cookie|token|secret|password|passwd|credential|code|text|html|value|body|content)/.test(childLower)) {
        out[childKey] = redactReceiptValue(String(childValue ?? ''), childKey, depth + 1);
        continue;
      }
      out[childKey] = redactReceiptValue(childValue, childKey, depth + 1);
    }
    if (lowerKey && /(authorization|cookie|token|secret|password|credential)/.test(lowerKey)) {
      return { redacted: true };
    }
    return out;
  }
  return { type: typeof value };
}

function redactReceiptUrl(value) {
  const text = String(value);
  try {
    const parsed = new URL(text);
    if (!parsed.search && !parsed.hash) return text;
    if (parsed.search) {
      const query = [];
      for (const [key, paramValue] of parsed.searchParams.entries()) {
        query.push(`${encodeURIComponent(key)}=[sha256:${sha256Text(paramValue).slice(0, 8)};len:${String(paramValue).length}]`);
      }
      parsed.search = query.join('&');
    }
    if (parsed.hash) {
      parsed.hash = '#[redacted]';
    }
    return parsed.toString();
  } catch {
    return {
      type: 'string',
      length: text.length,
      sha256: sha256Text(text).slice(0, 16),
    };
  }
}

function buildRunReceipt({ session, codeSource, timeoutMs, startedAt, endedAt, result, error }) {
  return {
    schema: 'chromux.run-receipt.v1',
    ok: !error,
    generatedAt: new Date().toISOString(),
    profile: getProfile(),
    mode: getMode(),
    session,
    timeoutMs: timeoutMs || null,
    codeSource,
    codeStored: false,
    startedAt: new Date(startedAt).toISOString(),
    endedAt: new Date(endedAt).toISOString(),
    durationMs: endedAt - startedAt,
    resultSummary: error ? null : redactReceiptValue(result, 'result'),
    error: error ? {
      message: error.message,
      failureKind: classifyBatchFailure(error).failureKind,
      retryable: classifyBatchFailure(error).retryable,
    } : null,
    redaction: {
      inlineCode: 'not stored',
      rawTypedText: 'not stored',
      secrets: 'string values under sensitive keys are redacted',
    },
  };
}

// Resolve a `--file` path, falling back to the chromux install directory so
// bundled snippets (e.g. snippets/_builtin/form-flow.js) work from any cwd.
function resolveRunFilePath(p) {
  if (fs.existsSync(p)) return path.resolve(p);
  const bundled = path.join(MODULE_DIR, p);
  if (!path.isAbsolute(p) && fs.existsSync(bundled)) return bundled;
  return path.resolve(p);
}

function readCodeArg(args, usage) {
  const timeoutMs = takeTimeoutFlag(args);
  const receiptPath = takeFlagValue(args, '--receipt', { required: 'a path' });
  const session = args[0];
  if (!session) { console.error(usage); process.exit(1); }
  let code;
  let codeSource = { kind: 'inline' };
  const fIdx = args.indexOf('--file');
  if (fIdx >= 0) {
    const p = args[fIdx + 1];
    if (!p) { console.error('--file requires a path'); process.exit(1); }
    const resolved = resolveRunFilePath(p);
    code = fs.readFileSync(resolved, 'utf8');
    codeSource = { kind: 'file', path: resolved };
  } else if (args[1] === '-') {
    code = fs.readFileSync(0, 'utf8');
    codeSource = { kind: 'stdin' };
  } else {
    code = args[1];
  }
  if (code == null) { console.error('No code provided'); process.exit(1); }
  return { session, code, timeoutMs, receiptPath, codeSource };
}

// Collect repeated `--arg key=value` flags into the object exposed to run
// code as `args`. Values that parse as JSON (objects, arrays, numbers,
// booleans, null) are passed structured; everything else stays a string.
function takeRunArgFlags(args) {
  const out = {};
  let i;
  while ((i = args.indexOf('--arg')) !== -1) {
    const kv = args[i + 1];
    const eq = kv ? kv.indexOf('=') : -1;
    if (eq <= 0) { console.error('--arg requires key=value (repeatable)'); process.exit(1); }
    args.splice(i, 2);
    const raw = kv.slice(eq + 1);
    let value = raw;
    if (/^(\{|\[|"|-?\d|true$|false$|null$)/.test(raw)) {
      try { value = JSON.parse(raw); } catch { value = raw; }
    }
    out[kv.slice(0, eq)] = value;
  }
  return out;
}

async function cmdRun(args, sock) {
  let session;
  let code;
  let timeoutMs;
  let receiptPath = null;
  let codeSource;
  const runArgs = takeRunArgFlags(args);
  const schemaPath = takeFlagValue(args, '--schema', { required: 'a JSON schema path' });
  const scriptLabel = takeFlagValue(args, '--script', { required: 'a <host>/<name> script label' });
  if (scriptLabel) {
    const ref = requireScriptLabel(scriptLabel, 'Usage: chromux run <session> --script <host>/<name> [--timeout MS] [--receipt PATH] [--schema PATH]');
    const scriptFile = resolveScriptPath(ref);
    if (!scriptFile) {
      console.error(`No script "${ref.label}". List scripts: chromux script ${ref.host}`);
      process.exit(1);
    }
    receiptPath = takeFlagValue(args, '--receipt', { required: 'a path' });
    timeoutMs = takeTimeoutFlag(args);
    session = args[0];
    if (!session) { console.error('Usage: chromux run <session> --script <host>/<name> [--timeout MS] [--receipt PATH] [--schema PATH]'); process.exit(1); }
    code = fs.readFileSync(scriptFile, 'utf8');
    codeSource = { kind: 'script', label: ref.label, path: scriptFile };
  } else if (args.includes('--page-file')) {
    receiptPath = takeFlagValue(args, '--receipt', { required: 'a path' });
    const p = takeFlagValue(args, '--page-file', { required: 'a path' });
    const pageCode = fs.readFileSync(p, 'utf8');
    timeoutMs = takeTimeoutFlag(args);
    session = args[0];
    if (!session) { console.error('Usage: chromux run <session> --page-file PATH [--timeout MS] [--receipt PATH]'); process.exit(1); }
    code = `return await js(${JSON.stringify(pageCode)});`;
    codeSource = { kind: 'page-file', path: path.resolve(p) };
  } else {
    ({ session, code, timeoutMs, receiptPath, codeSource } = readCodeArg(args, 'Usage: chromux run <session> <code|--file PATH|--page-file PATH|-> [--timeout MS] [--receipt PATH]'));
  }
  const httpTimeout = (timeoutMs ? timeoutMs : 30000) + 5000;
  const startedAt = Date.now();
  const writeReceipt = (result, error) => {
    if (!receiptPath) return;
    const receipt = buildRunReceipt({ session, codeSource, timeoutMs, startedAt, endedAt: Date.now(), result, error });
    writeSafeJsonArtifact(receiptPath, receipt, 'run receipt');
  };
  let result;
  try {
    result = await cliReq('POST', '/run', { session, code, timeoutMs, args: runArgs }, sock, httpTimeout);
  } catch (error) {
    writeReceipt(null, error);
    decorateScriptReplayError(error, codeSource);
    throw error;
  }
  const schemaErrors = schemaPath ? validateAgainstSchemaFile(result, schemaPath) : [];
  if (schemaErrors.length) {
    const error = new Error(schemaMismatchMessage(schemaPath, schemaErrors, result));
    writeReceipt(null, error);
    decorateScriptReplayError(error, codeSource);
    throw error;
  }
  writeReceipt(result, null);
  recordScriptReplayResult(codeSource, true);
  return result;
}

// When a saved-script replay fails, point the calling agent back at the
// script so it can repair and re-save it — the agent is the self-healing LLM.
// Both replay failure paths (thrown error and schema mismatch) funnel here, so
// this is also where a contradicted result is recorded for the memory loop.
function decorateScriptReplayError(error, codeSource) {
  if (codeSource?.kind !== 'script') return;
  recordScriptReplayResult(codeSource, false);
  error.message += `\nscript: ${codeSource.label} (${codeSource.path})`
    + `\nhint: saved-script replay failed — snapshot the page to see its current state, fix the flow, then update it: chromux script save ${codeSource.label} --file <fixed.js>`;
}

// ---- Zero-dependency JSON Schema subset validator (run --schema) ----
//
// Supports the practical subset agents need for extraction contracts:
// type (incl. arrays of types), enum, const, required, properties,
// additionalProperties:false, items, minItems/maxItems, minLength/maxLength,
// pattern, minimum/maximum. Unknown keywords are ignored.

function jsonTypeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function validateJsonSchema(value, schema, at = '$', errors = []) {
  if (schema === true || schema == null || typeof schema !== 'object') return errors;
  const fail = message => errors.push({ path: at, message });
  const actual = jsonTypeOf(value);

  if (schema.type) {
    const types = [].concat(schema.type);
    const matches = types.some(t => t === 'integer'
      ? (actual === 'number' && Number.isInteger(value))
      : t === actual);
    if (!matches) {
      fail(`expected type ${types.join('|')}, got ${actual}`);
      return errors;
    }
  }
  if (schema.enum && !schema.enum.some(option => JSON.stringify(option) === JSON.stringify(value))) {
    fail(`expected one of ${JSON.stringify(schema.enum)}, got ${JSON.stringify(value)}`);
  }
  if (schema.const !== undefined && JSON.stringify(schema.const) !== JSON.stringify(value)) {
    fail(`expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);
  }
  if (actual === 'string') {
    if (Number.isFinite(schema.minLength) && value.length < schema.minLength) fail(`string shorter than minLength ${schema.minLength}`);
    if (Number.isFinite(schema.maxLength) && value.length > schema.maxLength) fail(`string longer than maxLength ${schema.maxLength}`);
    if (schema.pattern && !(new RegExp(schema.pattern)).test(value)) fail(`string does not match pattern ${schema.pattern}`);
  }
  if (actual === 'number') {
    if (Number.isFinite(schema.minimum) && value < schema.minimum) fail(`number below minimum ${schema.minimum}`);
    if (Number.isFinite(schema.maximum) && value > schema.maximum) fail(`number above maximum ${schema.maximum}`);
  }
  if (actual === 'array') {
    if (Number.isFinite(schema.minItems) && value.length < schema.minItems) fail(`array shorter than minItems ${schema.minItems}`);
    if (Number.isFinite(schema.maxItems) && value.length > schema.maxItems) fail(`array longer than maxItems ${schema.maxItems}`);
    if (schema.items) {
      value.forEach((item, i) => validateJsonSchema(item, schema.items, `${at}[${i}]`, errors));
    }
  }
  if (actual === 'object') {
    for (const key of schema.required || []) {
      if (!(key in value)) fail(`missing required property "${key}"`);
    }
    if (schema.properties) {
      for (const [key, childSchema] of Object.entries(schema.properties)) {
        if (key in value) validateJsonSchema(value[key], childSchema, `${at}.${key}`, errors);
      }
    }
    if (schema.additionalProperties === false) {
      const known = new Set(Object.keys(schema.properties || {}));
      for (const key of Object.keys(value)) {
        if (!known.has(key)) fail(`unexpected additional property "${key}"`);
      }
    }
  }
  return errors;
}

function validateAgainstSchemaFile(result, schemaPath) {
  let schema;
  try {
    schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  } catch (err) {
    console.error(`Cannot read schema ${schemaPath}: ${err.message}`);
    process.exit(1);
  }
  return validateJsonSchema(result, schema);
}

function schemaMismatchMessage(schemaPath, schemaErrors, result) {
  const preview = JSON.stringify(result);
  const clipped = preview && preview.length > 2000 ? `${preview.slice(0, 2000)}…` : preview;
  return `Result does not match schema ${schemaPath}:\n`
    + schemaErrors.map(e => `- ${e.path}: ${e.message}`).join('\n')
    + `\nresult: ${clipped}`;
}

function getBatchArg(args, flag, fallback = null) {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : fallback;
}

function batchNumberArg(args, flag, fallback, { min = 0 } = {}) {
  const raw = getBatchArg(args, flag, String(fallback));
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.floor(n));
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

function batchHost(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return 'unknown';
  }
}

async function waitForBatchHost(hostState, host) {
  const state = hostState.get(host);
  if (!state?.nextAvailableAt) return;
  const waitMs = state.nextAvailableAt - Date.now();
  if (waitMs > 0) await sleep(waitMs);
}

function noteBatchHostSuccess(hostState, host) {
  if (!host) return;
  const state = hostState.get(host) || {};
  state.consecutiveFailures = 0;
  state.nextAvailableAt = 0;
  hostState.set(host, state);
}

function noteBatchHostFailure(hostState, host, hostBackoffMs, failureKind) {
  if (!host || hostBackoffMs <= 0) return;
  const state = hostState.get(host) || { consecutiveFailures: 0, failureKinds: {} };
  state.consecutiveFailures = (state.consecutiveFailures || 0) + 1;
  state.failureKinds[failureKind] = (state.failureKinds[failureKind] || 0) + 1;
  const multiplier = Math.min(8, state.consecutiveFailures);
  state.nextAvailableAt = Date.now() + hostBackoffMs * multiplier;
  hostState.set(host, state);
}

function classifyBatchFailure(err) {
  const message = String(err?.message || err || '');
  const lower = message.toLowerCase();
  let failureKind = 'unknown';
  let retryable = false;
  if (/does not match schema/.test(lower)) {
    failureKind = 'schema_mismatch';
    retryable = false;
  } else if (/timeout|timed out|handler timeout/.test(lower)) {
    failureKind = 'timeout';
    retryable = true;
  } else if (/resource guard/.test(lower)) {
    failureKind = 'resource_guard';
    retryable = true;
  } else if (/queue is full|operation queue/.test(lower)) {
    failureKind = 'queue_full';
    retryable = true;
  } else if (/unresponsive|websocket closed|websocket error|cdp unreachable|daemon endpoint unavailable|socket hang up|econnreset/.test(lower)) {
    failureKind = 'session_unresponsive';
    retryable = true;
  } else if (/net::|navigation|cannot reach|enotfound|econnrefused|err_name_not_resolved/.test(lower)) {
    failureKind = 'navigation';
    retryable = true;
  } else if (/http|status|not found|forbidden|unauthorized|server error/.test(lower)) {
    failureKind = 'http_or_page';
    retryable = false;
  }
  return { failureKind, retryable, message };
}

function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * q)));
  return sorted[idx];
}

async function cmdBatch(args, sock) {
  const filePath = getBatchArg(args, '--file');
  const outPath = getBatchArg(args, '--out');
  const workers = batchNumberArg(args, '--workers', 4, { min: 1 });
  const limit = batchNumberArg(args, '--limit', 0, { min: 0 });
  const retries = batchNumberArg(args, '--retries', 1, { min: 0 });
  const hostBackoffMs = batchNumberArg(args, '--host-backoff-ms', 250, { min: 0 });
  const retryBackoffMs = batchNumberArg(args, '--retry-backoff-ms', 250, { min: 0 });
  const prefix = getBatchArg(args, '--session-prefix', `batch-${Date.now().toString(36)}`);
  if (!filePath && !args.includes('-')) {
    console.error('Usage: chromux batch --file urls.txt [--workers N] [--retries N] [--host-backoff-ms MS] [--out results.jsonl] [--limit N] [--session-prefix P]');
    process.exit(1);
  }
  const records = readBatchRecords(filePath, limit);
  if (outPath) fs.writeFileSync(outPath, '');
  const queue = [...records];
  const results = [];
  const hostState = new Map();
  const startedAt = Date.now();
  const writeResult = (record) => {
    results.push(record);
    if (outPath) fs.appendFileSync(outPath, JSON.stringify(record) + '\n');
  };

  const worker = async (workerId) => {
    const session = `${prefix}-${workerId}`;
    while (queue.length > 0) {
      const item = queue.shift();
      const started = Date.now();
      const host = batchHost(item.url);
      const result = {
        workerId,
        session,
        url: item.url,
        host,
        input: item,
        ok: false,
        attempts: 0,
        retryable: false,
        failureKind: null,
        durationMs: 0,
        queuedRemainingAtStart: queue.length,
      };
      for (let attempt = 1; attempt <= retries + 1; attempt++) {
        result.attempts = attempt;
        await waitForBatchHost(hostState, host);
        try {
          const opened = await cliReq('POST', '/open', { session, url: item.url, background: true }, sock, defaultCliTimeoutMs());
          const pageInfo = await cliReq('POST', '/run', {
            session,
            code: `return await page('({url:location.href,title:document.title,textLength:(document.body?document.body.innerText.length:0),htmlLength:(document.documentElement?document.documentElement.outerHTML.length:0)})')`,
            timeoutMs: 15_000,
          }, sock, 20_000);
          result.ok = Boolean(pageInfo?.url) && Number(pageInfo?.htmlLength || 0) > 0;
          result.opened = opened;
          result.page = pageInfo;
          if (!result.ok) {
            const pageError = new Error(`Page result did not meet batch success contract: title=${pageInfo?.title || ''} htmlLength=${pageInfo?.htmlLength || 0}`);
            const classified = classifyBatchFailure(pageError);
            result.failureKind = classified.failureKind === 'unknown' ? 'http_or_page' : classified.failureKind;
            result.retryable = false;
            result.error = pageError.message;
          } else {
            noteBatchHostSuccess(hostState, host);
            result.failureKind = null;
            result.retryable = false;
            delete result.error;
          }
        } catch (err) {
          const classified = classifyBatchFailure(err);
          result.error = classified.message;
          result.failureKind = classified.failureKind;
          result.retryable = classified.retryable;
          noteBatchHostFailure(hostState, host, hostBackoffMs, classified.failureKind);
          if (classified.retryable && attempt <= retries) {
            await sleep(retryBackoffMs * attempt);
            continue;
          }
        }
        break;
      }
      result.durationMs = Date.now() - started;
      writeResult(result);
    }
    await cliReq('DELETE', `/session/${encodeURIComponent(session)}`, null, sock).catch(() => {});
  };

  await Promise.all(Array.from({ length: workers }, (_, i) => worker(i)));
  const durations = results.map(r => r.durationMs).sort((a, b) => a - b);
  const failureKinds = {};
  for (const result of results) {
    if (result.ok) continue;
    const key = result.failureKind || 'unknown';
    failureKinds[key] = (failureKinds[key] || 0) + 1;
  }
  return {
    total: results.length,
    ok: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length,
    workers,
    retries,
    retryCount: results.reduce((sum, r) => sum + Math.max(0, (r.attempts || 1) - 1), 0),
    hostBackoffMs,
    out: outPath || null,
    durationMs: Date.now() - startedAt,
    p50DurationMs: quantile(durations, 0.50),
    p95DurationMs: quantile(durations, 0.95),
    failureKinds,
    hosts: [...hostState.entries()].map(([host, state]) => ({
      host,
      consecutiveFailures: state.consecutiveFailures || 0,
      failureKinds: state.failureKinds || {},
      nextAvailableAt: state.nextAvailableAt || 0,
    })),
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
  const timeoutMs = takeTimeoutFlag(args);
  let params = {};
  const paramsFile = takeFlagValue(args, '--params-file', { required: 'a path' });
  if (paramsFile) {
    params = parseJsonArg(fs.readFileSync(paramsFile, 'utf8'), '--params-file');
  } else if (args[2]) {
    params = parseJsonArg(args[2], 'params-json');
  }
  const httpTimeout = (timeoutMs ? timeoutMs : 30000) + 5000;
  return cliReq('POST', '/cdp', { session, method: cdpMethod, params, timeoutMs }, sock, httpTimeout);
}

// click/fill/type/press verify their own effect by default: the response
// carries the post-action diff, so acting and verifying is one round-trip.
// `--verify MS` tunes the settle wait; `--no-verify` opts out entirely.
// Returns undefined (daemon default), a number, or false (explicitly off).
function takeVerifyFlag(args) {
  const noIdx = args.indexOf('--no-verify');
  if (noIdx !== -1) { args.splice(noIdx, 1); return false; }
  const i = args.indexOf('--verify');
  if (i === -1) return undefined;
  const next = args[i + 1];
  const ms = next != null && /^\d+$/.test(next) ? Number(next) : null;
  args.splice(i, ms != null ? 2 : 1);
  return ms ?? 300;
}

function takeCoordinateSpace(args) {
  const idx = args.indexOf('--space');
  if (idx === -1) return 'css';
  const space = args[idx + 1];
  if (space !== 'css' && space !== 'image') {
    console.error('Invalid --space. Use css or image.');
    process.exit(1);
  }
  args.splice(idx, 2);
  return space;
}

// On-demand deep guides: the main SKILL.md is paid as input on every agent
// turn, so topic depth lives here and loads only when a task needs it.
function cmdSkillTopic(args) {
  const topicsDir = path.join(MODULE_DIR, 'skills', 'chromux', 'topics');
  let topics = [];
  try {
    topics = fs.readdirSync(topicsDir).filter(f => f.endsWith('.md')).map(f => f.slice(0, -3)).sort();
  } catch {}
  const topic = args[0];
  if (!topic) {
    console.log(JSON.stringify({
      topics,
      usage: 'chromux skill <topic> prints the deep guide for that topic',
    }, null, 2));
    return;
  }
  const file = path.join(topicsDir, `${path.basename(topic)}.md`);
  if (!topics.includes(path.basename(topic)) || !fs.existsSync(file)) {
    console.error(`Unknown skill topic "${topic}". Available: ${topics.join(', ') || '(none found)'}`);
    process.exit(1);
  }
  console.log(fs.readFileSync(file, 'utf8'));
}

async function cmdClick(args, sock) {
  const verify = takeVerifyFlag(args);
  const space = takeCoordinateSpace(args);
  const session = args[0];
  if (!session) { console.error('Usage: chromux click <session> (@ref|selector|--text "label"|--xy X Y) [--verify [MS]]'); process.exit(1); }
  const textIdx = args.indexOf('--text');
  if (textIdx !== -1) {
    const text = args[textIdx + 1];
    if (!text) { console.error('Usage: chromux click <session> --text "visible label"'); process.exit(1); }
    return cliReq('POST', '/click', { session, text, verify }, sock);
  }
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
      space,
      verify,
    }, sock);
  }
  return cliReq('POST', '/click', { session, selector: args[1], verify }, sock);
}

function coordinateTargetFromArgs(args, xyFlag, selectorValue, space) {
  const xyIdx = args.indexOf(xyFlag);
  if (xyIdx >= 0) {
    const x = Number(args[xyIdx + 1]);
    const y = Number(args[xyIdx + 2]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      console.error(`${xyFlag} requires numeric X Y`);
      process.exit(1);
    }
    return { xy: [x, y], space };
  }
  return selectorValue ? { selector: selectorValue } : null;
}

async function cmdHover(args, sock) {
  const verify = takeVerifyFlag(args);
  const space = takeCoordinateSpace(args);
  const session = args[0];
  const target = coordinateTargetFromArgs(args, '--xy', args[1], space);
  if (!session || !target) {
    console.error('Usage: chromux hover <session> (@ref|selector|--xy X Y) [--space css|image] [--verify [MS]]');
    process.exit(1);
  }
  return cliReq('POST', '/hover', { session, ...target, verify }, sock);
}

async function cmdDrag(args, sock) {
  const verify = takeVerifyFlag(args);
  const space = takeCoordinateSpace(args);
  const session = args[0];
  const from = coordinateTargetFromArgs(args, '--xy', args[1], space);
  const toSelectorIdx = args.indexOf('--to');
  const to = coordinateTargetFromArgs(
    args,
    '--to-xy',
    toSelectorIdx >= 0 ? args[toSelectorIdx + 1] : null,
    space,
  );
  const modeIdx = args.indexOf('--drag-mode');
  const mode = modeIdx >= 0 ? args[modeIdx + 1] : 'auto';
  const stepsIdx = args.indexOf('--steps');
  const holdIdx = args.indexOf('--hold-ms');
  const steps = stepsIdx >= 0 ? Number(args[stepsIdx + 1]) : undefined;
  const holdMs = holdIdx >= 0 ? Number(args[holdIdx + 1]) : undefined;
  if (!session || !from || !to || !['auto', 'pointer', 'html5'].includes(mode)
    || (steps != null && !Number.isFinite(steps)) || (holdMs != null && !Number.isFinite(holdMs))) {
    console.error('Usage: chromux drag <session> (@ref|selector|--xy X Y) (--to @ref|selector|--to-xy X Y) [--space css|image] [--drag-mode auto|pointer|html5] [--steps N] [--hold-ms MS] [--verify [MS]]');
    process.exit(1);
  }
  return cliReq('POST', '/drag', { session, from, to, mode, steps, holdMs, verify }, sock);
}

async function cmdScreenshot(args, sock) {
  const space = takeCoordinateSpace(args);
  const session = args[0];
  if (!session) {
    console.error('Usage: chromux screenshot <session> [path] [--region X Y WIDTH HEIGHT | --ref @N] [--space css|image]');
    process.exit(1);
  }
  const refIdx = args.indexOf('--ref');
  const ref = refIdx >= 0 ? args[refIdx + 1] : null;
  if (refIdx >= 0) {
    if (!ref) { console.error('--ref requires @N or a selector'); process.exit(1); }
    args.splice(refIdx, 2);
  }
  const regionIdx = args.indexOf('--region');
  let region = null;
  if (regionIdx >= 0) {
    region = args.slice(regionIdx + 1, regionIdx + 5).map(Number);
    if (region.length !== 4 || region.some(value => !Number.isFinite(value))) {
      console.error('--region requires numeric X Y WIDTH HEIGHT');
      process.exit(1);
    }
    args.splice(regionIdx, 5);
  }
  if (ref && region) {
    console.error('Use either --region or --ref, not both.');
    process.exit(1);
  }
  return cliReq('POST', '/screenshot', {
    session,
    path: args[1] ? path.resolve(args[1]) : undefined,
    ref,
    region,
    space,
  }, sock, defaultCliTimeoutMs() + 5000);
}

async function cmdPress(args, sock) {
  const verify = takeVerifyFlag(args);
  const session = args[0];
  const key = args[1];
  if (!session || !key) { console.error(`Usage: chromux press <session> <${Object.keys(KEY_DEFS).join('|')}> [--verify [MS]]`); process.exit(1); }
  return cliReq('POST', '/press', { session, key, verify }, sock);
}

async function cmdWaitFor(args, sock, kind) {
  const goneIdx = args.indexOf('--gone');
  const gone = kind === 'selector' && goneIdx !== -1;
  if (goneIdx !== -1) args.splice(goneIdx, 1);
  const session = args[0];
  const needle = args[1];
  const timeoutMs = args[2] ? Number(args[2]) : 5000;
  if (!session || !needle || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    console.error(`Usage: chromux wait-for-${kind} <session> <${kind}> [timeout-ms]${kind === 'selector' ? ' [--gone]' : ''}`);
    process.exit(1);
  }
  const body = kind === 'text'
    ? { session, text: needle, timeoutMs }
    : { session, selector: needle, timeoutMs, gone };
  return cliReq('POST', `/wait-for-${kind}`, body, sock, timeoutMs + 5000);
}

// download: trigger via element click or direct URL, wait for completion.
async function cmdDownload(args, sock) {
  const session = args[0];
  if (!session) { console.error('Usage: chromux download <session> (@ref|selector|--url URL) [--to DIR] [--timeout MS]'); process.exit(1); }
  const urlIdx = args.indexOf('--url');
  const url = urlIdx >= 0 ? args[urlIdx + 1] : null;
  const toIdx = args.indexOf('--to');
  const to = toIdx >= 0 ? path.resolve(args[toIdx + 1]) : null;
  const timeoutIdx = args.indexOf('--timeout');
  const timeoutMs = timeoutIdx >= 0 ? Number(args[timeoutIdx + 1]) : 60000;
  const selector = url ? null : args[1];
  if (!selector && !url) { console.error('Usage: chromux download <session> (@ref|selector|--url URL) [--to DIR] [--timeout MS]'); process.exit(1); }
  return cliReq('POST', '/download', { session, selector, url, to, timeoutMs }, sock, timeoutMs + 10000);
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

function cliReq(method, urlPath, body, endpoint, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const normalized = typeof endpoint === 'string' ? legacySocketEndpoint(endpoint) : endpoint;
    if (!normalized) {
      reject(new Error('Daemon endpoint unavailable'));
      return;
    }
    const opts = {
      path: urlPath,
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      timeout: timeoutMs,
    };
    if (normalized.type === 'tcp') {
      opts.hostname = normalized.host || DAEMON_HOST;
      opts.port = normalized.port;
    } else {
      opts.socketPath = normalized.socketPath;
    }
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

// Probe the recorded daemon endpoint: reuse it when healthy and in the desired
// mode, otherwise stop the mismatched daemon and clear its endpoint state.
async function reuseHealthyDaemon(profileName, desiredMode) {
  const endpoint = daemonEndpointFromState(readState(profileName));
  try {
    const health = await cliReq('GET', '/health', null, endpoint, 3000);
    if (endpoint?.type === 'tcp' && (!health.mode || health.mode === desiredMode)) return endpoint;
    await cliReq('POST', '/stop', {}, endpoint, 3000).catch(() => {});
    await waitForEndpointGone(endpoint, 3000);
    clearDaemonEndpointState(profileName);
  } catch {}
  return null;
}

async function ensureDaemon(profileName) {
  const desiredMode = getMode();

  // Check if daemon already running (short timeout to fail fast)
  let endpoint = await reuseHealthyDaemon(profileName, desiredMode);
  if (endpoint) return endpoint;

  // Acquire lockfile to prevent concurrent daemon starts (CR-008)
  const lockFile = path.join(RUN_DIR, `${profileName}.lock`);
  const lockFd = await acquireLock(lockFile);
  try {
    // Re-check after lock — another process may have started it
    endpoint = await reuseHealthyDaemon(profileName, desiredMode);
    if (endpoint) return endpoint;

    // Clean up stale legacy socket only while holding the startup lock. During
    // concurrent cold-start, another CLI may be starting the daemon; deleting
    // its socket before taking the lock can produce ECONNRESET/socket hang up.
    try { fs.unlinkSync(sockPath(profileName)); } catch {}
    clearDaemonEndpointState(profileName);

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

    const daemonPort = await findFreeDaemonPort(loadConfig());
    if (!daemonPort) {
      console.error(`No free daemon port in range ${DAEMON_PORT_RANGE_START}-${DAEMON_PORT_RANGE_END}`);
      process.exit(1);
    }
    endpoint = daemonEndpointForPort(daemonPort);

    // Start daemon
    process.stderr.write(`Starting chromux daemon [${profileName}]...`);
    const child = spawn(process.execPath, [process.argv[1], '--daemon', profileName, String(port), String(daemonPort)], {
      detached: true, stdio: 'ignore',
    });
    child.unref();

    for (let i = 0; i < 50; i++) {
      await sleep(200);
      try { await cliReq('GET', '/health', null, endpoint, 3000); process.stderr.write(' ready.\n'); return endpoint; } catch {}
    }
    console.error(' daemon failed to start.');
    process.exit(1);
  } finally {
    releaseLock(lockFd, lockFile);
  }
}

async function waitForEndpointGone(endpoint, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (endpoint?.type === 'unix') {
      if (!fs.existsSync(endpoint.socketPath)) break;
    } else {
      try {
        await cliReq('GET', '/health', null, endpoint, 500);
      } catch {
        break;
      }
    }
    await sleep(100);
  }
  if (endpoint?.type === 'unix') {
    try { fs.unlinkSync(endpoint.socketPath); } catch {}
  }
}

// ============================================================
// CLI router
// ============================================================

function inferActivitySession(cmd, args) {
  if (cmd === 'open') return parseOpenArgs([...args]).session || null;
  if (cmd === 'batch' || cmd === 'ps' || cmd === 'launch' || cmd === 'kill' || cmd === 'pause' || cmd === 'resume') return null;
  return args[0] || null;
}

function sanitizeActivityArgs(cmd, args) {
  const copy = args.map(arg => String(arg));
  if (cmd === 'fill') return copy.map((arg, i) => i >= 2 ? '[redacted-text]' : arg);
  if (cmd === 'type') return copy.map((arg, i) => i >= 1 ? '[redacted-text]' : arg);
  if (cmd === 'run' || cmd === 'eval') {
    const passthroughFlags = new Set(['--file', '--page-file', '--timeout', '--receipt', '--script', '--schema']);
    return copy.map((arg, i) => {
      if (i <= 0) return arg;
      if (arg === '-' || arg === '--no-iife' || passthroughFlags.has(arg) || passthroughFlags.has(copy[i - 1])) return arg;
      return '[code]';
    });
  }
  if (cmd === 'cdp') {
    return copy.map((arg, i) => i >= 2 && copy[i - 1] !== '--params-file' && copy[i - 1] !== '--timeout' ? '[params-json]' : arg);
  }
  return copy;
}

function parseSnapshotActivityInfo(text) {
  if (typeof text !== 'string') return {};
  const lines = text.split('\n');
  const title = lines[0]?.startsWith('# ') ? lines[0].slice(2).trim() : null;
  const url = lines[1]?.startsWith('# ') ? lines[1].slice(2).trim() : null;
  return { title, url };
}

function extractActivityPageInfo(cmd, result) {
  if (cmd === 'snapshot') return parseSnapshotActivityInfo(result);
  if (!result || typeof result !== 'object') return {};
  const pageInfo = result.page && typeof result.page === 'object' ? result.page : result;
  return {
    url: pageInfo.url || pageInfo.fullUrl || result.url || result.fullUrl || null,
    title: pageInfo.title || result.title || null,
    siteKnowledgePaths: result.knowledgeHint?.paths || result.siteKnowledgePaths || null,
  };
}

function recordCliActivity({ cmd, args, profile, session, result, error, startedAt }) {
  try {
    if (cmd === 'app' || cmd === '--daemon') return;
    const pageInfo = extractActivityPageInfo(cmd, result);
    const url = pageInfo.url || null;
    const host = hostFromUrl(url) || null;
    appendActivityEvent({
      timestamp: new Date().toISOString(),
      profile: profile || DEFAULT_PROFILE,
      session: session || inferActivitySession(cmd, args),
      command: cmd,
      args: sanitizeActivityArgs(cmd, args),
      context: {
        mode: process.env.CHROMUX_MODE || 'default',
        cwd: process.cwd(),
        pid: process.pid,
      },
      task: process.env.CHROMUX_TASK || null,
      url,
      host,
      title: pageInfo.title || null,
      ok: !error,
      error: error ? error.message : null,
      durationMs: Date.now() - startedAt,
      siteKnowledgePaths: pageInfo.siteKnowledgePaths || (host ? siteKnowledgePathsForHost(host) : []),
    });
  } catch {}
}

async function runLoggedProfileCommand(cmd, args, profile, fn) {
  const startedAt = Date.now();
  try {
    const result = await fn();
    recordCliActivity({ cmd, args, profile, session: null, result, startedAt });
    return result;
  } catch (error) {
    recordCliActivity({ cmd, args, profile, session: null, error, startedAt });
    throw error;
  }
}

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
    return runLoggedProfileCommand(cmd, args, name, () => cmdLaunch(name, port, launchMode));
  }
  if (cmd === 'ps') return runLoggedProfileCommand(cmd, args, getProfile(), () => cmdPs(args));
  if (cmd === 'kill') {
    if (!args[0]) { console.error('Usage: chromux kill <profile>'); process.exit(1); }
    const r = await runLoggedProfileCommand(cmd, args, args[0], () => cmdKill(args[0]));
    printFailureLearningReminder(args[0]);
    return r;
  }
  if (cmd === 'note') return cmdNote(args);
  if (cmd === 'script') return cmdScript(args);
  if (cmd === 'skill') return cmdSkillTopic(args);
  if (cmd === 'pause') {
    const profileName = args[0] || getProfile();
    return runLoggedProfileCommand(cmd, args, profileName, () => cmdPause(profileName));
  }
  if (cmd === 'resume') {
    const profileName = args[0] || getProfile();
    return runLoggedProfileCommand(cmd, args, profileName, () => cmdResume(profileName));
  }
  if (cmd === 'app') return cmdApp(args);

  // Tab commands (need daemon)
  const profile = getProfile();
  const tabCommands = new Set([
    'show', 'open', 'snapshot', 'cdp', 'run', 'batch', 'click', 'hover', 'drag', 'fill', 'type',
    'press', 'download', 'wait-for-text', 'wait-for-selector', 'eval',
    'scroll-until', 'screenshot', 'scroll', 'wait', 'watch', 'console',
    'network', 'close', 'list', 'stop',
  ]);
  if (!tabCommands.has(cmd)) { console.error(`Unknown: ${cmd}. Run: chromux help`); process.exit(1); }

  const startedAt = Date.now();
  const session = inferActivitySession(cmd, args);
  let sock;
  try {
    sock = await ensureDaemon(profile);

    // Special: show — open DevTools in user's browser
    if (cmd === 'show') {
      if (!args[0]) { console.error('Usage: chromux show <session>'); process.exit(1); }
      const info = await cliReq('GET', `/show/${args[0]}`, null, sock);
      const url = info.devtoolsFrontendUrl;
      if (!url) { console.error('No DevTools URL available'); process.exit(1); }
      openExternal(url);
      recordCliActivity({ cmd, args, profile, session, result: info, startedAt });
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
        const grep = getArgValue(args, '--grep');
        const params = new URLSearchParams();
        if (filter) params.set('filter', filter);
        if (args.includes('--diff')) params.set('diff', '1');
        if (grep) params.set('grep', grep);
        if (args.includes('--clickable')) params.set('clickable', '1');
        const q = params.size ? `?${params}` : '';
        return cliReq('GET', `/snapshot/${args[0]}${q}`, null, sock);
      },
      cdp:        () => cmdCdp(args, sock),
      run:        () => cmdRun(args, sock),
      batch:      () => cmdBatch(args, sock),
      click:      () => cmdClick(args, sock),
      hover:      () => cmdHover(args, sock),
      drag:       () => cmdDrag(args, sock),
      fill:       () => {
        const verify = takeVerifyFlag(args);
        // fill <s> <sel> "text" --pick "label" types then chooses the
        // matching autocomplete suggestion in the same round-trip.
        let pick;
        const pickIdx = args.indexOf('--pick');
        if (pickIdx !== -1) {
          pick = args[pickIdx + 1];
          if (!pick) { console.error('Usage: chromux fill <session> <selector> "text" --pick "suggestion label"'); process.exit(1); }
          args.splice(pickIdx, 2);
        }
        // fill <s> <sel> --file PATH [--file PATH...] sets a file input
        // through DOM.setFileInputFiles instead of typing a value.
        const files = [];
        let fileIdx;
        while ((fileIdx = args.indexOf('--file')) !== -1) {
          const file = args[fileIdx + 1];
          if (!file) { console.error('Usage: chromux fill <session> <selector> (--file PATH [--file PATH...] | <text>)'); process.exit(1); }
          const resolved = path.resolve(file);
          if (!fs.existsSync(resolved)) { console.error(`Upload file not found: ${resolved}`); process.exit(1); }
          files.push(resolved);
          args.splice(fileIdx, 2);
        }
        if (files.length) {
          return cliReq('POST', '/fill', { session: args[0], selector: args[1], files, verify }, sock);
        }
        return cliReq('POST', '/fill', { session: args[0], selector: args[1], text: args[2], pick, verify }, sock);
      },
      type:       () => {
        const verify = takeVerifyFlag(args);
        return cliReq('POST', '/type', { session: args[0], text: args[1], verify }, sock);
      },
      press:      () => cmdPress(args, sock),
      download:   () => cmdDownload(args, sock),
      'wait-for-text': () => cmdWaitFor(args, sock, 'text'),
      'wait-for-selector': () => cmdWaitFor(args, sock, 'selector'),
      eval:       () => cmdEval(args, sock),
      'scroll-until': () => cmdScrollUntil(args, sock),
      screenshot: () => cmdScreenshot(args, sock),
      scroll:     () => cliReq('POST', '/scroll', { session: args[0], direction: args[1] || 'down' }, sock),
      wait:       () => cliReq('POST', '/wait', { session: args[0], ms: parseInt(args[1]) || 1000 }, sock),
      watch:      () => cmdWatch(args, sock),
      console:    () => cliReq('POST', '/console', { session: args[0], off: args.includes('--off') }, sock),
      network:    () => cliReq('POST', '/network', { session: args[0], off: args.includes('--off'), all: args.includes('--all') }, sock),
      close:      () => cliReq('DELETE', `/session/${args[0]}`, null, sock),
      list:       () => cliReq('GET', '/list', null, sock),
      stop:       () => cliReq('POST', '/stop', {}, sock),
    };

    const r = await routes[cmd]();
    recordCliActivity({ cmd, args, profile, session, result: r, startedAt });
    if (cmd === 'close') printFailureLearningReminder(profile, args[0]);
    console.log(typeof r === 'string' ? r : JSON.stringify(r, null, 2));
  } catch (e) {
    recordCliActivity({ cmd, args, profile, session, error: e, startedAt });
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
}

// ============================================================
// Companion status app
// ============================================================

function sendJson(res, status, value) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(value, null, 2));
}

function sendStatic(res, fileName, contentType) {
  const filePath = path.join(STATUS_APP_DIR, fileName);
  try {
    const body = fs.readFileSync(filePath);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    sendJson(res, 404, { ok: false, error: `Missing status app asset: ${fileName}` });
  }
}

function requireHttpName(name, label = 'name') {
  const value = String(name || '');
  if (!VALID_NAME.test(value)) throw httpErr(400, `Invalid ${label} "${value}". Use only [a-zA-Z0-9._-]`);
  return value;
}

function parseActivityScope(body) {
  const type = body.type || body.scope || 'all';
  if (type === 'all') return { type: 'all' };
  if (type === 'profile') {
    if (!body.profile) throw httpErr(400, 'profile is required for profile-scoped activity operation');
    return { type: 'profile', profile: requireHttpName(body.profile, 'profile') };
  }
  if (type === 'task') {
    if (!body.task) throw httpErr(400, 'task is required for task-scoped activity operation');
    return { type: 'task', task: String(body.task) };
  }
  throw httpErr(400, `Unsupported activity scope: ${type}`);
}

async function statusAppState() {
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    chromuxHome: CHROMUX_HOME,
    profiles: await collectProfileInventory(),
    activity: activitySnapshot(),
  };
}

function runSelfCommand(args, extraEnv = {}, timeoutMs = 60_000) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [process.argv[1], ...args], {
      cwd: process.cwd(),
      env: { ...process.env, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({ ok: false, code: null, stdout, stderr: `${stderr}\nCommand timed out after ${timeoutMs}ms`.trim() });
    }, timeoutMs);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
    child.on('error', err => {
      clearTimeout(timer);
      resolve({ ok: false, code: null, stdout: stdout.trim(), stderr: err.message });
    });
  });
}

async function performProfileAction(profileName, action) {
  validateName(profileName);
  if (action === 'launch-headed') {
    return runSelfCommand(['launch', profileName], { CHROMUX_LAUNCH_MODE: 'headed' });
  }
  if (action === 'launch-headless') {
    return runSelfCommand(['launch', profileName, '--headless']);
  }
  if (action === 'open-foreground') {
    const session = `status-${Date.now().toString(36)}`;
    return runSelfCommand(['--profile', profileName, 'open', '--foreground', session, 'about:blank'], {
      CHROMUX_LAUNCH_MODE: 'headed',
      CHROMUX_OPEN_BACKGROUND: '0',
    });
  }
  if (action === 'stop-daemon') {
    const state = readState(profileName);
    const endpoint = daemonEndpointFromState(state);
    if (!endpoint) return { ok: false, code: null, stdout: '', stderr: 'No daemon endpoint found for this profile.' };
    try {
      const result = await cliReq('POST', '/stop', {}, endpoint, 3000);
      return { ok: true, code: 0, stdout: JSON.stringify(result, null, 2), stderr: '' };
    } catch (err) {
      return { ok: false, code: null, stdout: '', stderr: err.message };
    }
  }
  if (action === 'kill') {
    return runSelfCommand(['kill', profileName]);
  }
  if (action === 'pause') {
    return runSelfCommand(['pause', profileName]);
  }
  if (action === 'resume') {
    return runSelfCommand(['resume', profileName]);
  }
  throw httpErr(400, `Unsupported profile action: ${action}`);
}

async function deleteProfile(profileName) {
  const name = requireHttpName(profileName, 'profile');
  const killResult = await performProfileAction(name, 'kill');
  fs.rmSync(profileDir(name), { recursive: true, force: true });
  for (const filePath of [
    sockPath(name),
    profileStopPath(name),
    path.join(RUN_DIR, `${name}.lock`),
  ]) {
    try { fs.unlinkSync(filePath); } catch {}
  }
  return {
    profile: name,
    ok: killResult.ok,
    killed: killResult.ok,
    removed: !fs.existsSync(profileDir(name)),
    result: killResult,
  };
}

async function deleteProfiles(profileNames) {
  if (!Array.isArray(profileNames)) throw httpErr(400, 'profiles must be an array');
  const names = [...new Set(profileNames.map(name => requireHttpName(name, 'profile')))];
  if (!names.length) throw httpErr(400, 'at least one profile is required');
  const results = [];
  for (const name of names) {
    try {
      results.push(await deleteProfile(name));
    } catch (err) {
      results.push({ profile: name, ok: false, removed: false, error: err.message });
    }
  }
  return {
    ok: results.every(result => result.ok && result.removed),
    deleted: results.filter(result => result.removed).length,
    failed: results.filter(result => !result.ok || !result.removed).length,
    results,
  };
}

async function handleStatusAppApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/state') {
    sendJson(res, 200, await statusAppState());
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/activity/config') {
    const body = await readBody(req);
    sendJson(res, 200, { ok: true, ...setActivityRetention(body.retentionDays) });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/activity/delete') {
    const body = await readBody(req);
    const result = deleteActivityEvents(parseActivityScope(body));
    sendJson(res, 200, { ok: true, ...result, activity: activitySnapshot() });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/activity/redact') {
    const body = await readBody(req);
    const result = redactActivityEvents(parseActivityScope(body));
    sendJson(res, 200, { ok: true, ...result, activity: activitySnapshot() });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/profiles/delete') {
    const body = await readBody(req);
    const result = await deleteProfiles(body.profiles);
    sendJson(res, result.ok ? 200 : 409, result);
    return true;
  }

  const actionMatch = url.pathname.match(/^\/api\/profiles\/([^/]+)\/action$/);
  if (req.method === 'POST' && actionMatch) {
    const profileName = requireHttpName(decodeURIComponent(actionMatch[1]), 'profile');
    const body = await readBody(req);
    const result = await performProfileAction(profileName, body.action);
    sendJson(res, result.ok ? 200 : 409, { ok: result.ok, action: body.action, profile: profileName, result });
    return true;
  }

  return false;
}

function createStatusAppServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    try {
      if (url.pathname.startsWith('/api/')) {
        if (await handleStatusAppApi(req, res, url)) return;
        sendJson(res, 404, { ok: false, error: `Unknown API route: ${url.pathname}` });
        return;
      }
      if (req.method !== 'GET') {
        sendJson(res, 405, { ok: false, error: 'Method not allowed' });
        return;
      }
      if (url.pathname === '/' || url.pathname === '/index.html') return sendStatic(res, 'index.html', 'text/html; charset=utf-8');
      if (url.pathname === '/app.js') return sendStatic(res, 'app.js', 'application/javascript; charset=utf-8');
      if (url.pathname === '/styles.css') return sendStatic(res, 'styles.css', 'text/css; charset=utf-8');
      sendJson(res, 404, { ok: false, error: `Not found: ${url.pathname}` });
    } catch (err) {
      sendJson(res, err.status || 500, { ok: false, error: err.message });
    }
  });
}

function assertSelfTest(condition, message, checks) {
  if (!condition) throw new Error(message);
  checks.push(message);
}

async function runStatusAppSelfTest() {
  if (!process.env.CHROMUX_HOME) throw new Error('chromux app --self-test requires CHROMUX_HOME to point at an isolated temp directory');
  fs.rmSync(ACTIVITY_DIR, { recursive: true, force: true });
  fs.rmSync(PROFILES_DIR, { recursive: true, force: true });
  fs.rmSync(RUN_DIR, { recursive: true, force: true });
  fs.mkdirSync(profileDir('alpha'), { recursive: true });
  fs.mkdirSync(profileDir('beta'), { recursive: true });

  const checks = [];
  saveActivityConfig({ retentionDays: 90 });
  const now = Date.now();
  const oldEvent = normalizeActivityEvent({
    timestamp: new Date(now - 100 * 24 * 60 * 60 * 1000).toISOString(),
    profile: 'alpha',
    session: 'old',
    command: 'open',
    url: 'https://old.example/path',
  });
  const events = [
    oldEvent,
    normalizeActivityEvent({
      timestamp: new Date(now - 1000).toISOString(),
      profile: 'alpha',
      session: 's1',
      command: 'open',
      task: 'task-a',
      url: 'https://example.com/a',
      title: 'A',
    }),
    normalizeActivityEvent({
      timestamp: new Date(now).toISOString(),
      profile: 'alpha',
      session: 's1',
      command: 'snapshot',
      task: 'task-a',
      url: 'https://example.com/a',
      title: 'A',
    }),
    normalizeActivityEvent({
      timestamp: new Date(now + 1000).toISOString(),
      profile: 'beta',
      session: 's2',
      command: 'close',
      url: 'https://example.org/b',
      title: 'B',
    }),
  ];
  writeActivityEvents(events);
  for (const event of events) updateActivityAggregates(event);
  const prune = pruneActivityEvents(now, { force: true });
  assertSelfTest(prune.removed === 1, 'retention prunes events older than configured days', checks);
  const guardedPrune = pruneActivityEvents(now + 1000);
  assertSelfTest(guardedPrune.skipped === true, 'retention pruning is guarded between daily runs', checks);
  const laterPrune = pruneActivityEvents(now + ACTIVITY_PRUNE_INTERVAL_MS + 1000);
  assertSelfTest(laterPrune.skipped === false, 'retention pruning runs again after the daily guard window', checks);
  const retained = readActivityEventsRaw();
  assertSelfTest(retained.length === 3, 'activity JSONL keeps recent events', checks);
  const timeline = buildActivityTimeline(retained);
  assertSelfTest(timeline.some(group => group.source === 'task' && group.task === 'task-a' && group.eventCount === 2), 'timeline groups Task-labeled events', checks);
  assertSelfTest(timeline.some(group => group.source === 'session-fallback' && group.derived), 'timeline creates derived session fallback groups', checks);
  const redaction = redactActivityEvents({ type: 'profile', profile: 'alpha' });
  assertSelfTest(redaction.redacted === 2, 'profile redaction removes URL and title fields', checks);
  const redacted = readActivityEventsRaw().filter(event => event.profile === 'alpha');
  assertSelfTest(redacted.every(event => event.url === null && event.title === null && event.redacted), 'redacted events keep command metadata only', checks);
  const deletion = deleteActivityEvents({ type: 'task', task: 'task-a' });
  assertSelfTest(deletion.deleted === 2, 'Task-scoped deletion removes matching raw events', checks);
  const retention = setActivityRetention('unlimited');
  assertSelfTest(retention.config.retentionDays === 'unlimited', 'retention accepts unlimited', checks);
  const winCandidates = chromePathCandidates('win32', {
    PROGRAMFILES: 'C:\\Program Files',
    'PROGRAMFILES(X86)': 'C:\\Program Files (x86)',
    LOCALAPPDATA: 'C:\\Users\\agent\\AppData\\Local',
  });
  assertSelfTest(winCandidates.some(candidate => candidate.endsWith(path.join('Google', 'Chrome', 'Application', 'chrome.exe'))), 'Windows Chrome Stable candidates are generated', checks);
  const winCommand = '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --user-data-dir="C:\\Users\\agent\\.chromux\\profiles\\alpha" --remote-debugging-port=9301';
  assertSelfTest(getCommandArgValue(winCommand, '--user-data-dir').includes('profiles\\alpha'), 'Windows command parsing preserves profile paths', checks);
  const winOpener = externalOpenerCommand('http://127.0.0.1:9340/', 'win32');
  assertSelfTest(winOpener.command === 'cmd.exe' && winOpener.args.includes('start'), 'Windows opener uses cmd start', checks);
  writeState('alpha', { pid: 123, port: 9301, cdpPort: 9301, sock: '/tmp/legacy.sock' });
  writeDaemonEndpointState('alpha', 9401);
  const alphaState = readState('alpha');
  assertSelfTest(alphaState.port === 9301 && alphaState.cdpPort === 9301 && alphaState.daemonPort === 9401, 'daemonPort is stored separately from Chrome CDP port', checks);
  assertSelfTest(!alphaState.sock && daemonEndpointFromState(alphaState)?.type === 'tcp', 'legacy daemon socket state migrates to TCP endpoint state', checks);
  clearState('alpha');
  fs.mkdirSync(profileDir('alpha'), { recursive: true });
  const inventory = await collectProfileInventory();
  assertSelfTest(inventory.some(profile => profile.name === 'alpha') && inventory.some(profile => profile.name === 'beta'), 'profile inventory lists known local profiles', checks);
  assertSelfTest(inventory.every(profile => Number.isInteger(profile.diskUsageBytes) && profile.diskUsageBytes >= 0), 'profile inventory reports per-profile disk usage bytes', checks);
  const sortedSample = [
    { name: 'stopped-profile', status: 'stopped', activeTabs: null, daemon: { status: 'idle' } },
    { name: 'active-profile', status: 'running', activeTabs: 1, daemon: { status: 'ok' } },
  ].sort(compareProfileInventory);
  assertSelfTest(sortedSample[0].name === 'active-profile', 'profile inventory sorts active profiles first', checks);
  const deleteResult = await deleteProfiles(['beta']);
  assertSelfTest(deleteResult.deleted === 1 && !fs.existsSync(profileDir('beta')), 'bulk profile deletion removes selected profile files', checks);
  const aggregates = loadActivityAggregates();
  assertSelfTest(aggregates.byCommand.open?.count >= 1, 'command aggregates survive redaction and deletion', checks);
  return { ok: true, checks };
}

async function cmdApp(args) {
  if (args.includes('--self-test')) {
    const result = await runStatusAppSelfTest();
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const portValue = getArgValue(args, '--port');
  const host = getArgValue(args, '--host') || '127.0.0.1';
  const port = portValue ? Number(portValue) : 9340;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error('Usage: chromux app [--host 127.0.0.1] [--port N] [--open]');
    process.exit(1);
  }

  const server = createStatusAppServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  }).catch(err => {
    console.error(`Failed to start chromux app: ${err.message}`);
    process.exit(1);
  });
  const address = server.address();
  const actualPort = typeof address === 'object' ? address.port : port;
  const url = `http://${host}:${actualPort}/`;
  console.log(`chromux status app: ${url}`);
  if (args.includes('--open')) {
    openExternal(url);
  }
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
// Convert the most common Playwright/Puppeteer muscle-memory mistakes inside
// `run` scripts into an immediate pointer at the actual helper surface.
const RUN_HELPER_HINT = "chromux run executes in the runner context with helpers cdp(method, params), js(pageCode), page(expr), sleep(ms), waitLoad(), waitFor(selectorOrTextOrExpression | [fallback, candidates], opts), assertPage(expr). Use js('...') to run code inside the page.";
function decorateRunError(err) {
  const msg = String(err?.message || '');
  if (msg.includes(RUN_HELPER_HINT)) return;
  if (/(?:page|browser|context)\.(?:evaluate|goto|click|type|waitForSelector|locator|\$\$?(?:eval)?)\b[\s\S]{0,40}is not a function/.test(msg)
    || /\b(?:document|window|querySelector) is not defined/.test(msg)) {
    err.message = `${msg}\nhint: ${RUN_HELPER_HINT}`;
  }
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
  chromux open <session> <url>       Create or navigate a tab (responses report the
                                     interactive-element count; small pages inline the
                                     elements with @refs so no snapshot round-trip is needed)
  chromux open --background <s> <u>  Explicitly create a background tab
  chromux open <s> <u> --dialog accept|dismiss   JS dialog auto-policy for the session
                                     (default: dismiss; beforeunload is always accepted;
                                     handled dialogs surface as "dialog" in action responses)
  chromux open <s> <u> --oopif     Opt in to cross-origin child target refs and routing
  chromux run <session> -            Multi-step async JS with cdp/js/page/waitFor/assertPage helpers
                                     (waitFor accepts [fallback, candidates] for selector/text waits)
  chromux run <session> --page-file F  Run a JS file directly in the page (no shell escaping)
  chromux run <s> --file F --arg k=v Parametrize run code: values arrive as \`args.k\`
                                     (JSON values parse, e.g. --arg fields='{"#email":"a@b.c"}')
  chromux run <session> --script <host>/<name>  Replay a saved action script (no model calls)
  chromux run <session> ... --schema s.json     Validate the run result against a JSON schema
  chromux run <session> --receipt p  Write a redacted local run receipt
  chromux batch --file urls.txt      Crawl URLs through a worker-tab pool
  chromux batch --file urls.txt --retries N --host-backoff-ms MS
  chromux cdp <session> <M> '{}'     Raw CDP method passthrough

Lifecycle:
  chromux launch [name]              Launch Chrome (default: "default")
  chromux launch <name> --headless   Launch in headless mode (no window)
  chromux launch <name> --port N     Launch with specific port
  chromux ps                         List running profiles
  chromux ps --json                  Machine-readable profile diagnostics
  chromux app [--port N]             Local profile/activity companion app
  chromux app --open                 Serve the app and open it in a browser
  chromux pause [name]               Hard-stop new tab work for a profile
  chromux resume [name]              Allow tab work again for a paused profile
  chromux kill <name>                Stop profile (Chrome + daemon)
  chromux stop                       Stop daemon (keeps Chrome)
  chromux close <session>            Close tab
  chromux list                       List active sessions

Convenience shortcuts:
  chromux snapshot <session>         Accessibility tree with @ref (refs stay stable per document)
  chromux snapshot <s> --interactive Only interactive elements (smaller payload)
  chromux snapshot <s> --diff        Only lines added/removed since the previous snapshot
  chromux snapshot <s> --grep "pat"  Only lines matching a pattern (+ ancestors for context)
  chromux snapshot <s> --clickable   Force behavior-based clickable detection (cursor/onclick
                                     divs); auto-enabled when a page has no standard elements
                                     or when clickable candidates are dense relative to them
  Snapshots, clicks, fills, and waits pierce same-origin iframes and open shadow DOM.
                                     Cross-origin frames expose an origin-only opaque ref and CSS
                                     rect; --oopif adds namespaced child refs such as @f1g1:2
                                     for snapshot/click/fill/waits. Navigation, detach, or crash invalidates refs.
                                     list reports crashedTotal; close reports drained child/CDP cleanup.
                                     --oopif uses child-target attachment and remains opt-in.
  chromux click <session> @<ref>     Click by ref number
  chromux click <session> "selector" Click by CSS selector
  chromux click <session> --text "label"   Click by visible label when refs went stale
                                     (ambiguous text fails and lists the candidates)
  chromux click <session> --xy X Y   Click by CSS viewport coordinates (backward compatible)
  chromux click <s> --xy X Y --space image   Click the most recent screenshot's image pixels
  chromux hover <s> (@ref|SEL|--xy X Y) [--space css|image]   Move the real pointer
  chromux drag <s> (@ref|SEL|--xy X Y) (--to @ref|SEL|--to-xy X Y)
                                     [--space css|image] [--drag-mode auto|pointer|html5]
  A click that opens a popup/new tab adopts it automatically: the response
                                     carries "newSession" with the adopted session name
  click/fill/type/press verify by default: the response carries the post-action
                                     diff ("changed"). --verify MS tunes the settle wait,
                                     --no-verify skips it (crawl mode skips automatically)
  chromux fill <session> @<ref> "t"  Replace input or contenteditable text
                                     (native <select>: matches option value/label)
                                     contenteditable replacement is standards-based; verify custom
                                     editors, mentions, slash commands, and IME flows separately
  chromux fill <s> @<ref> "se" --pick "Seoul"   Type, wait for the autocomplete popup,
                                     and choose the matching suggestion in one call
  chromux fill <s> @<ref> --file p   Set a file input for upload (repeat --file for multiple)
  chromux type <session> "text"      Insert text into focused field
  chromux press <session> Enter      Press Enter, Tab, Escape, Backspace, Delete,
                                     arrows, Home, End, PageUp, or PageDown
  chromux download <s> (@ref|SEL|--url U) [--to DIR]   Trigger a download and wait for the file
  chromux wait-for-text <s> "text"   Wait for visible page text
  chromux wait-for-selector <s> SEL  Wait for visible selector
  chromux wait-for-selector <s> SEL --gone   Wait until a selector disappears
  run waitFor also accepts {kind:'gone'} and {kind:'network-idle', idleMs:500}
                                     for deterministic waits without sleep()
  chromux screenshot <session> [p]   Take PNG with measured CSS/image coordinate metadata
  chromux screenshot <s> [p] --ref @N|SEL   Crop a visible element
  chromux screenshot <s> [p] --region X Y W H [--space css|image]   Crop a visible region
  Screenshot mappings describe the returned PNG; crop image coordinates start at local [0,0].
                                     Image actions use the session's most recent screenshot mapping.
                                     Do not infer mappings from DPR alone.
  Canvas objects have no DOM refs: inspect a crop, then hover/click/drag in css or image space.
  chromux show <session>             Open DevTools in browser (inspect live tab)

Watch / debug:
  chromux watch <session> console    Capture console logs (enable + read + clear)
  chromux watch <session> console --off
  chromux watch <session> network    Capture failed requests (4xx/5xx/errors)
  chromux watch <session> network --all
  chromux watch <session> network --off

Site knowledge:
  chromux note                       List hosts with saved site notes
  chromux note <host>                Show notes for a host (includes parent domains)
  chromux note <host> --add "text"   Append a durable site note (surfaced on next open)
  Notes live in ~/.chromux/skills/<host>/*.md and are attached to open results
  for that host and its subdomains.

Saved action scripts (observe once, replay deterministically):
  chromux script                     List saved replay scripts by host
  chromux script <host>              List scripts for a host (includes parent domains)
  chromux script show <host>/<name>  Print a saved script
  chromux script save <host>/<name> --file f.js   Save/update a replay script (stdin: -)
  chromux script rm <host>/<name>   Remove a saved script
  Scripts are plain run scripts in ~/.chromux/scripts/<host>/<name>.js; open
  responses list them for the page's host, and failed replays point back at
  the script so the calling agent can repair and re-save it.

Runner snippets:
  snippets/_builtin/page-extract.js      Structured page metadata extraction
  snippets/_builtin/form-flow.js         Whole form fill + submit + readiness in one call
                                         (--arg fields='{"#sel":"value"}' --arg submit='#go')
  snippets/_builtin/table-extract.js     Table -> {headers, rows} without dumping HTML
  snippets/_builtin/paginate-collect.js  Collect items across paginated pages
  snippets/_builtin/wizard-flow.js       Multi-step wizard with per-step readiness proof
  snippets/_builtin/search-and-pick.js   Type -> pick suggestion -> submit -> report
  snippets/_builtin/network-errors.js    Browser-observable resource diagnostics
  snippets/_builtin/page-assert.js       Selector, text, and DOM assertions

Deep guides (on demand, keeps per-turn skill text small):
  chromux skill                      List available topics
  chromux skill forms                Forms, autocomplete --pick, uploads, wizards
  chromux skill extraction           Grep/diff, tables, pagination, saved scripts
  chromux skill recovery             Stale refs, dialogs, popups, human login handoff
  chromux skill visual               DPR-safe screenshots, canvas, hover/drag, OOPIF tiers

Policy:
  New browser actions should be expressed with run or cdp before adding verbs.
  Older aliases such as eval, scroll, wait, console, network, and scroll-until
  remain for compatibility but are hidden from the main surface.

Profile selection:
  chromux --profile <name> <cmd>     Use specific profile
  chromux --mode crawl <cmd>         Use crawl resource policy for this profile daemon
  CHROMUX_PROFILE=<name> chromux     Via environment variable
  CHROMUX_MODE=crawl chromux         Efficient crawl mode (default mode preserves legacy behavior)
  CHROMUX_TASK=<label> chromux       Label activity events for Task timeline grouping
  CHROMUX_OPEN_BACKGROUND=0 chromux open ...    Create new tabs in foreground
  (default profile: "default")

Crawl mode:
  Caps expensive profile operations, blocks heavy media/font/analytics resources,
  uses shorter navigation waits, prunes idle sessions, and closes unresponsive
  sessions so worker-tab pools can keep moving. It also applies resource guards
  and honors chromux pause/resume hard-stop files.

Paths:
  CHROMUX_HOME                       Override chromux state root for tests or isolation
  ~/.chromux/config.json             Global config
  ~/.chromux/profiles/<name>/        Chrome user-data-dir per profile
  ~/.chromux/profiles/<name>/.state   Profile state with Chrome CDP port and daemonPort
  ~/.chromux/run/<name>.lock          Daemon startup lock (transient)
  ~/.chromux/scripts/<host>/          Saved replay scripts per host
  ~/.chromux/activity/events.jsonl    Local full-URL activity event log
  ~/.chromux/activity/config.json     Activity retention config
  ~/.chromux/activity/aggregates.json Command aggregate counters`;

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
  const daemonPort = parseInt(args[2]);
  if (!port || !daemonPort) { console.error('Usage: --daemon <profile> <chrome-cdp-port> <daemon-port>'); process.exit(1); }
  await startDaemon(profileName, port, daemonPort);
} else if (!cmd || cmd === 'help' || cmd === '--help') {
  console.log(HELP);
} else {
  await runCli(cmd, args);
}
