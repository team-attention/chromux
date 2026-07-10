# chromux Competitive Analysis & Improvement Plan (July 2026)

This document synthesizes a full-codebase review of chromux plus market research
across the MCP browser-server ecosystem, agentic browser frameworks, browser
CLIs, cloud browser infrastructure, and big-lab agent browsers. Sources were
verified against GitHub/npm/vendor docs in July 2026; representative citations
are inline.

## 1. Executive summary

chromux's two founding bets are now **industry consensus**:

1. **CLI-over-MCP for coding agents.** Microsoft shipped `@playwright/cli`
   (~12k stars in ~6 months) and tells coding agents with a shell to use it
   instead of Playwright MCP; Google added an experimental CLI/daemon mode to
   chrome-devtools-mcp; Anthropic's "code execution with MCP" post reports a
   98.7% token reduction moving from MCP tool schemas to filesystem/code APIs.
   Published numbers: ~114K tokens per task via Playwright MCP vs ~27K via the
   CLI; agent-browser reports 200–400 tokens per page snapshot.
2. **Raw CDP as the substrate.** browser-use (~104k stars) and Stagehand v3
   (~23k stars, Browserbase) both *removed Playwright* in 2025 and rewrote on
   raw CDP for speed, iframe correctness, and event-driven control.

That means neither bet is a differentiator anymore. What remains structurally
defensible for chromux:

- **The user's real, logged-in Chrome profiles, locally.** Cloud infra
  (Browserbase/Steel/Kernel/Anchor) reconstructs identity server-side because
  it *cannot* use the login state in the user's desktop Chrome. Extension
  approaches (Claude in Chrome, Browser MCP, Nanobrowser) can, but ship a
  demonstrably fragile transport (service-worker idles, native-host races,
  store review lag, no WSL, vendor plan lock-in). Zero-dependency raw CDP over
  chromux-owned profiles is the sturdiest delivery of "agent uses my browser."
- **Shell-native composability** (`run`, `cdp`, `batch`, pipes, cron) where
  MCP servers are protocol-coupled and frameworks demand a Python/TS runtime
  plus LLM keys.
- **The supervising-agent model.** chromux deliberately has no agent loop; the
  coding agent supplies intelligence. Every framework that bundled an LLM loop
  fights per-step cost/latency (Skyvern ~$0.05/step; Stagehand $50–200/day at
  scale) and prompt-injection liability (Comet/CometJacking/Scamlexity).

## 2. Market map (mid-2026)

| Category | Representatives | Signal |
|---|---|---|
| MCP browser servers | playwright-mcp (~35k★), chrome-devtools-mcp (~46k★, ~1.4M npm dl/wk) | Huge installed base; #1 complaint is context/token bloat; both vendors added CLIs |
| Browser CLIs for agents | vercel-labs/agent-browser (~38k★, Rust daemon), @playwright/cli (~12k★) | Direct competitors; daemon + `@ref` snapshot model identical in shape to chromux |
| Agent frameworks | browser-use (~104k★, $17M seed), Stagehand (~23k★, $40M B), Skyvern, notte | All converged on CDP + a11y-tree/text page representations; all fight LLM-per-step cost |
| Real-profile extensions | Claude in Chrome (~9M installs), Nanobrowser (13.4k★, stalled), Browser MCP (abandoned) | Demand proof for "my logged-in browser"; supply is flaky or vendor-locked |
| Cloud browser infra | Browserbase, Steel, Hyperbrowser, Anchor, Kernel, Lightpanda | Complementary, not competitive: they sell clean IPs/scale, not the user's identity |
| Big-lab agent browsers | ChatGPT Atlas, Gemini-in-Chrome auto-browse, Comet | Validate the category; carry the prompt-injection reputational risk |

Key events to track:

- **Chrome 136+** refuses `--remote-debugging-port` on the *default*
  user-data-dir. chromux is structurally immune (it always launches isolated
  `~/.chromux/profiles/<name>` dirs), but the "reuse the login state I already
  have" story needs an explicit, documented answer (see roadmap G-1).
- **Web Bot Auth / signed agents** (Cloudflare, RFC 9421-based) is now default
  policy for some Bot Management customers. A real user profile driven at
  human-ish rates mostly reads as the user; keep the minimal-CDP stealth
  posture (no `Runtime.enable`, no JS patches).
- **Prompt injection** is the category's defining risk: Anthropic published
  23.6%→11.2% attack-success numbers with mitigations; OpenAI says injection
  is "unlikely to ever be fully solved"; Brave/Guardio/LayerX repeatedly broke
  Comet. Simon Willison's "lethal trifecta" framing (private data + untrusted
  content + external communication) applies to any tool that drives a
  logged-in profile.

## 3. Strengths to double down on

1. **Real-profile, zero-dependency, works everywhere a shell works** — incl.
   headless Linux, servers, WSL, CI. Claude in Chrome cannot do WSL; cloud
   browsers cannot do "my accounts."
2. **Daemon-per-profile + parallel tab sessions.** agent-browser and
   playwright-cli have daemons but weaker multi-profile/parallel-agent
   stories. `tmux for Chrome tabs` is the honest, unique frame.
3. **`run` composability.** One `run` call with `js/page/waitFor/assertPage`
   collapses N agent round-trips; no competitor CLI has an equivalent
   multi-step runner context with CDP + page helpers in one script.
4. **`batch` crawl pools** with retries, host backoff, failure kinds, p50/p95 —
   no competing CLI ships a URL-batch primitive at all.
5. **Site knowledge notes (`chromux note`)** — durable per-host agent memory
   surfaced on `open`. Nobody else has this. It is the seed of a real moat
   (see roadmap D).
6. **Stealth by minimal CDP footprint** (no `Runtime.enable`, no injected
   patches) — aligned with where the arms race went (Patchright/Nodriver);
   JS-layer stealth is dead.
7. **Local activity log + redacted receipts + status app** — the
   privacy/audit surface competitors are only starting to build.

## 4. Gaps and threats

- **G-1. The "my existing daily profile" story is implicit.** chromux profiles
  are chromux-owned dirs; a first-run "log in once in a headed chromux
  profile" flow works, but docs don't lead with it, and there is no assisted
  import/clone from the user's daily Chrome profile. Every rival's docs are a
  mess here (agent-browser #1321); a crisp answer is cheap differentiation.
- **G-2. Snapshot format is good but static.** Competitors converged on
  ref-based a11y snapshots (table stakes, chromux has it). The next lever is
  **change-only reporting** (browser-use marks new-since-last-step elements)
  — `snapshot --diff` would compound token savings across a session.
- **G-3. No observe→cache→replay loop.** Stagehand's most-liked feature:
  resolve an action once (LLM), persist `{selector, method, args}`, replay
  with zero LLM calls, re-resolve on failure. chromux's CLI position gets this
  almost free: the *calling agent* is the self-healing LLM; chromux needs only
  (a) durable action scripts (snippets + site notes already exist) and (b)
  structured, recoverable errors (largely present).
- **G-4. Token-efficiency numbers aren't published.** The winning marketing
  axis has hard public numbers (114K vs 27K vs 200–400). chromux has a
  benchmark harness but no published comparison of `snapshot --interactive`
  payloads vs playwright-mcp/agent-browser on the same pages.
  *Closed in 0.15.0:* `benchmarks/agent-compare-benchmark.mjs` (one fixed
  model doing identical missions with chromux / agent-browser /
  @playwright/cli, measuring time, tokens, turns, machine-graded success) and
  `benchmarks/compare-benchmark.mjs` (deterministic payload/latency/isolation
  comparison) with results published in `docs/benchmark-2026-07.md` and the
  README. Measured note: agent-browser 0.31.1's named sessions isolate
  correctly, so the earlier "sessions share a tab / parallel broken" claim is
  stale; the durable chromux edges that survived measurement are real-Chrome
  bot-check resilience (Google: 100% vs 50%) and `snapshot --diff`
  incremental observation (~37 vs ~10.9K/28.4K tokens on a 200-story page).
- **G-5. Skills distribution.** agent-browser installs via `npx skills add`
  and fetches current instructions at runtime (`skills get core`) so docs
  never go stale; chrome-devtools-mcp ships marketplace skills. chromux's
  `skills/` needs the one-liner install path and (eventually) a runtime
  `chromux skill` command.
- **G-6. Safety affordances.** Driving a real profile is exactly the lethal
  trifecta. chromux has pause/resume, receipts, redaction — but no origin
  allowlist, no sensitive-host guard, and the skills docs don't yet teach
  injection hygiene (treat page text as data, prefer fresh profiles for
  untrusted sites).
- **G-7. Debug/observability depth.** chrome-devtools-mcp overtook
  playwright-mcp on the strength of console/network/perf visibility. chromux
  has `watch console|network`; perf tracing and richer network detail are
  reachable via `cdp` but undocumented as recipes.
- **G-8. Keyboard/input coverage.** `press` supported only
  Enter/Tab/Escape/Backspace (fixed in 0.12.0: arrows, Delete, Home/End,
  PageUp/PageDown). Remaining: key chords (e.g. Ctrl+A) via `cdp` recipe.

## 5. Roadmap

### P0 — sharpen the core (weeks)

1. **`snapshot --diff`** (G-2) — shipped in 0.13.0: refs are now stable within
   a document (elements keep their `@ref` across re-snapshots; navigation
   resets), and `snapshot --diff` emits only added/removed lines per session
   with an omitted-unchanged summary. *Extended in 0.16.0*: `snapshot --grep`
   (targeted find with ancestor context) and `open` inlining small pages'
   interactive elements, both driven by the agent-in-the-loop benchmark.
2. **Publish token benchmarks** (G-4) — shipped in 0.14.0:
   `benchmarks/chromux-token-benchmark.mjs` measures agent-visible payloads
   (full HTML vs snapshot vs `--interactive` vs `--diff` vs shaped extract) on
   deterministic fixtures; README "Token Footprint" section publishes a
   representative table (200-item feed: ~20.4K tokens full HTML → ~47 tokens
   `--diff`) with pointers to third-party MCP-vs-CLI numbers.
3. **First-class login/profile onboarding docs** (G-1): a "Front-load
   authentication" quickstart — `chromux launch work` headed, user logs in
   once, agents reuse forever; optionally an assisted `chromux clone-profile`
   that copies cookies/localStorage from the user's daily Chrome (with
   explicit consent language).
4. **Extended `press` keys** (G-8) — shipped with this change.

### P1 — safety + distribution (1–2 months)

5. **Origin allowlist** (G-6): `CHROMUX_ALLOW_HOSTS` / `--allow-hosts` on the
   daemon; navigation outside the list fails with a recoverable error. Off by
   default; skills docs recommend it for untrusted-content tasks.
6. **Injection-hygiene guidance in skills** (G-6) — shipped with this change:
   lethal-trifecta section in `skills/chromux-work` (fresh profile for
   untrusted sites, page text is data not instructions, confirm before
   irreversible actions).
7. **Skills one-liner install + runtime skill text** (G-5): document
   `npx skills add team-attention/chromux` (or equivalent), add
   `chromux skill [name]` that prints the current SKILL.md so agent-side
   instructions never go stale.
8. **Snapshot privacy hardening**: never emit password-field values (shipped
   with this change); consider masking values on `type=email`-like fields
   behind a flag.

### P2 — moats (quarter)

9. **Action scripts with replay** (G-3) — core shipped in 0.13.0:
   `chromux script save|show|rm <host>/<name>` stores plain `run` scripts
   under `~/.chromux/scripts/<host>/`, `run --script <host>/<name>` replays
   them with zero model calls, `open` responses surface them per host (parent
   domains included), and failed replays emit a repair hint pointing at the
   script (the calling agent is the self-healing layer). Schema contracts via
   `run --schema` (zero-dependency JSON-schema subset validator) shipped in
   the same release — Stagehand's cache + extract contract, minus the bundled
   LLM. The multi-candidate follow-up shipped in 0.14.0: `waitFor` accepts an
   array of fallback selector/text candidates (first match wins, reported as
   `matched`), so saved scripts carry several locator strategies. Action
   responses (`click`/`fill`/`type`/`press`) now also include a `next` hint
   pointing at `snapshot --diff`.
10. **Site-notes ecosystem** (strength 5): `chromux note --export/--import`
    (shareable non-secret host notes), auto-suggested note drafts from
    activity-log failure clusters (reminder already exists).
11. **Debug recipes** (G-7): checked-in `snippets/_builtin/perf-trace.js`,
    `network-har.js` runner scripts using raw CDP (Tracing.start/end,
    Network.*) — matches chrome-devtools-mcp's headline features without new
    verbs.
12. **Vision fallback documentation**: screenshot + a11y snapshot pairing for
    canvas/WebGL/PDF pages; explicitly not set-of-marks overlays (research
    showed no gains on strong models).

### Non-goals (deliberate)

- No agent loop, no bundled LLM, no per-step pricing — every player that did
  this fights cost/reliability (Skyvern, browser-use) or pivoted (Magnitude).
- No MCP server by default — the market is moving our way; revisit only if a
  major shell-less host matters.
- No pure-vision mode — vision is a fallback, not the primary channel.
- No new top-level verbs when `run`/`cdp` + snippets express the operation
  (AGENTS.md policy stands).

## 6. Positioning one-liner

> For the 90% of agent browser work that is *your* accounts on *your*
> machine, you don't need a cloud browser, an extension, or an MCP server —
> `chromux` is tmux for Chrome tabs: real profiles, raw CDP, zero
> dependencies, built for coding agents with a shell.
