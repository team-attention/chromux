# Context Notes: chromux Windows support

## Sources Read

- `.hoyeon/intake/chromux-windows-support/qa-log.md`
- `.hoyeon/intake/chromux-windows-support/prd-handoff.md`
- `.hoyeon/prd/chromux-status-app/prd.md`
- `.hoyeon/intake/chromux-status-app/prd-handoff.md`
- `/Users/hoyeonlee/.codex/skills/prd/SKILL.md`
- `/Users/hoyeonlee/.codex/memories/MEMORY.md`

## Repo Evidence From Intake

- `install.md` currently says the default supported install target is macOS/Linux.
- `install.md` troubleshooting says chromux searches common macOS/Linux Chrome and Chromium paths and that Windows support is deferred.
- `chromux.mjs` `CHROME_PATHS` includes macOS and Linux paths only.
- `chromux.mjs` daemon IPC currently uses `socketPath` with a `.sock` path under `~/.chromux/run/`.
- `chromux.mjs` process discovery and resource snapshots shell out to `ps`, with macOS and non-macOS Unix-style arguments.
- `chromux.mjs` `show` and `app --open` use `open` on macOS and `xdg-open` otherwise, with no Windows opener.
- `test.sh` is a bash script with `/tmp`, `ps`, `chmod`, and Unix cleanup assumptions.
- `skills/chromux/SKILL.md` and `skills/chromux-work/SKILL.md` declare platforms as macOS and Linux.
- `.github/workflows/ci.yml` has one Ubuntu job, validates bash syntax, runs `node chromux.mjs help`, checks Chrome availability through Unix commands, and runs `bash ./test.sh`.

## User Decisions Preserved

- Target Windows OS support, not Chrome browser window management.
- Target native Windows v1, not WSL interop.
- Make CLI and Chrome launch work on Windows.
- Keep native AppKit application macOS-only.
- Keep `chromux app` local HTTP dashboard in Windows CLI scope.
- Use all-platform localhost TCP daemon transport if existing regressions are preserved.
- Auto-discover Google Chrome Stable only for Windows v1.
- Keep Windows process lifecycle behavior close to macOS/Linux, not a reduced happy path.
- Use a macOS/Linux/Windows parity matrix for completion.
- Separate behavior parity from best-effort resource telemetry.
- Make Windows docs PowerShell-first and CLI-only.

## Prior Repo Memory Used

- Previous chromux PRD work used `.hoyeon/prd/<slug>/prd.md`, `checklist.md`, `context-notes.md`, `intent-scope-audit.md`, and `verification-contract-audit.md` with PASS audits.
- Previous chromux CI work established that the repo has used real headless Chrome smoke in CI and that `test.sh` is an important validation surface.
- Memory is supporting context only.
Current repo files and intake artifacts are the authority for this PRD.

## Implementation Notes

- The PRD should not prescribe low-level implementation details such as exact Windows process commands.
- The PRD should require behavior and verification outcomes strongly enough that implementation cannot stop at Chrome path strings.
- The package audit remains relevant because `.hoyeon/` planning artifacts should not be published.
