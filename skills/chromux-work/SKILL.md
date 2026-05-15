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
  use unique session names.
- Recon first. Do not fan out before checking login state, page shape, blockers,
  site hints, and whether the task is parallel-safe.
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

Launch or reuse the selected profile. Hidden headed mode is the pragmatic
default when login state and anti-bot behavior matter:

```bash
/path/to/chromux launch <profile> --hidden
```

Use `CHROMUX_PROFILE=<profile>` or `--profile <profile>` for every tab command.

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

Parallelize only when all are true:
- work is read-only
- subagents can use distinct session names
- subagents can work on distinct URLs, search queries, or result slices
- no form submission, settings change, purchase, messaging, or account mutation
- rate-limit or bot-risk is acceptable

Do not parallelize when the task depends on one evolving UI state, a single
modal/login flow, or a fragile site that throttles quickly.

## 4. Subagent Dispatch Pattern

When using subagents, give each one:
- the selected profile name
- a unique session prefix
- exact allowed tool: chromux only
- a bounded URL/query slice
- a fixed output schema
- cleanup instruction: close its sessions and report any close hint

Example assignment:

```text
Use CHROMUX_PROFILE=default for every command.
Use session names worker-a-* only.
Collect public posts for query "vibe coding"; do not mutate the account.
Close opened sessions and include any knowledgeHint in your report.
```

Main agent responsibilities:
- keep the recon session or close it once no longer needed
- avoid doing the same slice as a subagent
- dedupe and synthesize final results
- verify claims that affect the final answer

## 5. Evidence And Extraction

Prefer this order:
1. `snapshot` for accessible structure and `@ref` handles
2. `run` for DOM extraction, scrolling, and repeated collection
3. `cdp` for precise protocol operations
4. `screenshot` for visual evidence

Record enough evidence to distinguish:
- actually verified page content
- inferred summaries
- blockers or missing data

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
