---
name: chromux
description: Real Chrome browser automation through the chromux CLI. Use when an agent needs to open, inspect, interact with, scrape, test, or verify web pages using isolated Chrome profiles and raw CDP.
version: 0.1.0
platforms: [macos, linux, windows]
metadata:
  hermes:
    tags: [browser, chrome, cdp, automation]
    category: browser
---

# chromux

Direct browser control through the `chromux` CLI. chromux launches or reuses an
isolated real Chrome profile, keeps one daemon per profile, and exposes a small
CLI surface for tab work, multi-step JavaScript, raw CDP, screenshots, and
diagnostics.

The CLI supports macOS, Linux, and native Windows with Node.js >= 22 and Google
Chrome Stable. On Windows, use PowerShell or cmd; Chrome Stable is auto-detected
from normal Program Files or LocalAppData installs unless `chromePath` is set.

For setup, installation, or connection problems, read the repo's `install.md`.
For multi-step browser work orchestration (profile selection, recon, parallel
subagents, cleanup, domain notes), use the `chromux-work` skill
(`skills/chromux-work/SKILL.md`). For the current command surface, run
`chromux help`; it is the source of truth.

## First Rule

Resolve the chromux command once, then inline the resolved command and session ID
literally in every shell call. Do not rely on shell variables persisting across
agent tool calls.

```bash
CX=$(command -v chromux 2>/dev/null || echo "") && [ -n "$CX" ] && echo "$CX" || echo "MISSING"
```

If chromux is missing, read the repo's `install.md` and install it before
browser work.

## Normal Workflow

1. Generate a unique session ID, for example `exp-ab12`.
2. Open the page: `<chromux> open exp-ab12 <url>`. The response includes an
   `interactive` element count and a `next` field with the snapshot command —
   follow it before guessing selectors.
3. Inspect structure with `<chromux> snapshot exp-ab12`.
4. Prefer `@ref` interactions from the snapshot:
   - `<chromux> click exp-ab12 @<N>`
   - `<chromux> fill exp-ab12 @<N> "text"`
   - `<chromux> type exp-ab12 "text to insert"`
   - `<chromux> press exp-ab12 Enter`
5. After an action or navigation, wait for observable state when possible:
   - `<chromux> wait-for-text exp-ab12 "Saved" 5000`
   - `<chromux> wait-for-selector exp-ab12 ".toast" 5000`
6. Re-run `snapshot` after every meaningful click, fill, type, press,
   navigation, or state change. Refs stay stable within a document (new
   elements get new numbers; existing ones keep theirs), but navigation
   resets them. After an in-page action, prefer
   `<chromux> snapshot exp-ab12 --diff` — it prints only the lines added and
   removed since your previous snapshot, which is usually a few lines instead
   of the whole tree.
7. Use `screenshot` for visual verification and evidence, not as the primary
   way to locate elements.
8. Close the session when done: `<chromux> close exp-ab12`.

## Current Core Surface

Run `chromux help` for exact syntax. The day-to-day mental model is:

- `open` creates or navigates a tab. New tabs are background by default so a
  headed profile is not activated for each new tab. Use `open --foreground` or
  `CHROMUX_OPEN_BACKGROUND=0` only when activation is intentional.
- `snapshot` returns an accessibility tree with `@ref` handles. Add
  `--interactive` (or `--filter interactive`) to return only actionable
  elements (buttons, links, inputs) for a smaller payload. Add `--diff` to see
  only what changed since the previous snapshot of the session.
- `click`, `fill`, `type`, `press`, `wait-for-text`, and `wait-for-selector`
  are convenience shortcuts for visible interaction and observable UI state.
  Their responses include a `next` field pointing at `snapshot --diff` —
  follow it to verify the action's effect for a few dozen tokens instead of a
  full tree. For a known multi-step sequence, prefer a single `run` call over
  many separate shortcut commands — it collapses several agent round-trips
  into one.
- `type` inserts literal text into the focused field. Use `press` for special
  keys: Enter, Tab, Escape, Backspace, Delete, the arrow keys, Home, End,
  PageUp, and PageDown (arrow keys drive dropdowns and autocomplete lists).
- `run` executes multi-step async JavaScript with `cdp`, `js`, `sleep`,
  `waitLoad`, `page(expr?)`, `waitFor(...)`, and `assertPage(...)` helpers.
  `waitFor` accepts an array of fallback selector/text candidates — the first
  match wins and is returned as `matched` — so scripts survive single site
  changes. Use `run --receipt PATH` when a flow needs redacted local timing
  and replay evidence.
- Once a flow works, save it: `chromux script save <host>/<name> --file f.js`,
  then replay with `run <session> --script <host>/<name>` — zero model calls.
  `open` responses list saved scripts for the page's host. If a replay fails,
  the error points at the script file: snapshot the page, fix the flow, and
  save it again.
- Add `--schema contract.json` to `run` when extracting structured data — the
  result is validated against a JSON-schema subset and mismatches fail with
  per-path errors, so malformed extractions never flow downstream silently.
- `batch --file urls.txt --workers N --out results.jsonl` processes URL lines or
  JSONL rows through a worker-tab pool in the current profile. Add `--retries N`
  and `--host-backoff-ms MS` for bounded retry and domain backoff.
- `cdp` sends one raw Chrome DevTools Protocol method.
- `watch` reads console and network diagnostics.
- `screenshot` saves visual evidence.
- `show` opens DevTools for a live tab.
- `close`, `list`, `launch`, `ps`, `kill`, and `stop` manage sessions/profiles.
- `pause` and `resume` hard-stop or allow new browser work for a profile.
- `app` serves the local profile/activity companion app.

When a browser task has a stable name, set `CHROMUX_TASK=<label>` on every
related chromux command. The label is stored in local activity events and lets
the companion app group raw commands into a Task timeline. Use short,
non-secret labels such as `checkout-qa` or `pricing-crawl`, not private content.

## Modes

Use the default mode for QA, visual verification, login flows, and tasks where
Chrome should behave as much like a human-driven tab as possible.

Use `crawl` mode for efficient read-only collection:

```bash
CHROMUX_MODE=crawl CHROMUX_PROFILE=work /path/to/chromux open worker-1 https://example.com
```

In crawl mode, prefer a small worker-tab pool: reuse 3 to 5 stable session names
and repeatedly `open` new URLs in those sessions. Reusing a session navigates the
same tab instead of creating another Chrome renderer.

For a URL batch, prefer the built-in queue:

```bash
CHROMUX_MODE=crawl CHROMUX_PROFILE=work /path/to/chromux batch --file urls.txt --workers 10 --retries 1 --host-backoff-ms 250 --out results.jsonl
```

Each batch JSONL row includes attempts, worker/session identity, duration,
final URL/title metadata, retryability, and `failureKind`.
The summary includes p50/p95 timings, retry count, failure-kind totals, and host
backoff state.

If a parent orchestration decides to stop a wave, use:

```bash
CHROMUX_PROFILE=work /path/to/chromux pause
CHROMUX_PROFILE=work /path/to/chromux resume
```

Crawl mode adds resource guardrails: capped expensive operations, capped active
sessions, media/font/analytics blocking, shorter navigation waits, initial blank
tab cleanup, idle session cleanup, optional worker-tab recycling, and automatic
closure of CDP-unresponsive sessions. It can opt into crawl-only renderer
compaction flags for iframe-heavy process growth. Concurrent cold-start tab
commands for one profile coordinate through the profile startup lock. Tune with:

- `CHROMUX_MAX_CONCURRENT_OPS_PER_PROFILE` (default `4`)
- `CHROMUX_MAX_QUEUED_OPS_PER_PROFILE` (default `16`)
- `CHROMUX_MAX_SESSIONS_PER_PROFILE` (default `12`)
- `CHROMUX_IDLE_TTL_MS` (default `20000`)
- `CHROMUX_SESSION_TTL_MS` (default `300000`)
- `CHROMUX_NAVIGATION_WAIT_MS` (default `5000`)
- `CHROMUX_MAX_CHROME_PROCESSES_PER_PROFILE` (default `60`)
- `CHROMUX_MAX_RENDERERS_PER_PROFILE` (default `40`)
- `CHROMUX_MAX_RSS_MB_PER_PROFILE` (default `12000`)
- `CHROMUX_BLOCK_RESOURCES=0` to disable resource blocking
- `CHROMUX_CLOSE_INITIAL_TABS=0` to keep launch-created blank/new-tab targets
- `CHROMUX_MAX_NAVIGATIONS_PER_SESSION` (default `0`; opt in carefully because
  recycling can increase short-term renderer peaks)
- `CHROMUX_COMPACT_RENDERERS=1` for iframe-heavy crawls after testing the target
  site
- `CHROMUX_RENDERER_PROCESS_LIMIT` (default `8`) for crawl compact mode
- `CHROMUX_EXTRA_CHROME_ARGS` for explicit launch-flag experiments

Older aliases such as `eval`, `scroll`, `wait`, `console`, `network`, and
`scroll-until` may still work for compatibility, but do not teach them as the
primary interface. Prefer `run`, `cdp`, and `watch`.

## JavaScript And CDP

Use `run` for multi-step scripts:

```bash
/path/to/chromux run exp-ab12 - <<'JS'
await cdp('Page.navigate', { url: 'https://example.com' });
await waitLoad();
return await js('document.title');
JS
```

Use `cdp` for a single raw protocol call:

```bash
/path/to/chromux cdp exp-ab12 Runtime.evaluate '{"expression":"location.href","returnByValue":true}'
```

For anything longer than a one-liner of page code, prefer `--page-file` over
inline strings or heredocs. It sends the file contents to the page with no
shell/string escaping layer, so regexes, quotes, and newlines survive intact:

```bash
/path/to/chromux run exp-ab12 --page-file /path/to/extract.js
```

The page file is plain statements plus `return`:

```js
const rows = [...document.querySelectorAll('a[href]')]
  .map(a => ({ title: a.innerText.trim().split('\n')[0], url: a.href }));
return rows.slice(0, 10);
```

`run` is intentionally small. It does not expose Node `import` or `require`.
Reusable browser logic should be a copied `run` script, a checked-in helper
example, or a future chromux helper, not an ad hoc hidden module load.

`run` executes in the runner context, not directly inside the page. Use `js(...)`
for page expressions or `page(...)` for common page metadata:

```bash
/path/to/chromux run exp-ab12 - <<'JS'
return await page('({url:location.href,title:document.title,textLength:document.body.innerText.length})');
JS
```

`js(...)` runs page code in an isolated function scope, so lexical declarations
such as `const input = ...` do not leak into later `js(...)` calls for the same
tab. When `chromux run --timeout MS` is provided, that timeout is also used as
the default CDP timeout for `js(...)`, `cdp(...)`, and `page(...)` helper calls
unless the helper call passes its own timeout.

Use the readiness helpers when a state change can be proven inside one browser
operation:

```bash
/path/to/chromux run exp-ab12 --receipt /tmp/chromux-run-receipt.json - <<'JS'
await waitFor('#email', { kind: 'selector', timeoutMs: 5000 });
await js("document.querySelector('#email').value='agent@example.com'");
const ready = await waitFor('Saved', { kind: 'text', timeoutMs: 5000 });
return { ready, page: await page('({url:location.href,title:document.title})') };
JS
```

Receipts store command timing, profile/session/mode, code source, result shape,
failure kind, and redaction metadata.
They do not store raw inline code, raw typed text, cookies, authorization
headers, tokens, or secrets.

## Builtin Runner Snippets

Before recreating common browser loops, check the bundled snippets under
`snippets/_builtin/` in this skill or repo directory. They are examples for
`chromux run`, not extra top-level CLI verbs.

Available snippets:

- `snippets/_builtin/scroll-until.js` — scroll until a selector count reaches a
  target count. Use this for infinite feeds, load-more surfaces, and result
  collection loops before falling back to the deprecated `scroll-until` alias.
- `snippets/_builtin/page-extract.js` — collect structured page metadata
  without dumping full body text or HTML.
- `snippets/_builtin/form-flow.js` — fill, submit, and prove readiness for a
  simple form flow.
- `snippets/_builtin/network-errors.js` — collect browser-observable broken
  resource diagnostics.
- `snippets/_builtin/page-assert.js` — prove selector, text, and DOM assertions.

Run a snippet with an absolute path when possible:

```bash
/path/to/chromux run exp-ab12 --file /path/to/chromux/snippets/_builtin/scroll-until.js
/path/to/chromux run exp-ab12 --file /path/to/chromux/snippets/_builtin/network-errors.js
```

If the installed skill directory contains a symlinked `snippets/` folder, the
same file is also available next to this `SKILL.md`.

## Diagnostics

Use `watch` for console and network capture:

```bash
/path/to/chromux watch exp-ab12 console
/path/to/chromux watch exp-ab12 network --all
/path/to/chromux watch exp-ab12 console --off
/path/to/chromux watch exp-ab12 network --off
```

Use diagnostics as supporting evidence. A passing UI action with new console
errors or failed requests should be reported as partial or suspicious, not
silently accepted.

## Local Activity Log

chromux writes local activity events under `~/.chromux/activity/events.jsonl`.
Events include profile, session, command, result, duration, optional
`CHROMUX_TASK`, and full URL/title/host when command results expose page state.
`fill`/`type` text and inline `run`/`eval` code are not stored as raw arguments.

Open the companion app when profile state, raw command history, Task timeline,
site-note links, retention, deletion, or redaction controls are useful:

```bash
/path/to/chromux app
```

On macOS, the repo also includes a native status bar wrapper:

```bash
/path/to/chromux/apps/macos-status-bar/build.sh
open "/path/to/chromux/apps/macos-status-bar/dist/Chromux Status.app"
```

The wrapper adds a `cx` item to the macOS menu bar and opens the same local
dashboard in a WebKit window. GitHub Release zips contain the same app bundle
for double-click use on Macs with Node.js >= 22 installed.
This native wrapper is macOS-only; on Windows and Linux use `chromux app` or
`chromux app --open`.

The app and activity layer do not read Chrome History. Full URL retention
defaults to 90 days and can be changed in the app.

## Site Knowledge

chromux may surface host-specific hints from `~/.chromux/skills/<host>/*.md` on
navigation. Host matching includes parent domains, so `naver.com` notes also
surface on `search.naver.com`. If the `open` response includes hints, read them
before inventing a new approach.

Use the `note` command to write knowledge back — do this whenever a session
taught you durable site behavior, especially after failed attempts:

```bash
/path/to/chromux note <host> --add "stable selector / quirk / wait behavior"
/path/to/chromux note <host>          # review existing notes first
```

If you learn durable site knowledge, or discover existing notes are stale,
wrong, too task-specific, or unsafe, review/update public, non-secret,
non-task-diary notes under the relevant host directory.

Good site knowledge:
- stable selectors or URL patterns
- framework quirks
- hidden waits or load-more behavior
- private API shapes that are safe to document

Bad site knowledge:
- credentials, tokens, cookies, or personal data
- pixel coordinates that will break on layout changes
- one-off task narration
- stale selectors or URLs that you already know are wrong

## Gotchas

- Shell variables do not persist across separate agent shell calls. Inline the
  chromux path and session ID literally.
- A successful `open` means the browser navigated, not that the page is ready
  for the intended task. Use `snapshot`, `run`, or `watch` to verify state.
- A successful action response means chromux dispatched the action, not that
  the application accepted it. Prefer `wait-for-text`, `wait-for-selector`,
  another `snapshot`, or a focused `run` assertion before reporting success.
- For long page-side promises inside `run`, pass `--timeout MS`; the value now
  applies to the outer run and to default helper CDP calls.
- Prefer `@ref` clicks over CSS selectors for normal page interaction.
- `click` brings the tab forward, scrolls ref/selector targets into view, and
  fails if the target is stale, hidden, zero-size, still outside the viewport,
  or covered by another element at the click point.
- Coordinate click is available when visual geometry is the right tool:
  `<chromux> click exp-ab12 --xy X Y`. Coordinates must be inside the current
  viewport.
- Auth walls are user-owned. If a site redirects to login and no saved profile
  is available, stop and ask the user to log in manually.
- Always close sessions you open. Use `chromux ps` and `chromux kill <profile>`
  when profile cleanup is needed; `kill` also clears stale Chrome singleton lock
  files and profile markers after confirming the isolated profile has no
  remaining Chrome process.
