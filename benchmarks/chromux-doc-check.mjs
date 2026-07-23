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
  benchmark: read('docs/benchmark-2026-07.md'),
  agentCompare: read('benchmarks/agent-compare-benchmark.mjs'),
  webgames: read('benchmarks/webgames.mjs'),
  install: read('install.md'),
  chromuxSkill: read('skills/chromux/SKILL.md'),
  workSkill: read('skills/chromux-work/SKILL.md'),
  formsTopic: read('skills/chromux/topics/forms.md'),
  recoveryTopic: read('skills/chromux/topics/recovery.md'),
  visualTopic: read('skills/chromux/topics/visual.md'),
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
assertContains(checks, 'help image coordinate space', docs.help, '--space image');
assertContains(checks, 'help crop-local image coordinates', docs.help, 'crop image coordinates start at local [0,0]');
assertContains(checks, 'help hover action', docs.help, 'chromux hover');
assertContains(checks, 'help drag modes', docs.help, '--drag-mode auto|pointer|html5');
assertContains(checks, 'help screenshot crop', docs.help, '--region X Y W H');
assertContains(checks, 'help contenteditable limits', docs.help, 'slash commands, and IME');
assertContains(checks, 'help opaque frame identity', docs.help, 'origin-only opaque ref');
assertContains(checks, 'help OOPIF refs', docs.help, '@f1g1:2');
assertContains(checks, 'help OOPIF crash cleanup', docs.help, 'list reports crashedTotal');
assertContains(checks, 'help visual topic', docs.help, 'chromux skill visual');
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
assertContains(checks, 'README expanded benchmark', docs.readme, 'Agent task success (20 tasks, 35 sessions)');
assertContains(checks, 'benchmark expanded same-run', docs.benchmark, 'Expanded 20-task same-run results (chromux 0.18.0)');
assertContains(checks, 'visual benchmark denies run and cdp shortcuts', docs.agentCompare, 'CHROMUX_BENCH_VISUAL_ONLY');
assertContains(checks, 'README macos app install', docs.readme, 'install-app.sh');
assertContains(checks, 'README launch at login', docs.readme, 'Launch at Login');
assertContains(checks, 'README profile disk usage', docs.readme, 'per-profile disk usage');
assertContains(checks, 'install troubleshooting batch', docs.install, '--host-backoff-ms');
assertContains(checks, 'install macos app install', docs.install, 'install-app.sh');
assertContains(checks, 'install macos app ask first', docs.install, 'macOS App (ask the user first)');
assertContains(checks, 'install launch at login', docs.install, 'Launch at Login');
assertContains(checks, 'install profile disk usage', docs.install, 'per-profile disk usage');
assertContains(checks, 'install automatic npm publishing disabled', docs.install, 'Automatic npm publishing is disabled');
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
assertContains(checks, 'chromux skill image coordinates', docs.chromuxSkill, '`--space image`');
assertContains(checks, 'chromux skill hover action', docs.chromuxSkill, 'hover exp-ab12');
assertContains(checks, 'chromux skill drag action', docs.chromuxSkill, '--drag-mode pointer');
assertContains(checks, 'chromux skill contenteditable limits', docs.chromuxSkill, 'IME composition');
assertContains(checks, 'chromux skill OOPIF opt-in', docs.chromuxSkill, 'open ... --oopif');
assertContains(checks, 'chromux skill OOPIF crash cleanup', docs.chromuxSkill, 'renderer crash invalidates the child namespace');
assertContains(checks, 'chromux skill visual topic', docs.chromuxSkill, 'forms|extraction|recovery|visual');
assertContains(checks, 'chromux skill shadow reach', docs.chromuxSkill, 'Closed shadow roots');
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
assertContains(checks, 'README image coordinates', docs.readme, '`--space image`');
assertContains(checks, 'README hover action', docs.readme, '`hover <session>');
assertContains(checks, 'README drag modes', docs.readme, '`--drag-mode pointer`');
assertContains(checks, 'README screenshot metadata', docs.readme, '`coordinateSpace.cssToImage`');
assertContains(checks, 'README crop-local image contract', docs.readme, 'crop uses crop-local image coordinates');
assertContains(checks, 'README latest screenshot action mapping', docs.readme, "session's most recent screenshot mapping");
assertContains(checks, 'README contenteditable limits', docs.readme, 'slash commands, IME composition');
assertContains(checks, 'README OOPIF opt-in', docs.readme, 'Target.setAutoAttach');
assertContains(checks, 'README OOPIF close cleanup', docs.readme, 'CDP transport cleanup with zero attached frames');
assertContains(checks, 'README opaque redaction', docs.readme, 'never includes child paths');
assertContains(checks, 'README canvas workflow', docs.readme, 'Canvas and other visual-only surfaces');
assertContains(checks, 'README OOPIF payload', docs.readme, '`open --oopif` / namespaced snapshot | ~236 / ~161 tok');
assertContains(checks, 'README OOPIF attach payload', docs.readme, 'measured OOPIF attach overhead over default open | ~147 tok');
assertContains(checks, 'README full screenshot payload', docs.readme, 'full canvas screenshot metadata | ~245 tok');
assertContains(checks, 'README crop screenshot payload', docs.readme, 'bounded canvas crop metadata | ~323 tok');
assertContains(checks, 'README WebGames reach tasks', docs.readme, 'webgames-canvas-target,webgames-drag-drop,webgames-slider');
assertContains(checks, 'README WebGames visual command policy', docs.readme, 'snapshot, fill, eval, run, cdp, network, and watch are blocked');
assertContains(checks, 'WebGames visual allowlist', docs.webgames, 'WEBGAMES_VISUAL_COMMANDS');
assertContains(checks, 'WebGames visual help allowlist', docs.webgames, "'help'");
assertContains(checks, 'WebGames exact password grade', docs.agentCompare, 'webgamesPasswordMatches');
assertContains(checks, 'WebGames Read permission scope', docs.agentCompare, 'Read(//tmp/chromux-*.png)');
assertContains(checks, 'WebGames safe mode', docs.agentCompare, "'--safe-mode'");
assertContains(checks, 'WebGames hashed answers', docs.webgames, 'WEBGAMES_COMPLETION_PASSWORD_HASHES');
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
assertContains(checks, 'work skill visual workflow', docs.workSkill, 'chromux skill visual');
assertContains(checks, 'work skill OOPIF boundary', docs.workSkill, 'Default cross-origin frame recon');
assertContains(checks, 'forms topic contenteditable', docs.formsTopic, 'standards-based');
assertContains(checks, 'forms topic OOPIF constraints', docs.formsTopic, 'file uploads and `--pick` remain unsupported');
assertContains(checks, 'recovery topic OOPIF stale refs', docs.recoveryTopic, 'stale-child error means re-snapshot');
assertContains(checks, 'recovery topic stall signal', docs.recoveryTopic, '# stalled:');
assertContains(checks, 'chromux skill script confidence', docs.chromuxSkill, 'scriptStats');
assertContains(checks, 'visual topic DPR warning', docs.visualTopic, 'Do not multiply or');
assertContains(checks, 'visual topic crop-local coordinates', docs.visualTopic, 'image coordinates are local to that PNG');
assertContains(checks, 'visual topic latest screenshot mapping', docs.visualTopic, "session's most recent screenshot mapping");
assertContains(checks, 'visual topic canvas workflow', docs.visualTopic, 'Canvas objects do not have DOM refs');
assertContains(checks, 'visual topic drag modes', docs.visualTopic, '`--drag-mode html5`');
assertContains(checks, 'visual topic OOPIF limits', docs.visualTopic, 'ref-based hover/drag are not routed');
assertContains(checks, 'visual topic OOPIF crash cleanup', docs.visualTopic, '`list` reports `crashedTotal`');

{
  // Quick Start keeps the agent-first path: install, load the skill, then a
  // first real task through a real browser.
  assertContains(checks, 'readme quick start skill step', docs.readme, 'invoke the `chromux` skill');
  assertContains(checks, 'readme quick start first task', docs.readme, 'Using chromux, google');
  assertContains(checks, 'readme quick start by hand', docs.readme, '### By hand');
}

{
  // Live mode (extension bridge) surface must stay consistent across help,
  // README, install, and both skills.
  assertContains(checks, 'help live pair', docs.help, 'chromux pair');
  assertContains(checks, 'help live tabs', docs.help, 'chromux tabs');
  assertContains(checks, 'help live profile', docs.help, 'CHROMUX_PROFILE=live');
  assertContains(checks, 'help live attach tab', docs.help, '--tab active|<tabId>|<match>');
  assertContains(checks, 'readme live mode', docs.readme, 'CHROMUX_PROFILE=live chromux open');
  assertContains(checks, 'readme live kill semantics', docs.readme, 'kill live` never terminates your Chrome');
  assertContains(checks, 'install live pair', docs.install, 'chromux pair');
  assertContains(checks, 'install live load unpacked', docs.install, 'Load unpacked');
  assertContains(checks, 'help live tokenless', docs.help, 'no token');
  assertContains(checks, 'readme live tokenless', docs.readme, 'There is no\npairing token');
  assertContains(checks, 'readme live origin rejection', docs.readme, 'web `Origin` header');
  assertContains(checks, 'install live tokenless', docs.install, 'There is no token');
  assertContains(checks, 'install live origin rejection', docs.install, 'web `Origin` header');
  assertContains(checks, 'chromux skill live mode', docs.chromuxSkill, 'CHROMUX_PROFILE=live');
  assertContains(checks, 'chromux skill live unsupported', docs.chromuxSkill, 'live unsupported');
  assertContains(checks, 'work skill live profile', docs.workSkill, 'reserved `live` profile');
  // The attached-tab badge (green "chromux" tab group) is a user-facing live
  // surface: docs and the extension manifest permission must stay in sync.
  assertContains(checks, 'readme live tab-group badge', docs.readme, 'green "chromux" tab group');
  assertContains(checks, 'install live tab-group badge', docs.install, 'green "chromux" tab group');
  assertContains(checks, 'chromux skill live tab-group badge', docs.chromuxSkill, 'green "chromux" tab group');
  assertContains(checks, 'extension manifest tabGroups permission', read('extension/manifest.json'), '"tabGroups"');
}

{
  // Screen recording (`chromux record`) surface must stay consistent across
  // help, README, install, and both skills — same discipline as live mode.
  assertContains(checks, 'help record verb', docs.help, 'chromux record <session> start');
  assertContains(checks, 'help record discard', docs.help, '--discard');
  assertContains(checks, 'help record idle-timeout', docs.help, '--idle-timeout MS');
  assertContains(checks, 'help record head-trim', docs.help, 'not the start call itself');
  assertContains(checks, 'readme record section', docs.readme, '### Screen Recording');
  assertContains(checks, 'readme record ffmpeg requirement', docs.readme, 'requires `ffmpeg` as a system binary');
  assertContains(checks, 'readme record overlay', docs.readme, 'cursor/click overlay is injected');
  assertContains(checks, 'install record ffmpeg troubleshooting', docs.install, '`chromux record` says ffmpeg is not found');
  assertContains(checks, 'install record ffmpegPath', docs.install, 'ffmpegPath');
  assertContains(checks, 'chromux skill record verb', docs.chromuxSkill, 'record <s> start');
  assertContains(checks, 'work skill record evidence', docs.workSkill, 'record <s> start');
}

{
  // Secret store (Bitwarden add-on) surface must stay consistent across
  // help, README, install, and both skills.
  assertContains(checks, 'help secret unlock', docs.help, 'chromux secret unlock');
  assertContains(checks, 'help secret set', docs.help, 'chromux secret set');
  assertContains(checks, 'help fill --secret', docs.help, '--secret <host>:password|username|totp');
  assertContains(checks, 'help secret ssh-agent pattern', docs.help, 'ssh-agent pattern');
  assertContains(checks, 'help secret unsupported tier', docs.help, "'unsupported-tier'");
  assertContains(checks, 'readme secret store section', docs.readme, '## Secret Store (Opt-in Add-on)');
  assertContains(checks, 'readme secret ssh-agent pattern', docs.readme, 'ssh-agent-style pattern');
  assertContains(checks, 'readme secret human-only', docs.readme, 'human-only');
  assertContains(checks, 'install secret store setup', docs.install, '## Secret Store Setup (optional: Bitwarden add-on)');
  assertContains(checks, 'install secret unlock step', docs.install, 'chromux secret unlock');
  assertContains(checks, 'install secret windows unverified', docs.install, 'has not been smoke-tested on an\nactual Windows machine yet');
  assertContains(checks, 'chromux skill secret store section', docs.chromuxSkill, '## Secret Store (Opt-in Add-on)');
  assertContains(checks, 'chromux skill fill --secret', docs.chromuxSkill, 'fill --secret <host>:password');
  assertContains(checks, 'chromux skill secret human-only', docs.chromuxSkill, 'human-only by design');
  assertContains(checks, 'work skill secret store handoff', docs.workSkill, 'secret-store add-on is set up');
  assertContains(checks, 'recovery topic secret store handoff', docs.recoveryTopic, '--secret <host>:password` first');
}

{
  const pkg = JSON.parse(read('package.json'));
  const ok = !pkg.dependencies;
  checks.push({ label: `package remains zero-dependency at ${pkg.version}`, needle: 'no dependencies', ok });
  if (!ok) throw new Error(`package contract drift: version=${pkg.version}, dependencies=${JSON.stringify(pkg.dependencies)}`);
}

// Cross-file constant sync: the pick-candidate selector exists in the daemon
// (fill --pick) and in the standalone search-and-pick snippet; drift between
// them must fail validation.
{
  const src = read('chromux.mjs');
  const snippet = read('snippets/_builtin/search-and-pick.js');
  const daemonSel = src.match(/const PICK_CANDIDATE_SEL = '([^']+)'/)?.[1];
  const snippetSel = snippet.match(/const PICK_SEL = '([^']+)'/)?.[1];
  const ok = Boolean(daemonSel) && daemonSel === snippetSel;
  checks.push({ label: 'pick selector in sync with search-and-pick snippet', needle: daemonSel || '(missing)', ok });
  if (!ok) throw new Error(`pick candidate selector drift: daemon=${daemonSel} snippet=${snippetSel}`);
}

console.log(JSON.stringify({ ok: true, checks }, null, 2));
