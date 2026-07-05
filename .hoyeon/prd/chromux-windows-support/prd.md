---
topic: "chromux Windows support"
status: "ready"
source_intake: ".hoyeon/intake/chromux-windows-support/prd-handoff.md"
source_clarity: "none"
created_at: "2026-07-05"
updated_at: "2026-07-05"
---

# PRD: chromux Windows support

## 1. Summary

chromux should support native Windows as a first-class CLI runtime while preserving existing macOS/Linux behavior.
The implementation will make CLI launch, daemon communication, Chrome discovery, profile lifecycle, `chromux app --open`, and common commands work on Windows with a shared cross-platform parity matrix.
The daemon direction is all-platform localhost TCP bound to `127.0.0.1`, with explicit endpoint state and separate daemon and Chrome CDP ports.
The native AppKit status bar application remains macOS-only.

## 2. Problem, Goal, And Users

chromux currently reads as a macOS/Linux CLI in code, docs, skills, tests, and CI.
Windows users need the same practical CLI workflow: install from checkout, launch Google Chrome Stable, open pages, take snapshots, list profiles, close sessions, inspect processes, kill the right profile, recover stale state, and open the local dashboard.

The goal is to make chromux CLI behavior on native Windows as close as possible to macOS/Linux.
Success means an implementation agent can prove Windows support with real Chrome runtime evidence and can prove macOS/Linux regressions did not drift during the transport migration.

Primary users are chromux CLI users and agents operating chromux on their behalf.
Secondary users are maintainers who need reliable CI/runtime proof before changing docs and skill metadata from macOS/Linux-only.

## 3. Scope And Non-Goals

In scope:

- R1. Native Windows CLI support from PowerShell or cmd with Node.js 22 and Google Chrome Stable installed.
- R2. Windows Google Chrome Stable auto-discovery, with explicit `chromePath` still available for custom locations.
- R3. All-platform localhost TCP daemon transport bound to `127.0.0.1`.
- R4. Explicit daemon endpoint state that separates daemon HTTP `daemonPort` from Chrome CDP `port`.
- R5. Regression-preserving daemon endpoint migration for existing macOS/Linux profile state.
- R6. Windows profile lifecycle parity for launch, auto-launch open, snapshot, close, list, ps, kill, app open, stale lock cleanup, daemon reuse, and profile adoption.
- R7. Windows opener support for `show` and `chromux app --open`.
- R8. Cross-platform parity verification across macOS, Linux, and Windows.
- R9. Windows CLI install and smoke docs, plus updated agent-facing skills after validation.
- R10. Package validation to ensure planning artifacts and platform-specific app artifacts do not leak into published CLI package contents.

Non-goals:

- NG1. Chrome browser window management is not part of this work.
- NG2. WSL-to-Windows Chrome interop is out of scope for v1.
- NG3. Edge and Chromium auto-discovery are out of scope for v1.
- NG4. Native Windows app packaging, tray integration, or installer work is out of scope.
- NG5. Native AppKit status bar app work remains macOS-only.
- NG6. Windows must not be implemented as a launch-only happy path that skips process lifecycle behavior.
- NG7. Exact RSS, renderer count, or OS-specific resource telemetry parity is not required when behavior parity is proven and conservative fallback is documented.
- NG8. Manual `CHANGELOG.md` edits and auto-generated file edits are out of scope.

## 4. Pre-Work And Required Decisions

### 4.1 Pre-Work Before Implementation

- P1. Inspect current daemon request flow, profile `.state` shape, Chrome CDP port allocation, and stale lock handling.
- P2. Inspect current Chrome discovery, opener commands, process discovery, and resource snapshot logic.
- P3. Inspect current CI and test harness assumptions around Bash, `/tmp`, Unix `ps`, chmod, and Linux Chrome paths.
- P4. Decide the smallest cross-platform test harness change that can cover Windows without dropping the existing bash regression value.
- P5. Confirm the current package allowlist before changing docs, skills, tests, or app-related files.

### 4.2 Human Decisions Before PRD Approval

None required.
The user already approved native Windows v1, all-platform TCP transport, Chrome Stable-only auto-discovery, `chromux app --open` Windows scope, process lifecycle parity, PowerShell-first docs, and cross-platform parity verification.

### 4.3 Decision Traceability For Fidelity Review

- User clarified that `window` means Windows OS support, not Chrome browser window management.
Represented by Section 2, R1, NG1, AC1-AC10.
- User chose native Windows as v1 and excluded WSL.
Represented by R1, NG2, AC1, T2, V4.
- User prioritized CLI and Chrome launch while keeping Application macOS-only.
Represented by R1-R2, R7, NG4-NG5, AC1-AC8.
- User accepted all-platform localhost TCP if existing regressions are preserved.
Represented by R3-R5, AC3-AC4, T1, T4, V1-V3, V5.
- User chose Google Chrome Stable auto-discovery only.
Represented by R2, NG3, AC2, T2, V2, V4.
- User included `chromux app` local dashboard in Windows CLI scope while excluding AppKit packaging.
Represented by R7, NG4-NG5, AC8, T3, V4.
- User required Windows process lifecycle parity, not a reduced happy path.
Represented by R6, NG6, AC5-AC7, T3, V2, V4.
- User chose a macOS/Linux/Windows parity matrix covering help, launch, auto-launch open, snapshot, close, list, ps, kill, app --open, and stale/reuse behavior.
Represented by R8, AC10, T5, V4-V5.
- User accepted separating behavior parity from best-effort resource telemetry.
Represented by NG7, AC9, V2, V4, Risk K4.
- User chose PowerShell-first Windows CLI docs and excluded native app installer/release flow.
Represented by R9, NG4-NG5, AC11, T6, V6.

## 5. Major Technical Structure Changes

- S1. Add a daemon endpoint abstraction that supports localhost TCP across supported OSes.
- S2. Store daemon endpoint state explicitly and separately from Chrome CDP state.
- S3. Add daemon state migration and stale endpoint cleanup for profiles that currently store Unix socket paths.
- S4. Add Windows-aware Chrome Stable discovery and Windows opener behavior.
- S5. Add cross-platform process discovery and process matching for profile adoption, `ps`, `kill`, stale lock cleanup, and resource snapshots.
- S6. Add or adapt the test harness so behavior parity can run on Windows while existing macOS/Linux regressions remain meaningful.
- S7. Update CI/runtime proof strategy so Windows real Chrome smoke is required and macOS/Linux parity remains proven.
- S8. Update install docs and agent-facing skills after validation.

No external services, cloud state, accounts, auth, production data, database migrations, or network exposure beyond localhost daemon communication are approved.

## 6. Requirements

- R1. chromux must run as a native Windows CLI from PowerShell or cmd with Node.js 22.
- R2. chromux must auto-discover Google Chrome Stable on Windows and continue to support explicit `chromePath` for custom browser locations.
- R3. chromux daemon communication must use an all-platform localhost TCP transport bound to `127.0.0.1`.
- R4. chromux must represent daemon endpoint state separately from Chrome CDP endpoint state.
- R5. Existing macOS/Linux daemon, launch, profile reuse, and stale-state behavior must not regress during TCP migration.
- R6. Windows must support profile adoption, process listing, targeted kill, stale lock cleanup, duplicate launch avoidance, and safe profile lifecycle behavior.
- R7. Windows must support local opener behavior for `show` and `chromux app --open`.
- R8. Completion must be proven by a macOS/Linux/Windows parity matrix for common commands and stale/reuse behavior.
- R9. Documentation and skills must describe Windows CLI support accurately after validation.
- R10. Package contents must remain clean and must not publish `.hoyeon/`, planning artifacts, or native app build artifacts accidentally.

## 7. Acceptance Criteria

- AC1. On native Windows with Node.js 22 and Google Chrome Stable installed, `chromux help` works from PowerShell or cmd.
- AC2. On native Windows, chromux can find Google Chrome Stable without a custom `chromePath` in a normal installation.
- AC3. Daemon requests work through localhost TCP on Windows, macOS, and Linux.
- AC4. Runtime state distinguishes daemon HTTP `daemonPort` from Chrome CDP `port`, and stale state cleanup does not confuse the two.
- AC5. `chromux launch` starts or adopts the correct Windows profile without duplicate Chrome instances for the same profile.
- AC6. Auto-launch `open`, `snapshot`, `close`, and `list` work on Windows with a real Chrome profile.
- AC7. `chromux ps` and `chromux kill` operate on the correct Windows chromux-managed profile and do not target unrelated Chrome processes.
- AC8. `chromux app --open` opens the local HTTP dashboard on Windows without relying on the macOS AppKit wrapper.
- AC9. Resource guard telemetry either matches behavior expectations or reports a conservative best-effort fallback that does not block normal command parity.
- AC10. The parity matrix covers `help`, `launch`, auto-launch `open`, `snapshot`, `close`, `list`, `ps`, `kill`, `app --open`, and stale/reuse behavior on macOS, Linux, and Windows.
- AC11. `README.md`, `install.md`, and agent-facing skills give PowerShell-first Windows CLI guidance and keep native app install/release guidance macOS-only.
- AC12. Existing macOS/Linux validations remain passing or any blocker is explicitly classified as unrelated.
- AC13. `npm pack --dry-run` excludes `.hoyeon/` artifacts and does not accidentally include native app build products.

## 8. PRD-Level Tasks

- T1. Introduce daemon endpoint abstraction, localhost TCP daemon transport, explicit endpoint state, and stale endpoint cleanup.
Covers R3-R5, AC3-AC4.
- T2. Add Windows Chrome Stable discovery and preserve explicit `chromePath` behavior.
Covers R1-R2, AC1-AC2.
- T3. Add Windows opener and process lifecycle support for app open, profile adoption, `ps`, `kill`, stale cleanup, and safe reuse.
Covers R6-R7, AC5-AC8.
- T4. Add regression coverage for daemon state migration, port separation, Chrome discovery, opener behavior, process matching, and stale/reuse behavior.
Covers R2-R7, AC2-AC9.
- T5. Build and run the macOS/Linux/Windows parity matrix with real Chrome runtime proof where required.
Covers R8, AC10, AC12.
- T6. Update Windows install docs, platform wording, and agent-facing skills only after validation evidence exists.
Covers R9, AC11.
- T7. Run package and release-hygiene validation, including package allowlist checks.
Covers R10, AC13.
- T8. Produce an implementation result report with R/AC/V coverage, deviations, blocked checks, and OS-specific evidence.
Covers R1-R10, AC1-AC13.

## 9. Verification Contract

### 9.1 Test Mode Contract

| Mode | Required For Done | Covers | Human Decision |
| --- | --- | --- | --- |
| build/static | yes | repo health, help surface, syntax, package shape | none |
| automated behavior | yes | transport, state migration, path discovery, opener, process lifecycle, stale/reuse logic | none |
| browser/runtime | yes | real Chrome CLI behavior on supported OSes | none |
| cross-platform CI/runtime | yes | macOS/Linux/Windows parity matrix and Windows real Chrome proof | none |
| docs/skills | yes | user-facing install guidance and agent-facing platform wording | final wording review |
| package audit | yes | package allowlist and no planning artifact leakage | none |

### 9.2 Required Agent Verification

| ID | Mode | Covers | Pass Intent | Required For Done | Can Be Blocked | Safe Probe | Side Effect | Sensitive Data Policy |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| V1 | build/static | R1, R5, R10, AC1, AC12-AC13 | Existing repo health checks and CLI help surface do not regress. | yes | no | Run local static and existing repo checks selected by executor, including `node chromux.mjs help` and the existing regression suite unless impossible. | May create local test profiles. | Do not print secrets. |
| V2 | automated behavior | R2-R7, AC2-AC9 | New platform abstractions and lifecycle behavior are covered by regression tests. | yes | no | Use isolated temp chromux home and fake or test profiles where possible. | Writes local test state only. | Use synthetic URLs and profile names. |
| V3 | automated behavior | R3-R5, AC3-AC4 | TCP endpoint state, daemon/CDP port separation, stale endpoint cleanup, and migration behavior are covered by tests. | yes | no | Use local loopback only. | Opens localhost daemon ports in test scope. | No external network or secrets. |
| V4 | browser/runtime | R1-R8, AC1-AC10 | Real Chrome smoke proves launch, auto-launch open, snapshot, close, list, ps, kill, app --open, and stale/reuse behavior. | yes | no | Use isolated chromux profiles and safe URLs. | Opens and closes Chrome tabs and processes. | Avoid private browsing data and credentials. |
| V5 | cross-platform CI/runtime | R5, R8, AC10, AC12 | The parity matrix is proven across macOS, Linux, and Windows by CI or documented runtime receipts. | yes | no | Prefer CI for Linux and Windows; use documented local macOS runtime proof if hosted macOS Chrome smoke is not reliable. | May launch test Chrome profiles. | Use synthetic pages or safe public pages. |
| V6 | docs/skills | R9, AC11 | Docs and skills match actual validated Windows behavior and still separate macOS native app flow. | yes | no | Read docs and skill files after implementation. | File edits only. | Do not include private local paths except generic examples. |
| V7 | package audit | R10, AC13 | Package dry run includes only intended package files and excludes `.hoyeon/` artifacts. | yes | no | Dry-run packaging only. | None. | Package output must not include secrets or local data. |

### 9.3 Human Verification

- H1. Human reviewer approves the final Windows support scope if implementation proposes adding WSL, Edge/Chromium auto-discovery, or native Windows app packaging.
- H2. Human reviewer reviews Windows install docs for clarity before treating docs as final.
- H3. Human reviewer approves any deviation from all-platform TCP transport or required parity matrix.

## 10. Risks And Open Decisions

- K1. TCP daemon transport changes a core all-platform runtime path.
Mitigation: keep it behind an endpoint abstraction, bind to `127.0.0.1`, add migration tests, and keep macOS/Linux regression proof required.
- K2. Daemon and Chrome CDP port confusion can produce stale reuse or broken adoption.
Mitigation: store and test separate `daemonPort` and `port` semantics.
- K3. Windows process matching can kill unrelated Chrome processes.
Mitigation: require profile-specific process identification and real Windows kill/adoption smoke.
- K4. Resource telemetry differs by OS.
Mitigation: make behavior parity required and telemetry exactness best-effort with documented conservative fallback.
- K5. Windows CI Chrome availability can drift.
Mitigation: capture actual runtime receipts and classify environment blockers explicitly.
- K6. Test harness changes can weaken existing bash coverage.
Mitigation: supplement or replace only where equivalent coverage exists, and keep existing macOS/Linux regression proof required.
- K7. Docs could overclaim support before runtime proof exists.
Mitigation: update docs and skill platform wording only after validation evidence exists.

Open decisions deferred to implementation:

- D1. Exact Windows process inspection mechanism.
- D2. Exact cross-platform test runner shape.
- D3. Exact GitHub Actions Chrome setup on Windows and macOS.

No deferred decision blocks implementation because the required behavior and verification contract are explicit.

## 11. Implementation Guardrails

- G1. Do not implement Chrome browser window management under this PRD.
- G2. Do not add WSL interop, Edge/Chromium auto-discovery, or native Windows app packaging without asking.
- G3. Do not weaken macOS/Linux behavior while adding Windows support.
- G4. Do not expose the daemon beyond localhost.
- G5. Do not reuse Chrome CDP port state as daemon HTTP port state.
- G6. Do not make Windows support launch-only while leaving `ps`, `kill`, stale cleanup, adoption, or reuse unreliable.
- G7. Do not mark resource telemetry exactness as required if OS-specific metrics are not stable, but do document and test the fallback behavior.
- G8. Do not update docs or skill platform claims before runtime validation exists.
- G9. Do not publish `.hoyeon/` artifacts, local profile data, or native app build artifacts.
- G10. Do not manually edit `CHANGELOG.md` or auto-generated files.

## 12. Implementation Result Report Contract

The implementation result report must include:

- Status: `Done`, `Partially Done`, or `Blocked`.
- User-visible changes.
- Major changed modules, runtime boundaries, state shapes, and CI/test surfaces.
- Whether all-platform TCP transport was implemented as approved.
- Whether daemon endpoint state and Chrome CDP state are separated.
- Completion status for T1-T8.
- R1-R10 coverage status.
- AC1-AC13 coverage status.
- V1-V7 verification evidence by mode.
- OS-specific parity matrix results for macOS, Linux, and Windows.
- Windows real Chrome smoke evidence.
- Automated tests added or updated, including the regression risk each protects.
- Docs and skills changed, with validation evidence.
- Package audit evidence from `npm pack --dry-run`.
- Any deviations from this PRD and whether they were approved.
- Remaining human review items H1-H3.
- Not-done items and follow-up candidates.
