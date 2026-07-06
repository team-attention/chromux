# Verification

PRD: .hoyeon/prd/cli-command-registry-refactor/prd.md

## V1. General

- Status: pass
- Source: verification_matrix
- Check: Mode: build/static. Covers: R1-R4, AC1-AC3. Check: `node --check chromux.mjs && bash -n test.sh && node chromux.mjs help >/tmp/chromux-help.txt && grep -q "wait-for-selector" /tmp/chromux-help.txt && ! grep -q "^  chromux eval " /tmp/chromux-help.txt && ! grep -q "^  chromux scroll " /tmp/chromux-help.txt && ! grep -q "^  chromux wait " /tmp/chromux-help.txt && ! grep -q "^  chromux console " /tmp/chromux-help.txt && ! grep -q "^  chromux network " /tmp/chromux-help.txt && ! grep -q "^  chromux scroll-until " /tmp/chromux-help.txt`. Artifact: command-log. Pass: command exits 0, help exposes `wait-for-selector`, and hidden compatibility aliases are not listed as primary help entries. Environment: local shell. Required For Done: yes. Can Be Blocked: no. Safe Probe: local static/help only. Live Proof: command log. Side Effect: writes `/tmp/chromux-help.txt`. Sensitive Data Policy: no secrets.
- Evidence:
  - 2026-07-05T16:57:25.453Z: Artifact recorded: command-log .hoyeon/implement/cli-command-registry-refactor/artifacts/logs/V1-2026-07-05T16-57-25-445Z.log (30b9788e8b62) - verify-run passed: bash -lc 'node --check chromux.mjs && bash -n test.sh && node chromux.mjs help >/tmp/chromux-help.txt && grep -q "wait-for-selector" /tmp/chromux-help.txt && ! grep -q "^  chromux eval " /tmp/chromux-help.txt && ! grep -q "^  chromux scroll " /tmp/chromux-help.txt && ! grep -q "^  chromux wait " /tmp/chromux-help.txt && ! grep -q "^  chromux console " /tmp/chromux-help.txt && ! grep -q "^  chromux network " /tmp/chromux-help.txt && ! grep -q "^  chromux scroll-until " /tmp/chromux-help.txt'
  - 2026-07-05T16:57:25.454Z: Command passed with exit code 0: bash -lc 'node --check chromux.mjs && bash -n test.sh && node chromux.mjs help >/tmp/chromux-help.txt && grep -q "wait-for-selector" /tmp/chromux-help.txt && ! grep -q "^  chromux eval " /tmp/chromux-help.txt && ! grep -q "^  chromux scroll " /tmp/chromux-help.txt && ! grep -q "^  chromux wait " /tmp/chromux-help.txt && ! grep -q "^  chromux console " /tmp/chromux-help.txt && ! grep -q "^  chromux network " /tmp/chromux-help.txt && ! grep -q "^  chromux scroll-until " /tmp/chromux-help.txt'. Log: .hoyeon/implement/cli-command-registry-refactor/artifacts/logs/V1-2026-07-05T16-57-25-445Z.log
- Artifacts:
  - command-log: .hoyeon/implement/cli-command-registry-refactor/artifacts/logs/V1-2026-07-05T16-57-25-445Z.log (30b9788e8b62)

## V2. General

- Status: pass
- Source: verification_matrix
- Check: Mode: automated behavior. Covers: R1-R4, AC1-AC4. Check: `CHROMUX_HOME="$(mktemp -d /tmp/chromux-selftest-XXXXXX)" node chromux.mjs app --self-test >/tmp/chromux-selftest.txt && grep -q "command metadata registry invariants" /tmp/chromux-selftest.txt`. Artifact: command-log. Pass: command exits 0 and self-test visibly proves command metadata registry invariants, including no per-call inline tab-command `Set` in `runCli`. Environment: local shell. Required For Done: yes. Can Be Blocked: no. Safe Probe: isolated `CHROMUX_HOME`. Live Proof: command log. Side Effect: creates temporary local state and `/tmp/chromux-selftest.txt`. Sensitive Data Policy: no secrets.
- Evidence:
  - 2026-07-05T16:56:42.772Z: Artifact recorded: command-log .hoyeon/implement/cli-command-registry-refactor/artifacts/logs/V2-2026-07-05T16-56-42-763Z.log (e38794933741) - verify-run passed: bash -lc 'CHROMUX_HOME="$(mktemp -d /tmp/chromux-selftest-XXXXXX)" node chromux.mjs app --self-test >/tmp/chromux-selftest.txt && grep -q "command metadata registry invariants" /tmp/chromux-selftest.txt'
  - 2026-07-05T16:56:42.773Z: Command passed with exit code 0: bash -lc 'CHROMUX_HOME="$(mktemp -d /tmp/chromux-selftest-XXXXXX)" node chromux.mjs app --self-test >/tmp/chromux-selftest.txt && grep -q "command metadata registry invariants" /tmp/chromux-selftest.txt'. Log: .hoyeon/implement/cli-command-registry-refactor/artifacts/logs/V2-2026-07-05T16-56-42-763Z.log
- Artifacts:
  - command-log: .hoyeon/implement/cli-command-registry-refactor/artifacts/logs/V2-2026-07-05T16-56-42-763Z.log (e38794933741)

## V3. General

- Status: pass
- Source: verification_matrix
- Check: Mode: build/static. Covers: R4, AC4. Check: `npm pack --dry-run`. Artifact: command-log. Pass: command exits 0 and package allowlist remains valid. Environment: local shell. Required For Done: yes. Can Be Blocked: no. Safe Probe: package dry-run only. Live Proof: command log. Side Effect: creates no publish. Sensitive Data Policy: no secrets.
- Evidence:
  - 2026-07-05T16:57:27.412Z: Artifact recorded: command-log .hoyeon/implement/cli-command-registry-refactor/artifacts/logs/V3-2026-07-05T16-57-27-404Z.log (bdc4f9a41b0a) - verify-run passed: npm pack --dry-run
  - 2026-07-05T16:57:27.413Z: Command passed with exit code 0: npm pack --dry-run. Log: .hoyeon/implement/cli-command-registry-refactor/artifacts/logs/V3-2026-07-05T16-57-27-404Z.log
- Artifacts:
  - command-log: .hoyeon/implement/cli-command-registry-refactor/artifacts/logs/V3-2026-07-05T16-57-27-404Z.log (bdc4f9a41b0a)

## V4. General

- Status: pass
- Source: verification_matrix
- Check: Mode: browser/runtime. Covers: R2-R4, AC2-AC4. Check: `bash ./test.sh`. Artifact: command-log. Pass: command exits 0 across the browser test suite. Environment: local shell with Chrome. Required For Done: yes. Can Be Blocked: no. Safe Probe: isolated test profile. Live Proof: command log. Side Effect: launches and kills local test Chrome profiles. Sensitive Data Policy: no secrets.
- Evidence:
  - 2026-07-05T17:34:44.961Z: Artifact recorded: command-log .hoyeon/implement/cli-command-registry-refactor/artifacts/logs/V4-2026-07-05T17-34-44-959Z.log (aa65ef1faefc) - verify-run passed: bash ./test.sh
  - 2026-07-05T17:34:44.961Z: Command passed with exit code 0: bash ./test.sh. Log: .hoyeon/implement/cli-command-registry-refactor/artifacts/logs/V4-2026-07-05T17-34-44-959Z.log
- Artifacts:
  - command-log: .hoyeon/implement/cli-command-registry-refactor/artifacts/logs/V4-2026-07-05T17-34-44-959Z.log (aa65ef1faefc)

## V5. General

- Status: blocked
- Source: verification_matrix
- Check: Mode: delivery/CI. Covers: R5, AC5. Check: `bash -lc 'node ~/.codex/skills/prd-ship/scripts/prd_ship.js preflight --state .hoyeon/implement/cli-command-registry-refactor/state.json >/tmp/chromux-prd-ship-preflight.json && node ~/.codex/skills/prd-ship/scripts/prd_ship.js ship --state .hoyeon/implement/cli-command-registry-refactor/state.json --title "Refactor CLI command registry" >/tmp/chromux-prd-ship.json && gh pr diff prd/cli-command-registry-refactor --name-only >/tmp/chromux-pr-diff.txt && node ~/.codex/skills/prd-ship/scripts/prd_ship.js status --state .hoyeon/implement/cli-command-registry-refactor/state.json >/tmp/chromux-prd-ship-status.json'`. Artifact: command-log. Pass: preflight stage plan contains only allowed implementation paths, PR URL exists, PR diff excludes unrelated local artifacts, and required GitHub CI checks pass; if CI cannot pass, final status must be `Blocked`, not `Done`. Environment: GitHub CLI authenticated repo. Required For Done: no. Can Be Blocked: yes. Safe Probe: PR branch and CI only. Live Proof: PR URL, PR diff path list, staged path list, and CI status. Side Effect: pushes branch and opens PR. Sensitive Data Policy: writes `/tmp/chromux-prd-ship*.json` and `/tmp/chromux-pr-diff.txt`; no secrets in PR body or logs.
- Evidence:
  - 2026-07-05T17:38:08.584Z: Post-receipt delivery gate: prd-ship creates the PR and watches CI only after finalize emits the implementation receipt, so V5 is intentionally deferred from implementation finalization.
  - 2026-07-05T17:44:55.623Z: Post-receipt delivery gate remains blocked until finalize emits receipt; staging constraints are now explicit in state/config, and prd-ship preflight will prove the staged path set after receipt.
