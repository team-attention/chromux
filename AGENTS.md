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
- Keep agent-facing instructions under `skills/`: `skills/chromux/` for CLI
  usage and `skills/chromux-work/` for browser-work orchestration. Keep
  installation/runtime setup in `install.md`.
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

## Release / Publish

Publishing is handled by `.github/workflows/npm-publish.yml` on pushes to
`main` and by manual `workflow_dispatch`. The workflow validates the package,
checks whether the exact `package.json` version is already present on npm, and
then runs `npm publish --provenance` with the repository `NPM_TOKEN` secret.

Before pushing a publishable change, bump `package.json` to a version that is not
already published. Do not publish manually from a local machine unless the user
explicitly asks for it; the repo workflow is the deployment path.

## Pre-Publish Checklist

Before committing, pushing, tagging, or publishing a final chromux change:

- Run `git status --short` and confirm the staged files are only the intended
  repo changes.
- Bump `package.json` `version` (patch for bug fixes, minor for new features,
  major for breaking CLI changes). `.github/workflows/npm-publish.yml` runs on
  every push to `main` and will fail with `<pkg>@<version> is already published`
  if the version was not bumped — so the bump is a release gate, not just
  hygiene. Bumping in the same PR as the change keeps the publish trigger
  one merge away.
- Run `node chromux.mjs help` and confirm the documented public command surface
  matches the CLI output.
- Run `./test.sh` for behavioral coverage.
- Run `npm pack --dry-run` and confirm the tarball contains only the package
  allowlist from `package.json`.
- For publishable fixes, bump `package.json` before pushing; the GitHub Actions
  workflow publishes on `main` when the version is new.
- If behavior changed, update the matching docs and skills in the same change:
  `README.md`, `install.md`, `skills/chromux/`, and `skills/chromux-work/`.
- Before finalizing, read `install.md` and the relevant files under `skills/`
  to check for stale setup, usage, or agent-facing instructions.
- For browser focus or profile behavior changes, run one live smoke check with
  the relevant `CHROMUX_PROFILE` and environment variables instead of relying on
  docs or code inspection alone.
