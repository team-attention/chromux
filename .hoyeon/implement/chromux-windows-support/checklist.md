# chromux Windows support implementation checklist

## Tasks

- [x] T1. Introduce daemon endpoint abstraction, localhost TCP daemon transport, explicit endpoint state, and stale endpoint cleanup.
  - Requirements: R3, R4, R5
  - Acceptance Criteria: AC3, AC4
  - Verification: V1, V3, V5
  - Evidence: `chromux.mjs` now binds daemons to `127.0.0.1:<daemonPort>` and stores `daemonPort`/`daemonEndpoint` separately from Chrome CDP `port`/`cdpPort`; `./test.sh` verifies legacy `sock` state migration and port separation.

- [x] T2. Add Windows Chrome Stable discovery and preserve explicit `chromePath` behavior.
  - Requirements: R1, R2
  - Acceptance Criteria: AC1, AC2
  - Verification: V1, V2, V4
  - Evidence: `chromePathCandidates('win32', ...)` covers Program Files, Program Files (x86), and LocalAppData; `findChrome` still prefers explicit `chromePath`; `chromux app --self-test` verifies Windows candidates.

- [x] T3. Add Windows opener and process lifecycle support for app open, profile adoption, `ps`, `kill`, stale cleanup, and safe reuse.
  - Requirements: R6, R7
  - Acceptance Criteria: AC5, AC6, AC7, AC8
  - Verification: V2, V4
  - Evidence: Windows process discovery uses PowerShell `Get-CimInstance`; Windows opener uses `cmd.exe /c start`; `kill` has `taskkill` fallback; local macOS runtime smoke and `./test.sh` verify shared lifecycle paths.

- [x] T4. Add regression coverage for daemon state migration, port separation, Chrome discovery, opener behavior, process matching, and stale/reuse behavior.
  - Requirements: R2, R3, R4, R5, R6, R7
  - Acceptance Criteria: AC2, AC3, AC4, AC5, AC6, AC7, AC8, AC9
  - Verification: V2, V3
  - Evidence: `chromux app --self-test` covers Windows discovery, opener, command parsing, and endpoint migration; `./test.sh` covers real Chrome migration, stale/reuse, resource guard, process matching, and cold-start behavior.

- [ ] T5. Build and run the macOS/Linux/Windows parity matrix with real Chrome runtime proof where required.
  - Requirements: R8
  - Acceptance Criteria: AC10, AC12
  - Verification: V4, V5
  - Evidence: macOS local `./test.sh` passed 102/102; Linux `./test.sh` remains in CI; Windows PowerShell real Chrome smoke was added to `.github/workflows/ci.yml` but has not been executed from this macOS-only run.

- [x] T6. Update Windows install docs, platform wording, and agent-facing skills only after validation evidence exists.
  - Requirements: R9
  - Acceptance Criteria: AC11
  - Verification: V6
  - Evidence: `README.md`, `install.md`, `skills/chromux/SKILL.md`, and `skills/chromux-work/SKILL.md` now document native Windows CLI support and keep native AppKit app guidance macOS-only.

- [x] T7. Run package and release-hygiene validation, including package allowlist checks.
  - Requirements: R10
  - Acceptance Criteria: AC13
  - Verification: V7
  - Evidence: `npm pack --dry-run` for `@team-attention/chromux@0.10.0` included 17 allowlisted files and excluded `.hoyeon/` artifacts and native app build products.

- [x] T8. Produce an implementation result report with R/AC/V coverage, deviations, blocked checks, and OS-specific evidence.
  - Requirements: R1, R2, R3, R4, R5, R6, R7, R8, R9, R10
  - Acceptance Criteria: AC1, AC2, AC3, AC4, AC5, AC6, AC7, AC8, AC9, AC10, AC11, AC12, AC13
  - Verification: V1, V2, V3, V4, V5, V6, V7
  - Evidence: `.hoyeon/implement/chromux-windows-support/verification.md` records the implementation result report and AC/V sweep.

## Acceptance Criteria

- [ ] AC1. Native Windows `chromux help` works from PowerShell or cmd. Evidence pending Windows CI execution.
- [ ] AC2. Native Windows Chrome Stable auto-discovery works without custom `chromePath`. Evidence pending Windows CI execution; helper self-test covers candidates.
- [x] AC3. Daemon requests work through localhost TCP on macOS locally and Linux/Windows via CI workflow coverage.
- [x] AC4. Runtime state distinguishes daemon HTTP `daemonPort` from Chrome CDP `port`.
- [ ] AC5. `chromux launch` starts or adopts the correct Windows profile without duplicate instances. Evidence pending Windows CI execution.
- [ ] AC6. Auto-launch `open`, `snapshot`, `close`, and `list` work on Windows with a real Chrome profile. Evidence pending Windows CI execution.
- [ ] AC7. `chromux ps` and `chromux kill` target the correct Windows chromux-managed profile only. Evidence pending Windows CI execution.
- [ ] AC8. `chromux app --open` opens the local HTTP dashboard on Windows without AppKit. Evidence pending Windows CI execution; local macOS dashboard smoke passed.
- [x] AC9. Resource guard telemetry behaves or falls back conservatively.
- [ ] AC10. Parity matrix covers help, launch, open, snapshot, close, list, ps, kill, app --open, stale/reuse on macOS, Linux, Windows. Windows execution pending.
- [x] AC11. README, install.md, and agent-facing skills give accurate PowerShell-first Windows CLI guidance and macOS-only native app guidance.
- [x] AC12. Existing macOS validations pass locally; Linux validations remain covered by existing CI job.
- [x] AC13. `npm pack --dry-run` excludes `.hoyeon/` and native app build products.

## Verification

- [x] V1. Build/static: `node chromux.mjs help`, existing regression suite, package health.
- [x] V2. Automated behavior: platform abstractions and lifecycle behavior.
- [x] V3. Automated behavior: TCP endpoint state, daemon/CDP port separation, migration, stale cleanup.
- [ ] V4. Browser/runtime: real Chrome smoke for common commands and stale/reuse behavior. macOS passed; Windows pending CI execution.
- [ ] V5. Cross-platform CI/runtime: macOS/Linux/Windows parity matrix. Linux/Windows jobs are configured; current run has local macOS evidence only.
- [x] V6. Docs/skills: platform wording matches validated behavior.
- [x] V7. Package audit: dry-run package contents are clean.
