# Verification Plan: cli-command-registry-refactor

- Status: ready
- Generated: 2026-07-05T16:55:35.868Z
- PRD: .hoyeon/prd/cli-command-registry-refactor/prd.md

## Environment

- Package manager: npm
- Browser tool: chromux
- Server strategy: no dev server script detected
- Service strategy: use repo-local dev/test commands; ask if services are required
- DB strategy: no DB surface detected

## Test Mode Contract

- build/static: required=yes; blockable=no; covers=syntax, shell syntax, help surface, package surface; human=none
- automated behavior: required=yes; blockable=no; covers=command metadata invariants and status app self-test; human=none
- browser/runtime: required=yes; blockable=no; covers=real Chrome CLI behavior and activity logging; human=none
- delivery/CI: required=no; blockable=yes; covers=post-receipt PR URL and required GitHub CI pass through `prd-ship`; human=final merge remains human-owned

## Checks

### VP1. V1 - command

- Level: General
- Source: verification_matrix
- Test mode: build/static
- Tool: verify-run
- Command: `node --check chromux.mjs && bash -n test.sh && node chromux.mjs help >/tmp/chromux-help.txt && grep -q "wait-for-selector" /tmp/chromux-help.txt && ! grep -q "^  chromux eval " /tmp/chromux-help.txt && ! grep -q "^  chromux scroll " /tmp/chromux-help.txt && ! grep -q "^  chromux wait " /tmp/chromux-help.txt && ! grep -q "^  chromux console " /tmp/chromux-help.txt && ! grep -q "^  chromux network " /tmp/chromux-help.txt && ! grep -q "^  chromux scroll-until " /tmp/chromux-help.txt`
- Covers: R: R1, R2, R3, R4; AC: AC1, AC2, AC3
- Artifacts: command-log, console-log, network-log
- Pass criteria: command exits 0, help exposes `wait-for-selector`, and hidden compatibility aliases are not listed as primary help entries
- Required for done: yes
- Can be blocked: no
- Contract method: `node --check chromux.mjs && bash -n test.sh && node chromux.mjs help >/tmp/chromux-help.txt && grep -q "wait-for-selector" /tmp/chromux-help.txt && ! grep -q "^  chromux eval " /tmp/chromux-help.txt && ! grep -q "^  chromux scroll " /tmp/chromux-help.txt && ! grep -q "^  chromux wait " /tmp/chromux-help.txt && ! grep -q "^  chromux console " /tmp/chromux-help.txt && ! grep -q "^  chromux network " /tmp/chromux-help.txt && ! grep -q "^  chromux scroll-until " /tmp/chromux-help.txt`
- Contract artifact: command-log
- Contract environment: local shell
- Safe probe: local static/help only
- Live proof: command log
- Side effect: writes `/tmp/chromux-help.txt`
- Sensitive data policy: no secrets
- Status: planned

### VP2. V2 - automated

- Level: General
- Source: verification_matrix
- Test mode: automated behavior
- Tool: verify-run
- Command: `CHROMUX_HOME="$(mktemp -d /tmp/chromux-selftest-XXXXXX)" node chromux.mjs app --self-test >/tmp/chromux-selftest.txt && grep -q "command metadata registry invariants" /tmp/chromux-selftest.txt`
- Covers: R: R1, R2, R3, R4; AC: AC1, AC2, AC3, AC4
- Artifacts: command-log
- Pass criteria: command exits 0 and self-test visibly proves command metadata registry invariants, including no per-call inline tab-command `Set` in `runCli`
- Required for done: yes
- Can be blocked: no
- Contract method: `CHROMUX_HOME="$(mktemp -d /tmp/chromux-selftest-XXXXXX)" node chromux.mjs app --self-test >/tmp/chromux-selftest.txt && grep -q "command metadata registry invariants" /tmp/chromux-selftest.txt`
- Contract artifact: command-log
- Contract environment: local shell
- Safe probe: isolated `CHROMUX_HOME`
- Live proof: command log
- Side effect: creates temporary local state and `/tmp/chromux-selftest.txt`
- Sensitive data policy: no secrets
- Status: planned

### VP3. V3 - command

- Level: General
- Source: verification_matrix
- Test mode: build/static
- Tool: verify-run
- Command: `npm pack --dry-run`
- Covers: R: R4; AC: AC4
- Artifacts: command-log
- Pass criteria: command exits 0 and package allowlist remains valid
- Required for done: yes
- Can be blocked: no
- Contract method: `npm pack --dry-run`
- Contract artifact: command-log
- Contract environment: local shell
- Safe probe: package dry-run only
- Live proof: command log
- Side effect: creates no publish
- Sensitive data policy: no secrets
- Status: planned

### VP4. V4 - command

- Level: General
- Source: verification_matrix
- Test mode: browser/runtime
- Tool: verify-run
- Command: `bash ./test.sh`
- Covers: R: R2, R3, R4; AC: AC2, AC3, AC4
- Artifacts: command-log, screenshot, console-log
- Pass criteria: command exits 0 across the browser test suite
- Required for done: yes
- Can be blocked: no
- Contract method: `bash ./test.sh`
- Contract artifact: command-log
- Contract environment: local shell with Chrome
- Safe probe: isolated test profile
- Live proof: command log
- Side effect: launches and kills local test Chrome profiles
- Sensitive data policy: no secrets
- Status: planned

### VP5. V5 - command

- Level: General
- Source: verification_matrix
- Test mode: delivery/CI
- Tool: verify-run
- Command: `bash -lc 'node ~/.codex/skills/prd-ship/scripts/prd_ship.js preflight --state .hoyeon/implement/cli-command-registry-refactor/state.json >/tmp/chromux-prd-ship-preflight.json && node ~/.codex/skills/prd-ship/scripts/prd_ship.js ship --state .hoyeon/implement/cli-command-registry-refactor/state.json --title "Refactor CLI command registry" >/tmp/chromux-prd-ship.json && gh pr diff prd/cli-command-registry-refactor --name-only >/tmp/chromux-pr-diff.txt && node ~/.codex/skills/prd-ship/scripts/prd_ship.js status --state .hoyeon/implement/cli-command-registry-refactor/state.json >/tmp/chromux-prd-ship-status.json'`
- Covers: R: R5; AC: AC5
- Artifacts: command-log, api-log
- Pass criteria: preflight stage plan contains only allowed implementation paths, PR URL exists, PR diff excludes unrelated local artifacts, and required GitHub CI checks pass; if CI cannot pass, final status must be `Blocked`, not `Done`
- Required for done: no
- Can be blocked: yes
- Contract method: `bash -lc 'node ~/.codex/skills/prd-ship/scripts/prd_ship.js preflight --state .hoyeon/implement/cli-command-registry-refactor/state.json >/tmp/chromux-prd-ship-preflight.json && node ~/.codex/skills/prd-ship/scripts/prd_ship.js ship --state .hoyeon/implement/cli-command-registry-refactor/state.json --title "Refactor CLI command registry" >/tmp/chromux-prd-ship.json && gh pr diff prd/cli-command-registry-refactor --name-only >/tmp/chromux-pr-diff.txt && node ~/.codex/skills/prd-ship/scripts/prd_ship.js status --state .hoyeon/implement/cli-command-registry-refactor/state.json >/tmp/chromux-prd-ship-status.json'`
- Contract artifact: command-log
- Contract environment: GitHub CLI authenticated repo
- Safe probe: PR branch and CI only
- Live proof: PR URL, PR diff path list, staged path list, and CI status
- Side effect: pushes branch and opens PR
- Sensitive data policy: writes `/tmp/chromux-prd-ship*.json` and `/tmp/chromux-pr-diff.txt`; no secrets in PR body or logs
- Status: planned

## Acceptance Coverage

- AC1: covered (VP1, VP2) - A future maintainer can inspect one command metadata area in `chromux.mjs` to understand which commands are profile-l...
- AC2: covered (VP1, VP2, VP4) - `runCli` no longer constructs an inline `Set` of tab commands for each invocation and uses shared command routing met...
- AC3: covered (VP1, VP2, VP4) - `node chromux.mjs help` still includes visible commands such as `wait-for-selector` and does not expose hidden compat...
- AC4: covered (VP2, VP3, VP4) - Local static checks, command metadata self-test or equivalent automated behavior check, full `./test.sh`, and `npm pa...
- AC5: covered (VP5) - The completed implementation state contains PR delivery mode, an intended branch, and allowlist staging constraints s...

## Gaps

- None
