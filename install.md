---
name: chromux-install
description: Install chromux and register its browser automation skills with Codex, Claude Code, or Hermes.
---

# chromux installation

Use this file only for chromux installation, agent-skill registration, and
browser/profile troubleshooting. For day-to-day CLI usage, read
`skills/chromux/SKILL.md`; for browser task orchestration, read
`skills/chromux-work/SKILL.md`; for current syntax, run `chromux help`.

chromux uses the user's local Google Chrome with isolated profiles under
`~/.chromux/profiles/`. It does not bundle Chromium and does not require
Playwright, Puppeteer, Python, or npm dependencies.

## Agent Install Contract

If you are an AI agent and the user asks you to install chromux from this file,
do the work end to end without asking follow-up questions unless the next step
requires a user-owned action, such as entering a password, installing Google
Chrome, or resolving uncommitted changes in an existing checkout.

The default supported install target is macOS/Linux.

## One-Pass Agent Setup

Run this from any directory. It installs or updates chromux from a durable
checkout, registers the Codex, Claude Code, and Hermes skills, adds lightweight
browser-work guidance without duplicating it, and verifies the CLI surface.

```bash
INSTALL_DIR="${CHROMUX_DIR:-$HOME/team-attention/chromux}"
REPO_URL="https://github.com/team-attention/chromux"

if [ -d "$INSTALL_DIR/.git" ]; then
  cd "$INSTALL_DIR"
  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "chromux checkout has uncommitted changes: $INSTALL_DIR" >&2
    git status --short >&2
    exit 2
  fi
  git pull --ff-only
else
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone "$REPO_URL" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

npm install -g .
command -v chromux
chromux help

mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills/chromux"
[ -L "${CODEX_HOME:-$HOME/.codex}/skills/chromux/SKILL.md" ] && rm "${CODEX_HOME:-$HOME/.codex}/skills/chromux/SKILL.md"
cp "$PWD/skills/chromux/SKILL.md" "${CODEX_HOME:-$HOME/.codex}/skills/chromux/SKILL.md"
[ -L "${CODEX_HOME:-$HOME/.codex}/skills/chromux/skills" ] && rm "${CODEX_HOME:-$HOME/.codex}/skills/chromux/skills"
ln -sfn "$PWD/snippets" "${CODEX_HOME:-$HOME/.codex}/skills/chromux/snippets"
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills/chromux-work"
[ -L "${CODEX_HOME:-$HOME/.codex}/skills/chromux-work/SKILL.md" ] && rm "${CODEX_HOME:-$HOME/.codex}/skills/chromux-work/SKILL.md"
cp "$PWD/skills/chromux-work/SKILL.md" "${CODEX_HOME:-$HOME/.codex}/skills/chromux-work/SKILL.md"

mkdir -p "${HERMES_HOME:-$HOME/.hermes}/skills/chromux"
ln -sf "$PWD/skills/chromux/SKILL.md" "${HERMES_HOME:-$HOME/.hermes}/skills/chromux/SKILL.md"
[ -L "${HERMES_HOME:-$HOME/.hermes}/skills/chromux/skills" ] && rm "${HERMES_HOME:-$HOME/.hermes}/skills/chromux/skills"
ln -sfn "$PWD/snippets" "${HERMES_HOME:-$HOME/.hermes}/skills/chromux/snippets"
mkdir -p "${HERMES_HOME:-$HOME/.hermes}/skills/chromux-work"
ln -sf "$PWD/skills/chromux-work/SKILL.md" "${HERMES_HOME:-$HOME/.hermes}/skills/chromux-work/SKILL.md"

mkdir -p "$HOME/.claude/skills/chromux"
ln -sf "$PWD/skills/chromux/SKILL.md" "$HOME/.claude/skills/chromux/SKILL.md"
[ -L "$HOME/.claude/skills/chromux/skills" ] && rm "$HOME/.claude/skills/chromux/skills"
ln -sfn "$PWD/snippets" "$HOME/.claude/skills/chromux/snippets"
mkdir -p "$HOME/.claude/skills/chromux-work"
ln -sf "$PWD/skills/chromux-work/SKILL.md" "$HOME/.claude/skills/chromux-work/SKILL.md"

CHROMUX_GUIDE='
<!-- chromux-browser-guide:start -->
## Browser Work

Use `chromux` for browser work when available.
<!-- chromux-browser-guide:end -->
'

touch "${CODEX_HOME:-$HOME/.codex}/AGENTS.md"
if ! grep -Fq '<!-- chromux-browser-guide:start -->' "${CODEX_HOME:-$HOME/.codex}/AGENTS.md" &&
   ! grep -Fq 'Use `chromux` for browser work when available.' "${CODEX_HOME:-$HOME/.codex}/AGENTS.md"; then
  printf '\n%s\n' "$CHROMUX_GUIDE" >> "${CODEX_HOME:-$HOME/.codex}/AGENTS.md"
fi

touch "${HERMES_HOME:-$HOME/.hermes}/AGENTS.md"
if ! grep -Fq '<!-- chromux-browser-guide:start -->' "${HERMES_HOME:-$HOME/.hermes}/AGENTS.md" &&
   ! grep -Fq 'Use `chromux` for browser work when available.' "${HERMES_HOME:-$HOME/.hermes}/AGENTS.md"; then
  printf '\n%s\n' "$CHROMUX_GUIDE" >> "${HERMES_HOME:-$HOME/.hermes}/AGENTS.md"
fi

mkdir -p "$HOME/.claude"
touch "$HOME/.claude/CLAUDE.md"
if ! grep -Fq '<!-- chromux-browser-guide:start -->' "$HOME/.claude/CLAUDE.md" &&
   ! grep -Fq 'Use `chromux` for browser work when available.' "$HOME/.claude/CLAUDE.md"; then
  printf '\n%s\n' "$CHROMUX_GUIDE" >> "$HOME/.claude/CLAUDE.md"
fi
```

Then run the smoke test below. New Codex, Claude Code, or Hermes sessions should
now load the chromux browser skills automatically.

## Recommended Setup

Clone the repo once into a durable location, then install the CLI globally from
that checkout so `chromux` works from any directory.

```bash
git clone https://github.com/team-attention/chromux
cd chromux
npm install -g .
command -v chromux
chromux help
```

If you use pnpm globally, this also works:

```bash
pnpm add --global "$PWD"
command -v chromux
chromux help
```

Prefer a stable path such as `~/Developer/chromux` or
`~/team-attention/chromux`, not `/tmp`. Installing from a durable checkout keeps
the CLI, `skills/`, `install.md`, and `snippets/_builtin/` in one place.

## Register The Agent Skills

After the CLI works, register this repo's two skills with the agent runtime:

- `chromux`: direct CLI usage
- `chromux-work`: profile selection, recon, parallel work, cleanup, and domain notes

### Codex

Add both files as global skills under `$CODEX_HOME/skills/`, usually
`~/.codex/skills/`. For Codex, copy `SKILL.md` as a real file instead of
symlinking it; current Codex skill loading may omit symlinked `SKILL.md` files
from the model-visible Available skills list. Also add a lightweight
browser-work instruction to `~/.codex/AGENTS.md`; do not import the skill files
there.

```bash
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills/chromux"
[ -L "${CODEX_HOME:-$HOME/.codex}/skills/chromux/SKILL.md" ] && rm "${CODEX_HOME:-$HOME/.codex}/skills/chromux/SKILL.md"
cp "$PWD/skills/chromux/SKILL.md" "${CODEX_HOME:-$HOME/.codex}/skills/chromux/SKILL.md"
[ -L "${CODEX_HOME:-$HOME/.codex}/skills/chromux/skills" ] && rm "${CODEX_HOME:-$HOME/.codex}/skills/chromux/skills"
ln -sfn "$PWD/snippets" "${CODEX_HOME:-$HOME/.codex}/skills/chromux/snippets"
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills/chromux-work"
[ -L "${CODEX_HOME:-$HOME/.codex}/skills/chromux-work/SKILL.md" ] && rm "${CODEX_HOME:-$HOME/.codex}/skills/chromux-work/SKILL.md"
cp "$PWD/skills/chromux-work/SKILL.md" "${CODEX_HOME:-$HOME/.codex}/skills/chromux-work/SKILL.md"
CHROMUX_GUIDE='
<!-- chromux-browser-guide:start -->
## Browser Work

Use `chromux` for browser work when available.
<!-- chromux-browser-guide:end -->
'
touch "${CODEX_HOME:-$HOME/.codex}/AGENTS.md"
if ! grep -Fq '<!-- chromux-browser-guide:start -->' "${CODEX_HOME:-$HOME/.codex}/AGENTS.md" &&
   ! grep -Fq 'Use `chromux` for browser work when available.' "${CODEX_HOME:-$HOME/.codex}/AGENTS.md"; then
  printf '\n%s\n' "$CHROMUX_GUIDE" >> "${CODEX_HOME:-$HOME/.codex}/AGENTS.md"
fi
```

### Hermes

Add both files as Hermes skills under `$HERMES_HOME/skills/`, usually
`~/.hermes/skills/`. Hermes discovers installed skills from `~/.hermes/skills/`
and exposes them as `/chromux` and `/chromux-work` in new sessions. Also add a
lightweight browser-work instruction to `~/.hermes/AGENTS.md`.

```bash
mkdir -p "${HERMES_HOME:-$HOME/.hermes}/skills/chromux"
ln -sf "$PWD/skills/chromux/SKILL.md" "${HERMES_HOME:-$HOME/.hermes}/skills/chromux/SKILL.md"
[ -L "${HERMES_HOME:-$HOME/.hermes}/skills/chromux/skills" ] && rm "${HERMES_HOME:-$HOME/.hermes}/skills/chromux/skills"
ln -sfn "$PWD/snippets" "${HERMES_HOME:-$HOME/.hermes}/skills/chromux/snippets"
mkdir -p "${HERMES_HOME:-$HOME/.hermes}/skills/chromux-work"
ln -sf "$PWD/skills/chromux-work/SKILL.md" "${HERMES_HOME:-$HOME/.hermes}/skills/chromux-work/SKILL.md"
CHROMUX_GUIDE='
<!-- chromux-browser-guide:start -->
## Browser Work

Use `chromux` for browser work when available.
<!-- chromux-browser-guide:end -->
'
touch "${HERMES_HOME:-$HOME/.hermes}/AGENTS.md"
if ! grep -Fq '<!-- chromux-browser-guide:start -->' "${HERMES_HOME:-$HOME/.hermes}/AGENTS.md" &&
   ! grep -Fq 'Use `chromux` for browser work when available.' "${HERMES_HOME:-$HOME/.hermes}/AGENTS.md"; then
  printf '\n%s\n' "$CHROMUX_GUIDE" >> "${HERMES_HOME:-$HOME/.hermes}/AGENTS.md"
fi
```

### Claude Code

Add both files as Claude Code skills under `~/.claude/skills/`. Also add a
lightweight browser-work instruction to `~/.claude/CLAUDE.md`; do not import
the skill files there. Use the absolute path for your checkout:

```bash
mkdir -p "$HOME/.claude/skills/chromux"
ln -sf "$PWD/skills/chromux/SKILL.md" "$HOME/.claude/skills/chromux/SKILL.md"
[ -L "$HOME/.claude/skills/chromux/skills" ] && rm "$HOME/.claude/skills/chromux/skills"
ln -sfn "$PWD/snippets" "$HOME/.claude/skills/chromux/snippets"
mkdir -p "$HOME/.claude/skills/chromux-work"
ln -sf "$PWD/skills/chromux-work/SKILL.md" "$HOME/.claude/skills/chromux-work/SKILL.md"
CHROMUX_GUIDE='
<!-- chromux-browser-guide:start -->
## Browser Work

Use `chromux` for browser work when available.
<!-- chromux-browser-guide:end -->
'
mkdir -p "$HOME/.claude"
touch "$HOME/.claude/CLAUDE.md"
if ! grep -Fq '<!-- chromux-browser-guide:start -->' "$HOME/.claude/CLAUDE.md" &&
   ! grep -Fq 'Use `chromux` for browser work when available.' "$HOME/.claude/CLAUDE.md"; then
  printf '\n%s\n' "$CHROMUX_GUIDE" >> "$HOME/.claude/CLAUDE.md"
fi
```

If the file already has the chromux browser-work guide block, do not add a
duplicate block.

## First Smoke Test

Run a short local smoke before using chromux in a task:

```bash
chromux launch chromux-smoke --headless
CHROMUX_PROFILE=chromux-smoke chromux open smoke https://example.com
CHROMUX_PROFILE=chromux-smoke chromux run smoke "return await js('document.title')"
CHROMUX_PROFILE=chromux-smoke chromux run smoke "return await page('({title:document.title,url:location.href})')"
CHROMUX_PROFILE=chromux-smoke chromux cdp smoke Runtime.evaluate '{"expression":"location.href","returnByValue":true}'
CHROMUX_PROFILE=chromux-smoke chromux close smoke
chromux kill chromux-smoke
```

Expected result: the `run` command prints `Example Domain`, the `cdp` command
returns a `Runtime.evaluate` result containing `https://example.com/`, and the
profile is killed at the end.

## Builtin Helper Material

Repo-local helper examples live under `snippets/_builtin/`. They are documentation
and runner material, not files that chromux automatically copies into
`~/.chromux`.

For example:

```bash
chromux run <session> --file snippets/_builtin/scroll-until.js
```

Do not overwrite user or agent edited files under `~/.chromux/skills/` during
installation. Host-specific skills in `~/.chromux/skills/<host>/` are local
knowledge and should be preserved.

## Keeping chromux Current

For an editable checkout:

```bash
cd /path/to/chromux
git pull --ff-only
npm install -g .
chromux help
```

The global `chromux` command runs the package copy installed by npm or pnpm; it
does not automatically follow local edits in the checkout until you reinstall
from that checkout.

If a running daemon appears stale after an update, stop the profile and retry:

```bash
chromux ps
chromux kill <profile>
```

If the checkout has uncommitted changes, do not overwrite them. Report the dirty
files and let the user decide whether to keep, commit, or discard them.

## Publishing

The npm package is published by the GitHub Actions workflow at
`.github/workflows/npm-publish.yml` when a commit lands on `main` with a new
`package.json` version. The workflow validates `node --check`, `chromux help`,
skill files, built-in snippets, and `npm pack --dry-run`, then runs
`npm publish --provenance` using the repository `NPM_TOKEN` secret.

For a publishable fix:

```bash
node chromux.mjs help
./test.sh
npm pack --dry-run
git status --short
```

Then bump `package.json`, commit, and push to `main`. Do not run `npm publish`
locally unless the user explicitly requests a local/manual publish.

## Troubleshooting

### `chromux` is not found

Check that the global install location is on `PATH`:

```bash
command -v chromux
npm prefix -g
```

Then reinstall from the repo checkout with `npm install -g .` or
`pnpm add --global "$PWD"`.

### Chrome is not found

Install Google Chrome. chromux currently searches common macOS/Linux Chrome and
Chromium paths. The supported validation target for this installer is
macOS/Linux; Windows support is deferred.

### Chrome starts but CDP/DevTools never opens on macOS

If `chromux open` hangs or `http://127.0.0.1:<port>/json/version` refuses a
connection even though the Chrome process is alive, check whether the agent
runtime is using a synthetic `HOME` such as a Hermes profile home. chromux 0.7.4+
keeps chromux state under the invoking process `HOME` but launches the Chrome
child with the real macOS account home from `os.userInfo().homedir`; the
explicit `--user-data-dir` still provides Chrome profile isolation. Older
chromux versions may need to be updated before CDP becomes reachable in that
environment.

### Profile is locked or stale

List active profiles, then kill the specific profile:

```bash
chromux ps
chromux kill <profile>
```

chromux stores isolated profile state under `~/.chromux/profiles/<profile>/`
and transient daemon sockets/locks under `~/.chromux/run/`.
`chromux kill <profile>` also removes stale Chrome singleton lock files after it
has confirmed that no Chrome process is still using that isolated profile. The
cleanup can include Chrome's profile version marker when Chrome left it behind.

### Switch between default and crawl mode

`CHROMUX_MODE` is a daemon policy for a profile. Use `default` for QA/login/visual
work, and `crawl` for efficient read-only collection:

```bash
CHROMUX_MODE=crawl CHROMUX_PROFILE=work chromux open worker-1 https://example.com
```

If a profile daemon is already running in another mode, stop the daemon or kill
the profile before switching:

```bash
CHROMUX_PROFILE=work chromux stop
CHROMUX_MODE=crawl CHROMUX_PROFILE=work chromux open worker-1 https://example.com
```

For crawl throughput, reuse a small worker-tab pool instead of creating one tab
per URL. Tune limits with `CHROMUX_MAX_CONCURRENT_OPS_PER_PROFILE`,
`CHROMUX_MAX_QUEUED_OPS_PER_PROFILE`, `CHROMUX_MAX_SESSIONS_PER_PROFILE`,
`CHROMUX_IDLE_TTL_MS`, `CHROMUX_NAVIGATION_WAIT_MS`,
`CHROMUX_MAX_RENDERERS_PER_PROFILE`, `CHROMUX_MAX_CHROME_PROCESSES_PER_PROFILE`,
and `CHROMUX_MAX_RSS_MB_PER_PROFILE`.

For URL-only queues, prefer the built-in worker pool:

```bash
CHROMUX_MODE=crawl CHROMUX_PROFILE=work chromux batch --file urls.txt --workers 10 --out results.jsonl
```

To stop a crawl wave without killing Chrome, pause the profile. New browser
work is rejected until resumed, while `list`, `close`, and `stop` still work:

```bash
CHROMUX_PROFILE=work chromux pause
CHROMUX_PROFILE=work chromux resume
```

### A site asks for login

Use a named profile and log in manually once:

```bash
chromux launch work
CHROMUX_PROFILE=work chromux open login https://example.com
chromux show login
```

After the user logs in, close the tab but keep or reuse the profile for later
automation.

### Verify the installed skills

Codex:

```bash
ls -l "${CODEX_HOME:-$HOME/.codex}/skills/chromux/SKILL.md"
test ! -L "${CODEX_HOME:-$HOME/.codex}/skills/chromux/SKILL.md"
ls -l "${CODEX_HOME:-$HOME/.codex}/skills/chromux/snippets/_builtin"
ls -l "${CODEX_HOME:-$HOME/.codex}/skills/chromux-work/SKILL.md"
test ! -L "${CODEX_HOME:-$HOME/.codex}/skills/chromux-work/SKILL.md"
grep -n 'Use `chromux` for browser work when available.' "${CODEX_HOME:-$HOME/.codex}/AGENTS.md"
```

Hermes:

```bash
ls -l "${HERMES_HOME:-$HOME/.hermes}/skills/chromux/SKILL.md"
ls -l "${HERMES_HOME:-$HOME/.hermes}/skills/chromux/snippets/_builtin"
ls -l "${HERMES_HOME:-$HOME/.hermes}/skills/chromux-work/SKILL.md"
grep -n 'Use `chromux` for browser work when available.' "${HERMES_HOME:-$HOME/.hermes}/AGENTS.md"
hermes skills list | grep chromux
```

Claude Code:

```bash
ls -l "$HOME/.claude/skills/chromux/SKILL.md"
ls -l "$HOME/.claude/skills/chromux/snippets/_builtin"
ls -l "$HOME/.claude/skills/chromux-work/SKILL.md"
grep -n 'Use `chromux` for browser work when available.' "$HOME/.claude/CLAUDE.md"
```

New agent sessions should now have chromux browser instructions and workflow
orchestration available
without copying command catalogs into every project.
