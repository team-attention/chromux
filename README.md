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
- CLI support: macOS, Linux, and native Windows. The native AppKit status bar
  wrapper is macOS-only.

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
chromux launch work

# Open tabs for two agents
chromux open agent-a https://news.ycombinator.com
chromux open agent-b https://reddit.com/r/programming

# New tabs are background by default so headed Chrome does not steal focus
chromux open agent-c https://example.com

# Label related work for the local activity timeline
CHROMUX_TASK=research-pass chromux open agent-d https://example.com

# Open the local profile/activity companion app
chromux app --open

# Build and launch the native macOS app from a checkout (macOS only)
./apps/macos-status-bar/build.sh
open "apps/macos-status-bar/dist/chromux.app"

# Each operates independently
chromux snapshot agent-a
chromux click agent-a @3
chromux wait-for-text agent-a "expected text"
chromux run agent-b "return await js('document.title')"
chromux cdp agent-b Runtime.evaluate '{"expression":"location.href","returnByValue":true}'
chromux screenshot agent-a /tmp/hn.png

# Clean up
chromux close agent-a
chromux close agent-b
chromux kill default
```

## Modes

chromux defaults to the compatibility-oriented `default` mode. It preserves the
legacy browser behavior and is the right choice for QA, visual checks, login
flows, and tasks where the page should behave as much like a normal human-driven
Chrome tab as possible.

For crawling, use `crawl` mode:

```bash
CHROMUX_MODE=crawl chromux launch crawl-news --headless
CHROMUX_MODE=crawl CHROMUX_PROFILE=crawl-news chromux open worker-1 https://news.ycombinator.com
CHROMUX_MODE=crawl CHROMUX_PROFILE=crawl-news chromux open worker-1 https://example.com
CHROMUX_MODE=crawl CHROMUX_PROFILE=crawl-news chromux close worker-1
```

For URL batches, use the same crawl mode with `batch`:

```bash
CHROMUX_MODE=crawl CHROMUX_PROFILE=crawl-news \
  chromux batch --file urls.txt --workers 10 --out results.jsonl
```

`batch` reads plain URL lines or JSONL rows with `url`, `source_url`, or `href`,
reuses a worker-tab pool, writes one JSON result per URL, and closes worker
sessions when done.

`crawl` mode keeps the public command surface the same, but changes the profile
daemon policy:

- caps expensive profile operations (`CHROMUX_MAX_CONCURRENT_OPS_PER_PROFILE`,
  default `4`)
- caps active sessions (`CHROMUX_MAX_SESSIONS_PER_PROFILE`, default `12`)
- blocks common heavy media, font, and analytics resources
- uses shorter navigation waits (`CHROMUX_NAVIGATION_WAIT_MS`, default `5000`)
- closes idle/stale sessions
- closes CDP-unresponsive sessions so a worker tab can continue with later URLs
- closes initial blank/new-tab targets created during crawl-mode launch
- rejects new work when queue or resource guards are exceeded
- supports `chromux pause` / `chromux resume` as a profile hard-stop
- can optionally recycle long-lived worker tabs after a bounded number of
  navigations
- can optionally compact renderer growth for iframe-heavy crawl pages

For best crawling throughput, use a small worker-tab pool instead of one tab per
URL. For example, process 20 URLs through 3 to 5 stable session names and
repeatedly call `open` on those sessions. Reusing a session navigates the same
tab instead of creating another renderer.

If an orchestrator needs to stop a wave, pause the profile. Existing `close`,
`list`, and `stop` still work, but new browser work is rejected until resumed:

```bash
CHROMUX_PROFILE=crawl-news chromux pause
CHROMUX_PROFILE=crawl-news chromux resume
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

# Auto-launch headed Chrome, then keep new tabs in the background by default
CHROMUX_LAUNCH_MODE=headed chromux open bg-tab https://...

# Default profile is "default" — used when no --profile specified
chromux open my-tab https://...  # → uses "default" profile (auto-launches if needed)

# Stop a profile
chromux kill work
```

On macOS, chromux may be invoked from agent runtimes that set `HOME` to a
synthetic profile directory. Chrome's `--user-data-dir` still controls browser
profile isolation, but the Chrome child process is launched with the real macOS
account home so Chrome can initialize its per-user framework services and expose
the DevTools/CDP port reliably.

## Commands

chromux intentionally keeps the visible command surface small. When a new browser
operation is needed, express it with `run` or `cdp` before adding another verb.
The convenience commands below are for common human-like verification loops:
snapshot, act on fresh refs, wait for observable state, then snapshot or
screenshot again. A successful `open`, `click`, `fill`, `type`, or `press`
response is not proof that the page reached the intended state.

### Core Commands

| Command | Description |
|---------|-------------|
| `open <session> <url>` | Create or navigate a tab |
| `open --background <session> <url>` | Explicitly create a new tab without activating it |
| `run <session> <code\|--file PATH\|->` | Run multi-step async JS with `cdp`, `js`, `sleep`, and `waitLoad` helpers |
| `run <session> --page-file PATH` | Run a JS file directly in the page context, bypassing all shell/string escaping |
| `batch --file urls.txt --workers N --out results.jsonl` | Crawl URLs through a worker-tab pool |
| `cdp <session> <Method> <params-json>` | Send one raw CDP method to a session |
| `note [host] [--add "text"]` | List, show, or append durable site notes surfaced on `open` |

In default mode, `open` responses include an `interactive` element count and a
`next` field pointing at the snapshot command — inspect page structure first
rather than guessing selectors:

```json
{ "session": "s", "url": "…", "title": "…", "interactive": 359,
  "next": "chromux snapshot s --interactive" }
```

`run --page-file` is the escape-proof path for page scripts. The file contents
are JSON-encoded end to end, so regexes, quotes, and newlines never meet shell
quoting. Write natural statements and `return` a value:

```bash
cat > extract.js <<'EOF'
const rows = [...document.querySelectorAll('a[href]')]
  .map(a => ({ title: a.innerText.trim().split('\n')[0], url: a.href }))
  .filter(r => r.title.length > 8 && /^https?:/.test(r.url));
return rows.slice(0, 10);
EOF
chromux run s --page-file extract.js
```

`run` scripts execute in an async function context:

```bash
chromux run s - <<'JS'
await cdp('Page.navigate', { url: 'https://example.com' });
await waitLoad();
return await js('document.title');
JS
```

`run` executes in the runner context, not directly inside the page. Use `js(...)`
for page expressions or `page(...)` for common page metadata:

```bash
chromux run s - <<'JS'
return await page('({url:location.href,title:document.title,textLength:document.body.innerText.length})');
JS
```

`js(...)` runs page code in an isolated function scope, so lexical declarations
such as `const input = ...` do not leak into later `js(...)` calls for the same
tab. When `chromux run --timeout MS` is provided, that timeout is also used as
the default CDP timeout for `js(...)`, `cdp(...)`, and `page(...)` helper calls
unless the helper call passes its own timeout.

`cdp` is a thin passthrough:

```bash
chromux cdp s Runtime.evaluate '{"expression":"navigator.userAgent","returnByValue":true}'
```

### Lifecycle

| Command | Description |
|---------|-------------|
| `launch [name]` | Launch Chrome with isolated profile (default: "default") |
| `launch <name> --port N` | Launch with specific port |
| `ps` | List running profiles |
| `app [--port N] [--open]` | Serve the local profile/activity companion app |
| `pause [name]` | Hard-stop new browser work for a profile |
| `resume [name]` | Allow browser work again for a paused profile |
| `kill <name>` | Stop profile (Chrome + daemon) |
| `close <session>` | Close tab |
| `list` | List active sessions in current profile |
| `stop` | Stop daemon while keeping Chrome running |

### Convenience Shortcuts

| Command | Description |
|---------|-------------|
| `snapshot <session>` | Accessibility tree with `@ref` numbers |
| `snapshot <session> --interactive` | Only interactive elements (smaller payload) |
| `click <session> @<ref>` | Click element by ref |
| `click <session> "selector"` | Click by CSS selector |
| `click <session> --xy X Y` | Click validated viewport coordinates via CDP mouse events |
| `fill <session> @<ref> "text"` | Fill input field |
| `type <session> "text"` | Insert text into the focused field |
| `press <session> <Enter\|Tab\|Escape\|Backspace>` | Press a supported special key |
| `wait-for-text <session> "text" [timeout-ms]` | Wait until page text appears |
| `wait-for-selector <session> "selector" [timeout-ms]` | Wait until a selector is visible |
| `screenshot <session> [path]` | Take PNG screenshot |
| `show <session>` | Open DevTools in browser (inspect live tab, even headless) |

`click` brings the tab forward before acting. Ref/selector clicks scroll the
target into view and fail when the element is hidden, zero-size, stale, outside
the viewport after scroll, or covered by another element at the click point.
Coordinate clicks validate that `X,Y` are inside the current viewport. `fill`
updates input state through the native value setter and dispatches input/change
events so common frontend frameworks observe the value.

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
      .state                     PID, Chrome CDP port, daemonPort cache
    work/
      .state

Chrome instance A (port 9300, ~/.chromux/profiles/default/)
  ↑ CDP WebSocket per tab
chromux daemon (localhost TCP 127.0.0.1:9400)
  ↑ HTTP
CLI / AI agents

Chrome instance B (port 9301, ~/.chromux/profiles/work/)
  ↑ CDP WebSocket per tab
chromux daemon (localhost TCP 127.0.0.1:9401)
  ↑ HTTP
CLI / AI agents

chromux status app (local HTTP)
  ↑ reads profile state, activity logs, and site notes
~/.chromux/activity/events.jsonl
~/.chromux/activity/aggregates.json
```

- **No Playwright/Puppeteer** — raw `WebSocket` + `http` from Node.js stdlib
- **Tab CRUD** via Chrome's `/json/*` HTTP endpoints
- **Page ops** via CDP WebSocket JSON-RPC
- **Daemon per profile** keeps WebSocket connections alive across CLI invocations
- **Localhost TCP daemon transport** binds profile daemons to `127.0.0.1` on
  macOS, Linux, and Windows; `.state.port`/`.state.cdpPort` remain Chrome CDP
  ports, while `.state.daemonPort` is the daemon HTTP endpoint
- **Auto-launch** — `chromux open` auto-launches default profile if needed
- **Profile adoption** — `.state` is a cache, not the source of truth; `chromux ps`,
  `launch`, `open`, and `kill` rediscover live Chrome processes from
  `--user-data-dir` + CDP when daemon endpoint or state files drift or disappear
- **Cold-start coordination** — concurrent first `open` calls for the same profile
  share one startup lock so only one process launches Chrome and the daemon while
  the others wait for the profile daemon endpoint to become healthy.
- **macOS agent-home compatibility** — chromux state follows the invoking
  process `HOME`, while the Chrome child uses the real account home on macOS;
  `--user-data-dir` still keeps the Chrome profile isolated
- **Local activity log** — CLI commands append local JSONL events with profile,
  session, command, result, duration, Task label, and full URL/title when
  available; Chrome History files are not read
- **Companion status app** — `chromux app` serves a zero-dependency local UI for
  profile status, raw events, Task timeline, site-note links, retention,
  deletion, and redaction
- **Windows Chrome discovery** — native Windows CLI runs auto-discover Google
  Chrome Stable from normal Program Files or LocalAppData installations, while
  explicit `chromePath` remains available for custom locations
- **macOS app** — `apps/macos-status-bar` builds a native AppKit
  menu bar app that starts the local status server and opens the dashboard in a
  WebKit window; native app packaging is macOS-only
- **macOS release package** — `apps/macos-status-bar/package-release.sh` creates
  a zipped `.app` bundle for GitHub Releases and manual downloads

## Configuration

Optional `~/.chromux/config.json`:

```json
{
  "chromePath": "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "portRangeStart": 9300,
  "portRangeEnd": 9399,
  "daemonPortRangeStart": 9400,
  "daemonPortRangeEnd": 9499
}
```

On Windows, Chrome Stable is auto-discovered from normal Program Files or
LocalAppData install locations. Use `chromePath` only for custom locations, for
example `C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe`.

## Launch Modes

chromux supports two Chrome launch modes:

- `headless`: no visible Chrome window. This is the default auto-launch mode
  unless `CHROMUX_LAUNCH_MODE` is set.
- `headed`: normal visible Chrome window.

By default, `chromux open` creates new tabs in the background so a visible headed
profile does not come to the front for each new session:

```bash
chromux launch work
CHROMUX_PROFILE=work chromux open tab https://example.com
```

Per-command equivalents are available:

```bash
chromux open --background tab https://example.com
chromux open --no-focus tab https://example.com
chromux open --foreground tab https://example.com
```

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `CHROMUX_PROFILE` | `default` | Active profile name |
| `CHROMUX_MODE` | `default` | Browser policy mode: `default` for compatibility/QA, `crawl` for efficient crawling |
| `CHROMUX_TASK` | empty | Optional Task label written to activity events and used by the status app timeline |
| `CHROMUX_HOME` | `~/.chromux` | Override chromux state root for tests or isolated runs |
| `CHROMUX_LAUNCH_MODE` | `headless` for auto-launch | Auto-launch mode used by tab commands when a profile is not running: `headless` or `headed` |
| `CHROMUX_OPEN_BACKGROUND` | `1` | New tabs are created through `Target.createTarget({ background: true })` by default. Set to `0`, `false`, `no`, or `off`, or pass `open --foreground`, to activate new tabs instead |
| `CHROMUX_MAX_CONCURRENT_OPS_PER_PROFILE` | `4` in crawl, unlimited in default | Maximum expensive daemon operations running at once |
| `CHROMUX_MAX_QUEUED_OPS_PER_PROFILE` | `16` in crawl, unlimited in default | Maximum queued expensive operations before new requests are rejected |
| `CHROMUX_MAX_SESSIONS_PER_PROFILE` | `12` in crawl, unlimited in default | Maximum active sessions before new sessions are rejected |
| `CHROMUX_IDLE_TTL_MS` | `20000` in crawl, disabled in default | Idle session age before the daemon closes the tab |
| `CHROMUX_SESSION_TTL_MS` | `300000` in crawl, disabled in default | Maximum session age before the daemon closes the tab |
| `CHROMUX_NAVIGATION_WAIT_MS` | `5000` in crawl, `30000` in default | Navigation wait budget for `open` |
| `CHROMUX_MAX_CHROME_PROCESSES_PER_PROFILE` | `60` in crawl, disabled in default | Reject new opens when profile Chrome process count reaches this value |
| `CHROMUX_MAX_RENDERERS_PER_PROFILE` | `40` in crawl, disabled in default | Reject new opens when profile renderer count reaches this value |
| `CHROMUX_MAX_RSS_MB_PER_PROFILE` | `12000` in crawl, disabled in default | Reject new opens when profile Chrome RSS reaches this value |
| `CHROMUX_BLOCK_RESOURCES` | `1` in crawl | Set to `0` to disable crawl mode media/font/analytics blocking |
| `CHROMUX_CLOSE_INITIAL_TABS` | `1` in crawl | Set to `0` to keep initial blank/new-tab targets on launch |
| `CHROMUX_MAX_NAVIGATIONS_PER_SESSION` | `0` | Recreate a worker tab after this many `open` navigations; disabled by default because it can raise short-term renderer peaks |
| `CHROMUX_COMPACT_RENDERERS` | `0` | Opt into crawl-only Chrome flags that reduce renderer growth on iframe-heavy pages; keep disabled for broad compatibility |
| `CHROMUX_RENDERER_PROCESS_LIMIT` | `8` in compact mode | Renderer process cap passed to Chrome when compact renderer mode is enabled |
| `CHROMUX_EXTRA_CHROME_ARGS` | empty | Extra Chrome launch args, split like shell words |
| `CHROMUX_CLI_TIMEOUT_MS` | `90000` in crawl, `30000` in default | Default CLI request timeout for commands such as `open` |

## Site Knowledge

chromux surfaces durable, non-secret site notes from
`~/.chromux/skills/<host>/*.md` in `open` responses. Host matching walks up
parent domains, so notes saved under `naver.com` also surface on
`search.naver.com` pages.

The `note` command is the write side of that loop:

```bash
chromux note                                  # list hosts with notes
chromux note naver.com                        # show notes (includes parent domains)
chromux note naver.com --add "search results: snapshot --interactive shows result titles as @refs"
```

When a `close` or `kill` follows recent failed commands on a host that has no
notes yet, chromux prints a one-line reminder pointing at `chromux note` — the
activity log already holds the per-command errors that make such notes worth
writing.

## Activity Log And Status App

chromux records local activity events for CLI usage under
`~/.chromux/activity/events.jsonl`. Events include timestamp, profile, session,
command, sanitized command arguments, result, duration, optional `CHROMUX_TASK`,
and the full URL/title/host when the command result exposes page state. Input
text for `fill` and `type`, and inline code for `run` and `eval`, are not stored
as raw arguments.

The default full-URL retention is 90 days. The status app can set retention to
7, 30, 90, 365 days, or unlimited, delete all/profile/Task raw events, and
redact URL/title/host fields while preserving command aggregate counters in
`~/.chromux/activity/aggregates.json`.

Start the app locally:

```bash
chromux app
chromux app --port 9341 --open
```

The app lists known profiles, selected profile state, daemon/session counts when
available, active-first profile sorting, search/status filters, bulk profile
selection/deletion, raw command events, Task-first timeline groups, fallback
session windows, and site knowledge note paths under
`~/.chromux/skills/<host>/*.md`. V1 does not read Chrome History.

On macOS, use the GitHub Release asset when you want a real menu bar app instead
of a browser tab. The release zip contains `chromux.app`; unzip it, move it to
`/Applications` if desired, and open it from Finder:

```bash
unzip chromux-macos-<version>.zip
open "chromux.app"
```

The release app still requires Node.js >= 22 on the Mac. It does not install or
update the global `chromux` CLI. It runs the bundled `chromux.mjs` and dashboard
with the local `node` binary, looking at `CHROMUX_NODE`, common Homebrew/system
paths, and then `PATH`. If macOS blocks an unsigned download on first launch,
use Control-click > Open or approve it in System Settings > Privacy & Security.

The one-pass installer in `install.md` asks macOS users whether to download the
latest release app, copy it to `/Applications/chromux.app`, and launch it. If
`/Applications` is not writable, it falls back to `~/Applications/chromux.app`.

From a repo checkout, build and launch the same native wrapper locally:

```bash
./apps/macos-status-bar/build.sh
open "apps/macos-status-bar/dist/chromux.app"
```

To produce the GitHub Release zip on macOS:

```bash
./apps/macos-status-bar/package-release.sh
ls apps/macos-status-bar/release/
```

The wrapper adds a `cx` item to the macOS status bar, starts the same local
dashboard server, and exposes menu actions for opening the dashboard, opening it
in a browser, restarting the server, and quitting. The `cx` menu also refreshes
and shows currently active profiles when it opens.

## License

MIT
