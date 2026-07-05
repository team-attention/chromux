# PRD Handoff: chromux Windows support

> Date: 2026-07-05
> Source: `.hoyeon/intake/chromux-windows-support/qa-log.md`

## Clear Outcome

Make the chromux CLI work on native Windows with behavior as close as possible to macOS/Linux.
The implementation should use an all-platform localhost TCP daemon transport, add Windows Google Chrome Stable auto-discovery, keep profile lifecycle and process behavior reliable on Windows, and prove the result with Windows CI real Chrome smoke plus a cross-platform parity matrix.
The native AppKit status bar application remains macOS-only.

## Axis Decisions

The target is Windows OS support, not Chrome browser window management.
V1 targets native Windows from PowerShell or cmd with Node.js 22 and Google Chrome Stable installed.
WSL-to-Windows Chrome interop is out of scope for v1.

CLI and Chrome launch behavior are in scope.
The public command surface should stay the same where possible.
The `chromux app` local HTTP dashboard command is in Windows CLI scope.
Only the native AppKit wrapper under `apps/macos-status-bar` stays macOS-only.

Use localhost TCP as the all-platform daemon transport direction.
Bind the daemon endpoint to `127.0.0.1`.
Store explicit daemon endpoint state, for example `{ transport: "tcp", host: "127.0.0.1", port: <daemonPort> }`.
Keep the daemon HTTP `daemonPort` separate from Chrome CDP `port`.
Migration must preserve existing macOS/Linux behavior and regressions.

Windows process discovery and lifecycle behavior are v1 core scope.
Windows must support profile adoption, `ps`, `kill`, stale lock cleanup, duplicate launch avoidance, safe profile lifecycle, and stale/reuse behavior.
Crawl resource guard behavior should match where feasible.
RSS, renderer counts, and other OS-sensitive telemetry may be best-effort if behavior parity remains preserved.

## Domain Terms And Documented Decisions

Use existing chromux terms: profile, session, daemon, Chrome CDP port, Chrome user data dir, launch mode, headed, headless, stale lock, and known profile.
Use `Windows OS support` and `native Windows CLI` when describing this feature.
Do not use `window support` without disambiguation.
Treat `chromux help` as the source of truth for public CLI syntax.
Treat Windows docs as CLI install and smoke guidance, not native Windows app packaging.

## Requirement Seeds

Windows must auto-discover Google Chrome Stable.
Edge and Chromium auto-discovery are out of scope for v1.
Explicit `chromePath` remains the escape hatch for non-standard browser locations.

Daemon IPC must become a cross-platform localhost TCP transport or equivalent abstraction whose selected v1 behavior is TCP on all supported OSes.
The implementation must guard port allocation, startup locking, endpoint state migration, stale endpoint cleanup, and daemon reuse.
Existing macOS/Linux regressions must keep passing during and after migration.

Windows must support the common command parity matrix: `help`, `launch`, auto-launch `open`, `snapshot`, `close`, `list`, `ps`, `kill`, `app --open`, and stale/reuse behavior.
The same matrix should be used for macOS, Linux, and Windows.
Resource telemetry should be separated from behavior parity when OS process metrics differ.

Windows documentation should be PowerShell-first.
It should cover Node.js 22, Google Chrome Stable, and `npm install -g .` from checkout.
It should explicitly exclude macOS native app installer and release flow from Windows support.
Agent-facing skills should be updated from macOS/Linux-only after Windows validation exists.

## Non-Goals

Do not implement Chrome browser window management.
Do not include WSL-to-Windows Chrome interop in v1.
Do not add Edge or Chromium auto-discovery in v1.
Do not build native Windows app packaging or a Windows tray application.
Do not remove or degrade macOS/Linux behavior while migrating daemon transport.
Do not reduce Windows to a launch-only happy path.
Do not make resource telemetry exactness block completion when behavior parity is proven and telemetry fallback is documented.

## Pre-Work And Human Decisions

No blocking human decision remains before PRD drafting.
Implementation should inspect current `chromux.mjs`, `test.sh`, `.github/workflows/ci.yml`, `install.md`, `README.md`, `skills/chromux/SKILL.md`, and `skills/chromux-work/SKILL.md`.
If the implementation needs to widen scope beyond native Windows CLI support and `chromux app --open`, it must ask before continuing.

## Major Technical Structure Signals

Introduce an explicit daemon endpoint abstraction.
Move daemon client requests away from Unix-socket-only assumptions.
Separate daemon HTTP endpoint state from Chrome CDP endpoint state.
Introduce Windows-aware Chrome discovery and opener behavior.
Introduce cross-platform process discovery for profile adoption, process listing, kill safety, stale lock cleanup, and resource snapshots.
Replace or supplement the Unix shell test harness with cross-platform behavioral coverage.
Update CI so Windows real Chrome smoke is required for done, while preserving macOS/Linux regression proof.

## Test And Verification Seeds

Run repo health and package checks, including `node chromux.mjs help`, the existing regression suite, and `npm pack --dry-run`.
Add automated behavior coverage for daemon endpoint state, TCP daemon requests, stale endpoint cleanup, Windows Chrome discovery, Windows opener behavior, and process lifecycle logic.
Run a native Windows real Chrome smoke that proves at least launch, auto-launch open, snapshot, close, list, ps, kill, app --open, and stale/reuse behavior.
Run the same parity matrix across macOS, Linux, and Windows by CI or documented runtime proof.
Keep behavior parity required and resource telemetry exactness best-effort when OS process metrics differ.

## Risks, Side Effects, And Sensitive Data

TCP daemon transport changes a core runtime path and can affect all OSes.
Bind only to `127.0.0.1` and avoid exposing the daemon outside localhost.
Port collision and stale endpoint files can cause reuse, launch, or kill bugs if state migration is weak.
Process matching can kill the wrong Chrome process if it does not verify profile-specific launch arguments or equivalent identifiers.
Windows CI and GitHub hosted images can drift in Chrome availability and flags, so the result report must capture actual runtime evidence.
Local profile smoke tests may mutate test profiles and open local Chrome tabs.
Use isolated verification profiles where possible.

## Human Review Needed

Review and approve the final scope boundary before implementation if Windows native app packaging, WSL, or Edge/Chromium auto-discovery reappears.
Review Windows install docs for clarity after implementation.
Review any deviation from all-platform TCP transport or cross-platform parity requirements.

## Open Questions

Exact Windows process inspection mechanism is deferred to implementation.
Exact cross-platform test harness shape is deferred to implementation.
Exact Windows CI Chrome setup details are deferred to implementation.
No open question blocks PRD drafting.

## Suggested Next Step

`$prd --context .hoyeon/intake/chromux-windows-support/prd-handoff.md "chromux Windows support"`
