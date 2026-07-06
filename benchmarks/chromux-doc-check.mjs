#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function read(rel) {
  return fs.readFileSync(path.join(MODULE_DIR, rel), 'utf8');
}

function assertContains(checks, label, text, needle) {
  const ok = text.includes(needle);
  checks.push({ label, needle, ok });
  if (!ok) throw new Error(`${label} missing ${needle}`);
}

const help = spawnSync(process.execPath, [path.join(MODULE_DIR, 'chromux.mjs'), 'help'], {
  cwd: MODULE_DIR,
  encoding: 'utf8',
});
if (help.status !== 0) throw new Error(help.stderr || 'chromux help failed');

const docs = {
  help: help.stdout,
  readme: read('README.md'),
  install: read('install.md'),
  chromuxSkill: read('skills/chromux/SKILL.md'),
  workSkill: read('skills/chromux-work/SKILL.md'),
};

const checks = [];
assertContains(checks, 'help run receipt', docs.help, '--receipt');
assertContains(checks, 'help batch retries', docs.help, '--retries');
assertContains(checks, 'help ps json', docs.help, 'ps --json');
assertContains(checks, 'README benchmark', docs.readme, 'benchmarks/chromux-benchmark.mjs');
assertContains(checks, 'README receipt', docs.readme, '--receipt');
assertContains(checks, 'README snippets', docs.readme, 'page-extract.js');
assertContains(checks, 'install troubleshooting batch', docs.install, '--host-backoff-ms');
assertContains(checks, 'chromux skill receipt', docs.chromuxSkill, '--receipt');
assertContains(checks, 'chromux skill snippets', docs.chromuxSkill, 'network-errors.js');
assertContains(checks, 'work skill benchmark', docs.workSkill, 'chromux-benchmark.mjs');

console.log(JSON.stringify({ ok: true, checks }, null, 2));
