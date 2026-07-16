# Context Notes

- PRD: agents/prd/chromux-live-mode/prd.md

## 커버리지 체크 (구현 전)

- PRD R1-R10 / AC1-AC11 / V1-V4 / T1-T10 → 실행 노드 N1-N10 1:1 매핑, 갭 없음.
- 구조 락(섹션 5) 확인: transport 추상화, zero-dep WS 서버, MV3 extension, CDP 어댑터, live 예약 프로필, 신규 하니스.
- 초기화 편차 1건: 최초 `init`이 doctor 유효 설정(local)과 달리 pr+worktree 상태를 생성 → 방금 생성된 worktree/브랜치/상태를 제거하고 `--delivery local`로 재초기화. PRD delivery 결정(local)에 부합. (코드 변경 없음)

## 핵심 설계 결정 (transport 추상화의 구현 형태)

**wire-level CDP facade**: live 데몬 프로세스 안에 Chrome DevTools HTTP/WS 프로토콜을 에뮬레이션하는 facade 서버를 두고, 기존 `startDaemon(profile, port, daemonPort)`을 facade 포트에 그대로 붙인다.

- 근거: 데몬 내부(세션 관리, snapshot, verify, popup adoption, watch, download)는 전부 `cdpFetch(port, '/json/*')` + `CDPClient.connect(wsUrl)` 두 primitive 위에 있다. facade가 이 wire 계약을 구현하면 명령 시맨틱/응답 스키마가 "구성상 동일"해져 R1이 최소 diff로 충족된다.
- 대안 기각: primitive 함수마다 transport 분기를 스레딩(route/adoptPopup 등 수십 개 호출부에 침습) — 회귀 위험이 훨씬 큼.
- facade 구성: HTTP `/json/version|/json/list|/json/new|/json/close/<id>|/relay/status` + WS `/devtools/page/<id>`, `/devtools/browser/live`, `/relay`(extension, 토큰 인증).
- browser-level WS 에뮬레이션: `Target.setDiscoverTargets/createTarget`(→ chrome.tabs), `Browser.setDownloadBehavior`(다운로드 경로 기록 후 no-op), 그 외 미지원 메서드는 CDP 에러 객체 반환.
- popup adoption: `chrome.tabs.onCreated.openerTabId` → `Target.targetCreated{openerId}` 매핑으로 direct 모드와 동일하게 동작.

## 구현 결정 기록

- **다운로드(AC7)**: facade가 `Browser.setDownloadBehavior`의 downloadPath를 기억했다가, chrome.downloads 완료 시 사용자 다운로드 폴더의 원본을 `<downloadPath>/<guid>`로 복사 → 기존 /download 라우트가 무변경으로 동작. 결과: 응답 path는 chromux 경로(또는 --to), 원본은 사용자 다운로드 폴더에도 남음. 문서에 명시.
- **탭 소유권(R5)**: facade가 `createdByChromux` Set을 유지. `/json/close/<id>`에서 chromux 생성 탭만 chrome.tabs.remove, attach만 한 사용자 탭은 debugger.detach. 데몬의 idle 세션 정리 경로도 자동으로 이 시맨틱을 탄다.
- **kill live**: cmdKill 분기 — detach-all + 데몬 /stop만. PID 종료 경로 진입 금지.
- **페어링**: `~/.chromux/live.json` {port, token} 0600. `chromux pair [--new-token]`. relay WS는 `?token=` 쿼리(loopback 한정, 기존 Chrome CDP도 무인증 loopback인 것과 대칭). 토큰 비교는 timingSafeEqual.
- **콜드 스타트(R6)**: ensureDaemon live 분기에서 facade `/relay/status` 확인 → 미연결 시 사용자 Chrome 실행(darwin: `open -b com.google.Chrome`, 기타: chromePath detached spawn; `CHROMUX_LIVE_LAUNCH_CMD` env로 하니스 오버라이드) → 최대 30s 폴링. killSwitch 상태면 자동 실행 생략 + 안내 에러.
- **open --tab (R4/AC5)**: CLI가 facade `/json/list`(active 필드 포함)로 후보 해석(active | tabId | url/제목 부분일치; 복수 매칭 시 후보 목록 에러) → `/open`에 `attachTargetId` 전달. `/open` 라우트에 attach 소경로 추가(기존 탭 연결 시 createTab/navigation 생략).
- **MV3 keep-alive**: WS 활성 + 20s ping + chrome.alarms(0.5min) 재연결 루프. killSwitch 플래그는 chrome.storage.local에 영속.
- **하니스 토큰 부트스트랩**: 테스트 브라우저는 `--remote-debugging-port` 직결이 가능하므로, service worker 타깃에 Runtime.evaluate로 chrome.storage.local.set({port, token, enabled}) 주입. 테스트 브라우저 해석 순서: `CHROMUX_TEST_BROWSER` env > config.chromePath > Playwright chromium 캐시.
- **createTab 가드**: facade 오류가 `Invalid URL`류로 새는 것을 막기 위해 createTab에 webSocketDebuggerUrl 부재 시 명시 에러 추가 (R1 응답 품질, 소규모).
- **repair hints(T7)**: classify/hint 경로에 'live extension not connected', 'kill switch', 'not paired' 패턴 추가.

## Feasibility 매트릭스 최종 판정 (T6 확정, Chrome for Testing 149 하니스로 검증)

live 하니스(test-live.sh, parity 7/7 + safety 5/5)로 실브라우저 검증한 결과:

- **supported (검증됨)**: open(새 탭/direct-nav), snapshot, click(selector), run/eval(Runtime.evaluate), watch, screenshot, download(chrome.downloads 어댑터, 파일은 사용자 다운로드 폴더 + chromux 경로 사본), tabs 목록, attach(--tab raw tabId), unsupported 에러(show/launch --headless/chrome://).
- **degrade (검증됨)**: close(attach한 사용자 탭은 detach만, chromux 생성 탭은 close), kill live(전체 detach + 데몬 정지, 브라우저 프로세스 유지).
- **unsupported (검증됨)**: show(탭당 디버거 1개 제약), 미페어링/kill switch 상태 명시 에러.
- **--oopif: 여전히 verify(deferred)**. chrome.debugger는 sessionId flatten을 지원하고 relay가 sessionId를 패스스루하도록 구현했으나, 실제 교차 출처 자식 타깃 attach는 하니스 스위트에 포함하지 않았다(AGENTS.md OOPIF 고위험 규정). 실사용 live 스모크(V4) 또는 별도 검증 과제로 남김. 지원 범위를 줄이지 않았으므로 규정 위반 아님.

## 구현 중 발견한 핵심 기술 이슈와 해결 (하니스가 잡음)

1. **WS 서버 메시지 버퍼링**: acceptWebSocket에서 onmessage 핸들러 할당 전 도착한 프레임이 유실 → 버퍼 후 flush.
2. **cross-process 네비게이션의 chrome.debugger Page.navigate 실패("Detached while handling command")** → chrome.tabs.update로 우회(facade가 Page.navigate를 tabs.navigate로 변환).
3. **stale execution context(navigate 후 Runtime.evaluate가 about:blank를 읽음)** → 신규 세션은 URL로 직접 탭 생성 + 데몬 navigate 생략, attach 시 reconcileDebuggerContext가 debugger location.href가 실제 URL과 일치할 때까지 대기(불일치+complete면 detach+reattach로 컨텍스트 재바인딩).
4. **load 이벤트 신뢰성**: facade(Node)가 tabs.get 폴링으로 load 완료를 판단해 Page.loadEventFired 합성(MV3 in-memory 상태/타이머 의존 제거).
5. **MV3 SW keep-alive**: chrome.alarms(0.5분) + WS 활성 + onClose 재접속 백오프 + storage.onChanged 자동 재접속.
6. **하니스 fixture 격리**: spawnSync가 하니스 이벤트 루프를 막아 in-process fixture가 다운로드 요청에 응답 못함 → fixture를 별도 프로세스(test-live-fixture.mjs)로 분리(제품 버그 아님).

## Auto-pairing (사용자 요청으로 추가된 UX 개선)

원래 PRD는 팝업 토큰 수동 붙여넣기였으나, 실사용 중 "토큰 붙여넣기 없이 자동으로" 요청이 나와 auto-pairing을 추가했다. 보안 모델(D-09 토큰 페어링)은 유지 — 토큰은 여전히 모든 relay 연결을 잠그고, 전달만 자동화한다.

- facade: `GET /pair`(페어링 창 동안만 {port,token} 반환, 그 외 403), `POST /pair/open`(60초 창 오픈).
- `chromux pair`: 브리지(facade) 기동 + /pair/open 호출로 창 오픈 후 안내 출력(autoPairing: true).
- extension: 토큰 없으면 `http://127.0.0.1:47700/pair`를 3초 간격 폴링(startAutoPairPolling) → 토큰 받으면 storage 저장 → storage.onChanged → connect. 팝업에 수동 붙여넣기 폴백 UI 유지(pairing 입력란).
- 실브라우저 검증: `chromux pair` → 3초 내 자동 연결(붙여넣기 없음). V4 스모크에서 확인.

## V4 실사용자 Chrome 스모크 (완료)

artifacts/browser/v4-live-smoke.md 참조. 사용자의 실제 Google Chrome(격리 아님)에서 auto-pairing → open/snapshot/run/click/tabs/attach/close=detach/kill live 전부 통과. 추가로 실제 진행 중인 Google Meet에서 참석자/메타데이터 읽기 + 캡션 실시간 자막 읽기까지 read-only로 시연하고 원상 복구. V4/AC11 충족.

## 검증 환경

- 테스트 브라우저: Chrome for Testing 149 (Playwright 캐시), `--load-extension` + `--disable-features=DisableLoadExtensionCommandLineSwitch` + `--headless=new`.
- 페어링 부트스트랩: SW 타깃에 CDP로 chrome.storage.local.set 주입(실사용자는 chromux pair + 팝업).
- kill switch 테스트 훅: self.__chromuxKillSwitch (SW→SW 런타임 메시지 미전달 회피).
