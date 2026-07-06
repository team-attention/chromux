# PRD Implementation Checklist: cli-command-registry-refactor

Source PRD: .hoyeon/prd/cli-command-registry-refactor/prd.md

## Execution Nodes

- [x] N1. Introduce shared CLI command metadata inside `chromux.mjs`. Covers R1, AC1.
  - Status: complete
  - Source Task: T1
  - Write Scope: chromux.mjs
  - Parallel Safe: yes
  - Risk: medium
  - Covers: R: R1; AC: AC1; V: V1, V2
  - Evidence:
    - 2026-07-05T17:38:07.927Z: Shared command metadata registry added in chromux.mjs; V1 and V2 passed with logs under .hoyeon/implement/cli-command-registry-refactor/artifacts/logs.
- [x] N2. Refactor command validation and daemon-backed routing to use the shared metadata. Covers R2, AC2.
  - Status: complete
  - Source Task: T2
  - Write Scope: chromux.mjs, .hoyeon
  - Parallel Safe: yes
  - Risk: medium
  - Covers: R: R2; AC: AC2; V: V1, V2, V4
  - Evidence:
    - 2026-07-05T17:38:07.989Z: runCli daemon-backed routing now dispatches through DAEMON_COMMAND_ROUTES instead of per-call tab command sets; V1, V2, and V4 passed.
- [x] N3. Preserve help output and hidden compatibility alias policy. Covers R3, AC3.
  - Status: complete
  - Source Task: T3
  - Write Scope: chromux.mjs, .hoyeon
  - Parallel Safe: yes
  - Risk: medium
  - Covers: R: R3; AC: AC3; V: V1, V2, V4
  - Evidence:
    - 2026-07-05T17:38:08.051Z: Primary help still exposes wait-for-selector and hides compatibility aliases while daemon routes keep aliases callable; V1, V2, and V4 passed.
- [x] N4. Add or update automated coverage for command metadata invariants if existing coverage is insufficient, then run local...
  - Status: complete
  - Source Task: T4
  - Write Scope: chromux.mjs, .hoyeon
  - Parallel Safe: yes
  - Risk: medium
  - Covers: R: R4; AC: AC4; V: V1, V2, V3, V4
  - Evidence:
    - 2026-07-05T17:38:08.114Z: Status app self-test now checks command metadata registry invariants and full local verification V1-V4 passed.
- [x] N5. Prepare PR delivery handoff and ship through PR delivery after receipt without staging unrelated local artifacts. Cov...
  - Status: complete
  - Source Task: T5
  - Depends On: N4
  - Write Scope: chromux.mjs, .hoyeon
  - Parallel Safe: yes
  - Risk: medium
  - Covers: R: R5; AC: AC5; V: V5
  - Evidence:
    - 2026-07-05T17:38:08.178Z: PR delivery handoff is ready in implementation state with delivery.mode=pr, branch=prd/cli-command-registry-refactor, and allowlist staging handled by prd_ship; actual PR/CI execution remains the post-receipt V5 gate.
    - 2026-07-05T17:44:55.162Z: PR delivery handoff state now contains explicit allowlist staging include paths (.hoyeon/config.json, .hoyeon/prd/cli-command-registry-refactor, .hoyeon/implement/cli-command-registry-refactor, chromux.mjs) and exclude paths (.hoyeon/implement/.prd-implement-active.json, .hoyeon/implement/.prd-implement-sessions, .hoyeon/implement/cli-command-registry-refactor/artifacts).

## Tasks

- [x] T1. Introduce shared CLI command metadata inside `chromux.mjs`. Covers R1, AC1.
  - Status: complete
  - Requirements: R1
  - Acceptance Criteria: AC1
  - Evidence:
    - 2026-07-05T17:38:08.244Z: Execution roll-up: N1 complete; ACs AC1 met; required Verification V1, V2 passed.
- [x] T2. Refactor command validation and daemon-backed routing to use the shared metadata. Covers R2, AC2.
  - Status: complete
  - Requirements: R2
  - Acceptance Criteria: AC2
  - Evidence:
    - 2026-07-05T17:38:08.310Z: Execution roll-up: N2 complete; ACs AC2 met; required Verification V1, V2, V4 passed.
- [x] T3. Preserve help output and hidden compatibility alias policy. Covers R3, AC3.
  - Status: complete
  - Requirements: R3
  - Acceptance Criteria: AC3
  - Evidence:
    - 2026-07-05T17:38:08.377Z: Execution roll-up: N3 complete; ACs AC3 met; required Verification V1, V2, V4 passed.
- [x] T4. Add or update automated coverage for command metadata invariants if existing coverage is insufficient, then run local...
  - Status: complete
  - Requirements: R4
  - Acceptance Criteria: AC4
  - Evidence:
    - 2026-07-05T17:38:08.442Z: Execution roll-up: N4 complete; ACs AC4 met; required Verification V1, V2, V3, V4 passed.
- [x] T5. Prepare PR delivery handoff and ship through PR delivery after receipt without staging unrelated local artifacts. Cov...
  - Status: complete
  - Requirements: R5
  - Acceptance Criteria: AC5
  - Evidence:
    - 2026-07-05T17:38:08.585Z: Execution roll-up: N5 complete; ACs AC5 met; required Verification none passed.
    - 2026-07-05T17:44:55.492Z: T5 delivery handoff includes state/config allowlist constraints; post-receipt V5 remains responsible for PR creation, diff cleanliness proof, and required CI status.

## Acceptance Criteria

- [x] AC1. A future maintainer can inspect one command metadata area in `chromux.mjs` to understand which commands are profile-l...
  - Status: met
  - Evidence:
    - 2026-07-05T17:38:08.243Z: chromux.mjs contains a single shared command metadata registry for profile, daemon-backed, and hidden compatibility commands.
- [x] AC2. `runCli` no longer constructs an inline `Set` of tab commands for each invocation and uses shared command routing met...
  - Status: met
  - Evidence:
    - 2026-07-05T17:38:08.309Z: Daemon command validation and dispatch use DAEMON_COMMAND_ROUTES and the invariant self-test rejects per-call tab command set construction.
- [x] AC3. `node chromux.mjs help` still includes visible commands such as `wait-for-selector` and does not expose hidden compat...
  - Status: met
  - Evidence:
    - 2026-07-05T17:38:08.376Z: Help output smoke check confirms wait-for-selector remains visible and eval/cdp/run/batch remain hidden from primary help.
- [x] AC4. Local static checks, command metadata self-test or equivalent automated behavior check, full `./test.sh`, and `npm pa...
  - Status: met
  - Evidence:
    - 2026-07-05T17:38:08.442Z: V1 through V4 passed, including syntax checks, help policy checks, npm pack dry run, status app self-test, and bash ./test.sh.
- [x] AC5. The completed implementation state contains PR delivery mode, an intended branch, and allowlist staging constraints s...
  - Status: met
  - Evidence:
    - 2026-07-05T17:38:08.514Z: Implementation state contains PR delivery mode, branch prd/cli-command-registry-refactor, config path .hoyeon/config.json, and prd_ship allowlist staging constraints for post-receipt PR/CI delivery.
    - 2026-07-05T17:44:55.358Z: state.json and .hoyeon/config.json contain delivery.mode=pr, branch prd/cli-command-registry-refactor, explicit staging include allowlist, and active/session/artifacts exclude constraints for prd-ship.

## Verification Evidence

- [x] V1. General: `node --check chromux.mjs && bash -n test.sh && node chromux.mjs help >/tmp/chromux-help.txt && grep -q "wait-for-sel...
  - Status: pass
  - Required For Done: yes
  - Evidence:
    - 2026-07-05T16:57:25.453Z: Artifact recorded: command-log .hoyeon/implement/cli-command-registry-refactor/artifacts/logs/V1-2026-07-05T16-57-25-445Z.log (30b9788e8b62) - verify-run passed: bash -lc 'node --check chromux.mjs && bash -n test.sh && node chromux.mjs help >/tmp/chromux-help.txt && grep -q "wait-for-selector" /tmp/chromux-help.txt && ! grep -q "^  chromux eval " /tmp/chromux-help.txt && ! grep -q "^  chromux scroll " /tmp/chromux-help.txt && ! grep -q "^  chromux wait " /tmp/chromux-help.txt && ! grep -q "^  chromux console " /tmp/chromux-help.txt && ! grep -q "^  chromux network " /tmp/chromux-help.txt && ! grep -q "^  chromux scroll-until " /tmp/chromux-help.txt'
    - 2026-07-05T16:57:25.454Z: Command passed with exit code 0: bash -lc 'node --check chromux.mjs && bash -n test.sh && node chromux.mjs help >/tmp/chromux-help.txt && grep -q "wait-for-selector" /tmp/chromux-help.txt && ! grep -q "^  chromux eval " /tmp/chromux-help.txt && ! grep -q "^  chromux scroll " /tmp/chromux-help.txt && ! grep -q "^  chromux wait " /tmp/chromux-help.txt && ! grep -q "^  chromux console " /tmp/chromux-help.txt && ! grep -q "^  chromux network " /tmp/chromux-help.txt && ! grep -q "^  chromux scroll-until " /tmp/chromux-help.txt'. Log: .hoyeon/implement/cli-command-registry-refactor/artifacts/logs/V1-2026-07-05T16-57-25-445Z.log
  - Artifacts:
    - command-log: .hoyeon/implement/cli-command-registry-refactor/artifacts/logs/V1-2026-07-05T16-57-25-445Z.log (30b9788e8b62)
- [x] V2. General: `CHROMUX_HOME="$(mktemp -d /tmp/chromux-selftest-XXXXXX)" node chromux.mjs app --self-test >/tmp/chromux-selftest.txt...
  - Status: pass
  - Required For Done: yes
  - Evidence:
    - 2026-07-05T16:56:42.772Z: Artifact recorded: command-log .hoyeon/implement/cli-command-registry-refactor/artifacts/logs/V2-2026-07-05T16-56-42-763Z.log (e38794933741) - verify-run passed: bash -lc 'CHROMUX_HOME="$(mktemp -d /tmp/chromux-selftest-XXXXXX)" node chromux.mjs app --self-test >/tmp/chromux-selftest.txt && grep -q "command metadata registry invariants" /tmp/chromux-selftest.txt'
    - 2026-07-05T16:56:42.773Z: Command passed with exit code 0: bash -lc 'CHROMUX_HOME="$(mktemp -d /tmp/chromux-selftest-XXXXXX)" node chromux.mjs app --self-test >/tmp/chromux-selftest.txt && grep -q "command metadata registry invariants" /tmp/chromux-selftest.txt'. Log: .hoyeon/implement/cli-command-registry-refactor/artifacts/logs/V2-2026-07-05T16-56-42-763Z.log
  - Artifacts:
    - command-log: .hoyeon/implement/cli-command-registry-refactor/artifacts/logs/V2-2026-07-05T16-56-42-763Z.log (e38794933741)
- [x] V3. General: `npm pack --dry-run`
  - Status: pass
  - Required For Done: yes
  - Evidence:
    - 2026-07-05T16:57:27.412Z: Artifact recorded: command-log .hoyeon/implement/cli-command-registry-refactor/artifacts/logs/V3-2026-07-05T16-57-27-404Z.log (bdc4f9a41b0a) - verify-run passed: npm pack --dry-run
    - 2026-07-05T16:57:27.413Z: Command passed with exit code 0: npm pack --dry-run. Log: .hoyeon/implement/cli-command-registry-refactor/artifacts/logs/V3-2026-07-05T16-57-27-404Z.log
  - Artifacts:
    - command-log: .hoyeon/implement/cli-command-registry-refactor/artifacts/logs/V3-2026-07-05T16-57-27-404Z.log (bdc4f9a41b0a)
- [x] V4. General: `bash ./test.sh`
  - Status: pass
  - Required For Done: yes
  - Evidence:
    - 2026-07-05T17:34:44.961Z: Artifact recorded: command-log .hoyeon/implement/cli-command-registry-refactor/artifacts/logs/V4-2026-07-05T17-34-44-959Z.log (aa65ef1faefc) - verify-run passed: bash ./test.sh
    - 2026-07-05T17:34:44.961Z: Command passed with exit code 0: bash ./test.sh. Log: .hoyeon/implement/cli-command-registry-refactor/artifacts/logs/V4-2026-07-05T17-34-44-959Z.log
  - Artifacts:
    - command-log: .hoyeon/implement/cli-command-registry-refactor/artifacts/logs/V4-2026-07-05T17-34-44-959Z.log (aa65ef1faefc)
- [x] V5. General: `bash -lc 'node ~/.codex/skills/prd-ship/scripts/prd_ship.js preflight --state .hoyeon/implement/cli-command-registry...
  - Status: blocked
  - Required For Done: no
  - Evidence:
    - 2026-07-05T17:38:08.584Z: Post-receipt delivery gate: prd-ship creates the PR and watches CI only after finalize emits the implementation receipt, so V5 is intentionally deferred from implementation finalization.
    - 2026-07-05T17:44:55.623Z: Post-receipt delivery gate remains blocked until finalize emits receipt; staging constraints are now explicit in state/config, and prd-ship preflight will prove the staged path set after receipt.

## Requirements Fidelity Review

- [x] REQ_FIDELITY_REVIEW. Requirements fidelity review
  - Status: pass
  - Report: .hoyeon/implement/cli-command-registry-refactor/review/requirements-fidelity-review.md
  - Summary: Requirements fidelity review passed after AC5 fix: state.json and .hoyeon/config.json now contain explicit PR delivery staging include/exclude constraints; V5 remains the post-receipt prd-ship gate.

## Final Adversarial Review

- [x] REVIEW. Final adversarial review
  - Status: pass
  - Report: .hoyeon/implement/cli-command-registry-refactor/review/final-review.md
  - Summary: Final adversarial review passed: AC5 staging constraints are explicit in state/config, V1-V4 artifacts are valid, V5 remains the post-receipt prd-ship gate.
