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
assertContains(checks, 'help snapshot clickable', docs.help, '--clickable');
assertContains(checks, 'help action verify', docs.help, '--verify');
assertContains(checks, 'help dialog policy', docs.help, '--dialog accept|dismiss');
assertContains(checks, 'help popup adoption', docs.help, 'newSession');
assertContains(checks, 'help upload', docs.help, 'file input');
assertContains(checks, 'help download verb', docs.help, 'chromux download');
assertContains(checks, 'help wait gone', docs.help, '--gone');
assertContains(checks, 'help network idle wait', docs.help, 'network-idle');
assertContains(checks, 'help frame reach', docs.help, 'same-origin iframes');
assertContains(checks, 'help autocomplete pick', docs.help, '--pick');
assertContains(checks, 'help click by text', docs.help, '--text "label"');
assertContains(checks, 'help skill topics', docs.help, 'chromux skill');
assertContains(checks, 'help table snippet', docs.help, 'table-extract.js');
assertContains(checks, 'help paginate snippet', docs.help, 'paginate-collect.js');
assertContains(checks, 'help wizard snippet', docs.help, 'wizard-flow.js');
assertContains(checks, 'help search snippet', docs.help, 'search-and-pick.js');
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
assertContains(checks, 'README miniwob tasks', docs.readme, 'MiniWoB++');
assertContains(checks, 'README macos app install', docs.readme, 'install-app.sh');
assertContains(checks, 'README launch at login', docs.readme, 'Launch at Login');
assertContains(checks, 'README profile disk usage', docs.readme, 'per-profile disk usage');
assertContains(checks, 'install troubleshooting batch', docs.install, '--host-backoff-ms');
assertContains(checks, 'install macos app install', docs.install, 'install-app.sh');
assertContains(checks, 'install macos app ask first', docs.install, 'macOS App (ask the user first)');
assertContains(checks, 'install launch at login', docs.install, 'Launch at Login');
assertContains(checks, 'install profile disk usage', docs.install, 'per-profile disk usage');
assertContains(checks, 'chromux skill receipt', docs.chromuxSkill, '--receipt');
assertContains(checks, 'chromux skill snippets', docs.chromuxSkill, 'network-errors.js');
assertContains(checks, 'chromux skill snapshot diff', docs.chromuxSkill, '--diff');
assertContains(checks, 'chromux skill script replay', docs.chromuxSkill, '--script');
assertContains(checks, 'chromux skill schema', docs.chromuxSkill, '--schema');
assertContains(checks, 'chromux skill select idiom', docs.chromuxSkill, 'native `<select>`');
assertContains(checks, 'chromux skill snapshot grep', docs.chromuxSkill, '--grep');
assertContains(checks, 'chromux skill run args', docs.chromuxSkill, '--arg fields=');
assertContains(checks, 'chromux skill clickable', docs.chromuxSkill, '--clickable');
assertContains(checks, 'chromux skill action verify', docs.chromuxSkill, '--verify');
assertContains(checks, 'chromux skill frame reach', docs.chromuxSkill, 'same-origin iframes');
assertContains(checks, 'chromux skill shadow reach', docs.chromuxSkill, 'closed shadow roots');
assertContains(checks, 'chromux skill dialog field', docs.chromuxSkill, '--dialog accept');
assertContains(checks, 'chromux skill popup adoption', docs.chromuxSkill, 'newSession');
assertContains(checks, 'chromux skill upload', docs.chromuxSkill, '--file /path');
assertContains(checks, 'chromux skill download', docs.chromuxSkill, 'download exp-ab12');
assertContains(checks, 'chromux skill wait gone', docs.chromuxSkill, '--gone');
assertContains(checks, 'chromux skill network idle', docs.chromuxSkill, 'network-idle');
assertContains(checks, 'chromux skill autocomplete pick', docs.chromuxSkill, '--pick');
assertContains(checks, 'chromux skill pick effect field', docs.chromuxSkill, 'pickEffect');
assertContains(checks, 'chromux skill grep literal note', docs.chromuxSkill, 'literal reading');
assertContains(checks, 'chromux skill click by text', docs.chromuxSkill, '--text');
assertContains(checks, 'chromux skill topics on demand', docs.chromuxSkill, 'chromux skill');
assertContains(checks, 'chromux skill table snippet', docs.chromuxSkill, 'table-extract.js');
assertContains(checks, 'chromux skill paginate snippet', docs.chromuxSkill, 'paginate-collect.js');
assertContains(checks, 'chromux skill wizard snippet', docs.chromuxSkill, 'wizard-flow.js');
assertContains(checks, 'chromux skill search snippet', docs.chromuxSkill, 'search-and-pick.js');
assertContains(checks, 'README clickable', docs.readme, '--clickable');
assertContains(checks, 'README action verify', docs.readme, '--verify');
assertContains(checks, 'README snapshot grep', docs.readme, '--grep');
assertContains(checks, 'README run args', docs.readme, '--arg');
assertContains(checks, 'README frame reach', docs.readme, 'same-origin iframes');
assertContains(checks, 'README shadow reach', docs.readme, 'closed shadow roots');
assertContains(checks, 'README dialog policy', docs.readme, '--dialog accept|dismiss');
assertContains(checks, 'README popup adoption', docs.readme, 'newSession');
assertContains(checks, 'README upload', docs.readme, 'DOM.setFileInputFiles');
assertContains(checks, 'README download verb', docs.readme, '`download <session>');
assertContains(checks, 'README wait gone', docs.readme, '--gone');
assertContains(checks, 'README network idle', docs.readme, 'network-idle');
assertContains(checks, 'README autocomplete pick', docs.readme, '--pick');
assertContains(checks, 'README pick effect field', docs.readme, 'pickEffect');
assertContains(checks, 'README click by text', docs.readme, '--text "label"');
assertContains(checks, 'README skill topics', docs.readme, '`chromux skill`');
assertContains(checks, 'README table snippet', docs.readme, 'table-extract.js');
assertContains(checks, 'README paginate snippet', docs.readme, 'paginate-collect.js');
assertContains(checks, 'README wizard snippet', docs.readme, 'wizard-flow.js');
assertContains(checks, 'README search snippet', docs.readme, 'search-and-pick.js');
assertContains(checks, 'work skill benchmark', docs.workSkill, 'chromux-benchmark.mjs');
assertContains(checks, 'work skill script save', docs.workSkill, 'chromux script save');
assertContains(checks, 'work skill snapshot diff', docs.workSkill, '--diff');
assertContains(checks, 'work skill injection hygiene', docs.workSkill, 'lethal trifecta');

console.log(JSON.stringify({ ok: true, checks }, null, 2));
