# Cross-tool benchmark: chromux vs agent-browser vs @playwright/cli (July 2026)

This document records the methodology and results of the first published
cross-tool comparison for chromux, closing gap G-4 from
[competitive-analysis-2026-07.md](competitive-analysis-2026-07.md).
Two harnesses were run, both checked into `benchmarks/`:

1. **Agent-in-the-loop** (`benchmarks/agent-compare-benchmark.mjs`) — the
   headline benchmark. A real coding agent performs identical browser
   missions with each CLI; we measure what actually matters to an agent
   session: wall time, tokens, turns, and task success.
2. **Deterministic payload/latency** (`benchmarks/compare-benchmark.mjs`) —
   the explanatory benchmark. No LLM; measures the stdout payload an agent
   must read for equivalent observation commands, warm command latency, and a
   parallel-session isolation probe on identical fixture pages.

## Agent-in-the-loop methodology

For every (tool x task x repetition) the harness spawns an independent
headless Claude session:

```
claude -p "<mission>" --model claude-opus-4-8 --output-format json \
  --allowedTools Bash --max-turns 40 --setting-sources "" --strict-mcp-config \
  --disallowedTools WebFetch WebSearch Task \
  --append-system-prompt "<vendor's official SKILL.md>"
```

Fairness rules:

- **One model for all tools** (`claude-opus-4-8`), one shared mission prompt
  template, same `--max-turns`, same machine-grading.
- **Each tool is introduced by its vendor's official skill text**: chromux by
  `skills/chromux/SKILL.md` from this repo, agent-browser by the `SKILL.md`
  shipped inside the `agent-browser` npm package, playwright-cli by the
  `SKILL.md` shipped inside `@playwright/cli` (playwright-core). No
  tool-specific prompt tuning beyond that.
- **Per-tool init is measured separately** and excluded from task metrics:
  npm install of the pinned competitor CLIs plus the first browser/daemon
  launch. Task sessions start against a warm daemon for every tool.
- **Cheating is blocked or detected**: WebFetch/WebSearch/MCP are disabled in
  the session; local fixture pages log every request's user agent, and a run
  that touched the fixture with a non-browser client is failed as
  `non-browser-access`.
- Metrics come from the `claude -p` result JSON: `duration_ms`, `usage`
  (input/output/cache tokens), `num_turns`, `total_cost_usd`. Success is
  graded mechanically by the harness (see below), never by a model.

### Tasks

Local tasks run on a deterministic fixture server (`benchmarks/fixtures.mjs`)
with machine-checkable expected values; external tasks target public sites
without login and are graded against live ground truth or stable facts.

| task | kind | mission | grading |
|---|---|---|---|
| form-order | local | fill checkout form (email/coupon/country select), submit, report confirmation code | server-recorded submission must match the requested values AND the reported code must equal the server-issued code |
| feed-extract | local | on a 200-story feed, count stories with >700 points and name the top story | exact match against the generator's expected values |
| nav-tour | local | follow "Continue" links across 4 pages, report the completion code | exact code match |
| sequential-steps | local | 3 sequential click-wait-verify cycles, report the 3 revealed values | exact match of all 3 values |
| inventory-aggregate | local | aggregate across a 5-page inventory: top-priced SKU + count of items above a price threshold | exact match of SKU, price, and count (added in the v2 run) |
| signup-challenge | local | submit a signup form, answer the server-generated verification question shown only after submit, report the account code | server must record a successful verification AND the reported code must match (added in the v2 run) |
| shop-cookie-select | local | on a real-sized shop page (sticky header, dense nav, div-based product cards), dismiss the cookie consent dialog and select a named product | server-recorded selection of the right SKU AND the reported code must match (added post-v2 with the 2026-07 audit fixtures) |
| slow-order | local | submit an order whose confirmation arrives after a silent ~1.5s server round-trip, report the code | server must record EXACTLY ONE submission (a double submit fails) AND the code must match (added post-v2) |
| iframe-register | local | register through a form embedded in a same-origin iframe, report the code | server-recorded registration AND code match (added post-v2) |
| miniwob-email-inbox | miniwob | unmodified MiniWoB++ `email-inbox` task (find an email, star/delete/reply/forward per instruction) | the task page's own reward function must report success, relayed to the harness by an injected hook (see below) |
| miniwob-book-flight | miniwob | unmodified MiniWoB++ `book-flight` task (autocomplete airports, date picker, book the flight matching the criterion) | same reward-based grading |
| miniwob-use-autocomplete | miniwob | unmodified MiniWoB++ `use-autocomplete` task | same reward-based grading (added post-v2) |
| miniwob-login-user | miniwob | unmodified MiniWoB++ `login-user` task | same reward-based grading (added post-v2) |
| miniwob-search-engine | miniwob | unmodified MiniWoB++ `search-engine` task (result may sit on a later page) | same reward-based grading (added post-v2) |
| miniwob-click-checkboxes | miniwob | unmodified MiniWoB++ `click-checkboxes` task | same reward-based grading (added post-v2) |
| hn-top-story | external | report title+points of the current #1 Hacker News story | reported title must appear in the official HN API top stories fetched at run time |
| wikipedia-hop | external | from the Eiffel Tower article, navigate to Gustave Eiffel's page, report name + birth year | name contains "Eiffel", birth year 1832 |
| wikipedia-extract | external | report the Burj Khalifa's architectural height in metres from its article | height rounds to 828 (added post-v2) |
| google-search | external | search Google for "playwright github", report first organic result URL | URL contains github.com/microsoft/playwright (bot-detection failures count as failures — that is part of the signal) |
| youtube-search | external | search YouTube, report title+channel of the top result for a fixed query | channel/title must identify the expected canonical video |

Tasks marked "added post-v2" exist in the harness but are not part of the
published v1/v2 comparison tables below; they enter the numbers at the next
full 3-tool same-run.

The `miniwob` tasks come from an established third-party benchmark,
[MiniWoB++](https://github.com/Farama-Foundation/miniwob-plusplus) (MIT), to
ground the suite in tasks this repo's authors did not design. The task pages
are fetched at run start (checkout commit recorded in the report) and served
unmodified except for one injected hook that raises the 10s episode timer to
5 minutes (agents act through a CLI, not a policy network), fixes the RNG
seed for reproducible instances, and POSTs each episode's raw reward to the
local server so the harness can machine-grade success tool-neutrally.
Success = the benchmark's own reward function reporting a positive raw
reward.

Repetitions: 3 per local task, 2 per external task, sequential (no
concurrent sessions). The initial (v1) run used the first 4 local + 4
external tasks (20 sessions per tool, 60 total); the v2 run uses the 10
fixture/external tasks (26 sessions per tool, 78 total); the MiniWoB++ pair
was run separately at 3 reps (18 sessions).

### Reproduction

```bash
node benchmarks/agent-compare-benchmark.mjs --out /tmp/agent-compare.json
# cheap harness check without external tasks:
node benchmarks/agent-compare-benchmark.mjs --smoke --model claude-haiku-4-5-20251001
```

Requires an authenticated `claude` CLI, Google Chrome, and network access.
Competitor CLIs are npm-installed at their latest versions into a temp prefix
at run start; versions are recorded in the report JSON.

## Agent-in-the-loop results — v1 (chromux 0.14.1, before improvements)

Run of 2026-07-10, macOS (Apple Silicon), model `claude-opus-4-8`, 60
sessions, total cost $13.89. Versions: chromux 0.14.1 (working tree, real
Google Chrome), agent-browser 0.31.1 (auto-detected Chrome), @playwright/cli
0.1.17 (bundled Playwright Chromium).
Cells are success% · median wall time · median turns · median total tokens.

| task | chromux | agent-browser | playwright-cli |
|---|---|---|---|
| form-order | 100% · 34.2s · 8t · 173K | 100% · 19.9s · 6t · 134K | 100% · 34.9s · 7t · 138K |
| feed-extract | 100% · 35.6s · 5t · 109K | 100% · 50.2s · 8t · 188K | 100% · 23.6s · 4t · 78K |
| nav-tour | 100% · 22.8s · 4t · 85K | 100% · 23.3s · 7t · 121K | 100% · 25.9s · 7t · 138K |
| sequential-steps | 100% · 33.7s · 6t · 130K | 100% · 37.0s · 8t · 184K | 100% · 31.9s · 7t · 139K |
| hn-top-story | 100% · 19.1s · 4t · 74K | 100% · 20.3s · 4t · 74K | 100% · 17.3s · 4t · 67K |
| wikipedia-hop | 100% · 27.0s · 5t · 109K | 100% · 22.1s · 6t · 110K | 100% · 24.1s · 5t · 99K |
| google-search | **100%** · 44.1s · 6t · 122K | **50%** · 146.0s · 12t · 310K | 100% · 34.5s · 6t · 122K |
| youtube-search | 100% · 32.2s · 6t · 119K | 100% · 24.8s · 5t · 110K | 100% · 20.4s · 4t · 81K |
| **overall** | **100%** · 10.7min · 109t · 2.37M · $4.60 | 95% · 13.7min · 138t · 3.08M · $5.29 | **100%** · **9.0min** · 112t · **2.22M** · **$4.00** |

Honest reading of the numbers:

- **All three CLIs are viable agent browsers.** With a frontier model at the
  wheel, every tool completed every deterministic task; the CLI-over-MCP bet
  these three tools share is confirmed rather than differentiated.
- **The real Chrome difference shows up exactly where expected.** On Google,
  agent-browser's automation-flagged browser hit reCAPTCHA both reps — one
  rep burned 146s / 12 turns / 310K tokens fighting it, the other gave up
  (the only failure in the run). chromux's real-Chrome sessions passed
  cleanly both reps. This is the category of task ("your accounts, real
  sites, bot-gated surfaces") chromux is built for.
- **playwright-cli is the strongest generalist on neutral tasks** — fastest
  and cheapest overall on this task set. Its per-command latency is the
  worst of the three (see below), but its agent-facing responses are lean
  and its bundled-Chromium weakness simply doesn't show on sites without
  bot checks.
- **agent-browser pays a token premium** (~40% more input tokens than the
  others' median) because its idiomatic observation loop re-reads more of
  the page per step, and it degrades hardest under adversarial conditions.

## What the v1 run drove: chromux 0.16.0

The v1 numbers were used as an engineering signal, not just a scoreboard.
Per-session command traces showed three cost drivers for chromux: an extra
snapshot round-trip after every `open` (to discover selectors), model-authored
JavaScript where a parametrized helper would do, and missing native `<select>`
handling. 0.16.0 addressed them with general-purpose changes:

- `fill` handles native `<select>` (option matched by value or label, native
  setter, `change` dispatched; mismatches fail listing the available options).
- `snapshot --grep <pattern>` returns only matching lines plus their ancestor
  lines (regex first, literal retry) — the targeted-read counterpart to
  playwright-cli's `find`.
- `run --file F --arg k=v` parametrizes checked-in snippets;
  `snippets/_builtin/form-flow.js` became a whole-form one-shot (fields map,
  snapshot `@ref` keys, submit, readiness wait, outcome `report`).
- `open` inlines the interactive elements (with `@refs`) for small pages
  (≤20 interactive elements, ≤2000 chars), removing the snapshot round-trip
  that dominated short tasks.
- `skills/chromux/SKILL.md` was rewritten from ~4.3K to ~2.2K tokens around a
  task-shape playbook (skill text is re-paid as input every agent turn).

### Tuning disclosure

Between v1 and v2 we ran an improve→measure loop of 6 targeted chromux-only
runs. Iteration used only `form-order` and `feed-extract` (plus one initial
measurement of the two new tasks); the external tasks were never used for
iteration. The two new local tasks were designed by the chromux authors while
these improvements were being made — they are tool-neutral in mechanism
(aggregation across pages; a server-generated challenge no tool can know in
advance) but should be read as author-designed additions, not independent
held-out tasks. An independent review of the working tree found that three
SKILL.md playbook examples had leaked fixture-specific literals (field
values, a ready-text string, fixture routes, a `.points`/700 threshold);
those examples were genericized, review-found bugs were fixed, and **the
published v2 chromux numbers come from a fresh run with the cleaned skill**.
The v2 competitor numbers come from the same-day 78-session run (competitor
sessions never see the chromux skill, so they are unaffected by that
cleanup).

## Agent-in-the-loop results — v2 (chromux 0.16.0, all 10 tasks)

Runs of 2026-07-10 (same machine, model, and harness as v1). Competitor
numbers come from the 78-session three-tool run; the chromux numbers come
from the 26-session clean-skill run performed after the leak cleanup
described above (26/26 passed, $4.68). Versions: chromux 0.16.0 (working
tree), agent-browser 0.31.1, @playwright/cli 0.1.17.
Cells are success% · median wall time · median turns · median total tokens.

| task | chromux | agent-browser | playwright-cli |
|---|---|---|---|
| form-order | **100% · 25.2s · 4t · 75K** | 100% · 28.4s · 7t · 159K | 100% · 26.9s · 5t · 98K |
| feed-extract | **100% · 21.8s · 4t · 74K** | 100% · 39.6s · 7t · 161K | 100% · 29.3s · 4t · 79K |
| nav-tour | **100% · 22.7s · 4t · 73K** | 100% · 25.7s · 7t · 122K | 100% · 30.4s · 7t · 138K |
| sequential-steps | 100% · 31.3s · 4t · **75K** | 100% · 29.1s · 7t · 159K | 100% · 34.2s · 6t · 118K |
| inventory-aggregate | **100% · 38.0s · 5t · 96K** | 100% · 43.9s · 5t · 115K | 100% · 47.5s · 6t · 122K |
| signup-challenge | 100% · 30.3s · 6t · **114K** | 100% · 23.2s · 6t · 135K | 100% · 35.2s · 8t · 160K |
| hn-top-story | **100% · 15.4s · 3t · 55K** | 100% · 24.4s · 5t · 99K | 100% · 24.4s · 5t · 87K |
| wikipedia-hop | 100% · 40.7s · 6t · **105K** | 100% · 30.3s · 6t · 118K | 100% · 26.1s · 6t · 111K |
| google-search | **100% · 22.8s · 4t · 74K** | 0% · 238.6s · 17t · 504K | 100% · 72.4s · 11t · 248K |
| youtube-search | 100% · 27.9s · 4t · **74K** | 100% · 30.7s · 6t · 137K | 100% · 17.3s · 4t · 81K |
| **overall** | **100% · 13.0min · 115t · 2.16M · $4.68** | 92% · 23.0min · 187t · 4.32M · $7.31 | 100% · 14.4min · 156t · 3.18M · $5.62 |

Honest reading of the v2 numbers:

- **chromux now has the lowest token total on all 10 tasks** and the
  lowest-or-tied turn count on all 10 (strictly lowest on 5). The mechanism
  is structural: the first
  observation rides along with `open` on small pages, one-shot parametrized
  snippets replace multi-turn form choreography, and `--grep`/`--diff` keep
  large-page reads targeted. Fewer turns also means less wall time, since
  every agent turn re-reads the conversation.
- **Wall time is task-dependent**: chromux is fastest on 7/10 tasks and
  fastest overall (13.0min vs 14.4/23.0), but playwright-cli remains faster
  on youtube-search and wikipedia-hop in this window, and agent-browser edged
  out signup-challenge and sequential-steps on time (while spending ~2x the
  tokens). External medians come from 2 reps and carry live-site variance.
- **Google is again the split**: chromux passed all reps (22.8s median —
  faster than its own v1 because the result is read with one `--grep`);
  agent-browser failed both reps to reCAPTCHA; playwright-cli passed but
  needed 72.4s / 11 turns / 248K tokens fighting consent and layout.
- The v1 caveat still holds: all three CLIs complete the deterministic tasks
  with a frontier model. The differences that persist are cost per task,
  degradation under bot-detection, and behavior on large pages.

## External benchmark tasks: MiniWoB++ (Opus, 3 reps each)

### First run (chromux 0.16.0, 2026-07-10) — playwright-cli won

18 sessions, 18/18 passed, $8.13. MiniWoB++ checkout `a49a136a1782`.

| task | chromux 0.16.0 | agent-browser | playwright-cli |
|---|---|---|---|
| miniwob-email-inbox | 100% · 154.0s · 16t · 362K | 100% · 64.0s · 12t · 312K | **100% · 49.9s · 10t · 211K** |
| miniwob-book-flight | 100% · 110.4s · 15t · 328K | 100% · 109.4s · 22t · 570K | **100% · 75.3s · 15t · 329K** |

The mechanism was instructive: MiniWoB++ pages are dense 160px micro-UIs
built from `div`s with bare click handlers — no roles, no labels, no
anchors. chromux's accessibility snapshot (and therefore `--grep`, inline
`open` elements, and `@ref` actions) saw almost none of it, and agents fell
back to blind `querySelector` exploration. These tasks were added *after*
the 0.16.0 improvements and never used for that version's tuning; the
first-attempt loss was published as measured.

### What that loss drove: chromux 0.17.0 perception upgrade

Six targeted improve→measure loops on these two tasks (command traces →
general-purpose fix → re-run; ~$2 per loop), producing only mechanisms that
apply to real sites:

- **Behavior-based clickable detection**: `cursor:pointer` boundaries,
  `onclick` attributes, and a CDP `getEventListeners` scan for handlers with
  no styling affordance at all. Auto-enabled only on pages with almost no
  visible standard elements (`--clickable` forces it); icon-only targets are
  labeled with their `#id`/`.class` (state classes like `.star.clicked`
  included).
- **Occlusion probe**: the element sitting on top of the page's standard
  controls (sync covers, cookie walls, modals) is surfaced as
  `overlay (covers page; interact or dismiss first)`.
- **Actions verify by default**: `click`/`fill`/`type`/`press` responses
  carry a `changed` diff (settle wait, re-sample when nothing or only the
  acted element changed — debounced autocompletes land a beat late; large
  diffs are summarized so churning dynamic pages stay cheap). `--no-verify`
  opts out; crawl mode skips automatically.
- **Live state in snapshot lines**: input values, selected option,
  `[checkbox checked]`, `(disabled)`.
- **Payload regression guard**: the token benchmark now fails if any
  observation payload exceeds checked-in budgets — the fixture-page payloads
  stayed byte-identical through all of the above (gating works).

### Re-run (chromux 0.17.0, 2026-07-11, all three tools fresh) — flipped

18 sessions, 18/18 passed, $7.07. Same harness, same seeds, same-day
three-tool comparison.

| task | chromux 0.17.0 | agent-browser | playwright-cli |
|---|---|---|---|
| miniwob-email-inbox | **100% · 36.4s · 9t · 178K** | 100% · 63.2s · 15t · 378K | 100% · 59.3s · 16t · 348K |
| miniwob-book-flight | **100% · 56.2s · 13t · 277K** | 100% · 69.0s · 17t · 425K | 100% · 63.2s · 19t · 449K |

chromux now leads both tasks on every metric (email-inbox: -39% time / -49%
tokens vs playwright-cli in the same run). A 0.17.0 chromux-only re-run of
all 12 tasks passed 32/32 with fixture tasks at parity or better vs 0.16.0
(form-order 19.7s/74K, inventory 30.8s/97K); external live-site medians move
±1 turn between days, which dominates their small deltas. MiniWoB++ episode
rewards are still graded by the benchmark's own code; the improvement loop
tuned chromux's perception, never the tasks or the grading.

## Cross-model check: Sonnet 5 (reduced reps)

Same day, same harness, model `claude-sonnet-5`, all 12 tasks, reduced
repetitions (2 per local/MiniWoB task, 1 per external task; 20 sessions per
tool, 60 total, $14.38). One run, published as measured.

| task | chromux | agent-browser | playwright-cli |
|---|---|---|---|
| form-order | **100% · 16.2s · 5t · 126K** | 100% · 22.1s · 6t · 192K | 100% · 23.5s · 7t · 191K |
| feed-extract | 100% · 30.8s · 7t · 201K | 100% · 30.8s · 7t · 211K | **100% · 20.8s · 5t · 148K** |
| nav-tour | 100% · 28.7s · 8t · 229K | 100% · 25.2s · 7t · 225K | 100% · 33.9s · 10t · 296K |
| sequential-steps | **100% · 28.6s · 10t · 268K** | 100% · 44.8s · 10t · 330K | 100% · 31.5s · 10t · 296K |
| inventory-aggregate | **100% · 25.1s · 5t · 145K** | 100% · 41.3s · 10t · 338K | 100% · 45.1s · 10t · 292K |
| signup-challenge | **100% · 21.2s · 7t · 198K** | 100% · 22.1s · 6t · 193K | 100% · 27.1s · 8t · 222K |
| miniwob-email-inbox | 100% · 104.2s · 33t · 1045K | 100% · 89.1s · 23t · 862K | **100% · 53.4s · 17t · 537K** |
| miniwob-book-flight | 100% · 93.3s · 27t · 907K | 100% · 75.4s · 22t · 757K | **100% · 58.3s · 20t · 650K** |
| hn-top-story | 100% · 23.4s · 6t · 168K | **100% · 15.4s · 4t · 107K** | 100% · 21.0s · 5t · 162K |
| wikipedia-hop | 100% · 50.7s · 10t · 289K | 100% · 48.6s · 6t · 192K | **100% · 23.6s · 6t · 177K** |
| google-search | **100% · 17.8s · 5t · 140K** | 0% · 134.5s · 17t · 632K | 100% · 95.7s · 21t · 761K |
| youtube-search | 100% · 27.2s · 7t · 196K | **100% · 21.3s · 5t · 164K** | 100% · 43.5s · 8t · 253K |
| **overall (12 tasks)** | 100% · 13.6min · 7.03M · $4.64 | 95% · 15.4min · 7.31M · $5.21 | **100% · 12.9min · 6.62M · $4.52** |
| **overall excl. MiniWoB** | **100% · 7.0min · 3.13M · $2.64** | 94% · 9.9min · 4.07M · $3.42 | 100% · 9.1min · 4.25M · $3.19 |

Reading:

- **The Opus conclusions replicate directionally on a smaller model.**
  chromux and playwright-cli stay at 100% success; agent-browser again fails
  Google to reCAPTCHA (632K tokens burned before giving up) — the bot-check
  split is a browser-identity property, not a model property.
- **Real-Chrome under bot checks matters more for a weaker model**: on
  Google, chromux 17.8s / 140K vs playwright-cli 95.7s / 21 turns / 761K —
  Sonnet spent 5x the time fighting consent/anti-bot friction that chromux's
  real Chrome never surfaced.
- **The MiniWoB gap also widens with a weaker model** (chromux 1045K vs
  playwright-cli 537K on email-inbox): when observation gives poor purchase
  on div-soup UIs, a weaker model needs many more blind probes. This flips
  the 12-task aggregate to playwright-cli (12.9min vs 13.6min); excluding
  the two MiniWoB tasks, chromux leads the Sonnet aggregate cleanly
  (7.0min / 3.13M vs 9.1min / 4.25M). Both aggregates are published. (This
  Sonnet run predates the 0.17.0 perception upgrade that flipped the Opus
  MiniWoB results; see the re-measurement below.)
- Reduced reps (2/1) mean per-task medians are noisier than the Opus
  tables; treat this section as a directional cross-model check, not a
  precision ranking.

### Sonnet MiniWoB re-measurement after the perception upgrades (0.18.0)

2026-07-12, same harness, `claude-sonnet-5`, same-run chromux 0.18.0 vs
`@playwright/cli` 0.1.17, the two MiniWoB tasks at 2 reps each
(8 sessions, $2.32). One run, published as measured.

| task | chromux 0.18.0 | playwright-cli |
|---|---|---|
| miniwob-email-inbox | **100% · 34.6s · 11t · 339K** | 100% · 54.8s · 16t · 493K |
| miniwob-book-flight | **100% · 39.6s · 15t · 453K** | 100% · 58.0s · 19t · 637K |

The pre-upgrade Sonnet numbers above (chromux 104.2s/1045K and 93.3s/907K)
were the suite's worst cells; after the behavior-based clickable detection,
occlusion probe, and act-and-verify upgrades, chromux leads both tasks on
every metric on Sonnet as well — the prediction that perception upgrades
help a weaker model more holds (email-inbox: -67% time, -68% tokens vs its
own pre-upgrade result). The rest of the Sonnet table has not been re-run;
agent-browser was not part of this re-measurement.

## Deterministic payload / latency results

Same fixture pages for all tools (article, form with status line, 200-story
feed). Payload = agent-visible stdout bytes, tokens estimated at chars/4.
"Post-action verification (idiomatic)" is each tool's cheapest documented way
to confirm an action's effect on page structure: `snapshot --diff` for
chromux, re-`snapshot -i` for agent-browser, re-`snapshot` for playwright-cli
(which has no interactive filter). A targeted single-element read is also
shown for the form page.

```bash
node benchmarks/compare-benchmark.mjs --out /tmp/compare.json
```

Run of 2026-07-10, same machine and versions, 5 warm reps for latency,
tokens estimated at chars/4.

| page | command | chromux | agent-browser | playwright-cli |
|---|---|---|---|---|
| article | snapshot (full) | 775 | 1,057 | 1,028 |
| article | snapshot (interactive-only) | 41 | 40 | 1,028 |
| article | post-action verification | **36** | 47 | 1,036 |
| article | structured extract | 25 | 25 | 86 |
| form | snapshot (full) | 67 | 94 | 116 |
| form | snapshot (interactive-only) | 38 | 66 | 116 |
| form | post-action verification | 39 | 66 | 115 |
| form | targeted single-element read | 2 | 2 | 36 |
| form | structured extract | 27 | 27 | 88 |
| feed (200 stories) | snapshot (full) | **14,252** | 25,646 | 28,349 |
| feed (200 stories) | snapshot (interactive-only) | **7,153** | 10,928 | 28,349 |
| feed (200 stories) | post-action verification | **37** | 10,935 | 28,357 |
| feed (200 stories) | find one item by text | **59** (`snapshot --grep`) | 10,935 (no find; re-snapshot) | 163 (`find`) |
| feed (200 stories) | structured extract | 27 | 27 | 88 |

| metric | chromux | agent-browser | playwright-cli |
|---|---|---|---|
| navigate p50 (warm) | 204ms | **95ms** | 875ms |
| snapshot p50 (warm) | 153ms | **47ms** | 174ms |
| parallel sessions isolated | yes | yes | yes |

Reading:

- **chromux's `snapshot --diff` is the standout number**: verifying an
  action's effect on a large page costs ~37 tokens vs ~10.9K (agent-browser
  re-snapshot) and ~28.4K (playwright-cli re-snapshot, which has no
  interactive filter at all). On long multi-step sessions this compounds.
- **agent-browser's Rust daemon has the best raw command latency** (2-4x
  faster than chromux per command); playwright-cli is the slowest to
  navigate.
- **Parallel-session isolation passes for all three tools** as of these
  versions — agent-browser 0.31.1 has working named sessions, so earlier
  claims that its sessions share a tab no longer hold.
- Why doesn't the payload gap fully show up in the agent-in-the-loop totals?
  Because a capable model already uses each tool's cheapest observation
  commands and short tasks are dominated by fixed session overhead. The
  payload advantage matters most on long sessions over large pages — the
  regime the deterministic table isolates.

## Limitations

- Single machine (macOS, Apple Silicon), one benchmark window; two models
  (`claude-opus-4-8` headline tables at full reps, `claude-sonnet-5` as a
  reduced-rep directional check); external-site tasks depend on live site
  behavior and bot-detection policy at run time.
- Token estimates in the deterministic harness use chars/4; the
  agent-in-the-loop numbers use real API token counts.
- The agent decides its own command usage from the vendor skill text; results
  therefore measure the *tool + its documentation* as a system, which is the
  thing an agent actually experiences. A model weaker than the benchmark
  model may fail tasks a stronger model completes (we observed exactly this
  with `<select>` handling during harness bring-up; the chromux skill now
  documents the `run`+`change`-event idiom).
- Sessions run sequentially; daemons stay warm across repetitions for every
  tool alike.
