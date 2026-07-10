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
assertContains(checks, 'help snapshot diff', docs.help, '--diff');
assertContains(checks, 'help run script replay', docs.help, '--script');
assertContains(checks, 'help run schema', docs.help, '--schema');
assertContains(checks, 'help script save', docs.help, 'script save');
assertContains(checks, 'help press keys', docs.help, 'PageDown');
assertContains(checks, 'help snapshot grep', docs.help, '--grep');
assertContains(checks, 'help run args', docs.help, '--arg k=v');
assertContains(checks, 'help fill select', docs.help, 'native <select>');
assertContains(checks, 'README benchmark', docs.readme, 'benchmarks/chromux-benchmark.mjs');
assertContains(checks, 'README token benchmark', docs.readme, 'chromux-token-benchmark.mjs');
assertContains(checks, 'README receipt', docs.readme, '--receipt');
assertContains(checks, 'README snippets', docs.readme, 'page-extract.js');
assertContains(checks, 'README snapshot diff', docs.readme, '--diff');
assertContains(checks, 'README script replay', docs.readme, '--script');
assertContains(checks, 'README schema contract', docs.readme, '--schema');
assertContains(checks, 'README waitFor fallbacks', docs.readme, 'fallback candidates');
assertContains(checks, 'README press keys', docs.readme, 'PageDown');
assertContains(checks, 'README agent cross-tool benchmark', docs.readme, 'agent-compare-benchmark.mjs');
assertContains(checks, 'README deterministic cross-tool benchmark', docs.readme, 'compare-benchmark.mjs');
assertContains(checks, 'README benchmark doc link', docs.readme, 'docs/benchmark-2026-07.md');
assertContains(checks, 'install troubleshooting batch', docs.install, '--host-backoff-ms');
assertContains(checks, 'chromux skill receipt', docs.chromuxSkill, '--receipt');
assertContains(checks, 'chromux skill snippets', docs.chromuxSkill, 'network-errors.js');
assertContains(checks, 'chromux skill snapshot diff', docs.chromuxSkill, '--diff');
assertContains(checks, 'chromux skill script replay', docs.chromuxSkill, '--script');
assertContains(checks, 'chromux skill schema', docs.chromuxSkill, '--schema');
assertContains(checks, 'chromux skill select idiom', docs.chromuxSkill, 'native `<select>`');
assertContains(checks, 'chromux skill snapshot grep', docs.chromuxSkill, '--grep');
assertContains(checks, 'chromux skill run args', docs.chromuxSkill, '--arg fields=');
assertContains(checks, 'README snapshot grep', docs.readme, '--grep');
assertContains(checks, 'README run args', docs.readme, '--arg');
assertContains(checks, 'work skill benchmark', docs.workSkill, 'chromux-benchmark.mjs');
assertContains(checks, 'work skill script save', docs.workSkill, 'chromux script save');
assertContains(checks, 'work skill snapshot diff', docs.workSkill, '--diff');
assertContains(checks, 'work skill injection hygiene', docs.workSkill, 'lethal trifecta');

console.log(JSON.stringify({ ok: true, checks }, null, 2));
