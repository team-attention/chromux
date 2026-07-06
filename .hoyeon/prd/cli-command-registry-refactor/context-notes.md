# Context Notes

## Sources Read

- User request in the current conversation asked for a full skill improvement loop and a `chromux` example that reaches PR and CI.
- `AGENTS.md` says the public command surface should stay small, `chromux help` is the source of truth, and validation should include `node chromux.mjs help`, `./test.sh`, and `npm pack --dry-run`.
- `package.json` exposes a zero-dependency Node.js CLI with `chromux.mjs` as the binary.
- `.github/workflows/ci.yml` runs Node syntax checks, help checks, package dry-run, Linux browser tests, Windows self-test, and Windows Chrome smoke.
- `chromux.mjs` currently keeps command grouping, daemon routing, help text, and activity session inference in nearby but separate ad hoc structures.

## Scope Choice

The example refactor is intentionally behavior-preserving.
It is broad enough to touch the central CLI routing path, but narrow enough that existing browser tests and CI can prove compatibility.

## Delivery

Delivery mode is PR.
The current conversation requested final PR and CI pass as part of the example.
The implementation should use a PR branch and keep the current main checkout's existing untracked `.hoyeon` artifacts out of the PR.
