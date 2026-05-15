# chromux

tmux for Chrome tabs — zero-dependency parallel Chrome tab controller via raw CDP.

## Why

AI agents need to browse the web in parallel using the user's **real Chrome** (with logins preserved, no bot detection). Existing tools either bundle their own Chromium (Playwright/Puppeteer) or can't isolate tabs properly (agent-browser `--cdp --session`).

chromux solves this by talking to Chrome's DevTools Protocol directly using only Node.js built-ins — no Playwright, no Puppeteer, no npm dependencies.

| | Playwright/Puppeteer | agent-browser `--cdp` | chromux |
|---|---|---|---|
| Browser | Bundled Chromium | Real Chrome | Real Chrome |
| Bot detection | Often caught | Avoided | Avoided |
| Tab isolation | Yes | **No** (sessions share tab) | **Yes** |
| Parallel agents | Yes | **Broken** | **Yes** |
| Dependencies | 100s of MB | playwright-core | **None** |
| Profile management | No | No | **Yes** |

## Prerequisites

- **Node.js >= 22** (for built-in `WebSocket`)
- **Google Chrome** installed

## Agent Skills

To use chromux as agent browser skills, install the CLI and register the two
repo-local skills with Codex, Claude Code, or Hermes:

- [`install.md`](install.md) — CLI install, skill registration, and smoke test
- [`skills/chromux/SKILL.md`](skills/chromux/SKILL.md) — day-to-day chromux CLI usage
- [`skills/chromux-work/SKILL.md`](skills/chromux-work/SKILL.md) — profile selection, recon, parallel browser work, cleanup, and domain notes
- [`AGENTS.md`](AGENTS.md) — repo guidance for coding agents

## Quick Start

```bash
# Launch Chrome with an isolated profile (auto-finds Chrome, auto-assigns port)
chromux launch
chromux launch work --hidden

# Open tabs for two agents
chromux open agent-a https://news.ycombinator.com
chromux open agent-b https://reddit.com/r/programming

# Each operates independently
chromux snapshot agent-a
chromux click agent-a @3
chromux run agent-b "return await js('document.title')"
chromux cdp agent-b Runtime.evaluate '{"expression":"location.href","returnByValue":true}'
chromux screenshot agent-a /tmp/hn.png

# Clean up
chromux close agent-a
chromux close agent-b
chromux kill default
```

## Profile Management

Each profile is an isolated Chrome instance with its own user-data-dir, logins, cookies, and extensions.

```bash
# Launch named profiles
chromux launch work
chromux launch personal

# See what's running
chromux ps
# PROFILE             PORT    PID       STATUS      TABS
# work                9300    12345     running     3
# personal            9301    12346     running     1

# Use a specific profile for tab commands
chromux --profile work open my-tab https://...
CHROMUX_PROFILE=personal chromux open other-tab https://...

# Auto-launch tab commands in hidden headed mode
CHROMUX_LAUNCH_MODE=hidden chromux open hidden-tab https://...

# Default profile is "default" — used when no --profile specified
chromux open my-tab https://...  # → uses "default" profile (auto-launches if needed)

# Stop a profile
chromux kill work
```

## Commands

chromux intentionally keeps the visible command surface small. When a new browser
operation is needed, express it with `run` or `cdp` before adding another verb.

### The 3 You Actually Need

| Command | Description |
|---------|-------------|
| `open <session> <url>` | Create or navigate a tab |
| `run <session> <code\|--file PATH\|->` | Run multi-step async JS with `cdp`, `js`, `sleep`, and `waitLoad` helpers |
| `cdp <session> <Method> <params-json>` | Send one raw CDP method to a session |

`run` scripts execute in an async function context:

```bash
chromux run s - <<'JS'
await cdp('Page.navigate', { url: 'https://example.com' });
await waitLoad();
return await js('document.title');
JS
```

`cdp` is a thin passthrough:

```bash
chromux cdp s Runtime.evaluate '{"expression":"navigator.userAgent","returnByValue":true}'
```

### Lifecycle

| Command | Description |
|---------|-------------|
| `launch [name]` | Launch Chrome with isolated profile (default: "default") |
| `launch <name> --hidden` | Launch headed Chrome offscreen so it can be automated without covering the desktop |
| `launch <name> --port N` | Launch with specific port |
| `ps` | List running profiles |
| `kill <name>` | Stop profile (Chrome + daemon) |
| `close <session>` | Close tab |
| `list` | List active sessions in current profile |
| `stop` | Stop daemon while keeping Chrome running |

### Convenience Shortcuts

| Command | Description |
|---------|-------------|
| `snapshot <session>` | Accessibility tree with `@ref` numbers |
| `click <session> @<ref>` | Click element by ref |
| `click <session> "selector"` | Click by CSS selector |
| `click <session> --xy X Y` | Click viewport coordinates via CDP mouse events |
| `fill <session> @<ref> "text"` | Fill input field |
| `type <session> "text"` | Keyboard input (Enter, Tab, etc.) |
| `screenshot <session> [path]` | Take PNG screenshot |
| `show <session>` | Open DevTools in browser (inspect live tab, even headless) |

### Watch / Debug

| Command | Description |
|---------|-------------|
| `watch <session> console` | Capture console logs, enabling capture on first call |
| `watch <session> console --off` | Disable console capture |
| `watch <session> network` | Capture failed requests |
| `watch <session> network --all` | Capture all requests |
| `watch <session> network --off` | Disable network capture |

### Compatibility Aliases

The older `eval`, `scroll`, `wait`, `console`, `network`, and `scroll-until`
commands remain available for existing automation and do not print deprecation
warnings. They are intentionally hidden from the main help surface.

`scroll-until` is now documented as runner material in
`snippets/_builtin/scroll-until.js`; copy or adapt that file when a task needs the
pattern.

## Architecture

```
~/.chromux/
  config.json                    Global config (optional)
  profiles/
    default/                     Chrome user-data-dir
      .state                     PID, port, socket path cache
    work/
      .state

Chrome instance A (port 9300, ~/.chromux/profiles/default/)
  ↑ CDP WebSocket per tab
chromux daemon (Unix socket /tmp/chromux-default.sock)
  ↑ HTTP
CLI / AI agents

Chrome instance B (port 9301, ~/.chromux/profiles/work/)
  ↑ CDP WebSocket per tab
chromux daemon (Unix socket /tmp/chromux-work.sock)
  ↑ HTTP
CLI / AI agents
```

- **No Playwright/Puppeteer** — raw `WebSocket` + `http` from Node.js stdlib
- **Tab CRUD** via Chrome's `/json/*` HTTP endpoints
- **Page ops** via CDP WebSocket JSON-RPC
- **Daemon per profile** keeps WebSocket connections alive across CLI invocations
- **Auto-launch** — `chromux open` auto-launches default profile if needed
- **Profile adoption** — `.state` is a cache, not the source of truth; `chromux ps`,
  `launch`, `open`, and `kill` rediscover live Chrome processes from
  `--user-data-dir` + CDP when daemon/socket/state files drift or disappear

## Configuration

Optional `~/.chromux/config.json`:

```json
{
  "chromePath": "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "portRangeStart": 9300,
  "portRangeEnd": 9399
}
```

## Launch Modes

chromux supports three Chrome launch modes:

- `headless`: no visible Chrome window. This is the default auto-launch mode
  unless `CHROMUX_LAUNCH_MODE` is set.
- `headed`: normal visible Chrome window.
- `hidden`: headed Chrome launched offscreen/backgrounded. It avoids the
  `HeadlessChrome` user-agent path while trying not to cover the desktop.

Use hidden mode explicitly:

```bash
chromux launch work --hidden
```

Make auto-launch use hidden mode:

```bash
export CHROMUX_LAUNCH_MODE=hidden
chromux --profile work open tab https://example.com
```

On macOS, hidden mode uses `open -g -j -n -a "Google Chrome" --args ...` plus
offscreen window bounds. It is designed to avoid focus stealing, but it is not a
security boundary or a guarantee that Chrome can never become visible. OS-level
activation, permission prompts, popups, or user actions can still surface a
Chrome window. Use `chromux show <session>` when you intentionally want to
inspect a live tab.

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `CHROMUX_PROFILE` | `default` | Active profile name |
| `CHROMUX_LAUNCH_MODE` | `headless` for auto-launch | Auto-launch mode used by tab commands when a profile is not running: `headless`, `headed`, or `hidden` |

## License

MIT
