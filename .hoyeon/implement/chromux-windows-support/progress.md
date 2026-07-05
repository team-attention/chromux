# chromux Windows support progress

## 2026-07-05

- Created implementation run artifacts from PRD T1-T8, AC1-AC13, and V1-V7.
- Implemented localhost TCP daemon endpoint state with separate Chrome CDP `port`/`cdpPort` and daemon HTTP `daemonPort`.
- Added migration from legacy Unix socket `.state.sock` to TCP endpoint state.
- Added Windows Chrome Stable discovery candidates, Windows PowerShell process discovery, Windows opener support, and `taskkill` fallback for profile cleanup.
- Added regression coverage in `chromux app --self-test`, `test.sh`, and `.github/workflows/ci.yml`.
- Updated `README.md`, `install.md`, `skills/chromux/SKILL.md`, and `skills/chromux-work/SKILL.md`.
- Bumped `package.json` to `0.10.0` for the new Windows CLI support feature.
- Pushed branch and confirmed GitHub Actions run `28729902858` passed both Ubuntu `validate` and Windows `windows-runtime`, including the expanded Windows parity smoke.
