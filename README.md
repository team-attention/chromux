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

## Quick Start

```bash
# Launch Chrome with an isolated profile (auto-finds Chrome, auto-assigns port)
chromux launch

# Open tabs for two agents
chromux open agent-a https://news.ycombinator.com
chromux open agent-b https://reddit.com/r/programming

# Each operates independently
chromux snapshot agent-a
chromux click agent-a @3
chromux eval agent-b "document.title"
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

# Default profile is "default" — used when no --profile specified
chromux open my-tab https://...  # → uses "default" profile (auto-launches if needed)

# Stop a profile
chromux kill work
```

## Commands

### Profile

| Command | Description |
|---------|-------------|
| `launch [name]` | Launch Chrome with isolated profile (default: "default") |
| `launch <name> --port N` | Launch with specific port |
| `ps` | List running profiles |
| `kill <name>` | Stop profile (Chrome + daemon) |

### Tab Operations

| Command | Description |
|---------|-------------|
| `open <session> <url>` | Navigate (auto-creates tab) |
| `snapshot <session>` | Accessibility tree with `@ref` numbers |
| `click <session> @<ref>` | Click element by ref |
| `click <session> "selector"` | Click by CSS selector |
| `fill <session> @<ref> "text"` | Fill input field |
| `type <session> "text"` | Keyboard input (Enter, Tab, etc.) |
| `eval <session> "js"` | Run JavaScript expression |
| `screenshot <session> [path]` | Take PNG screenshot |
| `scroll <session> up\|down` | Scroll page |
| `wait <session> <ms>` | Wait milliseconds |
| `close <session>` | Close tab |
| `list` | List active sessions in current profile |
| `stop` | Stop daemon (keeps Chrome running) |

## Architecture

```
~/.chromux/
  config.json                    Global config (optional)
  profiles/
    default/                     Chrome user-data-dir
      .state                     PID, port, socket path
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

## Configuration

Optional `~/.chromux/config.json`:

```json
{
  "chromePath": "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "portRangeStart": 9300,
  "portRangeEnd": 9399
}
```

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `CHROMUX_PROFILE` | `default` | Active profile name |

## License

MIT
