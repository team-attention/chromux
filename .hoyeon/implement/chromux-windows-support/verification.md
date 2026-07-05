# chromux Windows support verification

## Evidence Log

### Status

Done.

Implementation work is complete and native Windows real Chrome runtime proof passed in GitHub Actions run `28729902858`.

### What Changed

- User-visible behavior: chromux now uses localhost TCP daemon endpoints, documents native Windows CLI support, and keeps `chromux app --open` as the cross-platform dashboard path.
- Main technical changes: daemon endpoint state, Windows Chrome discovery, Windows process listing, Windows opener behavior, taskkill fallback, CI Windows smoke, docs/skills updates, package version bump to `0.10.0`.
- Files changed: `chromux.mjs`, `test.sh`, `.github/workflows/ci.yml`, `README.md`, `install.md`, `skills/chromux/SKILL.md`, `skills/chromux-work/SKILL.md`, `package.json`.

### Approved Structure Conformance

- Approved structure followed: Yes.
- Deviations: None.

### Task Completion

- T1: Complete. TCP daemon transport and endpoint state implemented.
- T2: Complete. Windows Chrome Stable discovery added; explicit `chromePath` preserved.
- T3: Complete. Windows opener/process lifecycle support added.
- T4: Complete. Regression coverage added.
- T5: Complete. macOS runtime passed locally; Ubuntu and Windows CI passed in GitHub Actions run `28729902858`.
- T6: Complete. Docs and skills updated after local validation.
- T7: Complete. Package dry-run passed and excluded planning/native build artifacts.
- T8: Complete. This report records R/AC/V coverage and final proof.

### Acceptance Criteria Sweep

- AC1: Met. Windows CI `Validate package surface` ran `node chromux.mjs help` from PowerShell.
- AC2: Met. Windows CI launched Chrome Stable without a custom `chromePath`; self-test also covers Windows candidate generation.
- AC3: Met. macOS local runtime and GitHub Actions Ubuntu/Windows runtime passed through localhost TCP daemon requests.
- AC4: Met. `./test.sh` verifies `port`/`cdpPort` differs from `daemonPort` and legacy `sock` is removed.
- AC5: Met. Windows CI launched `win-ci`, ran a second `launch`, and asserted the running profile was reused.
- AC6: Met. Windows CI covered real Chrome `open`, `snapshot`, `list`, `close`, and post-close empty list.
- AC7: Met. Windows CI checked `ps` for the `win-ci` profile and ran `kill win-ci` cleanup.
- AC8: Met. Windows CI ran `chromux app --open` and verified local `/api/state`.
- AC9: Met. Windows RSS reports best-effort fallback while process/renderers remain profile-specific.
- AC10: Met. macOS local suite, Ubuntu full suite, and Windows PowerShell smoke cover the parity matrix, including duplicate launch reuse and dead-lock stale recovery.
- AC11: Met. README, install.md, and skills now include PowerShell-first Windows CLI guidance and macOS-only native app boundaries.
- AC12: Met. macOS local validations passed and Ubuntu CI passed in run `28729902858`.
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
- Native Windows runtime: GitHub Actions run `28729902858`, job `windows-runtime`, passed. The smoke launched Chrome Stable on Windows Server 2025, verified duplicate launch reuse, opened `https://example.com`, verified `snapshot`, `list`, `ps`, `close`, `chromux app --open`, `/api/state`, `kill`, and dead-lock stale recovery.

#### V5. Cross-Platform CI/Runtime

- GitHub Actions run `28729902858` completed successfully.
- Ubuntu `validate` passed package/static checks and the real headless Chrome `./test.sh` suite.
- Windows `windows-runtime` passed PowerShell validation, app self-test, npm pack dry-run, and real Chrome smoke for `launch`, duplicate launch reuse, `open`, `snapshot`, `close`, `list`, `ps`, `app --open`, `kill`, and stale lock recovery.

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
| Linux | GitHub Actions run `28729902858`, Ubuntu `validate` | Passed |
| Windows | GitHub Actions run `28729902858`, Windows `windows-runtime` | Passed |

### Human Review Needed

- H1: Not needed; no WSL, Edge/Chromium auto-discovery, or native Windows app packaging was added.
- H2: Recommended for human polish review, but not blocking implementation completion.
- H3: Not needed; all-platform TCP transport was implemented.

### Not Done, Risks, And Follow-Ups

- None required for the PRD implementation scope.
