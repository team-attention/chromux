---
topic: "cli-command-registry-refactor"
status: "ready"
human_approval: "pending"
source_intake: "current conversation"
source_clarity: "none"
created_at: "2026-07-05"
updated_at: "2026-07-05"
---

# PRD: CLI Command Registry Refactor

## 1. Summary

Refactor `chromux.mjs` so CLI command grouping, daemon-required command checks, and activity session inference are driven by shared command metadata instead of repeated ad hoc lists.
The refactor must preserve the public CLI surface and existing browser/runtime behavior.
The example is complete only when the implementation is shipped to a GitHub pull request and required CI passes.

Approval checklist:

- Approve a behavior-preserving central CLI routing refactor in `chromux.mjs`.
- Approve no new public CLI commands and no removed compatibility aliases.
- Approve validation through static checks, self-test, full browser test suite, package dry-run, and GitHub CI.
- Approve delivery mode: pr.
- Approve keeping unrelated pre-existing local `.hoyeon` artifacts out of the PR.

## 2. Problem, Goal, And Users

`chromux.mjs` has grown into a single-file CLI with command knowledge spread across help text, route dispatch, activity logging, and command classification.
That makes broad refactors risky because adding or changing a command can require updating multiple independent lists.

The goal is to make the command surface easier to maintain without changing behavior.
The users are agents and developers who rely on stable `chromux` command behavior for browser automation and CI workflows.

## 3. Scope And Non-Goals

In scope:

- Centralize profile-level command names, tab/daemon command names, hidden compatibility command names, and sessionless activity command names.
- Route tab commands through a shared command-route map or equivalent command metadata structure.
- Preserve current command behavior, command output shape, activity redaction behavior, and help visibility.
- Add or update lightweight automated coverage for command metadata invariants when the existing suite does not already protect them.
- Open or update a GitHub PR and watch required CI to completion.

Non-goals:

- No new top-level browser action commands.
- No removal of compatibility aliases such as `eval`, `scroll`, `wait`, `console`, `network`, or `scroll-until`.
- No runtime dependency changes.
- No status app UI redesign.
- No macOS app behavior change.
- No publish, tag, release, or package version bump unless CI or repo policy proves it is required.

## 4. Pre-Work And Required Decisions

### 4.1 Pre-Work Before Implementation

- Inspect `git status --short` and avoid staging unrelated pre-existing local `.hoyeon` artifacts.
- Read `AGENTS.md`, `.github/workflows/ci.yml`, `package.json`, and the relevant `chromux.mjs` routing/help sections.
- Use the project `.hoyeon/config.json` delivery defaults when initializing implementation state.

### 4.2 Human Decisions Before PRD Approval

- The current conversation requests PR delivery and CI pass for this example.
- No additional product decision is required if the implementation remains behavior-preserving and does not add or remove public commands.
- Ask before introducing a new command, removing an alias, changing package metadata, publishing, or changing the macOS app.

### 4.3 Decision Traceability For Fidelity Review

- Decision: use a bounded behavior-preserving CLI command metadata refactor for the `chromux` example | accepted | represented by R1-R4, AC1-AC4, T1-T4, V1-V4.
- Decision: delivery mode is PR with CI watch | accepted from current conversation | represented by R5, AC5, T5, V5, and the result report contract.
- Decision: avoid unrelated local `.hoyeon` artifacts in the PR | accepted | represented by Scope, T5, V5, and Guardrails.
- Decision: no new commands or dependency changes | rejected/deferred | represented by Non-goals and Guardrails.

## 5. Major Technical Structure Changes

Move CLI command classification from repeated inline lists toward a shared command metadata structure inside `chromux.mjs`.
The intended structure may include module-level sets or objects for profile commands, daemon-backed commands, hidden compatibility commands, sessionless activity commands, and route handlers.
No external package, file split, protocol change, daemon API change, or storage schema change is expected.

## 6. Requirements

- R1. `chromux.mjs` has one shared command classification source for profile commands, daemon-backed tab commands, hidden compatibility commands, and sessionless activity commands.
- R2. The CLI router uses the shared metadata to validate unknown commands and invoke daemon-backed command routes.
- R3. `chromux help` continues to show the same small public command surface and keeps compatibility aliases hidden from the main help surface.
- R4. Existing behavior for command outputs, daemon startup, browser operations, activity logging, and package contents does not regress.
- R5. The implementation produces a PR-ready delivery handoff, and the overall request continues through `prd-ship` until a PR URL and passing required GitHub CI checks exist.

## 7. Acceptance Criteria

- AC1. A future maintainer can inspect one command metadata area in `chromux.mjs` to understand which commands are profile-level, daemon-backed, compatibility-only, or sessionless for activity logging.
- AC2. `runCli` no longer constructs an inline `Set` of tab commands for each invocation and uses shared command routing metadata for daemon-backed commands.
- AC3. `node chromux.mjs help` still includes visible commands such as `wait-for-selector` and does not expose hidden compatibility aliases as primary help entries.
- AC4. Local static checks, command metadata self-test or equivalent automated behavior check, full `./test.sh`, and `npm pack --dry-run` pass.
- AC5. The completed implementation state contains PR delivery mode, an intended branch, and allowlist staging constraints so `prd-ship` can create the PR and prove CI after the receipt.

## 8. PRD-Level Tasks

- T1. Introduce shared CLI command metadata inside `chromux.mjs`. Covers R1, AC1.
- T2. Refactor command validation and daemon-backed routing to use the shared metadata. Covers R2, AC2.
- T3. Preserve help output and hidden compatibility alias policy. Covers R3, AC3.
- T4. Add or update automated coverage for command metadata invariants if existing coverage is insufficient, then run local verification. Covers R4, AC4.
- T5. Prepare PR delivery handoff and ship through PR delivery after receipt without staging unrelated local artifacts. Covers R5, AC5.

## 9. Verification Contract

### 9.1 Test Mode Contract

| Mode | Required For Done | Covers | Human Decision |
| --- | --- | --- | --- |
| build/static | yes | syntax, shell syntax, help surface, package surface | none |
| automated behavior | yes | command metadata invariants and status app self-test | none |
| browser/runtime | yes | real Chrome CLI behavior and activity logging | none |
| delivery/CI | no/blockable | post-receipt PR URL and required GitHub CI pass through `prd-ship` | final merge remains human-owned |

`delivery/CI` is outside the `prd-implement` receipt gate because `prd-ship` requires a complete receipt before it can create or update the PR.
The overall user request is not complete until the `prd-ship` delivery gate reports a PR URL and required CI pass or an explicit delivery blocker.

### 9.2 Required Agent Verification

| ID | Mode | Covers | Method | Artifact | Pass Criteria | Environment | Required For Done | Can Be Blocked | Safe Probe | Live Proof | Side Effect | Sensitive Data Policy |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| V1 | build/static | R1-R4, AC1-AC3 | `node --check chromux.mjs && bash -n test.sh && node chromux.mjs help >/tmp/chromux-help.txt && grep -q "wait-for-selector" /tmp/chromux-help.txt && ! grep -q "^  chromux eval " /tmp/chromux-help.txt && ! grep -q "^  chromux scroll " /tmp/chromux-help.txt && ! grep -q "^  chromux wait " /tmp/chromux-help.txt && ! grep -q "^  chromux console " /tmp/chromux-help.txt && ! grep -q "^  chromux network " /tmp/chromux-help.txt && ! grep -q "^  chromux scroll-until " /tmp/chromux-help.txt` | command-log | command exits 0, help exposes `wait-for-selector`, and hidden compatibility aliases are not listed as primary help entries | local shell | yes | no | local static/help only | command log | writes `/tmp/chromux-help.txt` | no secrets |
| V2 | automated behavior | R1-R4, AC1-AC4 | `CHROMUX_HOME="$(mktemp -d /tmp/chromux-selftest-XXXXXX)" node chromux.mjs app --self-test >/tmp/chromux-selftest.txt && grep -q "command metadata registry invariants" /tmp/chromux-selftest.txt` | command-log | command exits 0 and self-test visibly proves command metadata registry invariants, including no per-call inline tab-command `Set` in `runCli` | local shell | yes | no | isolated `CHROMUX_HOME` | command log | creates temporary local state and `/tmp/chromux-selftest.txt` | no secrets |
| V3 | build/static | R4, AC4 | `npm pack --dry-run` | command-log | command exits 0 and package allowlist remains valid | local shell | yes | no | package dry-run only | command log | creates no publish | no secrets |
| V4 | browser/runtime | R2-R4, AC2-AC4 | `bash ./test.sh` | command-log | command exits 0 across the browser test suite | local shell with Chrome | yes | no | isolated test profile | command log | launches and kills local test Chrome profiles | no secrets |
| V5 | delivery/CI | R5, AC5 | `bash -lc 'node ~/.codex/skills/prd-ship/scripts/prd_ship.js preflight --state .hoyeon/implement/cli-command-registry-refactor/state.json >/tmp/chromux-prd-ship-preflight.json && node ~/.codex/skills/prd-ship/scripts/prd_ship.js ship --state .hoyeon/implement/cli-command-registry-refactor/state.json --title "Refactor CLI command registry" >/tmp/chromux-prd-ship.json && gh pr diff prd/cli-command-registry-refactor --name-only >/tmp/chromux-pr-diff.txt && node ~/.codex/skills/prd-ship/scripts/prd_ship.js status --state .hoyeon/implement/cli-command-registry-refactor/state.json >/tmp/chromux-prd-ship-status.json'` | command-log | preflight stage plan contains only allowed implementation paths, PR URL exists, PR diff excludes unrelated local artifacts, and required GitHub CI checks pass; if CI cannot pass, final status must be `Blocked`, not `Done` | GitHub CLI authenticated repo | no | yes | PR branch and CI only | PR URL, PR diff path list, staged path list, and CI status | pushes branch and opens PR | writes `/tmp/chromux-prd-ship*.json` and `/tmp/chromux-pr-diff.txt`; no secrets in PR body or logs |

### 9.3 Human Verification

Final merge remains human-owned.
No separate human product QA is required because this is a behavior-preserving CLI refactor with automated and CI proof.

## 10. Risks And Open Decisions

- Risk: centralizing command metadata could accidentally expose hidden aliases in help.
Mitigation: keep help visibility explicit and verify help output.
- Risk: daemon-backed routing could change command output shape.
Mitigation: run the existing browser test suite and CI.
- Risk: PR delivery could stage unrelated local `.hoyeon` artifacts.
Mitigation: use the PR worktree and inspect git status before shipping.
- Open decision: none blocking.

## 11. Implementation Guardrails

- Do not add runtime dependencies.
- Do not add new public CLI commands.
- Do not remove or warn on existing compatibility aliases.
- Do not change daemon HTTP API routes unless a failing test proves the refactor requires it and the user approves.
- Do not change package version, publish, tag, or release.
- Do not stage unrelated pre-existing `.hoyeon` artifacts from the main checkout.

## 12. Implementation Result Report Contract

The implementation report must include:

- Status: `Done`, `Partially Done`, or `Blocked`.
- Developer-visible changes in command metadata, routing, and tests.
- Confirmation that the approved behavior-preserving structure was followed.
- Task completion status for T1-T5.
- R/AC/V coverage.
- Verification evidence grouped by build/static, automated behavior, browser/runtime, and delivery/CI.
- Delivery evidence: branch, PR URL, CI status, and any retry or blocked state.
- Automated tests added or updated and the regression risk each protects.
- Deviations from the PRD.
- Remaining human review, including merge ownership.
- Not-done items and follow-up candidates.
