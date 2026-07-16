# Verification Plan: chromux-live-mode

- Status: ready
- Generated: 2026-07-16T10:28:31.325Z
- PRD: agents/prd/chromux-live-mode/prd.md

## Environment

- Package manager: npm
- Browser tool: chromux
- Server strategy: no dev server script detected
- Service strategy: use repo-local dev/test commands; ask if services are required
- DB strategy: no DB surface detected

## Test Mode Contract

- build/static: required=yes; blockable=no; covers=help/doc-check/npm pack 등 리포 건강; human=none
- automated behavior: required=yes; blockable=no; covers=하니스 기반 live 파이프라인 전체 회귀; human=none
- browser/runtime: required=yes; blockable=no; covers=실사용자 Chrome 라이브 스모크; human=extension 수동 로드 필요 (4.1)
- human: required=no; blockable=yes; covers=팝업 카피/디자인 판단; human=최종 UX 판단

## Checks

### VP1. V1 - command

- Level: General
- Source: verification_matrix
- Test mode: build/static
- Tool: verify-run
- Command: `node chromux.mjs help && node benchmarks/chromux-doc-check.mjs && npm pack --dry-run && ./test.sh`
- Covers: R: R9; AC: AC10; T: T9, T10
- Artifacts: command-log
- Pass criteria: help/doc-check/pack allowlist(extension 포함)/direct transport 회귀가 모두 통과한다
- Required for done: yes
- Can be blocked: no
- Contract method: `node chromux.mjs help && node benchmarks/chromux-doc-check.mjs && npm pack --dry-run && ./test.sh`
- Contract artifact: command-log
- Safe probe: 로컬 전용, 외부 부작용 없음
- Sensitive data policy: 비밀정보 없음
- Status: planned

### VP2. V2 - automated

- Level: General
- Source: verification_matrix
- Test mode: automated behavior
- Tool: verify-run
- Command: ``./test-live.sh --suite parity` (T8이 구축하는 live 하니스 스크립트)`
- Covers: R: R1, R2, R3, R7; AC: AC1, AC2, AC7, AC9; T: T8
- Artifacts: command-log
- Pass criteria: 패리티 스위트, 페어링 인증 거부, download 경로, unsupported 에러가 자동 검증된다. 보호하는 회귀: transport 교체로 인한 기존 명령 의미 변화와 인증 우회
- Required for done: yes
- Can be blocked: no
- Contract method: `./test-live.sh --suite parity` (T8이 구축하는 live 하니스 스크립트)
- Contract artifact: command-log
- Safe probe: 테스트 전용 브라우저/프로필만 사용, 로컬 픽스처 우선
- Sensitive data policy: 테스트 토큰만 사용, 로그에 토큰 리댁션
- Status: planned

### VP3. V3 - automated

- Level: General
- Source: verification_matrix
- Test mode: automated behavior
- Tool: verify-run
- Command: ``./test-live.sh --suite safety` (동일 하니스의 안전/복구 스위트)`
- Covers: R: R5, R6, R8; AC: AC3, AC4, AC5, AC6, AC8
- Artifacts: command-log
- Pass criteria: 워커 강제 종료 재접속, kill switch 차단, 탭 목록/attach, close=detach, kill 후 프로세스 생존, 콜드 스타트가 자동 검증된다. 보호하는 회귀: 사용자 탭/프로세스를 파괴하는 안전 시맨틱 붕괴
- Required for done: yes
- Can be blocked: no
- Contract method: `./test-live.sh --suite safety` (동일 하니스의 안전/복구 스위트)
- Contract artifact: command-log
- Safe probe: 테스트 전용 브라우저 프로세스만 종료/재시작
- Sensitive data policy: 테스트 토큰만 사용, 로그에 토큰 리댁션
- Status: planned

### VP4. V4 - command

- Level: General
- Source: verification_matrix
- Test mode: browser/runtime
- Tool: verify-run
- Command: ``CHROMUX_PROFILE=live node chromux.mjs ...`로 페어링→open→탭 목록/attach→snapshot/click→screenshot→kill switch 순서의 스모크 실행`
- Covers: R: R1, R2, R3, R4, R5, R6, R7, R8; AC: AC11
- Artifacts: command-log, screenshot, console-log
- Pass criteria: 실사용자 Chrome에서 전체 스모크가 성공한다 (AGENTS.md 라이브 스모크 케이던스)
- Required for done: yes
- Can be blocked: no
- Contract method: `CHROMUX_PROFILE=live node chromux.mjs ...`로 페어링→open→탭 목록/attach→snapshot/click→screenshot→kill switch 순서의 스모크 실행
- Contract artifact: screenshot + command-log
- Safe probe: 스모크는 example.com 등 무해 사이트 + 사용자가 지정한 탭만 조작, 로그인 액션 없음
- Sensitive data policy: 실세션 쿠키/토큰 미기록, 스크린샷에 개인 정보 노출 시 리댁션
- Status: planned

## Acceptance Coverage

- AC1: covered (VP2, VP4) - 격리 프로필에서 통과하는 핵심 명령 스위트(open/snapshot/click/fill/type/press/run/screenshot/watch/wait)가 live 하니스에서 동일 응답 스키마로 통과한다. (...
- AC2: covered (VP2, VP4) - 페어링 토큰 없는/불일치 WS 접속은 거부되고, 미페어링 상태의 live 명령은 설치/페어링 안내를 포함한 에러를 반환한다. 토큰 파일 권한은 0600이다. (R2, R4)
- AC3: covered (VP2, VP3, VP4) - 하니스에서 service worker를 강제 종료하면 extension이 자동 재접속하고, 종료 시점에 진행 중이던 명령은 repair hint 포함 에러로 즉시 실패한다. (R3, R8)
- AC4: covered (VP2, VP3, VP4) - 팝업 kill switch를 누르면 전체 detach되고, 이후 자동 재연결이 일어나지 않으며, live 명령은 차단 상태 안내 에러를 낸다. (R3, R8)
- AC5: covered (VP3, VP4) - 기본 `open`은 새 탭을 만들고, 탭 목록 조회 후 활성 탭/URL 매칭 attach가 동작하며, 복수 매칭 시 후보 목록을 반환한다. (R4, R5)
- AC6: covered (VP3, VP4) - 하니스에서 브라우저 미실행 상태로 live 명령을 실행하면 브라우저가 자동 실행되고 재접속 후 명령이 완료된다. 대기 초과 시 안내 에러를 낸다. (R6)
- AC7: covered (VP2, VP4) - live `download`가 파일을 다운로드 폴더에 저장하고 응답에 실제 경로를 명시한다. (R7)
- AC8: covered (VP3, VP4) - attach한 기존 탭에 `close`를 호출하면 탭이 살아있는 채 detach만 되고, agent가 만든 탭은 실제로 닫힌다. `kill live` 후에도 브라우저 프로세스가 살아있다. (R5)
- AC9: covered (VP2, VP4) - 매트릭스의 `unsupported` 명령(show, launch --headless, chrome:// attach)이 사유를 포함한 `live unsupported` 에러를 반환한다. (R7)
- AC10: covered (VP1) - `node benchmarks/chromux-doc-check.mjs`가 live 모드 needles를 포함해 통과하고, help/README/install.md/skills가 같은 스토리를 말한다. (R9)
- AC11: covered (VP2, VP3, VP4) - 실사용자 Chrome에서 라이브 스모크(페어링 → 새 탭 open → 활성 탭 attach → snapshot/click → kill switch)가 성공한다. (R1-R8)

## Gaps

- None
