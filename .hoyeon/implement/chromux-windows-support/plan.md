# chromux Windows support implementation plan

Source PRD: `.hoyeon/prd/chromux-windows-support/prd.md`
Status: active

## Execution Notes

- Follow the approved all-platform localhost TCP daemon direction.
- Keep daemon HTTP endpoint state separate from Chrome CDP endpoint state.
- Preserve existing macOS/Linux behavior while adding native Windows support.
- Update docs and skills only after implementation validation evidence exists.

## Work Phases

1. Inspect current daemon, state, Chrome discovery, opener, process, tests, CI, and package allowlist surfaces.
2. Implement daemon endpoint abstraction, TCP transport, explicit endpoint state, and migration/stale cleanup.
3. Implement Windows Chrome Stable discovery, opener, and profile lifecycle/process behavior.
4. Add regression coverage for state migration, port separation, discovery, opener, process matching, stale/reuse behavior.
5. Run local static/package checks and available runtime smoke checks.
6. Update README, install docs, and agent-facing skills from validation evidence.
7. Complete acceptance sweep and implementation result report.
