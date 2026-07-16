---
topic: "chromux live 모드 - extension 브리지로 사용자 실제 Chrome 연결"
status: "ready"
human_approval: "approved"
review_profile: "high-risk"
review_rationale: "agent가 사용자의 실제 로그인된 브라우저 세션 위에서 동작하는 접근 경계 변경이며, 로컬 인증(페어링 토큰)과 즉시 차단 장치가 보안 표면이 된다."
source_intake: "agents/intake/chromux-live-mode/prd-handoff.md"
source_clarity: "none"
created_at: "2026-07-16"
updated_at: "2026-07-16"
---

# PRD: chromux live 모드 - extension 브리지로 사용자 실제 Chrome 연결

> Human approval: 2026-07-16 사용자 승인 발언 "고고 승인~" (Approval checklist 제시 후 대화 승인).

## 1. Summary

chromux에 두 번째 루트 "live 모드"를 추가한다.
MV3 extension이 `chrome.debugger`로 사용자 실제 Chrome 탭에 attach하고, 토큰 잠금 localhost WebSocket으로 chromux 데몬에 CDP를 릴레이한다.
사용자는 기존 CLI 표면 그대로 `CHROMUX_PROFILE=live`(예약 프로필)로 자신의 로그인된 브라우저를 agent에게 맡길 수 있고, 격리 프로필 루트는 그대로 유지된다.
1차 출시는 최대 패리티: 섹션 6의 feasibility 매트릭스에 따라 가능한 모든 기존 명령이 live에서 동작하고, 불가능한 것만 명시적 `live unsupported` 에러를 낸다.

Approval checklist:

- 스코프 경계: 최대 패리티 결합 스코프 일괄 승인(수 주 단위 규모, 인테이크 D-17에서 비용 고지 후 승인됨) 재확인 (섹션 3).
- feasibility 매트릭스의 `unsupported`/`degrade` 판정 수용 여부, 특히 `show`(DevTools 충돌)와 `--oopif`(검증 필요) (섹션 6, R7).
- 탭/프로세스 안전 시맨틱: attach한 사용자 탭에 대한 `close`는 detach로 동작, `kill live`는 사용자 Chrome을 절대 종료하지 않음 (R5).
- 기술 구조: transport 추상화 + zero-dependency WS 서버 자체 구현 + MV3 keep-alive 설계 (섹션 5).
- 검증 모드: Chrome for Testing 기반 자동 하니스(required) + 실사용자 Chrome 라이브 스모크(required) (섹션 9).
- delivery mode: local (PR 자동화 요청 없음, 기존 로컬 커밋 흐름).
- 사전 작업: 라이브 스모크 전 사용자가 본인 Chrome에 unpacked extension을 직접 로드해야 함 (섹션 4.1).

## 2. Problem, Goal, And Users

chromux는 현재 격리 프로필("agent의 브라우저")만 지원한다.
사용자의 실제 로그인 세션(사내 SSO, 2FA 계정, 이미 열려 있는 컨텍스트)이 필요한 작업은 불가능하고, Chrome 136+부터 기본 프로필에 대한 `--remote-debugging-port`가 차단되어 런치 방식으로는 해결할 수 없다.

목표: extension 브리지로 "나의 브라우저" 루트를 추가해, agent가 (1) 사용자의 실세션 위에서 작업하고 (2) "지금 보는 이 페이지에서 해줘" 요청을 처리할 수 있게 한다.
사용자는 chromux를 쓰는 AI agent와 그 운영자(현재 주 사용자: 이호연)다.
멘탈 모델은 "agent의 브라우저 vs 나의 브라우저" 2-루트이며, 선택 기준은 "이 작업에 내 세션이 필요한가" 하나다.

## 3. Scope And Non-Goals

### In Scope

- 데몬 transport 추상화: 직접 CDP 경로와 extension WS 릴레이 경로를 동일 명령 시맨틱/응답 스키마로 통합.
- MV3 extension(리포 내 `extension/` 신규 디렉토리): debugger attach/relay, 탭 목록, chrome.downloads 어댑터, keep-alive, 자동 재접속, 팝업(연결 상태 + attach 탭 목록 + kill switch).
- zero-dependency localhost WS 서버 + 페어링 토큰 인증.
- CLI: `live` 예약 프로필, 설치/페어링 자동화 명령, live 탭 목록/attach, 콜드 스타트 Chrome 자동 실행.
- 섹션 6 매트릭스 기준 최대 패리티 + 명시적 미지원 에러.
- 신규 자동 검증 하니스(Chrome for Testing + `--load-extension`) 및 문서/스킬 동기화.

### Non-Goals

- Chrome Web Store 배포. unpacked 배포만 지원한다. 사용자 결과: 설치에 개발자 모드 로드가 필요하다. 재검토 조건: 외부 사용자 배포 수요 발생 시 (인테이크 D-07).
- 다중 Chrome 프로필 동시 페어링(네임드 live 타깃). 1차는 단일 페어링. 사용자 결과: 개인/업무 Chrome 프로필 중 하나만 live로 쓸 수 있다. 재검토 조건: 다중 페어링 수요 발생 시 (D-12).
- 기존 탭 attach 건별 승인, 호스트 화이트리스트 (Q4에서 기각).
- extension 팝업에서 탭을 chromux로 공유하는 역방향 UX (Q5에서 기각).
- 인포바 숨김 (기술적으로 불가, 가시성 장점으로 수용).
- Firefox/Edge 등 타 브라우저 지원.

## 4. Pre-Work And Required Decisions

### 4.1 Pre-Work Before Implementation

- 실사용자 Chrome에 unpacked extension 로드 (V4 라이브 스모크 시점): `chrome://extensions`의 개발자 모드 토글과 "압축해제된 확장 프로그램 로드" 클릭은 브라우저 보안상 자동화가 불가능하고 사용자 본인의 브라우저에서만 수행할 수 있다. CLI 안내 명령이 절차를 출력하지만 클릭은 사용자 몫이다. 구현 중반까지는 하니스(V2)로 충분하므로 구현 시작을 막지 않는다.

### 4.2 Human Decisions Before PRD Approval

- 섹션 6 feasibility 매트릭스의 `unsupported`/`degrade` 판정 수용 (특히 `show`, `--oopif`, `batch`의 live 동작).
- attach한 사용자 탭의 `close` = detach, `kill live` = 데몬 정지 + 전체 detach(사용자 Chrome 프로세스 유지) 시맨틱 승인.
- Approval checklist 전체 승인.

### 4.3 Decision Traceability For Fidelity Review

수락된 사용자 결정 (인테이크 qa-log D#와 매핑):

- D-04/D-11: 2-루트 멘탈 모델, `live` 예약 프로필로 진입, CLI 표면 동일 유지 → R1, R4.
- D-06: 기본은 새 탭 생성, 명시 지정 시에만 기존 탭 attach → R5, AC5.
- D-07: unpacked 배포 + CLI 설치/페어링 자동화. Web Store는 비목표 → R3, R4, 비목표.
- D-08/D-17: 최대 패리티 결합 스코프를 비용 고지 후 일괄 승인 (감사의 단계 분할 권고를 사용자가 기각) → R7, 섹션 6 매트릭스.
- D-09: 페어링 1회 승인 + extension 팝업 kill switch/attach 탭 목록, 이후 무확인 진행 → R2, R3, AC2, AC8.
- D-10: 기존 탭 지정은 CLI 탭 목록(제목/URL/활성) 조회 + 활성/URL 매칭. 추가 클릭 없음 → R4, AC5.
- D-12: 1차 단일 페어링 (다중 Chrome 프로필은 추후) → 비목표.
- D-13: 비의도 끊김은 자동 재접속 + 진행 중 명령 즉시 명시 실패(암묵 재실행 금지). kill switch 후 자동 재연결 금지 → R8, AC8, AC9.
- D-18: 콜드 스타트 시 사용자 기본 Chrome 자동 실행 + 재접속 대기 → R6, AC6.
- D-19: WS 서버는 zero-dependency 자체 구현 → R2, 섹션 5.
- D-20: live 다운로드는 사용자 실제 다운로드 폴더 + 응답에 경로 명시 → R7(매트릭스 download 행), AC7.
- D-21: 단일 페어링 하 탭 단위 병렬 허용 (기존 데몬 멀티플렉싱 준용) → R1.

기각/보류된 옵션:

- 기각: 읽기 전용 1차, 핵심 경로 한정 1차, 단계 분할 (Q3, Q7).
- 기각: 기존 탭 attach 건별 승인, 호스트 화이트리스트 (Q4).
- 기각: extension 팝업 탭 공유, 활성 탭 단축 키워드 단독 방식 (Q5).
- 보류: feasibility 매트릭스 중 `verify` 표기 항목의 최종 판정 (섹션 10), 다중 페어링(D-12), 하니스 바이너리 조달 방식 상세(T8에서 확정).

### Delivery Decision

- delivery mode: local. PR/CI 자동화 요청 없음. 기존 관행대로 로컬 커밋, 버전 minor 범프(0.20.0), 명시적 요청 전 npm publish 금지 (AGENTS.md).

## 5. Major Technical Structure Changes

- Transport 추상화 계층 신설: 데몬의 CDP 연결(browser-level WebSocket + Target 도메인)을 transport 인터페이스로 분리하고, `direct`(기존)와 `extension-relay`(신규) 두 구현을 둔다. 명령 핸들러와 응답 스키마는 transport에 무관하게 동일하다.
- localhost WS 서버 신설: Node 22 내장은 WS 클라이언트뿐이므로 HTTP upgrade + RFC6455 프레이밍을 zero-dependency로 자체 구현한다. 페어링 토큰 없는 접속은 거부한다.
- MV3 extension 신규 서피스 (`extension/`): chrome.debugger 세션 관리, chrome.tabs 목록/생성, chrome.downloads 어댑터, service worker keep-alive(chrome.alarms + WS 활동 기반), 팝업 UI. 리포에 포함되고 npm pack allowlist에 추가된다.
- CDP 시맨틱 매핑: browser-level 의존 경로(Target.createTarget, Browser.setDownloadBehavior, /json/version)를 extension API 등가물(chrome.tabs.create, chrome.downloads, 릴레이 핸드셰이크)로 매핑하는 어댑터.
- `live` 예약 프로필: 프로필 해석 계층에서 `live`는 Chrome 런치 대신 릴레이 대기/콜드 스타트 경로를 탄다.
- 신규 검증 하니스: Chrome for Testing/Chromium 바이너리 + `--load-extension`으로 extension→WS→데몬 전 경로를 실브라우저로 구동 (브랜드 Chrome 137+는 `--load-extension` 제거).

## 6. Requirements

- R1. 데몬 transport 추상화: 모든 탭 명령이 direct/extension-relay 두 transport에서 동일한 명령 시맨틱과 응답 스키마(interactive/next/hints/scripts/replay, repair hints)로 동작한다. 단일 페어링 하에서 탭 단위 병렬 명령을 기존 데몬 멀티플렉싱과 동일하게 허용한다.
- R2. 페어링과 WS 보안: zero-dependency localhost WS 서버가 페어링 토큰으로 인증한다. 토큰은 CLI가 발급하고 로컬 파일 권한(0600)으로 보호하며, 토큰 불일치/부재 접속은 거부된다. 페어링은 최초 1회 승인이며 재발급 명령이 있다.
- R3. MV3 extension: debugger attach/relay, 탭 목록 제공, keep-alive(워커 휴면 방지), 자동 재접속, 팝업에 연결 상태/attach된 탭 목록/전체 detach kill switch를 제공한다. kill switch 후에는 자동 재연결하지 않는다.
- R4. CLI 표면: `CHROMUX_PROFILE=live`(및 `--profile live`) 예약 프로필로 진입한다. 설치/페어링 자동화 명령(절차 안내 + 토큰 발급/재발급), live 탭 목록 조회(제목/URL/활성 여부), 활성 탭 또는 URL 매칭으로 기존 탭 attach를 제공한다. `live`라는 이름의 기존 사용자 프로필이 있으면 마이그레이션 안내를 낸다. 미페어링 상태의 live 명령은 설치/페어링 안내를 포함한 에러를 낸다.
- R5. 탭/프로세스 안전 시맨틱: 기본은 새 탭 생성이며 명시 지정 시에만 기존 탭에 attach한다. attach한 사용자 탭에 대한 `close`는 탭을 닫지 않고 detach한다(agent가 만든 탭은 실제로 닫는다). `kill live`는 데몬 정지 + 전체 detach이며 사용자 Chrome 프로세스를 절대 종료하지 않는다.
- R6. 콜드 스타트: 사용자 Chrome이 실행 중이 아니면 chromux가 기본 Chrome을 자동 실행하고 extension 재접속을 기다린 뒤 명령을 진행한다. 대기 시간 초과 시 안내 포함 에러를 낸다.
- R7. 패리티 계약: 아래 feasibility 매트릭스가 live 지원 범위의 계약이다. `unsupported` 명령은 사유를 포함한 명시적 `live unsupported` 에러를 낸다. `verify` 항목은 구현 중 판정을 확정하고 매트릭스를 갱신하되, 판정 변경은 승인 없이 지원 범위를 줄일 수 없다(섹션 11).

| 명령/기능 | live 판정 | 방법/사유 |
| --- | --- | --- |
| open (새 탭, --background, --dialog) | supported | chrome.tabs.create + debugger attach, dialog는 Page 도메인 |
| snapshot/click/hover/drag/fill/type/press/wait-for-* | supported | DOM/AX/Input/Runtime 도메인 그대로 |
| run / cdp / batch | supported | Runtime/Page 릴레이. batch는 사용자 창에 워커 탭이 보임을 응답에 명시 |
| screenshot (+crop) | supported | Page.captureScreenshot |
| watch console/network | supported | Runtime/Network 이벤트 릴레이 |
| download | supported (adapter) | Browser.setDownloadBehavior 불가 → chrome.downloads. 파일은 사용자 다운로드 폴더, 응답에 경로 명시 |
| 탭 목록/attach (신규) | supported | chrome.tabs.query |
| close | supported (degrade) | agent 탭은 닫기, attach한 사용자 탭은 detach만 (R5) |
| launch / kill / pause / resume / ps | supported (degrade) | launch=콜드 스타트 실행, kill=detach+데몬 정지, ps에 live 연결 상태 표시 |
| note / script / list / app | supported | transport 무관 |
| --oopif (교차 출처 자식 타깃) | verify | debugger 세션 내 Target.setAutoAttach(flatten) 동작 확인 필요. AGENTS.md 고위험 규정 대상 |
| show (DevTools 열기) | unsupported | 탭당 디버거 1개 제약으로 chrome.debugger attach와 DevTools 동시 사용 불가. 에러에 사유 명시 |
| launch --headless / --port | unsupported | live는 사용자 브라우저이므로 헤드리스/포트 지정 무의미. 에러에 격리 프로필 안내 |
| chrome://, Web Store, 타 extension 페이지 | unsupported | chrome.debugger attach 불가. 에러에 사유 명시 |

- R8. 끊김/차단 처리: 비의도 끊김(워커 종료, Chrome 재시작)은 extension이 자동 재접속하고, 진행 중이던 명령은 기다리지 않고 repair hint 포함 에러로 즉시 실패한다(암묵 재실행 금지). kill switch로 끊은 경우 자동 재연결하지 않으며 이후 명령은 차단 상태 안내 에러를 낸다.
- R9. 문서/스킬 동기화: README.md, install.md, skills/chromux/, skills/chromux-work/에 live 모드(설치, 페어링, 2-루트 선택 기준, 매트릭스 요약, 안전 시맨틱)를 반영하고, `benchmarks/chromux-doc-check.mjs` needles를 추가한다. 응답 페이로드 크기 영향을 토큰 벤치마크로 확인한다.
- R10. 자동 검증 하니스: Chrome for Testing/Chromium + `--load-extension` 하니스가 extension→WS→데몬 전 경로를 실브라우저로 구동하며, 기존 test.sh와 별개의 live 스위트로 반복 실행 가능하다.

## 7. Acceptance Criteria

- AC1. 격리 프로필에서 통과하는 핵심 명령 스위트(open/snapshot/click/fill/type/press/run/screenshot/watch/wait)가 live 하니스에서 동일 응답 스키마로 통과한다. (R1, R7)
- AC2. 페어링 토큰 없는/불일치 WS 접속은 거부되고, 미페어링 상태의 live 명령은 설치/페어링 안내를 포함한 에러를 반환한다. 토큰 파일 권한은 0600이다. (R2, R4)
- AC3. 하니스에서 service worker를 강제 종료하면 extension이 자동 재접속하고, 종료 시점에 진행 중이던 명령은 repair hint 포함 에러로 즉시 실패한다. (R3, R8)
- AC4. 팝업 kill switch를 누르면 전체 detach되고, 이후 자동 재연결이 일어나지 않으며, live 명령은 차단 상태 안내 에러를 낸다. (R3, R8)
- AC5. 기본 `open`은 새 탭을 만들고, 탭 목록 조회 후 활성 탭/URL 매칭 attach가 동작하며, 복수 매칭 시 후보 목록을 반환한다. (R4, R5)
- AC6. 하니스에서 브라우저 미실행 상태로 live 명령을 실행하면 브라우저가 자동 실행되고 재접속 후 명령이 완료된다. 대기 초과 시 안내 에러를 낸다. (R6)
- AC7. live `download`가 파일을 다운로드 폴더에 저장하고 응답에 실제 경로를 명시한다. (R7)
- AC8. attach한 기존 탭에 `close`를 호출하면 탭이 살아있는 채 detach만 되고, agent가 만든 탭은 실제로 닫힌다. `kill live` 후에도 브라우저 프로세스가 살아있다. (R5)
- AC9. 매트릭스의 `unsupported` 명령(show, launch --headless, chrome:// attach)이 사유를 포함한 `live unsupported` 에러를 반환한다. (R7)
- AC10. `node benchmarks/chromux-doc-check.mjs`가 live 모드 needles를 포함해 통과하고, help/README/install.md/skills가 같은 스토리를 말한다. (R9)
- AC11. 실사용자 Chrome에서 라이브 스모크(페어링 → 새 탭 open → 활성 탭 attach → snapshot/click → kill switch)가 성공한다. (R1-R8)

## 8. PRD-Level Tasks

- T1. transport 추상화 계층 도입과 direct transport 회귀 무결성 확보. Covers R1.
- T2. zero-dependency localhost WS 서버 + 페어링 토큰 발급/검증/재발급. Covers R2.
- T3. MV3 extension 구현(attach/relay, 탭 목록, keep-alive, 자동 재접속, 팝업/kill switch). Covers R3.
- T4. CLI live 예약 프로필, 설치/페어링 자동화 명령, 탭 목록/attach, 마이그레이션·미페어링 안내. Covers R4.
- T5. 탭/프로세스 안전 시맨틱(close/kill/기본 새 탭)과 콜드 스타트 자동 실행. Covers R5, R6.
- T6. CDP 시맨틱 어댑터(Target/Browser 도메인 매핑, chrome.downloads 어댑터)와 매트릭스 전 항목 구현 + `verify` 항목(--oopif) 판정 확정. Covers R7.
- T7. 끊김/차단 처리와 repair hint 통합. Covers R8.
- T8. live 검증 하니스 구축(Chrome for Testing 조달 방식 확정 포함)과 live 스위트 작성. Covers R10.
- T9. 문서/스킬/doc-check needles/토큰 벤치마크 동기화. Covers R9.
- T10. 릴리즈 위생: package.json 0.20.0 minor 범프, npm pack allowlist에 extension 포함 확인. Covers R9. (release hygiene)

## 9. Verification Contract

### 9.1 Test Mode Contract

| Mode | Required For Done | Covers | Human Decision |
| --- | --- | --- | --- |
| build/static | yes | help/doc-check/npm pack 등 리포 건강 | none |
| automated behavior | yes | 하니스 기반 live 파이프라인 전체 회귀 | none |
| browser/runtime | yes | 실사용자 Chrome 라이브 스모크 | extension 수동 로드 필요 (4.1) |
| human | no/blockable | 팝업 카피/디자인 판단 | 최종 UX 판단 |

### 9.2 Required Agent Verification

| ID | Mode | Covers | Method | Artifact | Pass Intent | Required For Done | Can Be Blocked | Safe Probe | Sensitive Data Policy |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| V1 | build/static | R9, AC10, T9, T10 | `node chromux.mjs help && node benchmarks/chromux-doc-check.mjs && npm pack --dry-run && ./test.sh` | command-log | help/doc-check/pack allowlist(extension 포함)/direct transport 회귀가 모두 통과한다 | yes | no | 로컬 전용, 외부 부작용 없음 | 비밀정보 없음 |
| V2 | automated behavior | R1-R3, R7, AC1-AC2, AC7, AC9 | `./test-live.sh --suite parity` (T8이 구축하는 live 하니스 스크립트) | command-log | 패리티 스위트, 페어링 인증 거부, download 경로, unsupported 에러가 자동 검증된다. 보호하는 회귀: transport 교체로 인한 기존 명령 의미 변화와 인증 우회 | yes | no | 테스트 전용 브라우저/프로필만 사용, 로컬 픽스처 우선 | 테스트 토큰만 사용, 로그에 토큰 리댁션 |
| V3 | automated behavior | R5, R6, R8, AC3-AC6, AC8 | `./test-live.sh --suite safety` (동일 하니스의 안전/복구 스위트) | command-log | 워커 강제 종료 재접속, kill switch 차단, 탭 목록/attach, close=detach, kill 후 프로세스 생존, 콜드 스타트가 자동 검증된다. 보호하는 회귀: 사용자 탭/프로세스를 파괴하는 안전 시맨틱 붕괴 | yes | no | 테스트 전용 브라우저 프로세스만 종료/재시작 | 테스트 토큰만 사용, 로그에 토큰 리댁션 |
| V4 | browser/runtime | R1-R8, AC11 | `CHROMUX_PROFILE=live node chromux.mjs ...`로 페어링→open→탭 목록/attach→snapshot/click→screenshot→kill switch 순서의 스모크 실행 | screenshot + command-log | 실사용자 Chrome에서 전체 스모크가 성공한다 (AGENTS.md 라이브 스모크 케이던스) | yes | yes (4.1 사전 작업 대기 시) | 스모크는 example.com 등 무해 사이트 + 사용자가 지정한 탭만 조작, 로그인 액션 없음 | 실세션 쿠키/토큰 미기록, 스크린샷에 개인 정보 노출 시 리댁션 |

### 9.3 Human Verification

- 팝업 UI의 카피와 시각 디자인 최종 판단 (기능 요구는 R3으로 검증됨).
- 설치 가이드 문구 품질 (install.md).
- 매트릭스 `verify` 항목(--oopif) 판정이 `unsupported`로 확정될 경우 수용 여부.

## 10. Risks And Open Decisions

- 최대 패리티 과약속 리스크: 매트릭스 `verify` 항목이 구현 중 unsupported로 판정될 수 있다. 판정 변경은 사용자 확인을 거친다 (deferred, T6에서 확정).
- MV3 워커 수명: keep-alive 설계가 Chrome 정책 변화에 취약하다. 자동 재접속(R8)이 완충이며, 하니스 V3이 회귀를 잡는다.
- 하니스 바이너리 조달: Chrome for Testing 다운로드 방식(수동 배치 vs 스크립트)은 T8에서 확정한다 (deferred).
- 실세션 위 agent 동작: 페어링 토큰 + kill switch + 인포바 가시성이 방어선. live는 opt-in이며 기본 루트는 격리 프로필 유지.
- localhost WS 공격면: 토큰 인증(AC2) + 로컬 파일 권한으로 완화.
- 사용자 다운로드 폴더 오염: 응답에 경로 명시(AC7)로 완화.
- 구현 규모가 고지된 추정(수 주)을 크게 초과하면 사용자 재확인 (인테이크 D-17 revisit).

## 11. Implementation Guardrails

- 매트릭스에 없는 명령 지원 추가, supported 항목의 무단 축소, `verify` 판정의 무단 확정 금지. 판정 변경은 사용자 승인 필요.
- 승인된 구조(transport 추상화, zero-dependency WS 서버, MV3 extension) 외 아키텍처 변경 금지. 런타임 의존성 추가 금지.
- 사용자 탭/프로세스 파괴 금지: attach 탭 close=detach, kill live=프로세스 유지 시맨틱을 우회하는 코드 경로 금지.
- 페어링 토큰 평문 로그 출력 금지. 활동 로그/receipt에 토큰 리댁션.
- Web Store 배포, 다중 페어링 등 비목표 구현 금지.
- 격리 프로필 경로의 기존 동작/응답 스키마 회귀 금지 (`./test.sh` 유지).
- npm publish 금지 (명시 요청 전). 버전은 0.20.0으로 범프만.
- 실사용자 Chrome 대상 검증(V4)은 스모크 시나리오 범위를 넘는 조작 금지.

## 12. Implementation Result Report Contract

구현 agent는 다음을 보고한다:

- status: Done / Partially Done / Blocked.
- 사용자 가시 변경: 신규 CLI 명령/에러, extension 동작, 문서 변경.
- 주요 변경 모듈: transport 계층, WS 서버, extension/, 프로필 해석, 하니스.
- 승인된 기술 구조 준수 여부와 편차.
- T1-T10 완료 상태, R/AC/V 커버리지 표.
- 모드별 검증 증거: V1 명령 로그, V2/V3 하니스 결과, V4 스모크 증거(스크린샷 포함).
- 확정된 feasibility 매트릭스 최종본 (`verify` 항목 판정 포함).
- 추가/갱신된 자동 테스트 목록과 각각이 보호하는 회귀.
- delivery 증거: 로컬 커밋 해시, 버전 범프 확인.
- 잔여 human review 항목 (9.3)과 미완료/후속 후보.
