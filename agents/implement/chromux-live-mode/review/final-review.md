# Final Adversarial Review

Status: PASS

고위험 프로파일(agent가 사용자의 실제 로그인된 Chrome을 조종) 기준으로 전체 리뷰를 수행했다.
PRD, state.json, 기록된 fidelity 리뷰, 산출물, 구현 diff, 그리고 보안 표면(토큰 게이트, 페어링 창, close/kill 시맨틱, 미지원 명령)을 직접 확인했다.
필요한 required verification(V1 정적, V2 패리티, V3 안전, V4 실브라우저 스모크)이 모두 올바른 종류의 산출물로 뒷받침되며, 가장 약했던 증거 지점(V1의 `./test.sh` 부분)은 이번 리뷰에서 직접 재현해 해소했다.

## Fidelity Review Checked

- Report: agents/implement/chromux-live-mode/review/requirements-fidelity-review.md
- Sha256: 339607d7e23a (전체: 339607d7e23a79add1b206b05de5a6740c30a0683e5f0699173b960575072286)
- Status: pass
- Recorded at: 2026-07-16T14:08:39.638Z (state.json 최상위 `requirementsFidelityReview.worktreeSnapshot.capturedAt`, state `updatedAt`과 일치)
- Findings resolved or reflected:
  state.json에는 fidelity 리뷰가 두 개 있고, 오래된 항목(sha256 `8cc8c547...`, status `fail`, capturedAt 2026-07-16T12:34:19.818Z)은 V4/AC11이 인간 사전작업(4.1)으로 막혀 완료 게이트에서 fail이었다.
  최신/권위 항목(sha256 `339607d7...`, status `pass`)은 사용자가 본인 Chrome에 extension을 로드한 뒤 실브라우저 라이브 스모크(V4)를 수행해 AC11이 충족되면서 fail 사유가 해소된 버전이다.
  현재 디스크의 리뷰 파일 해시를 직접 계산했고 `339607d7e23a79add1b206b05de5a6740c30a0683e5f0699173b960575072286`로 기록값과 정확히 일치했다(파일 내용도 Status: PASS).
  리뷰는 신선하고(state updatedAt과 동일 시각), 구체적이며(21개 결정 D-01..D-21을 각각 R/AC/V에 매핑, 기각 옵션이 기각 상태로 유지됨을 확인), 두 개의 커버리지 갭(AC6 이산 단언 부재, --oopif verify 보류)을 과대주장 없이 정직하게 공개한다. 신뢰할 수 있다.

## Findings

- Info (해소됨): V1의 `./test.sh` 직접-transport 회귀 증거. 기록된 V1 command-log(deviation D3)는 정적 3종(help + doc-check + npm pack, `STATIC_OK`)만 캡처했고 `./test.sh` 실행 자체의 산출물 로그는 run 디렉토리에 없다. `341/0`은 ledger/implementation-result/state의 텍스트 주장으로만 존재했다. 리뷰어가 현재 HEAD(작업 트리)에서 Chrome for Testing로 `./test.sh`를 직접 실행해 **341 passed, 0 failed (EXIT=0)** 를 재현했다. 격리 프로필(direct transport) 경로 회귀 없음이 실증되어 갭 해소. (chromux.mjs, test.sh)
- Low (공개됨, 비차단): AC6 콜드 스타트(Chrome 미실행→자동 실행)에 대한 이산 하니스 단언이 없고 code-verified(`launchUserChrome`, chromux.mjs:7472/7510) + 하니스 bringup 수행으로만 충족. 구현자와 fidelity 리뷰가 후속 항목으로 명시 공개. 안전 시맨틱을 훼손하지 않음.
- Low (공개됨, 비차단): feasibility 매트릭스의 `--oopif`는 `verify`(deferred)로 유지. relay가 sessionId flatten 패스스루는 구현했으나 교차 출처 자식 타깃 attach는 하니스에 미포함(AGENTS.md OOPIF 고위험 규정 준수). 지원 범위를 줄이지 않았고 매트릭스도 유지되므로 무단 축소/드리프트 아님(context-notes.md:41).
- Low (housekeeping, 비차단): 작업 트리에 오염 파일 존재 — untracked `--out`, `--output`, `--path`, `.DS_Store`(리다이렉트 오작동 흔적으로 추정). npm pack allowlist 밖이라 배포에는 포함되지 않으나 커밋 전 정리 권장(`git status --short`).
- 보안/정확성 결함: None material.

## Checklist Coverage

- Tasks: T1-T10 전부 `complete`. 각 task의 노드(N1-N10) 모두 `complete`. PRD 8절 태스크와 1:1 매핑 일치.
- Acceptance Criteria: AC1-AC11 전부 `met`. AC1-AC10은 V1/V2/V3, AC11은 V4(실사용자 Chrome 스모크)로 충족. AC6는 code-verified + bringup(이산 단언 부재, 공개됨).
- Verification: V1/V2/V3/V4 전부 `status: pass`.
  V1 정적 3종 재실행 통과 + `./test.sh` 341/0(리뷰어 재현). V2 패리티 7/7(Chrome for Testing, 실 extension `--load-extension`, 산출물 로그 확인). V3 안전 6/6(tabs/attach/close=detach/auto-reconnect/kill switch/kill-keeps-process). V4 실사용자 Chrome에서 auto-pairing→open/snapshot/run/click/tabs/attach→close=detach(naver.com 유지)→kill live(프로세스 유지)까지 file + command-log 산출물로 기록.
- Execution Plan: N1-N10 `complete`. 경고 1건(`task_without_acceptance_mapping`: T8)은 하니스 태스크 특성상 예상된 것으로 비차단.
- Task Graph: `status: complete`, blockingGapCount 0. 미종료 노드는 REVIEW(본 리뷰) 뿐이며 FINALIZE는 REVIEW 통과에 게이트됨. REQ_FIDELITY_REVIEW pass.

## Artifact Audit

- Harness-visible validity:
  V1 command-log(75d57d22, exit 0)은 정적 3종만 실행하도록 축약(D3 공개). V2 pass 로그(2af28a2a, 72825b7e)와 V3 pass 로그(9e2c94a5)는 Chrome for Testing(playwright chromium-1228)에서 실 extension을 로드해 각각 7/7, 6/6 실통과했고 skip이 아니다. V4는 v4-live-smoke.md(2119b184)와 v4-command-log.txt(7a79df20)로 실사용자 Chrome 흐름을 기록. manifest.jsonl과 state의 sha256/bytes가 일치.
- Spot-checks performed:
  fidelity 리뷰 파일 해시 재계산(=339607d7). `node benchmarks/chromux-doc-check.mjs` 신선 실행 exit 0(live/auto-pairing needle 포함). `node chromux.mjs help`에 live 표면(pair/tabs/CHROMUX_PROFILE=live/--tab) 노출 확인. `npm pack --dry-run`이 `extension/`(background.js/manifest.json/popup.*/icons) 7파일 포함, `agents/`·`test-live.*`·하니스 제외 확인. `./test.sh` 341/0 직접 재현. 토큰 게이트(`liveTokenMatches`가 length 체크 후 `crypto.timingSafeEqual`, chromux.mjs:1570), `/relay` upgrade에서 토큰 불일치 403(chromux.mjs:2248), 바인딩 `127.0.0.1`(DAEMON_HOST), `/pair`는 60초 사용자개시 창 밖이면 403(chromux.mjs:2198), close=detach/agent탭 close(chromux.mjs:1874), `kill live` browserProcessKept:true(chromux.mjs:6475), `show`/`launch --headless`/`chrome://` 미지원, package.json `dependencies` 없음(zero-dependency), extension 테스트 훅(`self.__chromuxKillSwitch`=기존 killSwitch 노출, `self.__chromuxDropConnection`=ws.close 시뮬레이션; SW 전역이라 웹페이지 도달 불가, 무해) 모두 확인.
- Missing or weak artifacts:
  run 디렉토리에 `./test.sh` 실행 로그 산출물이 없었음(정적 3종 로그만 존재, D3로 공개). 리뷰어 직접 재현으로 실질 해소. verification.md/checklist.md 등 문서 아티팩트는 존재.

## Deviation Audit

- Recorded deviations:
  D1-D7 전부 `verification_command` 유형. D1/D2/D4/D5/D6/D7은 PRD 셀의 괄호 주석(설명)을 명령에서 제외한 정확 명령 실행으로 무해. D3은 V1에서 `./test.sh`를 정적 3종과 분리 실행한 축약으로, 사유(verify-run 샌드박스에 브라우저/egress 부재)가 정당하고 공개됨.
- Accepted deviations:
  D1-D7 전부 수용. 특히 D3은 리뷰어가 `./test.sh` 341/0을 독립 재현해 축약의 실질 결과를 확인했으므로 수용. auto-pairing 스코프 추가는 라이브 테스트 중 사용자 명시 요청으로 이뤄졌고(fidelity 리뷰 및 v4-live-smoke.md 기록), 토큰 *전달*만 자동화하며 모든 relay 접속에 토큰 게이트(D-09)를 유지하고, help/README/install/skills + doc-check needle로 문서화됨. 승인·문서화된 범위 내 추가로 수용.
- Rejected deviations:
  None. 무단 아키텍처 변경, 런타임 의존성 추가, 매트릭스 미지원 명령의 무단 지원 추가, supported 무단 축소, 안전 시맨틱 우회 경로는 발견되지 않음. 기각 옵션(Web Store, 다중 페어링, attach 건별 승인, 호스트 화이트리스트, 팝업 탭 공유, 인포바 숨김)은 모두 미구현 상태 유지.

## Verdict

PASS.
추적된 모든 작업(T1-T10)과 수용 기준(AC1-AC11), 실행 노드(N1-N10)가 완료/충족되었고, required verification(V1/V2/V3/V4)이 올바른 종류의 산출물로 뒷받침된다.
fidelity 리뷰는 신선하고 구체적이며 신뢰할 수 있고(해시 339607d7 일치, 오래된 fail 항목을 정당하게 대체), 보안 모델은 견고하다: 토큰이 `timingSafeEqual`로 모든 relay 접속을 게이트하고, auto-pairing 창은 사용자개시·60초·loopback 전용이며 토큰 게이트를 약화시키지 않고, close=detach와 kill-keeps-process 안전 시맨틱이 코드·V3·V4에서 확인되며, `show`/`launch --headless`/`chrome://`가 명시적으로 미지원이고, 런타임 의존성이 추가되지 않았으며(zero-dependency), npm pack allowlist가 `extension/`를 포함하고 `agents/`·하니스를 제외한다.
가장 약했던 증거 지점(V1의 `./test.sh` 회귀)은 리뷰어가 현재 HEAD에서 341/0을 직접 재현해 해소했다.
남은 항목은 비차단 성격이다: AC6 이산 단언 부재와 --oopif verify 보류(둘 다 공개됨), 그리고 커밋 전 정리해야 할 오염 파일(`--out`/`--output`/`--path`/`.DS_Store`). PRD 드리프트나 stale 드리프트는 없다.
