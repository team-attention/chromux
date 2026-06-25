---
name: chromux-work
description: Browser work orchestration with chromux. Use when an agent needs to plan and execute a browser task through profile selection, recon, safe parallel subagents, evidence collection, synthesis, cleanup, and domain note updates.
version: 0.1.0
platforms: [macos, linux]
metadata:
  hermes:
    tags: [browser, chrome, cdp, orchestration]
    category: browser
---

# chromux-work

Use this workflow for browser tasks that need more than a single page check:
research, feed/search collection, logged-in site inspection, cross-page
verification, or parallel browser work. For command syntax, use the `chromux`
skill and `chromux help`.

## Contract

- Use chromux, not Playwright/Puppeteer, unless the user explicitly chooses a
  different tool.
- Start from a real chromux profile. Prefer an existing logged-in profile for
  user-owned sites.
- Same profile, different sessions: subagents share the selected profile and
  use unique session names. Concurrent cold starts are coordinated by chromux,
  but pre-launching the profile is still useful when you want faster first work.
- Recon first. Do not fan out before checking login state, page shape, blockers,
  site hints, and whether the task is parallel-safe.
- For crawling, use `CHROMUX_MODE=crawl` and a small worker-tab pool instead of
  one tab per URL. Default recommendation: 3 to 5 worker sessions per profile.
- For plain URL batches, prefer `chromux batch --file urls.txt --workers N`
  instead of asking subagents to hand-roll `open`/`run` loops.
- Treat `batch` as a browser execution primitive, not a domain-specific
  extractor. Use it for URL load verification and simple page metadata; use
  checked-in per-site extractors when a task needs structured records.
- For UI work, do not treat `open` or an action response as proof. Use
  `snapshot`, `wait-for-text`, `wait-for-selector`, `run`, or `screenshot` to
  prove the resulting state.
- Minimize round-trips: bundle a known multi-step sequence (navigate, click,
  fill, wait, read back) into a single `chromux run` call instead of issuing
  many separate `click`/`fill`/`snapshot` commands. Each separate command is a
  full agent round-trip; one `run` with `page(...)`/`js(...)` is far faster and
  is the main reason a single-call browser flow feels fast.
- Observe with `snapshot` before reaching for `screenshot`. Use
  `snapshot --interactive` when you only need actionable elements (buttons,
  links, inputs) — it returns a much smaller payload. Reserve `screenshot` for
  visual verification a text snapshot cannot capture.
- For parent-controlled shutdown, use `chromux pause <profile>` to reject new
  browser work, then `chromux resume <profile>` before the next wave.
- Keep work read-only unless the user explicitly asked to mutate state.
- Close every session you open. Do not suppress `chromux close` output unless
  the user explicitly asked for silence.
- After close, review any `knowledgeHint`. Update
  `~/.chromux/skills/<host>/*.md` when this run revealed durable public site
  behavior or stale/wrong notes.

## 1. Resolve CLI And Inventory Profiles

Resolve the executable once and inline the resolved path in later commands:

```bash
CX=$(command -v chromux 2>/dev/null || echo "") && [ -n "$CX" ] && echo "$CX" || echo "MISSING"
```

Then inspect active and known profiles:

```bash
/path/to/chromux ps
find "$HOME/.chromux/profiles" -maxdepth 1 -mindepth 1 -type d -print 2>/dev/null
```

Ask the user to choose a profile when more than one plausible profile exists.
Show concise options:

- running profiles from `chromux ps` with mode and tab count
- stopped known profiles that look relevant
- a new task profile only when isolation is safer than login reuse

Default recommendation:
- one running profile: use it
- logged-in user site: prefer `default` or the known logged-in profile
- risky/destructive/unknown site: propose a new task profile

Launch or reuse the selected profile. Headed mode with background tab creation
is the pragmatic default when login state and anti-bot behavior matter. New
tabs are background by default so they should not steal focus:

```bash
/path/to/chromux launch <profile>
```

Use `CHROMUX_PROFILE=<profile>` or `--profile <profile>` for every tab command.
Use `open --foreground` only when bringing Chrome to the front is intentional.

For efficient read-only crawling, launch/use the same profile with crawl mode:

```bash
CHROMUX_MODE=crawl /path/to/chromux launch <profile> --headless
```

Use `CHROMUX_MODE=crawl` on every command for that profile. If a profile daemon
is already running in another mode, stop it first with `chromux stop` or use a
fresh profile.

For URL-only queues, use the built-in batch worker pool:

```bash
CHROMUX_MODE=crawl CHROMUX_PROFILE=<profile> /path/to/chromux batch --file urls.txt --workers 10 --out results.jsonl
```

`batch` accepts plain URL lines or JSONL rows with `url`, `source_url`, or
`href`. Its output is per-URL load metadata (`ok`, final URL, title, text/html
lengths, duration, and errors). It does not replace a site-specific parser.

## 2. Recon Pass

Open one recon session before planning the work split:

```bash
CHROMUX_PROFILE=<profile> /path/to/chromux open recon-<slug> <url>
CHROMUX_PROFILE=<profile> /path/to/chromux snapshot recon-<slug>
```

Check:
- did `open` return host-specific hints, and did you read them?
- is the user logged in, blocked by auth, rate limited, or challenged?
- what stable search URLs, selectors, or route patterns exist?
- how many visible results are available before scrolling or query rotation?
- is the task read-only and safe to parallelize?

If recon finds an auth wall, stop and ask the user to log in. Auth is
user-owned.

## 3. Decide Single Agent Or Parallel

Classify the work before choosing an execution pattern:

- Single-page QA or logged-in UI inspection: use one normal session in default
  mode, then `snapshot`, `click`/`fill`/`type`/`press`, `wait-for-text` or
  `wait-for-selector`, another `snapshot` or `run` assertion, and `screenshot`.
- URL load verification or broad URL inventory: use `CHROMUX_MODE=crawl` with
  `chromux batch`.
- Structured raw record extraction: generate or reuse URL seeds, run bounded
  browser execution through `batch` or a checked-in crawler, then apply
  deterministic per-site extractor code and schema validation.
- Strategy research, selector discovery, and output QA: use subagents when the
  work can be split without each subagent inventing its own browser loop.

Parallelize only when all are true:
- work is read-only
- subagents can use distinct session names
- subagents can work on distinct URLs, search queries, or result slices
- no form submission, settings change, purchase, messaging, or account mutation
- rate-limit or bot-risk is acceptable

Hard limits for browser fan-out:
- default/QA work: keep browser sessions low and prefer single-agent operation
- crawl mode: use 3 to 5 worker sessions per profile
- plain URL queues: prefer `chromux batch --workers N` over subagent fan-out
- never create one browser tab per URL for large crawls
- avoid more than 12 active sessions in one profile unless the user explicitly
  asked to stress test resource limits
- if a wave must stop, create the profile hard-stop before messaging workers:
  `CHROMUX_PROFILE=<profile> /path/to/chromux pause`

Do not parallelize when the task depends on one evolving UI state, a single
modal/login flow, or a fragile site that throttles quickly.

## 4. Subagent Dispatch Pattern

Prefer not to dispatch subagents for a plain URL queue. Run `chromux batch`
centrally and give subagents the results for analysis, extractor design, or QA.

When using subagents, give each one:
- the selected profile name
- a unique session prefix
- exact allowed tool: chromux only
- a bounded URL/query slice
- a fixed output schema
- cleanup instruction: close its sessions and report any close hint
- instruction to use `page(...)` or checked-in extractor files instead of
  shell-quoted one-line JavaScript for complex DOM reads

Example assignment:

```text
Use CHROMUX_MODE=crawl and CHROMUX_PROFILE=default for every command.
Use session names worker-a-1 through worker-a-3 only; reuse them for all URLs.
Use chromux run with a heredoc/file and page(...) for DOM reads; do not pass
complex JavaScript as a shell one-liner. Collect public posts for query
"vibe coding"; do not mutate the account. Close opened sessions and include any
knowledgeHint in your report.
```

Main agent responsibilities:
- keep the recon session or close it once no longer needed
- avoid doing the same slice as a subagent
- pause the profile before stopping a wave or interrupting runaway workers
- dedupe and synthesize final results
- verify claims that affect the final answer

## 5. Evidence And Extraction

Prefer this order:
1. `batch` for large URL load verification or metadata collection
2. `snapshot` for accessible structure and `@ref` handles; add `--interactive`
   when you only need actionable elements and want a smaller payload
3. `click`, `fill`, `type`, and `press` for visible UI work from fresh refs
4. `wait-for-text` and `wait-for-selector` after state-changing actions
5. `run` with `page(...)` or `js(...)` for DOM extraction, scrolling, and
   repeated collection — also the right tool to bundle a multi-step action
   sequence into one fast round-trip
6. `cdp` for precise protocol operations
7. `screenshot` for visual evidence a text snapshot cannot capture

Record enough evidence to distinguish:
- actually verified page content
- inferred summaries
- blockers or missing data

For form or modal flows, a clean evidence loop is: fresh `snapshot`, action by
`@ref`, bounded wait for visible text/selector, fresh `snapshot` or `run`
assertion, screenshot if the final visual state matters.

Do not rely on `batch` results alone for domain-specific fields such as address,
price, date, or recommendation reason. Those should come from explicit extractor
logic and validation.

For result lists, dedupe by the strongest stable key available: canonical URL,
profile plus post id, or profile plus first stable text when no URL is exposed.

## 6. Close And Domain Notes

Close sessions explicitly and read the output:

```bash
CHROMUX_PROFILE=<profile> /path/to/chromux close recon-<slug>
```

If the response includes `knowledgeHint`, decide whether to update the host note.
Update only durable, public, reusable knowledge:

- good: stable URL patterns, selector quirks, load limits, reliable extraction
  snippets, stale-note corrections
- bad: credentials, cookies, personal data, one-off task narration, brittle
  pixel coordinates

Never discard close output with `>/dev/null 2>/dev/null` during normal
chromux-work. If you need quiet cleanup, first run one close visibly or inspect
the relevant host notes manually.

## 7. Final Report

Report:
- selected profile and launch mode
- whether recon passed and what blockers appeared
- whether parallel subagents were used and why
- collected results with source path/query/session
- gaps, duplicates removed, and confidence
- domain notes updated, including file path, or why no update was needed
- cleanup status from `chromux ps`
