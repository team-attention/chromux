---
topic: "chromux Windows support"
status: "complete"
target_handoff: "prd"
where: "brownfield"
created_at: "2026-07-05"
updated_at: "2026-07-05"
question_count: 10
final_auditor_agent_id: "none"
final_auditor_status: "local-pass"
---

# Intake Q&A Log: chromux Windows support

## Current Understanding

- The request is to inspect what changes would be needed for chromux to support Windows OS before implementation.
- The priority is that the CLI and Chrome launch path work well on Windows.
- The native application can remain macOS-only.
- The current code and docs explicitly treat macOS/Linux as the supported install and validation target.

## Axis Map

| Axis | Track | Why | Closure status | Evidence / notes |
| --- | --- | --- | --- | --- |
| Product | selected | Need a clear user-facing goal for Windows support across CLI and Chrome launch while keeping the app macOS-only. | resolved | User clarified that CLI and Chrome launch should work on Windows, and the Application can be macOS-only. |
| Scope | selected | Windows support can mean native Windows, WSL, Git Bash, PowerShell, CI-only checks, or real Chrome smoke. | resolved | User confirmed native Windows as the v1 target. WSL is not v1. |
| UX/design | watch | CLI output and docs may need Windows-specific examples, but no GUI change is implied. | resolved | PRD scope is CLI/docs wording and `chromux app --open`; no new GUI design is requested. |
| Technical | selected | Requires platform abstraction for Chrome discovery, daemon IPC, process inspection, opener commands, path handling, and tests. | resolved | User confirmed all-platform localhost TCP transport with regression-preserving migration and Chrome Stable-only auto discovery. Exact implementation details are deferred to implementation. |
| Verification | selected | Windows support needs automated checks plus real Windows Chrome launch proof or a clearly deferred validation path. | resolved | User confirmed Windows CI plus real Chrome smoke and cross-platform parity matrix as required-for-done. |
| Risk | watch | Local process launch and kill logic can affect real Chrome profile state; Windows process matching needs care. | resolved | User wants Windows and macOS behavior to be as unified as possible, so process matching and kill safety remain v1 concerns and must be verified before completion. |
| Operation | selected | CI, install docs, developer prerequisites, and release packaging must separate CLI support from macOS app support. | resolved | User confirmed Windows PowerShell CLI install docs and macOS-only native app install/release separation. |
| Documented-domain | selected | Need canonical term: Windows OS support, not Chrome browser window management or the macOS app window. | resolved | User clarified that "윈도우" means Windows OS support. |

## Q&A

### Q1: Scope / canonical term
- axis: Scope, Documented-domain
- status: resolved
- asked: 여기서 `window` 지원은 Chrome 브라우저 창을 명명해서 탭을 그 창에 열고 관리하는 기능인가, 아니면 현재 세션 탭의 창 포커스/크기 같은 제어만 필요한 것인가?
- recommended: v1은 "명명된 Chrome window에 세션 탭을 열 수 있고, list/focus/bounds/close 정도를 제어한다"로 잡는 것을 추천한다.
- answer: CLI와 Chrome launch가 Windows OS에서도 잘 되는 것이 중요하다. Application은 macOS 전용이라고 해도 된다.
- rationale: 이 결정이 CLI 표면과 내부 데이터 모델을 가른다.
- prd impact: Chrome browser window management is not the current target. The PRD should target Windows OS support for the CLI and Chrome runtime, while keeping native macOS app support explicitly separate.

### Q2: Scope / Windows runtime target
- axis: Scope, Technical, Verification, Operation
- status: resolved
- asked: Windows 지원 기준을 native Windows, 즉 PowerShell 또는 cmd에서 Node.js 22와 Google Chrome을 설치한 상태로 `chromux` CLI가 실행되고 Chrome을 띄우는 것으로 잡으면 되나, 아니면 WSL에서 Windows Chrome을 띄우는 흐름도 v1에 포함해야 하나?
- recommended: v1은 native Windows를 기준으로 하고, WSL에서 Windows Chrome을 띄우는 흐름은 명시적으로 out-of-scope 또는 follow-up으로 두는 것을 추천한다.
- answer: native Windows 기준으로 간다.
- rationale: native Windows와 WSL은 Chrome 경로, user-data-dir 경로, process discovery, daemon IPC, shell docs, and verification setup이 다르다.
- prd impact: v1 should target PowerShell/cmd native Windows with Node.js 22 and installed Google Chrome. WSL-to-Windows Chrome interop is out of scope unless later reintroduced.

### Q3: Verification / Windows done proof
- axis: Verification, Operation, Technical
- status: resolved
- asked: 완료 기준에 GitHub Actions `windows-latest` 같은 native Windows runner에서 `node chromux.mjs help`, package validation, and at least one real Chrome launch/open/snapshot smoke까지 포함할까요, 아니면 Windows 실기기 수동 smoke를 후속으로 두고 이번 PRD는 코드/문서 준비까지만 잡을까요?
- recommended: CI에 Windows job을 추가하고, 가능하면 real Chrome launch/open/snapshot smoke까지 required-for-done으로 잡는 것을 추천한다.
- answer: 그렇게 간다. Windows CI and real Chrome smoke should be part of the done criteria.
- rationale: Windows 지원은 path/IPC/process 차이가 커서 macOS에서 코드만 보고는 완료 증거가 약하다.
- prd impact: The PRD should require a Windows CI job and a native Windows Chrome smoke that proves at least launch/open/snapshot.

### Q4: Technical / daemon IPC strategy
- axis: Technical, Risk, Operation
- status: resolved
- asked: daemon IPC는 macOS/Linux의 Unix socket 동작은 유지하고 Windows에는 별도 named pipe 또는 localhost TCP 같은 Windows-compatible transport를 추가하는 방향으로 갈까요, 아니면 모든 플랫폼을 localhost TCP 기반으로 통일하는 큰 변경까지 허용할까요?
- recommended: v1은 cross-platform IPC adapter를 만들고 macOS/Linux는 현재 Unix socket을 유지하며 Windows만 Windows-compatible transport를 추가하는 것을 추천한다.
- answer: User asked whether localhost TCP can consistently support all platforms and whether that is preferable if existing regressions are preserved.
- rationale: 전체 플랫폼을 TCP로 통일하면 단순할 수 있지만 기존 macOS/Linux 안정 동작과 보안/포트 충돌 표면이 바뀐다.
- prd impact: 답에 따라 blast radius가 Windows-only adapter인지, all-platform daemon transport migration인지 갈린다.

### Q4a: Technical note / localhost TCP feasibility
- axis: Technical, Verification, Risk
- status: resolved
- asked: Can localhost TCP be consistent across all platforms, and is it better if existing regressions are preserved?
- recommended: Yes, localhost TCP can be the common cross-platform daemon transport if it is implemented behind a transport abstraction, bound to `127.0.0.1`, allocated from a chromux daemon-port range, stored in profile state, guarded by startup locks, and covered by existing macOS/Linux tests plus new Windows smoke. Preserve a compatibility fallback or migration path for Unix socket behavior until regressions are disproven.
- answer: User confirmed this direction.
- rationale: TCP unifies Windows/macOS/Linux daemon requests and avoids Unix socket incompatibility, but changes security, port collision, stale state, and daemon adoption behavior.
- prd impact: The PRD can choose all-platform TCP as the target transport, but must require regression-preserving migration safeguards rather than a raw socket replacement.

### Q5: Scope / Windows browser target
- axis: Scope, Technical, Verification
- status: resolved
- asked: Windows v1 브라우저 자동 탐색은 Google Chrome Stable만 대상으로 하고, Edge/Chromium은 `chromePath` 명시 설정으로만 지원하면 될까요?
- recommended: v1은 Google Chrome Stable 자동 탐색만 지원하고, Edge/Chromium 자동 탐색은 후속으로 빼는 것을 추천한다.
- answer: 그렇게 한다. Windows v1 auto-discovery targets Google Chrome Stable only.
- rationale: browser target이 넓어지면 install docs, CI smoke, path discovery, UA/launch flags, and support expectations이 늘어난다.
- prd impact: Windows `findChrome` and smoke requirements target Google Chrome Stable. Edge/Chromium auto-discovery is out of scope for v1; explicit `chromePath` can remain the escape hatch.

### Q6: Scope / app command versus native app
- axis: Scope, Operation, UX/design
- status: resolved
- asked: `chromux app` local web dashboard command는 CLI 기능으로 보고 Windows에서도 동작하게 하고, macOS AppKit menu bar app만 macOS-only로 두면 될까요?
- recommended: 그렇게 분리하는 것을 추천한다. Native app packaging은 macOS-only, `chromux app` HTTP dashboard는 CLI surface라 Windows smoke에 포함한다.
- answer: 그렇게 분리한다. `chromux app` local web dashboard is Windows CLI scope; native AppKit menu bar app remains macOS-only.
- rationale: `chromux app` is a Node local HTTP dashboard command, while `apps/macos-status-bar` is the native AppKit wrapper. 둘을 같이 제외하면 Windows CLI support에서 기존 command 하나가 빠진다.
- prd impact: 답에 따라 Windows support scope에 `chromux app --open` and Windows opener support를 포함할지, 아니면 launch/open/snapshot만 포함할지 결정된다.

### Q7: Technical / process discovery and kill semantics
- axis: Technical, Risk, Verification
- status: resolved
- asked: Windows에서도 기존 macOS/Linux처럼 profile adoption, `ps`, `kill`, stale lock cleanup, and crawl resource guard를 실제 프로세스 조회 기반으로 유지해야 할까요, 아니면 v1에서는 state-file 기반으로 최소 동작만 보장하고 정교한 process/resource introspection은 후속으로 빼도 될까요?
- recommended: Windows v1에서도 profile adoption, kill safety, stale lock cleanup은 프로세스 조회 기반으로 유지하고, crawl resource guard의 RSS/renderer 세부 카운트만 필요하면 보수적으로 축소하는 것을 추천한다.
- answer: macOS and Windows behavior should be as similar and unified as possible. Do not make Windows a reduced happy-path implementation.
- rationale: Current code uses process discovery for adopting live profiles, avoiding duplicate Chrome launches, killing the right profile, lock stale detection, and crawl resource limits. Windows에서 이를 모두 빼면 "CLI launches Chrome"은 되더라도 operational reliability가 크게 낮아진다.
- prd impact: Windows process abstraction is v1 core work for adoption, `ps`, `kill`, stale lock cleanup, and safe profile lifecycle. Crawl resource guard should match macOS/Linux where feasible, with explicit conservative fallback if exact renderer/RSS parity is not practical in CI.

### Q8: Verification / parity matrix
- axis: Verification, Scope, Operation
- status: resolved
- asked: 완료 기준을 macOS/Linux/Windows 공통 parity matrix로 잡아서 `help`, `launch`, auto-launch `open`, `snapshot`, `close`, `list`, `ps`, `kill`, `app --open`, and stale/reuse behavior까지 OS별로 검증하도록 할까요?
- recommended: 그렇게 잡는 것을 추천한다. 단, crawl resource guard의 세부 RSS/renderer 수치처럼 OS별로 값이 흔들리는 항목은 "동작 parity"와 "best-effort telemetry"를 분리한다.
- answer: 그렇게 간다.
- rationale: "uniworking"을 구현자가 놓치지 않게 하려면 기능 목록이 아니라 OS별 동일 동작 매트릭스가 필요하다.
- prd impact: PRD의 Test And Verification Seeds에 cross-platform parity matrix가 들어가고, 구현은 Node 기반 cross-platform test runner 쪽으로 강하게 유도된다.

### Q9: Operation / install and docs surface
- axis: Operation, Scope, Documented-domain
- status: resolved
- asked: Windows 설치/사용 문서는 PowerShell 기준으로 `npm install -g .` from checkout, Node.js 22, Google Chrome Stable prerequisites를 안내하고, macOS app installer/release flow는 Windows 문서에서 명확히 제외하면 될까요?
- recommended: 그렇게 잡는 것을 추천한다. Windows는 CLI install and smoke guide만 제공하고, native app release/install 문서는 macOS-only로 남긴다.
- answer: yes.
- rationale: install surface가 섞이면 사용자가 Windows에서도 macOS app installer를 기대하거나, 구현자가 Windows installer packaging까지 범위를 키울 수 있다.
- prd impact: PRD의 Pre-Work, Docs, Non-Goals에 Windows installer/native app packaging 제외와 PowerShell-first CLI install guide가 들어간다.

### Q10: Handoff goal confirmation
- axis: Product, Scope, Verification
- status: resolved
- asked: 합의된 목표를 한 문장으로 쓰면 "chromux CLI를 native Windows에서 macOS/Linux와 최대한 동일한 동작으로 실행되게 만들고, localhost TCP daemon transport, Chrome Stable 자동 탐색, Windows CI real Chrome smoke, cross-platform parity matrix로 검증하되 native AppKit 앱은 macOS-only로 남긴다"입니다. 이 문장이 다음 PRD/구현 에이전트에게 의도대로 전달되나요?
- recommended: yes.
- answer: yes. User confirmed the handoff goal and asked to create the PRD from the handoff.
- rationale: Before handoff, the agreed goal should prevent drift toward Chrome window management, WSL support, Windows native app packaging, or happy-path-only Windows launch.
- prd impact: If confirmed, write `prd-handoff.md` with resolved axes and remaining implementation details as requirement seeds.

## Evidence From Code Or Docs

- `install.md` says the default supported install target is macOS/Linux.
- `install.md` troubleshooting says chromux searches common macOS/Linux Chrome and Chromium paths and that Windows support is deferred.
- `chromux.mjs` `CHROME_PATHS` includes macOS and Linux paths only.
- `chromux.mjs` daemon IPC currently uses `socketPath` with a `.sock` path under `~/.chromux/run/`.
- `chromux.mjs` process discovery and resource snapshots shell out to `ps`, with macOS and non-macOS Unix-style arguments.
- `chromux.mjs` `show` and `app --open` use `open` on macOS and `xdg-open` otherwise, with no Windows opener.
- `test.sh` is a bash script with `/tmp`, `ps`, `chmod`, and Unix cleanup assumptions.
- `skills/chromux/SKILL.md` and `skills/chromux-work/SKILL.md` declare platforms as macOS and Linux.
- `.github/workflows/ci.yml` has one Ubuntu job, validates bash syntax, runs `node chromux.mjs help`, checks Chrome availability through Unix commands, and runs `bash ./test.sh`.
- `startDaemon` listens on `sockPath(profileName)`, `cliReq` uses `http.request({ socketPath })`, and `ensureDaemon` waits for that socket path to become healthy.
- Per-profile `.state` stores `sock` along with `pid`, `port`, `headless`, and launch mode, so daemon endpoint shape is part of runtime state.
- A TCP migration would need to separate Chrome CDP `port` from daemon HTTP `daemonPort` in state and config so the two port spaces cannot conflict.
- Windows browser discovery scope remains open: currently `findChrome` only checks configured `chromePath` and fixed macOS/Linux paths.
- `chromux app` is a Node local HTTP dashboard command in `chromux.mjs`, while `apps/macos-status-bar` is the native macOS wrapper around that dashboard.
- Process discovery is used by profile adoption, resource snapshots, stale singleton cleanup, `kill`, `ps`, and stale startup lock detection. Current implementation shells out to Unix `ps`.
- User wants Windows and macOS behavior to be unified, not a reduced Windows-only happy path.
- User confirmed cross-platform parity matrix for common commands and stale/reuse behavior, with best-effort telemetry separated from behavior parity.
- User confirmed Windows docs should be PowerShell-first CLI install docs with Node.js 22 and Google Chrome Stable prerequisites, excluding macOS native app install/release flow.

## Documented Domain Checks

- docs inspected: `README.md`, `install.md`, `skills/chromux/SKILL.md`, `skills/chromux-work/SKILL.md`, `chromux.mjs`, `test.sh`, `package.json`
- canonical terms: `Windows OS support`, `native Windows CLI`, `macOS app`, `profile`, `session`, `daemon`, and `Chrome launch`
- glossary/code conflicts: The user term `window` initially conflicted with Chrome browser window and macOS app window. It is now resolved as Windows OS support.
- concrete scenarios tested: code inspection only, no live headed smoke yet
- docs mutation: none
- ADR candidate: possible if daemon IPC changes from Unix socket to TCP or cross-platform named pipe because that affects core runtime architecture

## Initial Change Inventory

- Add Windows Chrome discovery paths and config behavior, including stable lookup for installed Google Chrome and maybe Chromium or Edge only if explicitly selected.
- Replace or abstract daemon IPC so CLI-to-daemon requests work on Windows. Options include localhost HTTP with per-profile port files, Windows named pipes, or a cross-platform IPC adapter.
- If all-platform TCP is chosen, introduce explicit daemon endpoint state such as `{ transport: "tcp", host: "127.0.0.1", port: <daemonPort> }` rather than overloading Chrome's CDP port.
- Use localhost TCP as the intended all-platform daemon transport, but preserve regression safety through existing macOS/Linux tests, state migration handling, and compatibility fallback where needed.
- Abstract process listing and process command inspection away from Unix `ps`, because profile adoption, resource guards, stale lock handling, and kill safety depend on it.
- Review `--user-data-dir`, singleton cleanup, and profile path handling on Windows.
- Add Windows opener support for `show` and `app --open`, likely through `cmd /c start` or PowerShell `Start-Process`.
- Preserve existing macOS/Linux daemon behavior unless the implementation explicitly chooses an all-platform transport migration.
- Keep the native app and Swift build/release flow macOS-only, but make docs clear that this does not block Windows CLI support.
- Include `chromux app` local HTTP dashboard in Windows CLI scope. Add Windows opener support and dashboard smoke coverage; keep AppKit wrapper and release packaging macOS-only.
- Implement Windows process discovery so adoption, `ps`, `kill`, stale lock cleanup, and safe profile lifecycle behave like macOS/Linux. If crawl resource guard telemetry cannot be exact across OSes, document and test the conservative behavior.
- Add a cross-platform parity matrix to the PRD so common commands are verified across macOS/Linux/Windows rather than being treated as separate feature sets.
- Keep resource telemetry checks separate from behavioral parity when OS-level process metrics differ.
- Document Windows install as CLI-only from checkout, not native Windows app packaging.
- Split shell setup docs so Windows users get PowerShell-compatible install and smoke commands.
- Replace or supplement `test.sh` with a Node-based cross-platform test runner, or add Windows-specific tests while keeping the current bash suite for macOS/Linux.
- Update skill metadata from macOS/Linux-only once Windows support is actually validated.
- Update package/docs validation so `npm pack --dry-run` still excludes planning artifacts and macOS app build artifacts stay scoped.

## Decisions, Assumptions, And Open Questions

- confirmed: The target is Windows OS support for CLI and Chrome launch, not Chrome window management.
- confirmed: The macOS native application can remain macOS-only.
- assumptions: v1 targets native Windows and leaves WSL interop out of scope.
- blocking for PRD: none.
- deferred to implementation: Exact Windows transport details, Windows process inspection mechanism, Windows smoke environment, and docs command style.
- human taste or approval: Keep the public CLI shape the same for existing macOS/Linux users.

## Audit History

### Audit 1
- type: local
- auditor_agent_id: none
- result: fail
- ambiguity: The term `window` was initially interpreted as Chrome browser window support, but user clarified Windows OS support.
- highest-risk assumption: Native Windows and WSL could be accidentally bundled into one requirement even though they need different implementation and verification paths.
- final-blocking-question: Windows 지원 기준을 native Windows로 잡으면 되나, 아니면 WSL에서 Windows Chrome을 띄우는 흐름도 v1에 포함해야 하나?
- handoff impact: PRD scope should pivot to Windows OS support and must settle native Windows versus WSL before handoff.
- fallback reason: Local audit after the first user answer; final auditor is not due yet.

### Audit 2
- type: local
- auditor_agent_id: none
- result: fail
- ambiguity: If we stopped now, an implementation agent might make the CLI "not immediately crash on win32" but skip daemon IPC and real Chrome launch validation.
- highest-risk assumption: A Windows support PRD without Windows runtime proof would overclaim support because current blockers are platform runtime blockers, not only docs or path strings.
- final-blocking-question: 완료 기준에 native Windows CI/browser smoke까지 포함할까요, 아니면 수동 Windows smoke를 후속으로 둘까요?
- handoff impact: The PRD needs an explicit verification contract before handoff.
- fallback reason: Local adversarial misunderstanding check after two user answers.

### Audit 3
- type: local
- auditor_agent_id: none
- result: fail
- ambiguity: If we stopped now, an implementation agent could interpret "Application mac-only" as excluding both the native macOS AppKit wrapper and the `chromux app` local HTTP dashboard from Windows.
- highest-risk assumption: `chromux app` is part of CLI support because it is a Node command, but that needs user confirmation.
- final-blocking-question: `chromux app` local web dashboard는 Windows CLI scope에 포함하고 native AppKit menu bar app만 macOS-only로 둘까요?
- handoff impact: App scope affects docs, opener implementation, CI smoke, and skill platform wording.
- fallback reason: Local adversarial misunderstanding check after Q4/Q5 answers.

### Audit 4
- type: local
- auditor_agent_id: none
- result: fail
- ambiguity: If we stopped now, an implementation agent could port Chrome path and TCP daemon only, but leave process adoption and kill semantics weak on Windows.
- highest-risk assumption: Process discovery can be deferred without affecting "works well"; that is likely false because duplicate Chrome launch, stale locks, and wrong-profile kill are core operational issues.
- final-blocking-question: Windows에서도 process discovery 기반 adoption/kill/stale cleanup을 v1 core로 유지할까요?
- handoff impact: Determines whether Windows support includes operational reliability or only happy-path launch.
- fallback reason: Local adversarial misunderstanding check after Q6 answer.

### Audit 5
- type: local
- auditor_agent_id: none
- result: pass
- ambiguity: No blocking ambiguity remains for PRD handoff.
- highest-risk assumption: An implementation agent could over-focus on launch/open and skip Windows process lifecycle parity or TCP daemon state migration.
- final-blocking-question: none.
- handoff impact: Handoff must require cross-platform parity for help, launch, auto-launch open, snapshot, close, list, ps, kill, app --open, and stale/reuse behavior.
- fallback reason: Multi-agent tooling is available, but current tool policy does not allow spawning subagents unless the user explicitly asks for delegation. A local strict audit was performed instead.
