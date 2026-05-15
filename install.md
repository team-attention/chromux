---
name: chromux-install
description: Install chromux and register its browser automation skill with Codex, Claude Code, or Hermes.
---

# chromux installation

Use this file only for chromux installation, agent-skill registration, and
browser/profile troubleshooting. For day-to-day browser work, read `SKILL.md`
and run `chromux help`.

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
checkout, registers the Codex, Claude Code, and Hermes skills, adds a Claude
Code import fallback without duplicating it, and verifies the CLI surface.

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
ln -sf "$PWD/SKILL.md" "${CODEX_HOME:-$HOME/.codex}/skills/chromux/SKILL.md"

mkdir -p "${HERMES_HOME:-$HOME/.hermes}/skills/chromux"
ln -sf "$PWD/SKILL.md" "${HERMES_HOME:-$HOME/.hermes}/skills/chromux/SKILL.md"

mkdir -p "$HOME/.claude/skills/chromux"
ln -sf "$PWD/SKILL.md" "$HOME/.claude/skills/chromux/SKILL.md"

mkdir -p "$HOME/.claude"
touch "$HOME/.claude/CLAUDE.md"
if ! grep -Fqx "@$PWD/SKILL.md" "$HOME/.claude/CLAUDE.md"; then
  printf '\n@%s/SKILL.md\n' "$PWD" >> "$HOME/.claude/CLAUDE.md"
fi
```

Then run the smoke test below. New Codex, Claude Code, or Hermes sessions should
now load the chromux browser skill automatically.

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
the CLI, `SKILL.md`, `install.md`, and `skills/_builtin/` in one place.

## Register The Agent Skill

After the CLI works, register this repo's `SKILL.md` with the agent runtime.

### Codex

Add this file as a global skill at
`$CODEX_HOME/skills/chromux/SKILL.md`, usually
`~/.codex/skills/chromux/SKILL.md`. A symlink is preferred so updates to this
repo update the skill instructions too.

```bash
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills/chromux"
ln -sf "$PWD/SKILL.md" "${CODEX_HOME:-$HOME/.codex}/skills/chromux/SKILL.md"
```

### Hermes

Add this file as a Hermes skill at
`$HERMES_HOME/skills/chromux/SKILL.md`, usually
`~/.hermes/skills/chromux/SKILL.md`. Hermes discovers installed skills from
`~/.hermes/skills/` and exposes the skill as `/chromux` in new sessions.

```bash
mkdir -p "${HERMES_HOME:-$HOME/.hermes}/skills/chromux"
ln -sf "$PWD/SKILL.md" "${HERMES_HOME:-$HOME/.hermes}/skills/chromux/SKILL.md"
```

### Claude Code

Add this file as a Claude Code skill at `~/.claude/skills/chromux/SKILL.md`.
Also add an import fallback to `~/.claude/CLAUDE.md` that points at this repo's
`SKILL.md`. Use the absolute path for your checkout:

```bash
mkdir -p "$HOME/.claude/skills/chromux"
ln -sf "$PWD/SKILL.md" "$HOME/.claude/skills/chromux/SKILL.md"
mkdir -p "$HOME/.claude"
touch "$HOME/.claude/CLAUDE.md"
if ! grep -Fqx "@$PWD/SKILL.md" "$HOME/.claude/CLAUDE.md"; then
  printf '\n@%s/SKILL.md\n' "$PWD" >> "$HOME/.claude/CLAUDE.md"
fi
```

If the file already imports chromux, do not add a duplicate line.

## First Smoke Test

Run a short local smoke before using chromux in a task:

```bash
chromux launch chromux-smoke --headless
CHROMUX_PROFILE=chromux-smoke chromux open smoke https://example.com
CHROMUX_PROFILE=chromux-smoke chromux run smoke "return await js('document.title')"
CHROMUX_PROFILE=chromux-smoke chromux cdp smoke Runtime.evaluate '{"expression":"location.href","returnByValue":true}'
CHROMUX_PROFILE=chromux-smoke chromux close smoke
chromux kill chromux-smoke
```

Expected result: the `run` command prints `Example Domain`, the `cdp` command
returns a `Runtime.evaluate` result containing `https://example.com/`, and the
profile is killed at the end.

## Builtin Helper Material

Repo-local helper examples live under `skills/_builtin/`. They are documentation
and runner material, not files that chromux automatically copies into
`~/.chromux`.

For example:

```bash
chromux run <session> --file skills/_builtin/scroll-until.js
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

If a running daemon appears stale after an update, stop the profile and retry:

```bash
chromux ps
chromux kill <profile>
```

If the checkout has uncommitted changes, do not overwrite them. Report the dirty
files and let the user decide whether to keep, commit, or discard them.

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

### Profile is locked or stale

List active profiles, then kill the specific profile:

```bash
chromux ps
chromux kill <profile>
```

chromux stores isolated profile state under `~/.chromux/profiles/<profile>/`
and transient daemon sockets/locks under `~/.chromux/run/`.

### A site asks for login

Use a named profile and log in manually once:

```bash
chromux launch work --hidden
CHROMUX_PROFILE=work chromux open login https://example.com
chromux show login
```

After the user logs in, close the tab but keep or reuse the profile for later
automation.

### Verify the installed skill

Codex:

```bash
ls -l "${CODEX_HOME:-$HOME/.codex}/skills/chromux/SKILL.md"
```

Hermes:

```bash
ls -l "${HERMES_HOME:-$HOME/.hermes}/skills/chromux/SKILL.md"
hermes skills list | grep chromux
```

Claude Code:

```bash
ls -l "$HOME/.claude/skills/chromux/SKILL.md"
grep -n 'chromux.*/SKILL.md' "$HOME/.claude/CLAUDE.md"
```

New agent sessions should now have chromux browser-work instructions available
without copying command catalogs into every project.
