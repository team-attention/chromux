# PRD Handoff: chromux live 모드 - extension 브리지로 사용자 실제 Chrome 연결

> Date: 2026-07-16
> Source: agents/intake/chromux-live-mode/qa-log.md
> Interview skill: interview-me

## Clear Outcome

MV3 extension이 `chrome.debugger`로 사용자 실제 Chrome에 attach하고 토큰 잠금 localhost WebSocket으로 chromux 데몬에 CDP를 릴레이하여,
기존 CLI 표면 그대로 `CHROMUX_PROFILE=live`(예약 프로필)로 사용자의 로그인된 브라우저를 조작하는 두 번째 루트("나의 브라우저")를 추가한다.
1차 출시는 최대 패리티: 기술적으로 가능한 모든 기존 명령이 live에서 동작하고, 불가능한 것만 명시적 `live unsupported` 에러를 낸다.
기본은 agent가 새 탭을 만들어 작업하고, 사용자가 지시할 때만 탭 목록 조회를 통해 기존/활성 탭에 attach한다.

## Product Completeness Boundary

- 완전한 1차 여정 포함: 설치/페어링(CLI 자동화 명령 포함) → 새 탭 golden path → 기존 탭 attach("지금 보는 페이지") → kill switch/끊김 복구 → 콜드 스타트(Chrome 자동 실행).
- 의도적 축소(전부 Decision Register에 기록): Web Store 배포 비목표(D-07), 다중 Chrome 프로필 동시 페어링은 추후(D-12).
- 고위험 결합 스코프는 비용 고지(OOPIF급 이상, 수 주 단위) 후 사용자가 일괄 승인(D-17). 감사의 단계 분할 권고는 기각되었으나, PRD는 검증 가능한 내부 마일스톤을 두어야 한다.

## Decision Trace And Requirement Mapping

| Decision | User intent or evidence | Represented by | Remaining gap |
| --- | --- | --- | --- |
| D-01 데몬이 browser-level CDP 소유 | chromux.mjs:2749, 1469 | R1 (transport 추상화) | none |
| D-02 chrome.debugger는 CDP 부분집합 | Chrome extensions API | R7, V5 | feasibility 매트릭스는 PRD 산출물 (deferred) |
| D-03 다운로드 등 browser-level 의존 | chromux.mjs:4431 | R2 (chrome.downloads 어댑터), V5 | none |
| D-04 2-루트 멘탈 모델, live는 opt-in | user (사전 대화) | R4, R5 + Clear Outcome | none |
| D-05 Chrome 136+ 기본 프로필 포트 차단 | Chrome 릴리즈 정책 | R1 근거 (기술 구조 시그널) | none |
| D-06 기본 새 탭, 명시 지정 시 기존 탭 | user Q1 | R5, V2 + UX-02/UX-03 | none |
| D-07 unpacked 배포 + CLI 설치/페어링 자동화 | user Q2 | R4, V4 + UX-01 + 비목표(Web Store) | none |
| D-08 1차 최대 패리티 | user Q3 | R7, V1 | feasibility 매트릭스는 PRD 산출물 (deferred) |
| D-09 페어링 1회 + kill switch | user Q4 | R2, R3, V3, V4 + UX-01/UX-04 | none |
| D-10 CLI 탭 목록 + 지정 | user Q5 | R2, R4, V2 + UX-03 | none |
| D-11 `live` 예약 프로필명 | user Q6 | R4 (마이그레이션 안내 포함) | none |
| D-12 1차 단일 페어링 | user Q6 | 비목표 + revisit(다중 페어링 수요) | none |
| D-13 자동 재접속 + 명시 실패 + keep-alive 전제 | user Q6 + 감사 교정 | R2, V3 + UX-04 | none |
| D-14 --load-extension 하니스 (Chrome for Testing 필수) | agent default + 감사 교정 | V1 | 하니스 바이너리 조달 방식 (deferred) |
| D-15 문서/스킬/doc-check 동기 업데이트 | AGENTS.md | R8 | none |
| D-16 불가능 항목만 명시적 미지원 에러 | agent default | R7, V5 | 매트릭스와 함께 확정 (deferred) |
| D-17 고위험 결합 스코프 일괄 승인 | user Q7 (비용 고지 후) | R7 + risk (스코프 승인 기록) | none |
| D-18 콜드 스타트 Chrome 자동 실행 | user Q7 | R6, V1 + UX-02 | none |
| D-19 WS 서버 zero-dependency 자체 구현 | agent default + AGENTS.md | R3 | none |
| D-20 다운로드는 사용자 다운로드 폴더 + 경로 응답 | agent default | R2 세부 + risk | 매트릭스에서 확정 (deferred) |
| D-21 단일 페어링 하 탭 단위 병렬 허용 | agent default (기존 데몬 패턴) | R1 세부 + guardrail | none |

## UX Behavior And State Seeds

qa-log의 UX Scenario Cards 4장이 시드다:

- UX-01 설치와 페어링: unpacked 로드 + CLI 페어링 토큰 교환, 미페어링 에러는 설치/페어링 안내 포함.
- UX-02 새 탭 golden path: 기존 명령·응답 스키마(interactive/next/hints/scripts/replay) 동일 동작, 콜드 스타트 시 Chrome 자동 실행, attach 불가 페이지·미지원 명령은 명시적 에러.
- UX-03 지금 보는 페이지: 탭 목록(제목/URL/활성) 조회 → 활성 탭/URL 매칭 attach, 복수 매칭 시 후보 반환.
- UX-04 차단과 끊김: kill switch는 전체 detach + 자동 재연결 없음, 비의도 끊김은 자동 재접속 + 진행 중 명령 즉시 실패(repair hint, 암묵 재실행 금지).

## Domain Terms And Documented Decisions

- live 모드 / live 프로필: `CHROMUX_PROFILE=live` 예약 프로필로 진입하는 실사용자 Chrome 루트.
- 페어링: CLI가 발급한 토큰을 extension과 교환해 localhost WS를 잠그는 1회 승인.
- kill switch: extension 팝업의 즉시 전체 detach 버튼.
- 2-루트 멘탈 모델: "agent의 브라우저"(격리 프로필) vs "나의 브라우저"(live).
- AGENTS.md 규칙: 작은 명령 표면, zero-dependency, 응답 스키마 일관성, 문서/스킬/doc-check 동기화, 고위험 변경 승인 절차.

## Requirement Seeds

1. transport 추상화: 데몬의 CDP 연결 계층을 "직접 CDP"와 "extension WS 릴레이"로 분리 (D-01, D-19).
2. MV3 extension: chrome.debugger attach/relay, chrome.tabs 목록 API, chrome.downloads 어댑터, keep-alive 설계, 팝업(연결 상태 + attach 탭 목록 + kill switch) (D-02, D-09, D-10, D-13).
3. localhost WS 서버: zero-dependency 자체 구현 + 페어링 토큰 인증 (D-09, D-19).
4. CLI: `live` 예약 프로필, 설치/페어링 자동화 명령, live 탭 목록 명령, 미페어링/미지원/attach 불가 에러와 repair hint (D-07, D-10, D-11, D-16).
5. 탭 소유권: 기본 새 탭 생성, 명시 지정 시 기존 탭 attach (D-06).
6. 콜드 스타트: Chrome 미실행 시 자동 실행 + 재접속 대기 (D-18).
7. 명령별 feasibility 매트릭스: 전체 명령 × live 지원 여부/우회 방법/미지원 사유 - PRD의 필수 산출물 (D-08, D-16).
8. 문서/스킬: README, install.md, skills/chromux/, skills/chromux-work/, doc-check needles 동기 업데이트 + Token Footprint 영향 확인 (D-15).

## Non-Goals And Rejected Options

- Web Store 배포 (D-07에서 비목표, 추후 별도 결정).
- 다중 Chrome 프로필 동시 페어링 / 네임드 live 타깃 (D-12, 수요 발생 시 revisit).
- 기존 탭 attach마다 건별 승인, 호스트 화이트리스트 (Q4에서 기각).
- extension 팝업에서 탭 공유, 활성 탭 단축 키워드 (Q5에서 기각).
- 읽기 전용 1차, 핵심 경로 한정 1차, 단계 분할 (Q3·Q7에서 기각).
- 인포바 숨김 (기술적으로 불가, 오히려 가시성 장점으로 수용).

## Pre-Work And Human Decisions

- 스코프 승인 완료: 고위험 결합 스코프를 사용자가 비용 고지 후 일괄 승인 (D-17).
- 구현 전 결정 불필요 항목 없음. 단, 구현 규모가 고지된 추정을 크게 초과하면 사용자 재확인 (D-17 revisit).

## Major Technical Structure Signals

- 데몬 transport 추상화가 본체: 기존 browser-level CDP 경로(Target 도메인, /json/version)를 chrome.debugger 의미론(tabId attach, flat session)으로 매핑하는 어댑터 계층.
- Node 22 내장 WS는 클라이언트 전용 → WS 서버(HTTP upgrade + RFC6455)는 신규 zero-dependency 코드.
- MV3 service worker 수명: keep-alive + 자동 재접속 + 페어링 상태 영속화.
- Chrome 137+에서 브랜드 Chrome은 --load-extension 제거 → 하니스는 Chromium/Chrome for Testing 바이너리 필요.
- AGENTS.md의 OOPIF/CDP 라우팅 고위험 규정이 이 변경 전체에 적용됨.

## Test And Verification Seeds

- V1 하니스: 테스트 전용 브라우저(--load-extension, Chrome for Testing/Chromium)로 extension→WS→데몬 전 경로를 실브라우저 구동, 격리 프로필 통과 스위트를 live에서 재실행 (D-14, UX-02 proof).
- V2 탭 attach: 미리 연 탭을 목록 조회→활성 탭 attach→조작까지 자동 검증 (UX-03 proof).
- V3 끊김/차단: 워커 강제 종료 후 자동 재접속 + 진행 중 명령의 명시 실패, kill switch 후 재연결 부재 검증 (UX-04 proof).
- V4 페어링: 토큰 불일치/미페어링 에러 및 안내 검증 (UX-01 proof).
- V5 negative: 미지원 명령의 `live unsupported` 에러, attach 불가 페이지 에러 (D-16).
- V6 라이브 스모크: 출시 전 실사용자 Chrome에서 1회 (AGENTS.md 케이던스).
- 기존 게이트 유지: `node chromux.mjs help`, `./test.sh`, `benchmarks/chromux-doc-check.mjs`(needles 추가), `npm pack --dry-run`(extension 폴더 allowlist 반영), 토큰 벤치마크로 응답 크기 확인.

## Risks, Side Effects, And Sensitive Data

- 실로그인 세션 위에서 agent가 동작: 페어링 토큰 + kill switch + 인포바 가시성이 방어선 (D-09). live는 opt-in 유지.
- 최대 패리티 스코프 리스크: feasibility 매트릭스 확정 전까지 패리티 범위가 요구사항으로 과약속될 수 있음 → PRD에서 매트릭스를 필수 산출물로 (D-08/D-16).
- localhost WS는 로컬 공격면: 토큰 없는 접속 거부, 토큰은 로컬 파일 권한으로 보호.
- 다운로드가 사용자 실제 다운로드 폴더에 떨어짐 (D-20) - 응답에 경로 명시로 완화.
- 사용자 탭 상태 간섭: 기본 새 탭 원칙(D-06)으로 완화, attach된 탭은 팝업에 표시(D-09).

## Human Review Needed

- extension 팝업 UI의 카피/시각 디자인 (기능 요구만 확정: 연결 상태, attach 탭 목록, kill switch).
- 페어링 안내 문구와 설치 가이드 문서의 카피 품질.
- feasibility 매트릭스에서 "미지원" 판정 항목들의 제품 수용 여부.

## Open Questions

- 없음 (blocking). Deferred: feasibility 매트릭스 상세(D-08/D-16), 하니스 바이너리 조달 방식(D-14), 다운로드 경로 정책 확정(D-20), 다중 페어링 확장(D-12).

## Suggested Next Step

/gen-prd --context agents/intake/chromux-live-mode/prd-handoff.md "chromux live 모드 - extension 브리지로 사용자 실제 Chrome 연결"
