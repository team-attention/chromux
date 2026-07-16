---
topic: "chromux live 모드 - extension 브리지로 사용자 실제 Chrome 연결"
status: "complete"
target_handoff: "prd"
where: "brownfield"
selected_packs: "ux, compatibility, provider, risk, operation, verification"
created_at: "2026-07-16"
updated_at: "2026-07-16"
question_count: 7
normalization_policy: "raw-capture-with-checkpoint-backfill"
normalization_checkpoint_every: 10
---

# Interview Log: chromux live 모드

## Current Understanding

- MV3 extension이 `chrome.debugger`로 사용자 실제 Chrome 탭에 attach하고, 로컬 chromux 데몬과 WebSocket으로 CDP를 릴레이하는 "live 모드"를 추가한다.
- 기존 격리 프로필 루트는 그대로 유지, live는 두 번째 루트("나의 브라우저")로 opt-in.
- CLI 표면은 동일 유지, 프로필 선택(`CHROMUX_PROFILE=live` 등)으로 두 루트를 오간다.
- 제약: chrome.debugger는 CDP 부분집합(browser-level 도메인 없음), 디버깅 인포바 상시 노출, MV3 service worker 수명 관리 필요, Chrome 136+는 기본 프로필에 --remote-debugging-port 차단.

## Intake Cursor

- next_decision_id: D-22
- next_question: 없음 (인터뷰 종료, handoff 작성)
- last_materiality_sweep: Sweep 2 (Q6 이후)
- outstanding_raw_entries: 0
- next_checkpoint_at: 완료

## Decision Register

| ID | Kind | Area | Decision / fact | Priority | Source / owner | Status | PRD mapping / revisit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| D-01 | fact | 아키텍처 | 프로필별 데몬이 browser-level CDP 연결을 소유; live 모드는 extension WS 릴레이로 transport를 대체해야 함 | P0 | chromux.mjs:2749, chromux.mjs:1469 | resolved | 기술 구조 시그널 |
| D-02 | fact | 호환성 | chrome.debugger는 CDP 부분집합: browser-level 도메인 없음, chrome://·Web Store·타 extension 페이지 attach 불가, 인포바 상시 노출 | P0 | Chrome extensions API 문서 (대화에서 확인) | resolved | 제약/비목표 매핑 |
| D-03 | fact | 호환성 | 다운로드 등 일부 기능은 browser-level CDP 필수 → live 모드에서 degrade 대상 | P1 | chromux.mjs:4431 | resolved | live 모드 기능 커버리지 결정과 연결 |
| D-04 | decision | 제품 방향 | 격리 프로필("agent의 브라우저") + live("나의 브라우저") 2-루트 멘탈 모델, live는 opt-in, CLI 표면 동일 유지 | P0 | user (사전 대화) | resolved | Clear Outcome |
| D-05 | fact | 제약 | Chrome 136+는 기본 user-data-dir에 --remote-debugging-port 무시 → 사용자 "기본 프로필"에 붙는 유일한 경로가 extension 브리지 (별도 user-data-dir 실행은 여전히 포트 디버깅 가능) | P0 | Chrome 릴리즈 정책 (감사에서 표현 교정) | resolved | 기술 구조 시그널 |
| D-06 | decision | UX/design | live 모드 탭 소유권: 기본은 agent가 새 탭 생성, 사용자가 명시 지정할 때만 기존/활성 탭에 attach | P0 | user (Q1) | resolved | 핵심 UX 요구사항 |
| D-07 | decision | 운영/배포 | extension은 unpacked(repo 포함 + 개발자 모드 로드) 배포 + chromux CLI가 설치/페어링 자동화 명령 제공. Web Store 배포는 비목표 | P0 | user (Q2) | resolved | 설치 UX 요구사항 + 비목표 |
| D-08 | decision | 스코프 | 1차 출시는 최대 패리티: chrome.debugger + extension API(chrome.downloads 등 우회 포함)로 가능한 모든 명령 지원, 진짜 불가능한 것만 명시적 미지원 에러 | P0 | user (Q3) | resolved | 명령별 feasibility 매트릭스 필요 |
| D-09 | decision | 접근/리스크 | 안전 장치: 최초 페어링 1회 승인(토큰 교환) + extension 팝업에 전체 detach kill switch와 attach된 탭 목록 표시. 이후 작업은 무확인 진행 | P0 | user (Q4) | resolved | 보안 요구사항 + UX 카드 |
| D-10 | decision | UX/design | 기존 탭 지정 UX: CLI에서 live 탭 목록(제목/URL/활성 여부) 조회 후 활성 탭·URL 매칭으로 attach. 사용자는 말로만 지시, 추가 클릭 없음 | P0 | user (Q5) | resolved | 핵심 UX 요구사항 + UX 카드 |
| D-11 | decision | CLI 표면 | live 진입은 `live` 예약 프로필명(CHROMUX_PROFILE=live / --profile live). 기존 명령 표면 유지. 동명의 기존 사용자 프로필 존재 시 마이그레이션 안내 | P1 | user (Q6-1) | resolved | CLI 요구사항 |
| D-12 | decision | 스코프 | 1차는 단일 Chrome 프로필 페어링만. 다중 Chrome 프로필 동시 페어링(live:work 등 네임드 타깃)은 명시적 추후 과제 | P1 | user (Q6-2) | resolved | 비목표 + revisit: 다중 페어링 수요 발생 시 |
| D-13 | decision | UX/design | 끊김 처리: extension 자동 재접속 + 진행 중 명령은 명확한 에러와 repair hint로 즉시 실패(암묵 재실행 없음). kill switch로 끊은 경우 자동 재연결 안 함. 전제: MV3 워커는 외부에서 깨울 수 없으므로 keep-alive 설계(chrome.alarms, WS 활동 기반 수명 연장 등)가 요구사항에 포함되어야 함 | P1 | user (Q6-3) + 감사 지적으로 keep-alive 전제 명시 | resolved | 실패/복구 요구사항 + 기술 구조 시그널 |
| D-14 | assumption | 검증 | live 파이프라인 자동 검증은 테스트 전용 브라우저를 `--load-extension`으로 띄워 extension→WS→데몬 경로를 실브라우저로 구동하는 하니스로 수행. 주의: 브랜드 Chrome 137+는 --load-extension 제거 → 하니스는 Chromium/Chrome for Testing 바이너리 필수. 출시 전 실사용자 Chrome 라이브 스모크 1회 병행(AGENTS.md 케이던스) | P1 | agent default + 감사에서 Chrome 137+ 제약 교정 | resolved | 검증 시드. revisit: 하니스 바이너리 조달 방식 결정 시 |
| D-15 | fact | 운영/문서 | 동작 변경 시 README.md, install.md, skills/chromux/, skills/chromux-work/, doc-check needles 동기 업데이트가 리포 규칙. live 모드도 동일 적용 + 응답 스키마(next/hints/replay) 일관성 유지 | P1 | AGENTS.md | resolved | 문서/스킬 요구사항 |
| D-16 | assumption | 호환성 | 명령별 feasibility 매트릭스에서 browser-level 전용 기능 중 extension API 우회가 불가능한 항목만 명시적 `live unsupported` 에러로 처리 (D-08의 경계 조건) | P1 | agent default (D-08에서 파생) | resolved | 요구사항 경계. revisit: PRD 단계 매트릭스 작성 시 |
| D-17 | decision | 스코프 | AGENTS.md 고위험 결합 스코프(transport 교체 + extension + 설치 자동화 + 페어링 + 탭 목록 + 다운로드 우회 + 신규 하니스, 수 주 단위 비용 고지)를 사용자가 명시 승인. 감사의 단계 분할 권고는 기각됨 | P0 | user (Q7-1, 비용 고지 후 승인) | resolved | 스코프 승인 기록. revisit: 구현 중 규모가 추정을 크게 초과 시 재확인 |
| D-18 | decision | UX/design | 콜드 스타트: live 명령 시 사용자 Chrome 미실행이면 chromux가 기본 Chrome을 자동 실행하고 extension 재접속을 기다린 뒤 진행 | P1 | user (Q7-2) | resolved | UX-02 카드 반영 |
| D-19 | decision | 아키텍처 | extension이 접속할 localhost WS 서버는 zero-dependency 유지를 위해 자체 구현(HTTP upgrade + RFC6455 프레이밍). Node 22 내장은 WS 클라이언트뿐이라 서버는 신규 코드 | P1 | agent default + AGENTS.md zero-dependency 원칙 (감사 지적 반영) | resolved | 기술 구조 시그널 |
| D-20 | assumption | 데이터 | live 모드 다운로드(chrome.downloads 우회)는 사용자 실제 다운로드 폴더에 저장됨을 기본으로 하고, 결과 경로를 응답에 명시 | P2 | agent default (감사 지적 반영) | resolved | revisit: feasibility 매트릭스 작성 시 |
| D-21 | assumption | 아키텍처 | live 동시성: 단일 페어링 하에서 데몬이 탭 단위로 멀티플렉싱하여 격리 프로필과 동일하게 병렬 탭 작업 허용 | P2 | agent default (기존 데몬 패턴 준용) | resolved | revisit: 사용자 체감 간섭 이슈 발생 시 |

## Raw Q&A

### Q1: live 모드 탭 소유권 모델
- decision_ids: D-06
- route: user-decision
- asked: live 모드에서 agent가 조작하는 탭의 소유권 모델 (새 탭만 / 활성 탭 중심 / 둘 다)
- recommended: 둘 다, 기본은 새 탭
- answer: 둘 다, 기본은 새 탭 (추천안 채택)
- immediate_notes: 기본은 agent가 새 탭 생성, 사용자가 명시 지정 시에만 기존 탭 attach. 안전 기본값 + "지금 보는 페이지 처리" 유스케이스 모두 커버.
- needs_normalization: false

### Q2: extension 배포/설치 방식
- decision_ids: D-07
- route: user-decision
- asked: extension 배포 방식 (unpacked 우선 / Web Store / unpacked + 설치 자동화)
- recommended: unpacked 우선
- answer: unpacked + 설치 자동화
- immediate_notes: repo에 extension 포함 + 개발자 모드 로드가 기본이되, chromux CLI가 설치/페어링을 돕는 명령(안내 + 페어링 토큰 발급)까지 스코프에 포함. Web Store는 비목표(추후 별도 결정).
- needs_normalization: false

### Q3: live 모드 1차 기능 커버리지
- decision_ids: D-08
- route: user-decision
- asked: 1차 출시에서 지원할 명령 범위 (핵심 조작 경로 / 최대 패리티 / 읽기 전용부터)
- recommended: 핵심 조작 경로
- answer: 최대 패리티 (추천안 대신 넓은 스코프 선택)
- immediate_notes: chrome.debugger로 기술적으로 가능한 모든 명령을 1차에서 지원. 다운로드는 chrome.downloads 우회 등 extension API 어댑터 포함. 진짜 불가능한 것만 명시적 미지원 에러. 구현/검증 규모가 커지므로 명령별 feasibility 매트릭스가 PRD에 필요.
- needs_normalization: false

### Q4: 안전 장치 수준
- decision_ids: D-09
- route: user-decision
- asked: live 모드 안전 장치 수준 (페어링 1회 + kill switch / 기존 탭 attach마다 승인 / 호스트 화이트리스트)
- recommended: 페어링 1회 + 즉시 차단
- answer: 페어링 1회 + 즉시 차단 (추천안 채택)
- immediate_notes: 최초 페어링 시 1회 승인(토큰 교환). 이후 무확인 진행. extension 아이콘/팝업에 전체 detach kill switch + 현재 attach된 탭 목록 표시. 로컬 WS는 페어링 토큰으로 잠금(공통 전제 승인됨).
- needs_normalization: false

### Q5: 기존 탭 지정 UX
- decision_ids: D-10
- route: user-decision
- asked: "지금 보는 페이지에서 해줘" 시 탭 지정 방법 (CLI 목록+지정 / extension 팝업 공유 / 활성 탭 키워드)
- recommended: CLI에서 탭 목록 + 지정
- answer: CLI에서 탭 목록 + 지정 (추천안 채택, multiSelect였으나 단일 선택)
- immediate_notes: agent가 live 탭 목록(제목/URL/활성 여부)을 조회해 활성 탭이나 URL 매칭으로 attach. 사용자 추가 클릭 없음. 탭 목록 조회는 chrome.tabs 기반 → extension이 목록 API를 제공해야 함.
- needs_normalization: false

### Q6: 저위험 확인 배치 (네이밍 / 다중 크롬 프로필 / 끊김 처리)
- decision_ids: D-11, D-12, D-13
- route: user-decision (배치 확인)
- asked: (1) live 프로필 네이밍 (2) 다중 Chrome 프로필 1차 범위 (3) 연결 끊김 기본 동작
- recommended: `live` 예약 프로필 / 1차 단일 페어링 / 자동 재연결 + 명시 실패
- answer: 세 항목 모두 추천안 채택
- immediate_notes: 없음
- needs_normalization: false

### Q7: 최종 감사 블로커 해소 (스코프 승인 / 콜드 스타트)
- decision_ids: D-17, D-18
- route: user-decision
- asked: (1) AGENTS.md 고위험 결합 스코프 승인 여부 (비용 고지: OOPIF급 이상, 수 주 단위) - 일괄 승인 / 단계 분할 / 축소 (2) Chrome 미실행 시 live 명령 동작
- recommended: 단계 분할 / Chrome 자동 실행
- answer: (1) 결합 스코프 일괄 승인 (추천안 기각, 사용자 판단) (2) Chrome 자동 실행 (추천안 채택)
- immediate_notes: 스코프 승인은 AGENTS.md가 요구하는 "비용 추정 후 명시 승인" 요건을 충족. 감사의 단계 분할 권고는 사용자가 기각. PRD에는 검증 가능한 중간 지점(내부 마일스톤)을 두되 산출물은 단일 스코프로.
- needs_normalization: false

## UX Scenario Cards

### UX-01: 설치와 페어링
- trigger: 사용자가 live 모드를 처음 쓰려 할 때 (CLI가 미페어링 상태를 감지하고 안내)
- happy path: chromux의 설치 안내 명령 실행 → chrome://extensions 개발자 모드로 repo 내 extension 로드 → CLI가 페어링 토큰 발급 → extension 팝업에 토큰 입력(또는 확인) → "연결됨" 상태가 CLI와 extension 팝업 양쪽에 표시
- state / failure: 토큰 불일치/만료, extension 미설치 상태에서 live 명령 실행(미페어링 에러 + 설치 안내), 다른 chromux 인스턴스가 이미 페어링됨
- recovery: 페어링 재발급 명령으로 토큰 재교환. 미페어링 에러 메시지에 설치/페어링 명령 안내 포함
- proof: 페어링 후 `chromux ps`(또는 동급)에서 live 타깃이 연결 상태로 보이고, live로 `open`이 실제 사용자 Chrome에 새 탭을 만든다
- linked decisions: D-07, D-09, D-11

### UX-02: 새 탭 기본 작업 (golden path)
- trigger: 사용자가 agent에게 자기 세션이 필요한 브라우저 작업을 요청 (예: 사내 SSO 뒤 페이지 조회)
- happy path: agent가 `CHROMUX_PROFILE=live chromux open <url>` → 사용자 Chrome에 새 탭 생성 + 인포바 표시 → snapshot/click/run 등 기존 명령이 동일 응답 스키마(interactive/next/hints/scripts/replay)로 동작 → 작업 완료 후 탭 정리
- state / failure: 사용자 Chrome 미실행(콜드 스타트), attach 불가 페이지(chrome://, Web Store)로 이동 시 명시적 에러, live 미지원 명령 실행 시 `live unsupported` 에러, 사용자가 작업 중 해당 탭을 닫음
- recovery: Chrome 미실행이면 chromux가 기본 Chrome을 자동 실행하고 extension 재접속 후 진행(D-18). 실패 응답에 기존 repair hint 패턴으로 원인과 다음 행동 안내. 탭이 닫힌 경우 새 탭 재생성은 agent 판단
- proof: 격리 프로필에서 통과하는 핵심 명령 스위트가 live 하니스(테스트 Chrome + --load-extension)에서 동일하게 통과
- linked decisions: D-04, D-06, D-08, D-16

### UX-03: "지금 보는 페이지에서 해줘" (기존 탭 attach)
- trigger: 사용자가 현재 보고 있는 탭을 대상으로 작업을 지시
- happy path: agent가 live 탭 목록 조회(제목/URL/활성 여부) → 활성 탭 또는 URL 매칭으로 attach → 해당 탭에서 snapshot/조작 수행 → 사용자는 자기 화면에서 진행을 실시간으로 봄
- state / failure: 활성 탭이 attach 불가 페이지, 매칭되는 탭 없음/복수 매칭, 사용자가 attach 중 다른 탭으로 이동하거나 페이지를 조작해 상태가 어긋남
- recovery: 복수 매칭 시 후보 목록을 반환해 agent가 좁히도록 함. 상태 어긋남은 기존 verify/next 패턴으로 재관찰 후 진행
- proof: 하니스에서 미리 열어둔 탭을 목록 조회→활성 탭 attach→조작까지 자동 검증. 실사용자 Chrome 라이브 스모크 1회
- linked decisions: D-06, D-10, D-14

### UX-04: 차단과 끊김 복구
- trigger: 사용자가 extension 팝업에서 kill switch를 누르거나, 서비스 워커 종료/Chrome 재시작으로 연결이 끊김
- happy path: (차단 시) kill switch 즉시 전체 detach + 인포바 소멸 → 진행 중이던 CLI 명령은 명확한 에러로 즉시 실패 → 자동 재연결 없음(사용자가 다시 켤 때까지)
- state / failure: 비의도 끊김(워커 종료/재시작)과 의도 차단(kill switch)이 구분되어야 함. 끊김 중 도착한 명령 처리
- recovery: 비의도 끊김은 extension이 자동 재접속, 진행 중 명령은 repair hint와 함께 즉시 실패(암묵 재실행 없음). 재연결 후 새 명령부터 정상 동작
- proof: 하니스에서 워커 강제 종료 후 자동 재접속과 명령 실패 메시지를 검증. kill switch 후 재연결이 일어나지 않음을 검증
- linked decisions: D-09, D-13

## Evidence From Code, Docs, Or Research

- `chromux.mjs:2749` startDaemon: 프로필별 데몬이 Chrome CDP 포트에 붙는 구조.
- `chromux.mjs:1469` /json/version의 webSocketDebuggerUrl로 browser-level 연결 획득.
- `chromux.mjs:4431` 다운로드는 데몬의 browser-level CDP 연결 필요 (503 처리).
- `package.json` version 0.19.1, zero-dependency 정책, files allowlist에 skills/ 포함.
- AGENTS.md: OOPIF/target 멀티플렉싱급 변경은 standalone high-risk change로 취급하는 규칙 존재.

## Documented Domain Checks

- docs inspected: AGENTS.md, package.json, chromux.mjs (부분)
- canonical terms: profile, daemon, live 모드(신규), extension 브리지(신규)
- glossary or code conflicts: 없음 확인
- concrete scenarios tested: 아직 없음
- docs mutation: 예정 없음 (인터뷰 단계)
- ADR candidate: live transport 추상화 설계

## Checkpoint And Sweep History

### Sweep 1
- trigger: 3+ 물질적 결정 (D-06~D-09)
- intent_drift: 없음 (2-루트 멘탈 모델 유지)
- impact_gap: 기존 탭 지정 UX 미해결 → Q5로 처리
- verification_gap: live 파이프라인 자동 검증 방법 미정 → D-14로 처리
- next_action: Q5 (탭 지정 UX)

### Sweep 2
- trigger: Q6 배치 확인 완료, P0 노드 전부 resolved
- intent_drift: 없음
- impact_gap: 없음 (명령별 feasibility 매트릭스는 PRD 단계 산출물로 위임, D-16)
- verification_gap: 없음 (D-14 하니스 + 라이브 스모크)
- next_action: 최종 정규화 → 검증기 → 최종 감사 → handoff

### Checkpoint 1 (final)
- after_question: Q6
- normalized_entries: Q1~Q6 전부 (raw 캡처 시점에 정규화 완료)
- register_changes: D-01~D-16 확정
- reopened_decisions: 없음
- highest_remaining_gap: 명령별 feasibility 매트릭스 (PRD 단계 과제로 명시)

## Audit History

### Audit 1
- type: final-auditor
- result: fail
- missing decision_ids: 고위험 결합 스코프 승인(→D-17), WS 서버 구현 방식(→D-19), live 동시성(→D-21)
- unsupported assumptions: D-05 표현 과장(교정), D-13 keep-alive 전제 누락(교정), D-14 --load-extension은 브랜드 Chrome 137+ 제거(교정), D-20 다운로드 경로 미정(추가)
- UX or behavior gap: Chrome 미실행 콜드 스타트(→D-18, UX-02 반영)
- highest-risk blocker: D-08 최대 패리티가 feasibility 근거·스코프 승인 없이 handoff되는 것
- final-blocking-question: 결합 스코프 승인 vs 단계 분할 vs 축소 → 사용자에게 Q7로 질의
- handoff impact: Q7 답변 및 레지스터 교정 후 해소

### Audit 2
- type: local
- result: pass
- missing decision_ids: 없음
- unsupported assumptions: 없음 (감사 지적 전부 레지스터에 반영)
- UX or behavior gap: 없음
- highest-risk blocker: 잔존 리스크는 명령별 feasibility 매트릭스(PRD 단계 산출물, D-16)와 하니스 바이너리 조달(D-14 revisit)로 추적됨
- final-blocking-question: 없음
- handoff impact: handoff 작성 가능
