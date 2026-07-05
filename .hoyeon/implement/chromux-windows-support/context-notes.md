# chromux Windows support context notes

## Decisions

- Kept `.state.port` as the existing Chrome CDP port for compatibility and added `cdpPort` as an explicit alias plus separate `daemonPort`/`daemonEndpoint` for daemon HTTP.
- Kept legacy `sockPath` only for migration/cleanup of older macOS/Linux state; new daemon requests use localhost TCP.
- Used PowerShell `Get-CimInstance Win32_Process` for native Windows process discovery because it is available on modern Windows runners and avoids adding dependencies.
- Used `cmd.exe /c start` for Windows opener behavior for both `show` and `chromux app --open`.
- Kept exact RSS telemetry as best-effort on Windows while preserving profile process and renderer counting.

## Tradeoffs

- Native Windows real Chrome runtime proof cannot be executed from this macOS workspace. The implementation adds a Windows GitHub Actions smoke job, but AC1, AC2, AC5, AC6, AC7, AC8, and the Windows leg of AC10 remain pending until that job runs.

## Blockers

- Native Windows runtime execution is not available in this local environment.
