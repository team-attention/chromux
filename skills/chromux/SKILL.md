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

Direct control of a real Chrome profile through the `chromux` CLI: tab work,
multi-step JavaScript, raw CDP, screenshots, diagnostics. One daemon per
profile; sessions are isolated tabs. Requires Node.js >= 22 and Chrome Stable
(macOS, Linux, native Windows). `chromux help` is the source of truth for
syntax. Setup problems: read the repo's `install.md`. Multi-step orchestration
(profile choice, parallel subagents, cleanup): use the `chromux-work` skill.

## First Rule

Resolve the chromux command once, then inline the resolved command and a unique
session ID (e.g. `exp-ab12`) literally in every shell call — shell variables do
not persist across agent tool calls.

```bash
command -v chromux || echo MISSING   # if missing, read install.md
```

## Pick The Shape Of The Task First

Most tasks are one of these four shapes. Choosing the right one saves most of
the turns and tokens:

**Fill and submit a form — one call.** Do not fill field-by-field. `open`
inlines small pages' interactive elements with `@refs`; feed those refs (or
CSS selectors) straight into the builtin snippet. It fills inputs and native
selects, submits, waits for `readyText`, and returns the confirmation text —
open + one run is the whole flow:

```bash
chromux open exp-ab12 <url>   # elements: @1 textbox "Name" / @2 combobox "Plan" / @3 button
chromux run exp-ab12 --file snippets/_builtin/form-flow.js \
  --arg fields='{"@1":"Jane Doe","@2":"Team"}' --arg submit='@3' \
  --arg readyText='Thanks'   # success text you expect on this page;
                             # if unknown, use --arg readySelector='.toast'
# result includes report: the text of the element containing readyText
```

**Find something on a big page — grep, don't dump.**
`chromux snapshot <s> --grep "pattern"` returns only matching lines (plus their
ancestors for context) instead of the whole tree. The pattern is tried as a
case-insensitive regex, then literally if the regex matches nothing; when the
literal reading would match lines the regex result misses, the header says so
(NOTE) — escape metacharacters if you meant the literal string. Grep for
the label, value, or row you need; take a full `snapshot` only when you truly
need the whole structure.

**Count or aggregate over many elements — one `run`, one JSON.** Compute every
part of a multi-part question in a single `run` call that returns one object —
two questions is not two runs, and sanity checks belong inside the same call:

```bash
chromux run exp-ab12 - <<'JS'
return await js(`(() => {
  const ratings = [...document.querySelectorAll('[data-rating]')].map(el => Number(el.dataset.rating));
  return { total: ratings.length, highRated: ratings.filter(r => r >= 4.5).length, max: Math.max(...ratings) };
})()`);
JS
```

**A known multi-step sequence — one `run` script.** `run` executes async JS
with `cdp`, `js`, `sleep`, `waitLoad`, `page(expr?)`, `waitFor(...)`,
`assertPage(...)`, and `args` helpers, so navigate→wait→read loops collapse
into one command:

```bash
chromux run exp-ab12 - <<'JS'
const out = [];
for (const path of ['/pricing', '/changelog']) {
  await cdp('Page.navigate', { url: new URL(path, await js('location.href')).href });
  await waitLoad();
  out.push(await page('({url:location.href,title:document.title,h1:document.querySelector("h1")?.textContent})'));
}
return out;
JS
```

**Actions verify themselves.** `click`/`fill`/`type`/`press` responses carry a
`changed` field: the post-action diff (new elements, confirmations, revealed
text). Read it instead of taking another snapshot — it is the proof of what
the action did. `--verify MS` tunes the settle wait (default 300ms; raise it
for slow UIs), `--no-verify` skips it. For manual checks,
`snapshot <s> --diff` prints only lines added/removed since your previous
snapshot. Navigation resets refs; in-page changes keep them stable.

## Core Workflow

1. `chromux open exp-ab12 <url>` — response includes an `interactive` count,
   and small pages inline their interactive elements (with `@ref` handles) in
   an `elements` field: when present, act on those refs directly instead of
   taking a separate snapshot. Otherwise follow the `next` snapshot command
   before guessing selectors.
2. `chromux snapshot exp-ab12` — accessibility tree with stable `@ref` handles.
   `--interactive` returns only actionable elements; `--grep` filters by
   pattern. Lines show live state: input values, selected option, `[checkbox
   checked]`, `(disabled)`. Snapshots pierce same-origin iframes and open
   shadow DOM (cross-origin frames are marked unreachable). Pages built from
   bare clickable `div`s are detected and marked `clickable` with `@refs`;
   the automatic trigger fires on nearly-dead pages and on SPAs whose
   viewport mixes a standard nav with div-based controls. If a snapshot still
   looks emptier than the page (e.g. controls far below the fold), pass
   `--clickable` explicitly. Note: value masking covers `type=password` and
   fields that look sensitive by autocomplete/name/id (card numbers, CVCs,
   one-time codes, SSNs); values in other plain text fields appear as-is.
3. Act by ref: `click exp-ab12 @<N>`, `fill exp-ab12 @<N> "text"`,
   `type exp-ab12 "text"` (focused field), `press exp-ab12 Enter` (also Tab,
   Escape, Backspace, Delete, arrows, Home, End, PageUp, PageDown — arrows
   drive dropdowns). Refs inside same-origin iframes and open shadow DOM work
   like any other ref. `fill` on a native `<select>` matches an option by
   value or label and fires `change`; never `type` into a select. Custom
   dropdowns (divs styled as comboboxes) are not `<select>` — use `click` +
   arrow keys. Autocomplete: `fill exp-ab12 @<N> "seo" --pick "Seoul"` types
   and chooses the matching suggestion in one call; the response's `picked`
   is the chosen label and `pickEffect` says what was observed (treat
   "unconfirmed" as needing a check, not success). Stale refs after a SPA
   re-render: `click exp-ab12 --text "로그인"` targets by visible label
   (ambiguity fails with a candidate list). File inputs:
   `fill exp-ab12 @<N> --file /path/report.pdf`. Downloads:
   `download exp-ab12 @<N> --to DIR` waits for the completed file and
   returns its path.
4. Verify: read the `changed` diff in the action's own response; for slower
   UIs use `--verify 1000`, or `wait-for-text exp-ab12 "Saved"` /
   `wait-for-selector exp-ab12 ".toast"` for readiness
   (`wait-for-selector ... --gone` waits for disappearance; in `run`,
   `waitFor(null, {kind: 'network-idle'})` waits out XHR bursts). If a click
   opened a new tab, the response's `newSession` names the adopted session —
   continue there. If a JS dialog fired, the response's `dialog` field says
   what it asked and how it was auto-handled (`open ... --dialog accept` to
   change the policy).
5. `chromux close exp-ab12` when done — batch it with your last command
   (`chromux run … && chromux close exp-ab12`) so cleanup does not cost an
   extra round-trip. Batch any commands that don't need each other's output.

A successful `open` means navigation happened, not task readiness; a successful
action response means the action was dispatched, not accepted. Always verify
with `--diff`, a wait, or a `run` assertion before reporting success.

## run Details

- `run <s> --file F --arg k=v` passes parameters to run code as `args.k`
  (repeatable; JSON values like `--arg fields='{...}'` arrive parsed). All
  builtin snippets accept `--arg` overrides.
- For page code longer than a one-liner, prefer `--page-file F` — file contents
  reach the page with no shell escaping, so quotes/regexes/newlines survive.
- `js(...)` runs page code in an isolated function scope (lexical declarations
  don't leak between calls). `run` executes in the runner context, not the
  page; `run` has no Node `import`/`require`.
- `waitFor` accepts an array of fallback selector/text candidates — first match
  wins, returned as `matched`.
- Add `--schema contract.json` when extracting structured data — the result is
  validated against a JSON-schema subset with per-path errors.
- Add `--receipt PATH` for a redacted local timing/evidence receipt (no raw
  code, typed text, cookies, or secrets).
- `--timeout MS` applies to the run and becomes the default CDP timeout for
  helper calls.

Once a flow works, save it: `chromux script save <host>/<name> --file f.js`,
replay with `run <s> --script <host>/<name>` — zero model calls. `open`
responses list saved scripts for the page's host; a failed replay points back
at the script file so you can fix and re-save it.

## Builtin Snippets

Check `snippets/_builtin/` before recreating common loops (paths also work
relative to the repo/skill directory):

- `form-flow.js` — whole-form fill + submit + readiness (`--arg fields=...`,
  `--arg submit=...`, `--arg readyText=...`)
- `table-extract.js` — table → `{headers, rows}` (`--arg table=...`)
- `paginate-collect.js` — items across paginated pages (`--arg item=...`,
  `--arg next=...`, `--arg fields=...`)
- `wizard-flow.js` — multi-step wizard with per-step readiness proof
  (`--arg steps=[...]`)
- `search-and-pick.js` — type → pick suggestion → submit → report
- `scroll-until.js` — scroll until selector count reaches a target
  (`--arg selector=...`, `--arg count=N`)
- `page-extract.js` — structured page metadata without dumping HTML
- `page-assert.js` — selector/text/DOM assertions (`--arg selector=...`)
- `network-errors.js` — browser-observable broken-resource diagnostics

Deeper guides load on demand — `chromux skill` lists topics;
`chromux skill forms|extraction|recovery` prints the guide (autocomplete
patterns, pagination/table extraction, dialog/popup recovery, and the
pause → open --foreground → wait → resume human login handoff).

## Crawling And Batches

For read-only collection use crawl mode and the built-in queue:

```bash
CHROMUX_MODE=crawl CHROMUX_PROFILE=work chromux batch --file urls.txt \
  --workers 10 --retries 1 --host-backoff-ms 250 --out results.jsonl
```

Crawl mode adds resource guardrails (resource blocking, session caps, idle
cleanup); reuse 3-5 stable session names as a worker pool instead of new
sessions per URL. Tuning env vars: see `chromux help`. `pause`/`resume`
hard-stop or resume a profile's tab work.

## Diagnostics And Evidence

- `chromux watch <s> console` / `watch <s> network --all` capture logs and
  failed requests; report passing UI actions with new console errors as
  suspicious, not silent success.
- `screenshot <s> [path]` for visual evidence; `show <s>` opens DevTools.
- Local activity events land in `~/.chromux/activity/events.jsonl`
  (`fill`/`type` text and inline code are never stored raw). `chromux app`
  serves the local profile/activity dashboard. Set `CHROMUX_TASK=<label>`
  (short, non-secret) to group related commands into a Task timeline.

## Site Knowledge

`open` responses may surface host notes from `~/.chromux/skills/<host>/*.md`
(parent domains included) — read hints before inventing an approach. Write
durable, non-secret knowledge back after sessions that taught you something:

```bash
chromux note <host>                    # review existing notes first
chromux note <host> --add "stable selector / quirk / wait behavior"
```

Good: stable selectors, URL patterns, framework quirks, hidden waits. Bad:
credentials, cookies, pixel coordinates, one-off task narration, stale facts.

## Gotchas

- Prefer `@ref` interactions over CSS selectors; `click` scrolls the target
  into view and fails on stale/hidden/covered targets. `click <s> --xy X Y`
  clicks viewport coordinates when visual geometry is the right tool.
- New tabs open in the background by default; use `open --foreground` only when
  activation is intentional.
- Auth walls are user-owned: if a site redirects to login without a usable
  saved profile, stop and ask the user to log in manually.
- Always close sessions you open; `chromux ps` / `chromux kill <profile>` for
  profile cleanup (also clears stale singleton locks).
- Older aliases (`eval`, `scroll`, `wait`, `console`, `network`, `scroll-until`)
  exist for compatibility; prefer `run`, `cdp`, and `watch`.
- Known reach limits (report these instead of retrying blindly): cross-origin
  iframes (many payment/captcha widgets) and closed shadow roots are not
  reachable — snapshots mark cross-origin frames explicitly. Verify diffs may
  show a newly revealed listener-only element as text without a clickable
  `@ref`; take a snapshot to get its ref.
