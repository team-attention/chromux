# chromux Windows support context notes

## Decisions

- Kept `.state.port` as the existing Chrome CDP port for compatibility and added `cdpPort` as an explicit alias plus separate `daemonPort`/`daemonEndpoint` for daemon HTTP.
- Kept legacy `sockPath` only for migration/cleanup of older macOS/Linux state; new daemon requests use localhost TCP.
- Used PowerShell `Get-CimInstance Win32_Process` for native Windows process discovery because it is available on modern Windows runners and avoids adding dependencies.
- Used `cmd.exe /c start` for Windows opener behavior for both `show` and `chromux app --open`.
- Kept exact RSS telemetry as best-effort on Windows while preserving profile process and renderer counting.

## Tradeoffs

- Native Windows real Chrome runtime proof was executed through GitHub Actions run `28729902858` after pushing the branch. The first Windows run exposed a PowerShell multiline assertion bug in the workflow, which was fixed in commit `136efd6`; the final smoke was expanded in commit `a393de6` to include close, duplicate launch reuse, and dead-lock stale recovery.

## Blockers

- None currently known.
