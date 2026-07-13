---
topic: "browser-reach-roadmap"
status: "ready"
human_approval: "approved"
source_intake: "current conversation"
source_clarity: "none"
created_at: "2026-07-13"
updated_at: "2026-07-13"
---

# PRD: Browser Reach Roadmap A-D

## 1. Summary

chromux 0.18.0이 표준 DOM 기반 폼, 검색, 자동완성, 다단계 흐름, same-origin iframe, open shadow DOM, 팝업, 업로드와 다운로드에서 확보한 도달성을 비-DOM 및 격리된 브라우저 표면까지 확장한다.
이번 로드맵은 갭 A의 좌표 액션 레이어, 갭 B의 contenteditable 입력, 갭 C의 cross-origin iframe 및 OOPIF 2-tier 지원, 갭 D의 canvas/WebGL 관찰과 좌표 상호작용을 하나의 검증 가능한 제품 계약으로 정의한다.
기존 `click <session> --xy X Y`의 CSS viewport 좌표 의미는 유지하고, screenshot 이미지 좌표 변환과 hover, drag, rich text replacement, opaque frame geometry, opt-in OOPIF 탐색을 추가한다.
기능 구현은 local deterministic fixtures, 실제 OOPIF, DPR 1과 2, 소규모 WebGames 태스크, 전체 browser suite, payload budget, 문서 drift, package dry-run으로 증명한다.
현재 handoff의 `표준 DOM 웹 80~90%` 표현은 측정된 커버리지 수치가 아니므로, 새로운 증거가 생기기 전에는 제품 문구로 사용하지 않는다.

Approval checklist:

- Approve scope in Section 3: 갭 A-D 전체와 이를 증명하는 focused WebGames 통합은 in scope이고, vision model, CAPTCHA 우회, REAL과 WebArena 계열은 non-goal이다.
- Approve public command contract in Sections 5-7: 기존 `click --xy`는 CSS 좌표로 유지하고, 공통 coordinate-space metadata, first-class `hover`와 `drag`, screenshot crop 기능을 추가한다.
- Approve OOPIF structure in Sections 5-7: Tier 1 opaque frame geometry는 기본 제공하고, Tier 2 namespaced refs와 CDP target session routing은 opt-in으로 시작한다.
- Approve security and compatibility guardrails in Section 11: full cross-origin URL과 민감한 field value를 노출하지 않고, closed shadow root, 실결제, 실제 인증 데이터, 탐지 우회는 범위에서 제외한다.
- Approve verification in Section 9: DPR 1/2, contenteditable, pointer 및 HTML5 drag, cross-site OOPIF, canvas, WebGames, payload, full Chrome suite를 required-for-done으로 둔다.
- Approve release and delivery in Sections 6, 8, and 12: package version은 unpublished `0.19.0`으로 올리고 npm publish 없이 `main` 기반 PR, CI pass, blocker 부재 시 merge까지 수행한다.

## 2. Problem, Goal, And Users

chromux의 현재 agent-facing surface는 DOM에서 식별 가능한 요소에 강하다.
`snapshot`, stable `@ref`, targeted `--grep`, act-and-verify, same-origin frame과 open shadow DOM 지원으로 일반 업무형 웹 흐름은 크게 개선됐다.
그러나 현재 benchmark와 test suite는 웹 전체 커버리지 비율을 측정하지 않으며, cross-origin iframe, canvas, drag, hover-only UI, rich editor replacement를 완전하게 증명하지 않는다.

현재 코드에는 좌표 클릭과 caret 기반 text 삽입이라는 핵심 primitive가 이미 있다.
반면 screenshot 응답에는 image와 CSS viewport 사이의 coordinate mapping이 없고, first-class hover와 drag가 없으며, `fill`은 contenteditable을 value 기반 input으로 처리하지 못한다.
cross-origin iframe은 snapshot에서 unreachable marker로만 나타나고, CDP client는 OOPIF sub-target session을 multiplex하지 않는다.

목표는 agent가 DOM ref를 사용할 수 없는 표면에서도 관찰, 행동, 검증을 반복할 수 있는 일관된 좌표 및 frame contract를 제공하는 것이다.
DOM 기반 작업의 기존 효율과 stealth posture를 보존하면서, 필요한 경우에만 더 넓은 CDP target attach를 opt-in으로 사용한다.
기능이 있다고 주장하는 기준은 code path 존재가 아니라 deterministic fixture와 browser runtime에서 성공이 재현되고, help, README, skills, payload budget이 함께 맞는 것이다.

주요 사용자는 실제 Chrome profile에서 업무형 웹을 수행하는 coding agent와 browser agent이다.
두 번째 사용자는 chromux의 command surface, detection surface, payload cost, OOPIF teardown 안정성을 유지하는 maintainer이다.
세 번째 사용자는 README와 benchmark 결과로 chromux의 실제 도달성을 판단하는 reviewer이다.

## 3. Scope And Non-Goals

In scope:

- Screenshot 응답에 실제 image pixel dimensions, CSS viewport dimensions, device scale, visual viewport offset과 scale, image-to-CSS conversion metadata를 추가한다.
- 기존 `click --xy`는 CSS viewport 좌표로 유지하고, click, hover, drag가 공통 coordinate space contract를 사용하도록 한다.
- Image pixel 좌표를 명시적으로 선택할 수 있는 backward-compatible coordinate-space option을 추가한다.
- Element ref 또는 좌표를 대상으로 하는 first-class `hover` action을 추가한다.
- Pointer sequence와 native HTML5 drag를 모두 증명하는 first-class `drag` action을 추가한다.
- `fill`이 standards-based contenteditable에 replacement semantics로 입력하고 결과를 검증하도록 라우팅한다.
- 기존 `type`의 insertion semantics를 유지하고, per-key behavior가 필요한 editor의 fallback과 한계를 문서화한다.
- Cross-origin iframe을 origin-only identity, CSS viewport rect, opaque frame ref로 snapshot에 노출하는 Tier 1을 구현한다.
- Tier 1 geometry와 좌표 입력으로 cross-origin frame의 쓰기와 제출이 가능한 local cross-site fixture를 증명한다.
- Opt-in Tier 2에서 OOPIF target을 attach하고, frame-namespaced refs를 snapshot과 action routing에 연결한다.
- OOPIF navigation, detach, crash, session close에서 target listener와 pending request가 누수되지 않도록 lifecycle을 관리한다.
- Screenshot region crop과 same-origin element/ref crop을 제공해 canvas나 큰 visual surface를 확대 관찰할 수 있게 한다.
- Canvas fixture에서 screenshot, click, hover, drag가 DPR 1과 DPR 2에서 같은 논리 좌표를 조작함을 증명한다.
- WebGames의 non-timed deterministic subset에서 canvas target, drag/drop, slider 계열을 최소 한 개씩 machine-grade한다.
- `chromux help`, README, install guidance when affected, `skills/chromux/`, `skills/chromux-work/`, benchmark docs, doc-check needles를 public behavior와 동기화한다.
- Observation payload 변화는 token benchmark로 측정하고, 표준 DOM snapshot budget을 불필요하게 증가시키지 않는다.
- Package version은 새 기능을 나타내는 unpublished minor `0.19.0`으로 올린다.
- Delivery는 latest `main` 기반 branch, PR creation, CI watch, blocker 부재 시 merge까지 포함한다.

Non-goals:

- chromux 자체에 OCR, object detection, multimodal model, hosted vision service를 넣지 않는다.
- CAPTCHA, anti-bot challenge, browser security boundary, same-origin policy를 우회하지 않는다.
- 실제 Stripe, payment, SSO, bank, healthcare, production credential flow로 OOPIF를 검증하지 않는다.
- Cross-origin frame의 full URL query, credential, card value, password, token을 snapshot이나 receipt에 노출하지 않는다.
- Closed shadow root 내부를 강제로 탐색하지 않는다.
- 모든 ProseMirror, Quill, Slate, Lexical plugin과 mention, slash command, IME 조합을 완전 지원한다고 주장하지 않는다.
- Synthetic JavaScript drag event를 기본 성공 경로로 사용하지 않는다.
- REAL, WebArena, WebChoreArena, ST-WebAgentBench, WorkArena를 이번 PRD에 통합하지 않는다.
- Existing benchmark result cells를 새 기능 proof로 재사용하지 않는다.
- npm publish, tag, GitHub Release, registry release를 수행하지 않는다.
- `표준 DOM 웹의 80~90%` 또는 `모든 웹을 자율 수행` 같은 population-level coverage claim을 만들지 않는다.

## 4. Pre-Work And Required Decisions

### 4.1 Pre-Work Before Implementation

None required.
필요한 repo inspection, local fixture, temporary WebGames checkout, Chrome profile isolation, test host mapping은 구현 에이전트가 수행할 수 있다.
실서비스 계정, credential, 결제, production permission은 이번 범위에 사용하지 않는다.

### 4.2 Human Decisions Before PRD Approval

- Approve adding first-class `hover` and `drag` commands despite the repository preference to prove new actions through `run` or `cdp` first.
The justification is that multi-event coordinate choreography is common, costly to reconstruct, and must share one verified coordinate contract.
- Approve retaining `click --xy` as CSS viewport coordinates and adding an explicit alternate image coordinate space instead of changing existing semantics.
- Approve Tier 1 cross-origin geometry as default and Tier 2 OOPIF DOM/ref access as opt-in until its detection surface, payload, and lifecycle behavior are measured.
- Approve exposing only frame origin, geometry, and redacted metadata for cross-origin frames.
- Approve a small WebGames non-timed subset and an agent-run cost cap of 5 USD for required capability proof.
- Approve version bump to unpublished `0.19.0` with no npm publish or release.
- Approve PR delivery from latest `main`, CI watch, and merge after required checks and reviews pass with no unresolved blocker.

### 4.3 Decision Traceability For Fidelity Review

- User approval: `gogo` on 2026-07-13 | approved the complete Summary checklist, including scope, public commands, OOPIF opt-in, security guardrails, verification, version, PR delivery, CI, and conditional merge | represented by `human_approval: "approved"` and R1-R13, AC1-AC13, T1-T9, V1-V7.
- User request: "그리고 chromux 자체적으로도 기능 개선된게 있어? 이거들 다 구현된건가?" | current implementation boundary audited | represented by Problem, R1, and the baseline portions of T1 and V1-V3.
- User request: "이거 PR올리고 README나 그런것들 업데이트해서 문제없으면 머지까지 시켜" | accepted as future implementation delivery | represented by R13, AC13, T9, V7, and the Result Report Contract.
- User request: "그리고 main으로 체크아웃해서 A~D 로드맵을 위한 $ho-spec 까지 만들어주면 좋겠어" | accepted for this turn | represented by this PRD on `origin/main@cf6952e`; implementation is not part of the current ho-spec turn.
- Handoff decision: gap A is DPR-safe coordinates plus hover and drag | accepted with backward compatibility refinement | represented by R2-R4, AC2-AC4, T2-T3, V3-V4.
- Handoff decision: gap B routes contenteditable through focus, selection, and `Input.insertText` | accepted | represented by R5, AC5, T4, V3.
- Handoff decision: gap C uses opaque geometry first and OOPIF target multiplexing second | accepted | represented by R6-R7, AC6-AC7, T5-T6, V3.
- Handoff decision: gap D is solved through screenshot and coordinate action infrastructure rather than an embedded vision model | accepted | represented by R8, AC8, T2-T3, T7, V3-V5.
- Handoff proposal: JavaScript synthetic DragEvent fallback | deferred as a non-default escape hatch | represented by Non-goals and Guardrails because real CDP input must remain the primary proof.
- Handoff proposal: WebGames is the first external benchmark for canvas and drag | accepted as a focused non-timed subset only | represented by R11, AC11, T7, V5.
- Current code fact: `click --xy` and `Input.insertText` exist, while DPR metadata, first-class hover/drag, contenteditable fill, and OOPIF routing do not | accepted as baseline | represented by R1, AC1, T1, V1-V3.
- Product claim: `표준 DOM 웹 80~90%` | rejected as a measured statement | represented by Summary, Non-goals, R9, AC9, and Guardrails.
- Repo rule: zero runtime dependencies and raw CDP patterns remain preferred | accepted | represented by Major Technical Structure Changes, R12, AC12, T8, V6.
- Repo rule: merging to `main` does not publish npm | accepted | represented by Non-goals, R12, AC12, and Guardrails.

## 5. Major Technical Structure Changes

The implementation introduces four related structural changes while preserving the single-file, zero-runtime-dependency CLI.

1. Coordinate space contract.
Screenshot and coordinate actions will share an explicit mapping between image pixels, CSS viewport coordinates, visual viewport offsets, and scale.
Existing CSS-coordinate callers remain compatible.
The same contract will serve click, hover, drag, screenshot crop, canvas, and opaque frame geometry.

2. Input action layer.
Hover and drag become public commands backed by real CDP input sequences and the existing action verification surface.
Contenteditable replacement joins the existing fill boundary but preserves `type` as insertion.
Common result fields, failure hints, repair hints, and `changed` verification remain consistent with other actions.

3. Frame target boundary.
Tier 1 extends snapshots with redacted opaque frame identity and geometry without crossing the origin boundary.
Tier 2 extends the CDP client from one page target channel to routed child target sessions, with namespaced refs and explicit attach, navigation, detach, and cleanup lifecycle.
Tier 2 starts opt-in so its detection and payload tradeoffs are measurable before any default expansion.

4. Capability benchmark boundary.
The benchmark harness gains the smallest environment registration seam needed to set up, grade, and tear down a pinned WebGames subset without adding runtime dependencies to the package.
The adapter and fixtures remain test and benchmark surfaces, not production services.

No database, schema, migration, auth service, payment service, background job, deployment, or hosted external API is introduced.

## 6. Requirements

- R1. Baseline and compatibility. The executor must verify the current `0.18.0` command, response, snapshot, CDP client, and test behavior before edits, and existing `click --xy` CSS-coordinate behavior must not break.
- R2. DPR-safe observation. Screenshot responses must expose enough measured metadata to map image pixels to the captured CSS and visual viewport at DPR 1 and DPR 2 without assuming that DPR alone is the scale.
- R3. Hover. chromux must provide a first-class hover action by ref or coordinate, use the common coordinate contract, and return the normal verification and repair fields.
- R4. Drag. chromux must provide a first-class drag action that supports pointer-driven sortable interactions and native HTML5 drag/drop, uses bounded intermediate movement, and fails clearly for invalid or unreachable points.
- R5. Contenteditable. `fill` must replace text in a focused standards-based contenteditable surface through browser input events, return observed content, and preserve existing input, textarea, select, file, autocomplete, and `type` semantics.
- R6. OOPIF Tier 1. Default snapshots must expose cross-origin iframe origin-only identity, CSS geometry, and an opaque ref while preserving redaction and the existing unreachable statement for DOM content.
- R7. OOPIF Tier 2. An explicit opt-in must attach eligible OOPIF child targets, merge frame-namespaced refs into observation output, route supported actions to the correct target session, and clean up safely across navigation, detach, crash, and close.
- R8. Canvas and visual regions. Screenshot must support bounded region and reachable element/ref crops, and coordinate actions must operate correctly on deterministic canvas targets at DPR 1 and DPR 2.
- R9. Agent-facing consistency. Help, README, both chromux skills, relevant topic guides, response hints, failure hints, and doc-check needles must describe the same coordinate, rich text, frame, canvas, and known-limit contract.
- R10. Regression coverage. Every changed behavior must have deterministic automated coverage, including negative cases, payload limits, lifecycle cleanup, and existing behavior regression protection.
- R11. Independent capability proof. A pinned, non-timed WebGames subset must machine-grade at least one canvas target, one drag/drop, and one slider-like interaction through chromux without source-answer shortcuts or model judging.
- R12. Package and release hygiene. The package must remain zero-runtime-dependency, advance to unpublished version `0.19.0`, pass package allowlist checks, and perform no publish, tag, or release.
- R13. Delivery. Implementation must start from current `main`, produce reviewable PR evidence, pass required CI and reviews, exclude unrelated local artifacts, and merge only when no blocker remains.

## 7. Acceptance Criteria

- AC1. A compatibility test proves the pre-existing CSS viewport meaning of `click --xy` is unchanged and existing click, fill, type, press, screenshot, same-origin iframe, and shadow DOM tests still pass.
- AC2. A DPR 1 and DPR 2 fixture records screenshot image dimensions, CSS viewport dimensions, visual viewport metadata, conversion factors, and proves that the same image-space target maps to the correct CSS action point.
- AC3. Hover by ref and coordinate opens a hover-only control in a deterministic fixture, reports the changed state, and rejects hidden, covered, stale, or out-of-viewport targets with a repair hint.
- AC4. Drag completes both a pointer-sortable fixture and a native HTML5 drag/drop fixture, reports the observed result, and does not silently fall back to JavaScript synthetic success.
- AC5. `fill` replaces native contenteditable content, emits framework-observable input events in a listener-backed fixture, reports the observed text, and documents that mention, slash-command, IME, and editor-specific behavior remains conditional unless separately tested.
- AC6. A cross-site local fixture snapshot exposes an opaque frame ref, origin, and CSS rect without query strings or field values, and coordinate click plus type can complete a machine-graded write flow through the frame.
- AC7. With the explicit OOPIF opt-in, the same cross-site fixture exposes namespaced child refs; click, fill, wait, and snapshot route to the child target; frame navigation and detach invalidate refs cleanly without leaking listeners or pending requests.
- AC8. Region and ref crops are bounded to the requested visible area, include coordinate metadata, and a deterministic canvas fixture passes click, hover, and drag at DPR 1 and DPR 2.
- AC9. Public docs state the supported coordinate spaces, opt-in OOPIF behavior, rich text limits, canvas prerequisites, and failure recovery without claiming unmeasured `80~90%` web coverage.
- AC10. The full browser suite contains named regression coverage for DPR conversion, hover, both drag modes, contenteditable, opaque frame geometry, OOPIF routing and teardown, canvas crop/action, redaction, payload limits, and backward compatibility.
- AC11. The registered WebGames report records the pinned upstream commit, exact task IDs, model, repetitions, session cost, machine grading, command traces, and passes the approved three-category subset within the 5 USD cap.
- AC12. `package.json` is `0.19.0`, runtime dependencies remain empty, `npm pack --dry-run` contains only the allowlist, and no npm publish, tag, or release occurs.
- AC13. Delivery evidence contains branch, base, commit, PR URL, exact changed paths, review verdicts, CI workflow results, merge commit, and confirmation that unrelated user files and planning artifacts were excluded.

## 8. PRD-Level Tasks

- T1. Audit the current coordinate, screenshot, contenteditable, frame, CDP session, response, documentation, benchmark, and test contracts from latest `main`; preserve a baseline compatibility record. Covers R1, AC1.
- T2. Implement the shared screenshot and coordinate-space contract, region/ref crops, and DPR-safe conversion while keeping existing CSS coordinates stable. Covers R1-R2, R8, AC1-AC2, AC8.
- T3. Implement first-class hover and drag through the shared input layer with pointer and native HTML5 paths, verification, repair hints, and negative cases. Covers R3-R4, R8, AC3-AC4, AC8.
- T4. Route standards-based contenteditable replacement through `fill`, preserve existing field behavior, and document editor-specific limits and fallbacks. Covers R5, AC5.
- T5. Implement Tier 1 opaque cross-origin frame identity, redaction, geometry, refs, and coordinate-driven write proof. Covers R6, AC6.
- T6. Implement opt-in Tier 2 OOPIF target routing, namespaced refs, supported actions, lifecycle cleanup, and detection/payload measurement. Covers R7, AC7.
- T7. Add deterministic canvas and cross-site fixtures plus the pinned WebGames subset, machine grading, command-trace evidence, and cost guard. Covers R8, R10-R11, AC8, AC10-AC11.
- T8. Synchronize help, README, install guidance when affected, both skills, topic guides, doc-check, token budgets, package version, and full regression verification. Covers R9-R12, AC9-AC12.
- T9. Produce review artifacts, deliver from latest `main` through PR and CI, exclude unrelated files, and merge only after all required evidence and reviews pass. Covers R13, AC13.

## 9. Verification Contract

Browser startup contract: `bash ./test.sh` starts and stops its own local fixture servers and isolated real Chrome profiles, so this CLI repository does not require a separate app dev server command.

### 9.1 Test Mode Contract

| Mode | Required For Done | Covers | Human Decision |
| --- | --- | --- | --- |
| build/static | yes | syntax, help, docs drift, package surface, version | none |
| automated behavior | yes | coordinate, contenteditable, frame, lifecycle, negative cases | public command and opt-in OOPIF contract approval |
| browser/runtime | yes | real Chrome input, DPR, hover, drag, OOPIF, canvas | no production accounts or sensitive flows |
| payload/performance | yes | observation bytes, action response size, attach overhead | approve measured budget changes before raising checked-in limits materially |
| benchmark/live-agent | yes | focused WebGames agent capability proof | approve up to 5 USD and pinned upstream checkout |
| delivery/CI | no/blockable | branch, PR, CI, merge after complete receipt | merge is pre-authorized only after all required gates pass |

### 9.2 Required Agent Verification

| ID | Mode | Covers | Method | Artifact | Pass Criteria | Environment | Required For Done | Can Be Blocked | Safe Probe | Live Proof | Side Effect | Sensitive Data Policy |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| V1 | build/static | R1-R4, R9, R12, AC1-AC4, AC9, AC12, T1-T3, T8 | `node --check chromux.mjs && node chromux.mjs help` | command-log | syntax and help exit 0; help exposes the approved commands, coordinate semantics, opt-in frame behavior, and known limits without deprecated aliases | local shell, Node 22 or newer | yes | no | local CLI only | command log | none | no secrets |
| V2 | automated behavior | R9-R10, R12, AC9-AC10, AC12, T7-T8 | `node benchmarks/chromux-doc-check.mjs` | command-log | docs, help, README, skills, package version, and public response guidance are synchronized by drift needles | local shell | yes | no | local docs check only | command log | none | no secrets |
| V3 | browser/runtime | R1-R10, AC1-AC10, T1-T7 | `bash ./test.sh` | command-log and browser-screenshot-set | the full real Chrome suite exits 0 and names passing DPR 1/2, hover, pointer drag, HTML5 drag, contenteditable, opaque cross-origin frame, OOPIF attach/navigation/detach, canvas, redaction, cleanup, and compatibility scenarios | isolated local Chrome profiles and local two-site fixtures | yes | no | local fixture hosts only; no production auth or payment | command log, fixture state, DPR screenshots | launches and closes isolated Chrome profiles and fixture servers | synthetic values only; redact full cross-origin URLs and sensitive-looking fields |
| V4 | payload/performance | R2-R4, R6-R10, AC2-AC4, AC6-AC10, T2-T8 | `node benchmarks/chromux-token-benchmark.mjs --out /tmp/chromux-browser-reach-tokens.json` | benchmark-report-json | standard DOM rows stay within existing budgets unless a reviewed update is justified; new frame and visual rows record payload and attach overhead without unbounded growth | isolated headless Chrome | yes | no | local fixtures only | report JSON and command log | launches and closes one isolated benchmark profile | no secrets, no external account data |
| V5 | benchmark/live-agent | R8, R10-R11, AC8, AC10-AC11, T7 | `node benchmarks/agent-compare-benchmark.mjs --model claude-sonnet-5 --tools chromux --tasks webgames-canvas-target,webgames-drag-drop,webgames-slider --reps-local 1 --out /tmp/chromux-webgames-reach.json` | benchmark-report-json | all selected non-timed tasks pass machine grading, exact upstream commit and traces are recorded, no source-answer shortcut occurs, and total measured cost does not exceed 5 USD | authenticated local `claude` CLI, Google Chrome, network for pinned checkout and build | yes | yes | estimate cost and validate checkout before launching sessions | report JSON, command log, machine-grade events | temporary upstream clone/build and cost-bearing agent sessions | no credentials, redact tokens and local paths before public evidence |
| V6 | build/static | R12, AC12, T8 | `npm pack --dry-run` | command-log | package dry-run exits 0, version is `0.19.0`, runtime dependency count remains zero, and tarball contains only the package allowlist | local shell, npm | yes | no | package dry-run only | command log | no publish | no secrets |
| V7 | delivery/CI | R13, AC13, T9 | `git status --short && gh pr view --json url,state,headRefName,baseRefName,statusCheckRollup,mergeStateStatus,mergedAt` | command-log | PR is based on current `main`, changed paths are scoped, required reviews and CI pass, and merge evidence is reported; any blocker prevents a user-facing completion claim | authenticated GitHub CLI after complete receipt | no | yes | diff and PR status read before push or merge | PR URL, CI checks, merge commit | may push branch, open PR, and merge after gates | no secrets, no local-only paths as sole PR evidence |

### 9.3 Human Verification

- Human PRD approval must confirm the public command contract, OOPIF opt-in boundary, 5 USD WebGames cap, version bump, and merge authorization in the Summary checklist.
- Human review of the implementation PR must judge whether README capability wording is proportional to the evidence and whether the OOPIF detection/payload tradeoff is acceptable.
- No human must enter real payment, authentication, personal, or production data for verification.
- After approval, final merge is pre-authorized only when requirements fidelity review, adversarial review, required verification, and CI all pass with no unresolved blocker.

## 10. Risks And Open Decisions

- Risk: OOPIF target multiplexing changes a core CDP transport assumption and can introduce request misrouting, leaked listeners, stale refs, or teardown races.
Mitigation: keep Tier 2 opt-in, namespace child refs, test attach/navigation/detach/crash/close, and stop for approval before any different transport architecture.
- Risk: `Target.setAutoAttach` and child Runtime evaluation can broaden the browser automation detection surface.
Mitigation: measure only on isolated fixtures, document the tradeoff, avoid making Tier 2 default in this PRD, and preserve Tier 1 coordinate fallback.
- Risk: screenshot pixel dimensions can differ from CSS coordinates because of DPR, browser zoom, visual viewport scale, clipping, or platform behavior.
Mitigation: derive mapping from observed capture and viewport dimensions, test DPR 1 and 2 plus non-default visual viewport scale, and never assume `devicePixelRatio` alone is sufficient.
- Risk: HTML5 drag/drop and pointer-sortable libraries have different event requirements.
Mitigation: prove both classes separately with real CDP input paths and report unsupported cases instead of claiming synthetic success.
- Risk: contenteditable editors vary in selection, beforeinput, composition, nested markup, and framework event handling.
Mitigation: define standards-based replacement only, preserve `type` and `press` fallbacks, test listener-observable events, and keep untested editor-specific claims out of docs.
- Risk: Opaque frame geometry or screenshot metadata can leak sensitive cross-origin information or inflate observation payloads.
Mitigation: expose origin only, redact query and field values, cap geometry output, add payload rows, and retain existing sensitive-field masking.
- Risk: WebGames upstream build or task identifiers can drift.
Mitigation: pin commit, record license and commit, exclude timed tasks, use machine grading, and stop rather than silently substituting tasks.
- Risk: A-D in one implementation cycle has a broad review surface.
Mitigation: execute T2-T7 in ordered, independently tested commits; material scope removal or structural deviation requires renewed approval rather than a partial hidden merge.
- Open decision: exact public flag spelling for alternate coordinate spaces and Tier 2 opt-in may be refined during implementation only if the semantics in R2, R6, and R7 remain unchanged and help/skills are updated together.

## 11. Implementation Guardrails

- Do not change the existing CSS viewport semantics of `click --xy`.
- Do not add top-level actions beyond the approved hover and drag surface without renewed approval.
- Do not make Tier 2 OOPIF attachment default in this PRD.
- Do not expose full cross-origin URL queries, frame field values, passwords, payment data, tokens, or credential-like text.
- Do not use real payment, SSO, banking, healthcare, personal, or production flows for verification.
- Do not claim closed shadow root access, CAPTCHA bypass, general anti-bot bypass, universal rich editor support, or population-level web coverage.
- Do not use JavaScript synthetic drag events as the default or sole proof of drag success.
- Do not embed OCR, vision models, hosted inference, or a new runtime dependency.
- Do not raise standard snapshot payload budgets materially without measured evidence and explicit review in the implementation result.
- Keep public responses, `chromux help`, README, install guidance when affected, both skills, topic guides, and doc-check needles synchronized in the same change.
- Use existing raw-CDP and daemon/profile patterns unless the approved OOPIF session routing boundary requires the documented extension.
- Bump `package.json` to `0.19.0`, but do not run `npm publish`, create a tag, or create a release.
- Do not include AI agent, model, vendor, or tool attribution in branch, commit, or PR title.
- Do not move, overwrite, delete, stage, or commit unrelated files from other worktrees, especially the existing untracked AGENTS and DESIGN files that blocked the stale `main` worktree fast-forward.
- Do not merge if any required verification, review, artifact validation, or CI check is failed, pending, or contradicted by current state.

## 12. Implementation Result Report Contract

The implementing agent must report:

- Status: `Done`, `Partially Done`, or `Blocked`.
- User-visible command and response changes for coordinate spaces, screenshot metadata and crops, hover, drag, contenteditable, Tier 1 frames, Tier 2 OOPIF refs, and canvas workflows.
- Major changed modules, CDP transport/session boundaries, response shapes, benchmark adapters, fixtures, skills, docs, and package metadata.
- Whether the approved technical structure and opt-in OOPIF boundary were followed.
- Task completion for T1-T9 and complete R/AC/V coverage.
- Automated tests added or updated and the regression risk each test protects.
- DPR 1 and DPR 2 screenshot metadata, coordinate conversion evidence, and before/after browser screenshots.
- Pointer drag, HTML5 drag, contenteditable event, opaque frame geometry, OOPIF attach/navigation/detach, canvas action, redaction, and cleanup evidence.
- Token benchmark before/after rows and any changed budget with justification.
- WebGames pinned commit, exact task IDs, repetitions, model, machine-grade results, command traces, cost, and any excluded timed task.
- Full verification evidence grouped by build/static, automated behavior, browser/runtime, payload/performance, benchmark/live-agent, and delivery/CI.
- Package version, runtime dependency count, pack allowlist result, and explicit confirmation that no publish, tag, or release occurred.
- Requirements fidelity and adversarial review verdicts, deviations, remaining risks, and human judgment still needed.
- Delivery evidence: base and branch, commit hashes, PR URL, changed paths, CI workflow names and verdicts, merge state, merge commit, and confirmation that unrelated worktree files were excluded.
- Not-done items and follow-up candidates, especially whether Tier 2 should ever become default, broader WebGames coverage, framework-specific rich editors, REAL, and WebArena-family evaluation.
