# chromux agent guide

chromux is a zero-dependency Node.js CLI for controlling real Google Chrome
profiles through raw CDP. Keep the public command surface small and let
`chromux help` be the source of truth for current CLI syntax.

## Working Rules

- Use Node.js >= 22 and avoid adding runtime dependencies unless the tradeoff is
  explicit and necessary.
- Prefer existing raw-CDP and daemon/profile patterns in `chromux.mjs` over new
  abstraction layers.
- New browser actions should usually be expressed through `run` or `cdp` before
  adding another top-level verb.
- Compatibility aliases may remain quiet, but do not expose deprecated aliases
  in the main help surface.
- Keep agent-facing instructions in `SKILL.md` and installation/runtime setup in
  `install.md`.
- Keep repo-local helper runner material under `snippets/_builtin/`.

## Validation

Run focused checks after changes:

```bash
node chromux.mjs help
./test.sh
npm pack --dry-run
```

`npm pack --dry-run` should include only the package allowlist from
`package.json`; local planning or handoff artifacts should not be published.
