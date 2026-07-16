# Execution Plan: chromux-live-mode

- PRD: agents/prd/chromux-live-mode/prd.md
- Status: ready
- Generated: 2026-07-16T10:28:53.613Z
- Nodes: 10
- Blocking gaps: 0
- Warnings: 1

## Ready Guidance

- Ready sequential: none
- Ready parallel groups: none

## Nodes

### N1. transport 추상화 계층 도입과 direct transport 회귀 무결성 확보. Covers R1.

- Status: complete
- Source task: T1
- Owner: unassigned
- Depends on: none
- Write scope: unknown
- Parallel safe: no
- Risk: medium
- Covers: R: R1; AC: AC1, AC11; V: V2, V4
- Evidence:
  - 2026-07-16T12:06:56.370Z: live bridge (CDP facade + zero-dep WS server + pairing), MV3 extension, CLI live surface (pair/tabs/open --tab/cold-start/kill/show gating), safety semantics (close=detach, kill≠process-kill), download adapter, disconnect handling, and Chrome-for-Testing harness. Verified: ./test-live.sh parity 7/7 + safety 5/5.

### N2. zero-dependency localhost WS 서버 + 페어링 토큰 발급/검증/재발급. Covers R2.

- Status: complete
- Source task: T2
- Owner: unassigned
- Depends on: none
- Write scope: unknown
- Parallel safe: no
- Risk: medium
- Covers: R: R2; AC: AC2; V: V2, V4
- Evidence:
  - 2026-07-16T12:06:56.371Z: live bridge (CDP facade + zero-dep WS server + pairing), MV3 extension, CLI live surface (pair/tabs/open --tab/cold-start/kill/show gating), safety semantics (close=detach, kill≠process-kill), download adapter, disconnect handling, and Chrome-for-Testing harness. Verified: ./test-live.sh parity 7/7 + safety 5/5.

### N3. MV3 extension 구현(attach/relay, 탭 목록, keep-alive, 자동 재접속, 팝업/kill switch). Covers R3.

- Status: complete
- Source task: T3
- Owner: unassigned
- Depends on: none
- Write scope: unknown
- Parallel safe: no
- Risk: medium
- Covers: R: R3; AC: AC3, AC4; V: V2, V3, V4
- Evidence:
  - 2026-07-16T12:06:56.371Z: live bridge (CDP facade + zero-dep WS server + pairing), MV3 extension, CLI live surface (pair/tabs/open --tab/cold-start/kill/show gating), safety semantics (close=detach, kill≠process-kill), download adapter, disconnect handling, and Chrome-for-Testing harness. Verified: ./test-live.sh parity 7/7 + safety 5/5.

### N4. CLI live 예약 프로필, 설치/페어링 자동화 명령, 탭 목록/attach, 마이그레이션·미페어링 안내. Covers R4.

- Status: complete
- Source task: T4
- Owner: unassigned
- Depends on: none
- Write scope: unknown
- Parallel safe: no
- Risk: medium
- Covers: R: R4; AC: AC2, AC5; V: V2, V3, V4
- Evidence:
  - 2026-07-16T12:06:56.371Z: live bridge (CDP facade + zero-dep WS server + pairing), MV3 extension, CLI live surface (pair/tabs/open --tab/cold-start/kill/show gating), safety semantics (close=detach, kill≠process-kill), download adapter, disconnect handling, and Chrome-for-Testing harness. Verified: ./test-live.sh parity 7/7 + safety 5/5.

### N5. 탭/프로세스 안전 시맨틱(close/kill/기본 새 탭)과 콜드 스타트 자동 실행. Covers R5, R6.

- Status: complete
- Source task: T5
- Owner: unassigned
- Depends on: none
- Write scope: unknown
- Parallel safe: no
- Risk: medium
- Covers: R: R5, R6; AC: AC5, AC6, AC8; V: V3, V4
- Evidence:
  - 2026-07-16T12:06:56.371Z: live bridge (CDP facade + zero-dep WS server + pairing), MV3 extension, CLI live surface (pair/tabs/open --tab/cold-start/kill/show gating), safety semantics (close=detach, kill≠process-kill), download adapter, disconnect handling, and Chrome-for-Testing harness. Verified: ./test-live.sh parity 7/7 + safety 5/5.

### N6. CDP 시맨틱 어댑터(Target/Browser 도메인 매핑, chrome.downloads 어댑터)와 매트릭스 전 항목 구현 + `verify` 항목(--oopif) 판정 확정. Covers R7.

- Status: complete
- Source task: T6
- Owner: unassigned
- Depends on: none
- Write scope: unknown
- Parallel safe: no
- Risk: medium
- Covers: R: R7; AC: AC1, AC7, AC9; V: V2, V4
- Evidence:
  - 2026-07-16T12:06:56.371Z: live bridge (CDP facade + zero-dep WS server + pairing), MV3 extension, CLI live surface (pair/tabs/open --tab/cold-start/kill/show gating), safety semantics (close=detach, kill≠process-kill), download adapter, disconnect handling, and Chrome-for-Testing harness. Verified: ./test-live.sh parity 7/7 + safety 5/5.

### N7. 끊김/차단 처리와 repair hint 통합. Covers R8.

- Status: complete
- Source task: T7
- Owner: unassigned
- Depends on: none
- Write scope: unknown
- Parallel safe: no
- Risk: medium
- Covers: R: R8; AC: AC3, AC4, AC11; V: V3, V4
- Evidence:
  - 2026-07-16T12:06:56.371Z: live bridge (CDP facade + zero-dep WS server + pairing), MV3 extension, CLI live surface (pair/tabs/open --tab/cold-start/kill/show gating), safety semantics (close=detach, kill≠process-kill), download adapter, disconnect handling, and Chrome-for-Testing harness. Verified: ./test-live.sh parity 7/7 + safety 5/5.

### N8. live 검증 하니스 구축(Chrome for Testing 조달 방식 확정 포함)과 live 스위트 작성. Covers R10.

- Status: complete
- Source task: T8
- Owner: unassigned
- Depends on: none
- Write scope: unknown
- Parallel safe: no
- Risk: medium
- Covers: R: R10; V: V2
- Evidence:
  - 2026-07-16T12:06:56.371Z: live bridge (CDP facade + zero-dep WS server + pairing), MV3 extension, CLI live surface (pair/tabs/open --tab/cold-start/kill/show gating), safety semantics (close=detach, kill≠process-kill), download adapter, disconnect handling, and Chrome-for-Testing harness. Verified: ./test-live.sh parity 7/7 + safety 5/5.

### N9. 문서/스킬/doc-check needles/토큰 벤치마크 동기화. Covers R9.

- Status: complete
- Source task: T9
- Owner: unassigned
- Depends on: none
- Write scope: unknown
- Parallel safe: no
- Risk: medium
- Covers: R: R9; AC: AC10; V: V1
- Evidence:
  - 2026-07-16T12:10:52.588Z: Live mode documented in help, README (Live mode section), install.md (Live Mode Setup), skills/chromux and skills/chromux-work. doc-check needles added for live surface. package.json bumped to 0.20.0, extension/ added to files allowlist; npm pack --dry-run includes extension/ (7 files) and excludes harness/agents.

### N10. 릴리즈 위생: package.json 0.20.0 minor 범프, npm pack allowlist에 extension 포함 확인. Covers R9. (release hygiene)

- Status: complete
- Source task: T10
- Owner: unassigned
- Depends on: none
- Write scope: unknown
- Parallel safe: no
- Risk: medium
- Covers: R: R9; AC: AC10; V: V1
- Evidence:
  - 2026-07-16T12:10:52.588Z: Live mode documented in help, README (Live mode section), install.md (Live Mode Setup), skills/chromux and skills/chromux-work. doc-check needles added for live surface. package.json bumped to 0.20.0, extension/ added to files allowlist; npm pack --dry-run includes extension/ (7 files) and excludes harness/agents.

## Rollups

- T1: nodes N1; AC AC1, AC11; Verification V2, V4
- T2: nodes N2; AC AC2; Verification V2, V4
- T3: nodes N3; AC AC3, AC4; Verification V2, V3, V4
- T4: nodes N4; AC AC2, AC5; Verification V2, V3, V4
- T5: nodes N5; AC AC5, AC6, AC8; Verification V3, V4
- T6: nodes N6; AC AC1, AC7, AC9; Verification V2, V4
- T7: nodes N7; AC AC3, AC4, AC11; Verification V3, V4
- T8: nodes N8; AC none; Verification V2
- T9: nodes N9; AC AC10; Verification V1
- T10: nodes N10; AC AC10; Verification V1

## Trace Matrix

- T1: N N1; R R1; AC AC1, AC11; required V V2, V4; optional V none
- T2: N N2; R R2; AC AC2; required V V2, V4; optional V none
- T3: N N3; R R3; AC AC3, AC4; required V V2, V3, V4; optional V none
- T4: N N4; R R4; AC AC2, AC5; required V V2, V3, V4; optional V none
- T5: N N5; R R5, R6; AC AC5, AC6, AC8; required V V3, V4; optional V none
- T6: N N6; R R7; AC AC1, AC7, AC9; required V V2, V4; optional V none
- T7: N N7; R R8; AC AC3, AC4, AC11; required V V3, V4; optional V none
- T8: N N8; R R10; AC none; required V V2; optional V none
- T9: N N9; R R9; AC AC10; required V V1; optional V none
- T10: N N10; R R9; AC AC10; required V V1; optional V none

## Gaps

- warning: task_without_acceptance_mapping T8 - Task has no acceptance-criterion mapping
