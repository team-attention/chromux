# Execution Plan: cli-command-registry-refactor

- PRD: .hoyeon/prd/cli-command-registry-refactor/prd.md
- Status: ready
- Generated: 2026-07-05T16:55:36.240Z
- Nodes: 5
- Blocking gaps: 0
- Warnings: 1

## Ready Guidance

- Ready sequential: none
- Ready parallel groups: none

## Nodes

### N1. Introduce shared CLI command metadata inside `chromux.mjs`. Covers R1, AC1.

- Status: complete
- Source task: T1
- Owner: unassigned
- Depends on: none
- Write scope: chromux.mjs
- Parallel safe: yes
- Risk: medium
- Covers: R: R1; AC: AC1; V: V1, V2
- Evidence:
  - 2026-07-05T17:38:07.927Z: Shared command metadata registry added in chromux.mjs; V1 and V2 passed with logs under .hoyeon/implement/cli-command-registry-refactor/artifacts/logs.

### N2. Refactor command validation and daemon-backed routing to use the shared metadata. Covers R2, AC2.

- Status: complete
- Source task: T2
- Owner: unassigned
- Depends on: none
- Write scope: chromux.mjs, .hoyeon
- Parallel safe: yes
- Risk: medium
- Covers: R: R2; AC: AC2; V: V1, V2, V4
- Evidence:
  - 2026-07-05T17:38:07.989Z: runCli daemon-backed routing now dispatches through DAEMON_COMMAND_ROUTES instead of per-call tab command sets; V1, V2, and V4 passed.

### N3. Preserve help output and hidden compatibility alias policy. Covers R3, AC3.

- Status: complete
- Source task: T3
- Owner: unassigned
- Depends on: none
- Write scope: chromux.mjs, .hoyeon
- Parallel safe: yes
- Risk: medium
- Covers: R: R3; AC: AC3; V: V1, V2, V4
- Evidence:
  - 2026-07-05T17:38:08.051Z: Primary help still exposes wait-for-selector and hides compatibility aliases while daemon routes keep aliases callable; V1, V2, and V4 passed.

### N4. Add or update automated coverage for command metadata invariants if existing coverage is insufficient, then run local...

- Status: complete
- Source task: T4
- Owner: unassigned
- Depends on: none
- Write scope: chromux.mjs, .hoyeon
- Parallel safe: yes
- Risk: medium
- Covers: R: R4; AC: AC4; V: V1, V2, V3, V4
- Evidence:
  - 2026-07-05T17:38:08.114Z: Status app self-test now checks command metadata registry invariants and full local verification V1-V4 passed.

### N5. Prepare PR delivery handoff and ship through PR delivery after receipt without staging unrelated local artifacts. Cov...

- Status: complete
- Source task: T5
- Owner: unassigned
- Depends on: N4
- Write scope: chromux.mjs, .hoyeon
- Parallel safe: yes
- Risk: medium
- Covers: R: R5; AC: AC5; V: V5
- Evidence:
  - 2026-07-05T17:38:08.178Z: PR delivery handoff is ready in implementation state with delivery.mode=pr, branch=prd/cli-command-registry-refactor, and allowlist staging handled by prd_ship; actual PR/CI execution remains the post-receipt V5 gate.
  - 2026-07-05T17:44:55.162Z: PR delivery handoff state now contains explicit allowlist staging include paths (.hoyeon/config.json, .hoyeon/prd/cli-command-registry-refactor, .hoyeon/implement/cli-command-registry-refactor, chromux.mjs) and exclude paths (.hoyeon/implement/.prd-implement-active.json, .hoyeon/implement/.prd-implement-sessions, .hoyeon/implement/cli-command-registry-refactor/artifacts).

## Rollups

- T1: nodes N1; AC AC1; Verification V1, V2
- T2: nodes N2; AC AC2; Verification V1, V2, V4
- T3: nodes N3; AC AC3; Verification V1, V2, V4
- T4: nodes N4; AC AC4; Verification V1, V2, V3, V4
- T5: nodes N5; AC AC5; Verification V5

## Trace Matrix

- T1: N N1; R R1; AC AC1; required V V1, V2; optional V none
- T2: N N2; R R2; AC AC2; required V V1, V2, V4; optional V none
- T3: N N3; R R3; AC AC3; required V V1, V2, V4; optional V none
- T4: N N4; R R4; AC AC4; required V V1, V2, V3, V4; optional V none
- T5: N N5; R R5; AC AC5; required V none; optional V V5

## Gaps

- warning: weak_graph_repeated_write_scope execution-plan - Most execution nodes share the same write scope (chromux.mjs
.hoyeon); narrow scopes before relying on parallel guidance
