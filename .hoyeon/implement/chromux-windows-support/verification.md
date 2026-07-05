# chromux Windows support verification

## Evidence Log

### Status

Partially Done.

Implementation work is complete in the local repo, but native Windows real Chrome runtime proof is pending execution on a Windows runner.

### What Changed

- User-visible behavior: chromux now uses localhost TCP daemon endpoints, documents native Windows CLI support, and keeps `chromux app --open` as the cross-platform dashboard path.
- Main technical changes: daemon endpoint state, Windows Chrome discovery, Windows process listing, Windows opener behavior, taskkill fallback, CI Windows smoke, docs/skills updates, package version bump to `0.10.0`.
- Files changed: `chromux.mjs`, `test.sh`, `.github/workflows/ci.yml`, `README.md`, `install.md`, `skills/chromux/SKILL.md`, `skills/chromux-work/SKILL.md`, `package.json`.

### Approved Structure Conformance

- Approved structure followed: Yes.
- Deviations: None in implementation structure. Verification is partial because the local environment is macOS-only and cannot execute native Windows Chrome.

### Task Completion

- T1: Complete. TCP daemon transport and endpoint state implemented.
- T2: Complete. Windows Chrome Stable discovery added; explicit `chromePath` preserved.
- T3: Complete. Windows opener/process lifecycle support added.
- T4: Complete. Regression coverage added.
- T5: Partially complete. macOS runtime passed; Linux CI and Windows CI configured; Windows runtime result pending.
- T6: Complete. Docs and skills updated after local validation.
- T7: Complete. Package dry-run passed and excluded planning/native build artifacts.
- T8: Complete. This report records R/AC/V coverage and pending proof.

### Acceptance Criteria Sweep

- AC1: Pending Windows CI execution. Windows job runs `node chromux.mjs help` from PowerShell.
- AC2: Pending Windows CI execution. Helper self-test covers Windows candidate generation.
- AC3: Met for local macOS runtime; Linux/Windows covered by CI workflow configuration.
- AC4: Met. `./test.sh` verifies `port`/`cdpPort` differs from `daemonPort` and legacy `sock` is removed.
- AC5: Pending Windows CI execution. Shared launch/adoption code passes macOS runtime suite.
- AC6: Pending Windows CI execution. Windows job covers `open`, `snapshot`, and `list`.
- AC7: Pending Windows CI execution. Windows job covers `ps` and `kill`; helper code targets profile-specific `--user-data-dir`.
- AC8: Pending Windows CI execution. Local `chromux app --open` dashboard smoke passed.
- AC9: Met. Windows RSS reports best-effort fallback while process/renderers remain profile-specific.
- AC10: Pending Windows CI execution. macOS local matrix passed; Linux existing CI and Windows new CI are configured.
- AC11: Met. README, install.md, and skills now include PowerShell-first Windows CLI guidance and macOS-only native app boundaries.
- AC12: Met locally for macOS. Existing Linux CI job remains in place.
- AC13: Met. `npm pack --dry-run` excludes `.hoyeon/` and native app build outputs.

### Verification Evidence

#### V1. Build And Static Gates

- `node --check chromux.mjs`: passed.
- `bash -n test.sh`: passed.
- `bash -n apps/macos-status-bar/build.sh`: passed.
- `bash -n apps/macos-status-bar/package-release.sh`: passed.
- `node chromux.mjs help` plus help/skill/snippet checks: passed.

#### V2. Automated Behavior Tests

- `CHROMUX_HOME=/tmp/chromux-selftest-win-support node chromux.mjs app --self-test`: passed, including Windows Chrome candidates, Windows command parsing, Windows opener, endpoint migration, and daemon/CDP port separation.

#### V3. Endpoint And Migration Tests

- `./test.sh`: passed 102/102. Added checks verify legacy `sock` state migrates away and daemon HTTP `daemonPort` differs from Chrome CDP `port`/`cdpPort`.

#### V4. Runtime Agent QA

- Local macOS smoke: `launch`, `open`, `list`, `ps`, and `kill` with a real Chrome profile passed.
- Local macOS dashboard smoke: `chromux app --open` served `http://127.0.0.1:9351/` and `/api/state` returned `ok`.
- Full local `./test.sh`: passed 102/102 with real Chrome.
- Native Windows runtime: pending CI execution.

#### V5. Cross-Platform CI/Runtime

- Existing Ubuntu CI job still runs static/package checks and `./test.sh`.
- Added Windows CI job on `windows-latest` with PowerShell validation, app self-test, npm pack dry-run, and real Chrome smoke for `launch`, `open`, `snapshot`, `list`, `ps`, `app --open`, and `kill`.
- Windows job has not been executed in this local run.

#### V6. Docs/Skills

- Updated `README.md`, `install.md`, `skills/chromux/SKILL.md`, and `skills/chromux-work/SKILL.md`.

#### V7. Package Audit

- `npm pack --dry-run`: passed for `@team-attention/chromux@0.10.0`.
- Tarball included 17 allowlisted files.
- `.hoyeon/` artifacts and native app build products were not included.

### OS-Specific Parity Matrix

| OS | Evidence | Status |
| --- | --- | --- |
| macOS | Local `./test.sh` 102/102, local TCP smoke, local `app --open` smoke | Passed |
| Linux | Existing GitHub Actions Ubuntu job preserved | Pending next CI run |
| Windows | New GitHub Actions Windows PowerShell job added | Pending next CI run |

### Human Review Needed

- H1: Not needed; no WSL, Edge/Chromium auto-discovery, or native Windows app packaging was added.
- H2: Recommended for final Windows install wording.
- H3: Not needed; all-platform TCP transport was implemented.

### Not Done, Risks, And Follow-Ups

- Native Windows real Chrome proof is not locally executed.
- GitHub Actions Windows job should be run before declaring PRD status `Done`.
