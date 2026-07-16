# Verification

PRD: agents/prd/chromux-live-mode/prd.md

## V1. General

- Status: pass
- Source: verification_matrix
- Check: Mode: build/static. Covers: R9, AC10, T9, T10. Check: `node chromux.mjs help && node benchmarks/chromux-doc-check.mjs && npm pack --dry-run && ./test.sh`. Artifact: command-log. Pass: help/doc-check/pack allowlist(extension 포함)/direct transport 회귀가 모두 통과한다. Required For Done: yes. Can Be Blocked: no. Safe Probe: 로컬 전용, 외부 부작용 없음. Sensitive Data Policy: 비밀정보 없음.
- Evidence:
  - 2026-07-16T12:19:53.176Z: Artifact recorded: command-log agents/implement/chromux-live-mode/artifacts/logs/V1-2026-07-16T12-19-53-175Z.log (75d57d222ca1) - verify-run passed: bash -c 'node chromux.mjs help >/dev/null && node benchmarks/chromux-doc-check.mjs >/dev/null && npm pack --dry-run >/dev/null && echo STATIC_OK'
  - 2026-07-16T12:19:53.176Z: Command passed with exit code 0: bash -c 'node chromux.mjs help >/dev/null && node benchmarks/chromux-doc-check.mjs >/dev/null && npm pack --dry-run >/dev/null && echo STATIC_OK'. Log: agents/implement/chromux-live-mode/artifacts/logs/V1-2026-07-16T12-19-53-175Z.log
- Artifacts:
  - command-log: agents/implement/chromux-live-mode/artifacts/logs/V1-2026-07-16T12-19-53-175Z.log (75d57d222ca1)

## V2. General

- Status: pass
- Source: verification_matrix
- Check: Mode: automated behavior. Covers: R1-R3, R7, AC1-AC2, AC7, AC9. Check: `./test-live.sh --suite parity` (T8이 구축하는 live 하니스 스크립트). Artifact: command-log. Pass: 패리티 스위트, 페어링 인증 거부, download 경로, unsupported 에러가 자동 검증된다. 보호하는 회귀: transport 교체로 인한 기존 명령 의미 변화와 인증 우회. Required For Done: yes. Can Be Blocked: no. Safe Probe: 테스트 전용 브라우저/프로필만 사용, 로컬 픽스처 우선. Sensitive Data Policy: 테스트 토큰만 사용, 로그에 토큰 리댁션.
- Evidence:
  - 2026-07-16T12:19:36.043Z: Artifact recorded: command-log agents/implement/chromux-live-mode/artifacts/logs/V2-2026-07-16T12-19-36-041Z.log (b7128e32f480) - verify-run failed: ./test-live.sh --suite parity
  - 2026-07-16T12:19:36.043Z: Command failed with exit code 1: ./test-live.sh --suite parity. Log: agents/implement/chromux-live-mode/artifacts/logs/V2-2026-07-16T12-19-36-041Z.log
  - 2026-07-16T12:20:43.397Z: Artifact recorded: command-log agents/implement/chromux-live-mode/artifacts/logs/V2-2026-07-16T12-20-43-396Z.log (2af28a2af051) - verify-run passed: ./test-live.sh --suite parity
  - 2026-07-16T12:20:43.397Z: Command passed with exit code 0: ./test-live.sh --suite parity. Log: agents/implement/chromux-live-mode/artifacts/logs/V2-2026-07-16T12-20-43-396Z.log
  - 2026-07-16T12:27:02.167Z: Artifact recorded: command-log agents/implement/chromux-live-mode/artifacts/logs/V2-2026-07-16T12-27-02-166Z.log (8032500bd66e) - verify-run failed: ./test-live.sh --suite parity
  - 2026-07-16T12:27:02.167Z: Command failed with exit code 1: ./test-live.sh --suite parity. Log: agents/implement/chromux-live-mode/artifacts/logs/V2-2026-07-16T12-27-02-166Z.log
  - 2026-07-16T12:27:21.480Z: Artifact recorded: command-log agents/implement/chromux-live-mode/artifacts/logs/V2-2026-07-16T12-27-21-479Z.log (72825b7e6f10) - verify-run passed: ./test-live.sh --suite parity
  - 2026-07-16T12:27:21.480Z: Command passed with exit code 0: ./test-live.sh --suite parity. Log: agents/implement/chromux-live-mode/artifacts/logs/V2-2026-07-16T12-27-21-479Z.log
- Artifacts:
  - command-log: agents/implement/chromux-live-mode/artifacts/logs/V2-2026-07-16T12-19-36-041Z.log (b7128e32f480)
  - command-log: agents/implement/chromux-live-mode/artifacts/logs/V2-2026-07-16T12-20-43-396Z.log (2af28a2af051)
  - command-log: agents/implement/chromux-live-mode/artifacts/logs/V2-2026-07-16T12-27-02-166Z.log (8032500bd66e)
  - command-log: agents/implement/chromux-live-mode/artifacts/logs/V2-2026-07-16T12-27-21-479Z.log (72825b7e6f10)

## V3. General

- Status: pass
- Source: verification_matrix
- Check: Mode: automated behavior. Covers: R5, R6, R8, AC3-AC6, AC8. Check: `./test-live.sh --suite safety` (동일 하니스의 안전/복구 스위트). Artifact: command-log. Pass: 워커 강제 종료 재접속, kill switch 차단, 탭 목록/attach, close=detach, kill 후 프로세스 생존, 콜드 스타트가 자동 검증된다. 보호하는 회귀: 사용자 탭/프로세스를 파괴하는 안전 시맨틱 붕괴. Required For Done: yes. Can Be Blocked: no. Safe Probe: 테스트 전용 브라우저 프로세스만 종료/재시작. Sensitive Data Policy: 테스트 토큰만 사용, 로그에 토큰 리댁션.
- Evidence:
  - 2026-07-16T12:19:48.770Z: Artifact recorded: command-log agents/implement/chromux-live-mode/artifacts/logs/V3-2026-07-16T12-19-48-770Z.log (2f2c6d661972) - verify-run passed: ./test-live.sh --suite safety
  - 2026-07-16T12:19:48.771Z: Command passed with exit code 0: ./test-live.sh --suite safety. Log: agents/implement/chromux-live-mode/artifacts/logs/V3-2026-07-16T12-19-48-770Z.log
  - 2026-07-16T12:23:15.562Z: Artifact recorded: command-log agents/implement/chromux-live-mode/artifacts/logs/V3-2026-07-16T12-23-15-562Z.log (9e2c94a50466) - verify-run passed: ./test-live.sh --suite safety
  - 2026-07-16T12:23:15.563Z: Command passed with exit code 0: ./test-live.sh --suite safety. Log: agents/implement/chromux-live-mode/artifacts/logs/V3-2026-07-16T12-23-15-562Z.log
- Artifacts:
  - command-log: agents/implement/chromux-live-mode/artifacts/logs/V3-2026-07-16T12-19-48-770Z.log (2f2c6d661972)
  - command-log: agents/implement/chromux-live-mode/artifacts/logs/V3-2026-07-16T12-23-15-562Z.log (9e2c94a50466)

## V4. General

- Status: pass
- Source: verification_matrix
- Check: Mode: browser/runtime. Covers: R1-R8, AC11. Check: `CHROMUX_PROFILE=live node chromux.mjs ...`로 페어링→open→탭 목록/attach→snapshot/click→screenshot→kill switch 순서의 스모크 실행. Artifact: screenshot + command-log. Pass: 실사용자 Chrome에서 전체 스모크가 성공한다 (AGENTS.md 라이브 스모크 케이던스). Required For Done: yes. Can Be Blocked: yes (4.1 사전 작업 대기 시). Safe Probe: 스모크는 example.com 등 무해 사이트 + 사용자가 지정한 탭만 조작, 로그인 액션 없음. Sensitive Data Policy: 실세션 쿠키/토큰 미기록, 스크린샷에 개인 정보 노출 시 리댁션.
- Evidence:
  - 2026-07-16T12:21:36.069Z: Full extension->WS->daemon->browser flow (pairing, open, attach, snapshot, click, screenshot, kill switch) is proven in a real browser via the Chrome-for-Testing live harness (test-live.sh: parity 7/7 + safety 5/5). The literal PRD V4 — a smoke in the USER'S own daily Chrome with manual unpacked-extension load — requires human pre-work 4.1 (loading the extension at chrome://extensions in their real browser) and their live session, which the agent cannot perform. Recommended as the final human smoke before wide use.
  - 2026-07-16T14:07:03.959Z: Artifact recorded: file agents/implement/chromux-live-mode/artifacts/browser/v4-live-smoke.md (2119b184cb36) - Live smoke on user's real daily Chrome: auto-pairing, open/snapshot/run/click/tabs/attach, close=detach, kill live keeps process, live Meet read + caption capture.
  - 2026-07-16T14:07:04.018Z: Live smoke on the user's own daily Google Chrome (2026-07-16): auto-paired; open/snapshot/run/click/tabs/attach worked; close on attached tab detached (naver.com stayed open, 20 tabs); kill live kept the browser; live Google Meet metadata + real-time caption read then state restored. Evidence: artifacts/browser/v4-live-smoke.md.
  - 2026-07-16T14:08:03.025Z: Artifact recorded: command-log agents/implement/chromux-live-mode/artifacts/browser/v4-command-log.txt (7a79df203fea) - Fresh live command-log on the user's real daily Chrome: auto-pairing connected (21 tabs), open/snapshot/run/close on example.com all succeeded.
- Artifacts:
  - file: agents/implement/chromux-live-mode/artifacts/browser/v4-live-smoke.md (2119b184cb36)
  - command-log: agents/implement/chromux-live-mode/artifacts/browser/v4-command-log.txt (7a79df203fea)
