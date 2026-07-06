## Summary

- Refactors `chromux.mjs` so CLI command classification and daemon-backed routing use shared command metadata.
- Preserves the visible CLI help surface and hidden compatibility aliases.
- Adds status app self-test coverage for command metadata registry invariants.

## Result

- User-visible outcome: no intended public CLI behavior change.
- Reviewer should be able to confirm: command routing metadata is centralized and existing checks still pass.
- Not included: no new public commands, no dependency changes, no version bump, no publish, no macOS status app behavior change.

## Screenshots / Demo

N/A - no visual surface changed.

| Area | Before | After / Current | Notes |
| --- | --- | --- | --- |
| CLI command routing | Repeated inline command lists in routing and classification | Shared metadata constants and route map | Behavior-preserving refactor |

## Human Review Focus

- Product behavior or requirement interpretation: confirm this is limited to behavior-preserving CLI routing metadata.
- UX, copy, visual polish, or content judgment: N/A.
- Risky files, flows, or edge cases: `chromux.mjs` command dispatch, hidden compatibility aliases, daemon startup, and activity logging.
- Data, auth, security, privacy, or permission concern: N/A.
- Deployment, migration, rollback, or operational concern: no release or package version change included.
- Specific questions for reviewers: verify the shared command metadata area is maintainable enough for future command additions.

## Product And Scope Result

- PRD or issue: .hoyeon/prd/cli-command-registry-refactor/prd.md
- Implementation run or receipt: .hoyeon/implement/cli-command-registry-refactor/state.json; .hoyeon/implement/cli-command-registry-refactor/receipt.json
- Acceptance result: complete
- Structure or guardrail result: public command surface preserved, compatibility aliases retained, no runtime dependency change.
- Out of scope: publish, tag, release, version bump, macOS app behavior change, status app UI redesign.

## Implementation Notes

- Completed: shared command metadata, daemon command route map, sessionless command classification, and self-test invariant checks.
- Deferred: PR merge remains human-owned.
- Added or changed beyond the original plan: PRD delivery artifacts under `.hoyeon/` document receipt, reviews, and staging constraints.
- Migration, config, credential, or deployment notes: `.hoyeon/config.json` records PR delivery and staging allowlist metadata only.

## Acceptance Result

| ID | Status | Evidence |
| --- | --- | --- |
| AC1 | met | A future maintainer can inspect one command metadata area in `chromux.mjs` to understand which commands are profile-level, daemon-backed, compatibility-only, or sessionless for activity logging. Evidence: chromux.mjs contains a single shared command metadata registry for profile, daemon-backed, and hidden compatibility commands. |
| AC2 | met | `runCli` no longer constructs an inline `Set` of tab commands for each invocation and uses shared command routing metadata for daemon-backed commands. Evidence: Daemon command validation and dispatch use DAEMON_COMMAND_ROUTES and the invariant self-test rejects per-call tab command set construction. |
| AC3 | met | `node chromux.mjs help` still includes visible commands such as `wait-for-selector` and does not expose hidden compatibility aliases as primary help entries. Evidence: Help output smoke check confirms wait-for-selector remains visible and eval/cdp/run/batch remain hidden from primary help. |
| AC4 | met | Local static checks, command metadata self-test or equivalent automated behavior check, full `./test.sh`, and `npm pack --dry-run` pass. Evidence: V1 through V4 passed, including syntax checks, help policy checks, npm pack dry run, status app self-test, and bash ./test.sh. |
| AC5 | met | The completed implementation state contains PR delivery mode, an intended branch, and allowlist staging constraints so `prd-ship` can create the PR and prove CI after the receipt. Evidence: Implementation state contains PR delivery mode, branch prd/cli-command-registry-refactor, config path .hoyeon/config.json, and prd_ship allowlist staging constraints for post-receipt PR/CI delivery. state.json and .hoyeon/config.json contain delivery.mode=pr, branch prd/cli-command-registry-refactor, explicit staging include allowlist, and active/session/artifacts exclude constraints for prd-ship. |

## Evidence And Checks

| Result Area | Outcome | Evidence |
| --- | --- | --- |
| Product behavior | N/A | Behavior-preserving CLI refactor with no visual or product flow change. |
| UI, browser, mobile, or desktop result | Pass | `bash ./test.sh` passed in V4. |
| API, service, or external provider result | N/A | No API or external provider surface changed. |
| Database, migration, or data integrity result | N/A | No database or migration surface changed. |
| CLI, package, or library result | Pass | `node --check`, help policy checks, self-test, and `npm pack --dry-run` passed. |
| Docs, content, generated media, or course result | Pass | PRD, receipt, verification plan, and review artifacts included. |
| Static checks, automated tests, build, or CI | Local pass, CI pending | V1-V4 passed locally; GitHub CI runs on this PR. |
| Security, accessibility, or performance result | N/A | No security, accessibility, or performance surface intentionally changed. |

| Verification | Outcome | Check | Evidence |
| --- | --- | --- | --- |
| V1 (build/static) | pass | `node --check chromux.mjs && bash -n test.sh && node chromux.mjs help >/tmp/chromux-help.txt && grep -q "wait-for-sel... | .hoyeon/implement/cli-command-registry-refactor/artifacts/logs/V1-2026-07-05T16-57-25-445Z.log |
| V2 (automated behavior) | pass | `CHROMUX_HOME="$(mktemp -d /tmp/chromux-selftest-XXXXXX)" node chromux.mjs app --self-test >/tmp/chromux-selftest.txt... | .hoyeon/implement/cli-command-registry-refactor/artifacts/logs/V2-2026-07-05T16-56-42-763Z.log |
| V3 (build/static) | pass | `npm pack --dry-run` | .hoyeon/implement/cli-command-registry-refactor/artifacts/logs/V3-2026-07-05T16-57-27-404Z.log |
| V4 (browser/runtime) | pass | `bash ./test.sh` | .hoyeon/implement/cli-command-registry-refactor/artifacts/logs/V4-2026-07-05T17-34-44-959Z.log |
| V5 (delivery/CI) | blocked | `bash -lc 'node ~/.codex/skills/prd-ship/scripts/prd_ship.js preflight --state .hoyeon/implement/cli-command-registry... | Post-receipt delivery gate: prd-ship creates the PR and watches CI only after finalize emits the implementation receipt, so V5 is intentionally deferred from implementation finalization. Post-receipt delivery gate remains blocked until finalize emits receipt; staging constraints are now explicit in state/config, and prd-ship preflight will prove the staged path set after receipt. |

## Review And Delivery Evidence

- Requirements fidelity review: pass - .hoyeon/implement/cli-command-registry-refactor/review/requirements-fidelity-review.md
- Final adversarial review: pass - .hoyeon/implement/cli-command-registry-refactor/review/final-review.md
- Receipt or artifact manifest: .hoyeon/implement/cli-command-registry-refactor/receipt.json; .hoyeon/implement/cli-command-registry-refactor/artifacts/manifest.jsonl
- PR delivery status: this PR.
- CI status: pending on PR creation; required checks must pass before merge.

## Delivery Staging

- Mode: pr
- Branch: prd/cli-command-registry-refactor
- Base: main
- Staging include: .hoyeon/config.json, .hoyeon/prd/cli-command-registry-refactor, .hoyeon/implement/cli-command-registry-refactor, chromux.mjs
- Staging exclude: .hoyeon/implement/.prd-implement-active.json, .hoyeon/implement/.prd-implement-sessions, .hoyeon/implement/cli-command-registry-refactor/artifacts

## Changed Paths Planned For This PR

- .hoyeon/config.json
- .hoyeon/implement/cli-command-registry-refactor/checklist.md
- .hoyeon/implement/cli-command-registry-refactor/context-notes.md
- .hoyeon/implement/cli-command-registry-refactor/delivery/pr-body.md
- .hoyeon/implement/cli-command-registry-refactor/execution-plan.json
- .hoyeon/implement/cli-command-registry-refactor/execution-plan.md
- .hoyeon/implement/cli-command-registry-refactor/implementation-result.md
- .hoyeon/implement/cli-command-registry-refactor/ledger.jsonl
- .hoyeon/implement/cli-command-registry-refactor/receipt.json
- .hoyeon/implement/cli-command-registry-refactor/review/final-review.md
- .hoyeon/implement/cli-command-registry-refactor/review/requirements-fidelity-review.md
- .hoyeon/implement/cli-command-registry-refactor/state.json
- .hoyeon/implement/cli-command-registry-refactor/taskgraph.json
- .hoyeon/implement/cli-command-registry-refactor/taskgraph.md
- .hoyeon/implement/cli-command-registry-refactor/verification-plan.json
- .hoyeon/implement/cli-command-registry-refactor/verification-plan.md
- .hoyeon/implement/cli-command-registry-refactor/verification.md
- .hoyeon/prd/cli-command-registry-refactor/context-notes.md
- .hoyeon/prd/cli-command-registry-refactor/intent-scope-audit.md
- .hoyeon/prd/cli-command-registry-refactor/prd.md
- .hoyeon/prd/cli-command-registry-refactor/verification-contract-audit.md
- chromux.mjs

## Risks, Rollback, And Human Review

- Known risks: command routing regressions if metadata falls out of sync with handler behavior.
- Rollback or mitigation path: revert this branch or restore the previous inline routing block.
- Follow-ups: none required for this PR; future command additions should update the shared metadata area and self-test invariants.

Result report: .hoyeon/implement/cli-command-registry-refactor/implementation-result.md
