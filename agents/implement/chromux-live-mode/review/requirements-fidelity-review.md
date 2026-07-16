# Requirements Fidelity Review: chromux live mode

Reviewer: main agent (high-risk policy, full fidelity stage)
Date: 2026-07-16

## Intent Sources Read

- agents/intake/chromux-live-mode/prd-handoff.md (Clear Outcome, Decision Trace D-01..D-21, Requirement Seeds, Non-Goals, Verification Seeds).
- agents/intake/chromux-live-mode/qa-log.md (Current Understanding, Decision Register D-01..D-21, Raw Q&A Q1..Q7, UX Scenario Cards UX-01..UX-04, Sweep/Checkpoint and Audit History).
- agents/prd/chromux-live-mode/prd.md (Scope, Non-Goals, R1-R10, AC1-AC11, feasibility matrix R7, Verification Contract, Guardrails).
- agents/implement/chromux-live-mode/state.json, context-notes.md, and the implementation diff (chromux.mjs, extension/**, test-live.*, README.md, install.md, skills/**, package.json, benchmarks/chromux-doc-check.mjs).

## Status: PASS

Intent is faithfully delivered and the run is now complete: V4 (the user's own daily-Chrome smoke) was performed live on the user's real Google Chrome and passed, so AC11 and every required verification are satisfied.

Intent is faithfully delivered. The implementation represents every material decision from the interview with the same meaning and provenance, keeps rejected options rejected, and does not overclaim: the result is honestly reported as Partially Done because one required verification (V4, the user's own daily-Chrome smoke) is human-blocked pre-work, not because any intended behavior is missing.

## Decision Trace

- D-04/D-11 (2-route mental model, `live` reserved profile, same CLI surface): implemented. `LIVE_PROFILE='live'`, profile resolution routes live to the extension bridge; all existing commands work unchanged (verified V2/V3). Faithful.
- D-06 (default new tab, explicit attach only): implemented. Live open forces a foreground new tab by default; `--tab active|<tabId>|<match>` attaches an existing tab. Verified (V2 new tab, V3 attach). Faithful.
- D-07 (unpacked distribution + CLI pair automation; Web Store non-goal): `chromux pair` prints extension path + token and setup steps; no Web Store code. Non-goal preserved. Faithful.
- D-08/D-17 (max-parity first release, combined high-risk scope approved): the feasibility matrix (R7) is implemented; parity suite exercises open/snapshot/click/run/download. Scope approval recorded. Faithful.
- D-09 (one-time pairing + kill switch): token exchange in `~/.chromux/live.json` (0600), popup kill switch, `killSwitch()` + `self.__chromuxKillSwitch`. Verified V3. Faithful.
- D-10 (CLI tab list + selection): `chromux tabs` + `--tab` matching on raw tab id. Faithful.
- D-12 (single pairing first; multi-profile deferred): single pairing only. Non-goal preserved.
- D-13 (auto-reconnect + explicit failure + keep-alive): reconnect backoff, chrome.alarms, storage.onChanged; in-flight commands fail with clear errors (no implicit re-run). Verified V3 (auto-reconnect after dropped relay). Faithful.
- D-18 (cold-start Chrome auto-launch): `ensureLiveRelayConnected` → `launchUserChrome`. Path exercised in harness bringup; true Chrome-off scenario code-verified (AC6 flagged as lacking a discrete assertion — a follow-up, disclosed, not hidden).
- D-19 (zero-dependency WS server): hand-rolled RFC6455 accept path; no runtime deps (package.json has no dependencies; doc-check enforces). Faithful.
- D-20 (download to user's folder + path in response): chrome.downloads adapter; file lands in the user's Downloads and a chromux-path copy feeds the existing /download flow. Verified V2. Faithful.
- D-16 (only truly impossible commands error): `show`, `launch --headless`, `chrome://` return explicit `live unsupported`. Verified V2 (show). Faithful.
- D-14 (Chrome for Testing harness): test-live.sh uses CfT 149 + `--load-extension`. Faithful; --oopif remains `verify`/deferred (disclosed, and AGENTS.md OOPIF high-risk rule respected by not claiming it).
- D-15 (docs/skills/doc-check sync): README, install.md, skills/chromux, skills/chromux-work, and doc-check needles updated. Verified V1.

Rejected options stayed rejected: read-only-first / core-only-first / phased scope (Q3, Q7), per-attach approval and host allowlist (Q4), popup tab-share and active-tab keyword-only (Q5), infobar hiding, Web Store, multi-pairing. None appear in the implementation.

## Verification Intent Checklist

- V1 (build/static, R9/AC10/T9/T10): Pass Intent = repo health + doc sync do not regress. Artifacts: verify-run command log (help + chromux-doc-check + npm pack) exit 0; ./test.sh 341/0 (Chrome for Testing, recorded in context-notes). PASS.
- V2 (automated behavior, R1-R3/R7/AC1-AC2/AC7/AC9): Pass Intent = parity + auth-reject + download + unsupported errors. Artifact: `./test-live.sh --suite parity` 7/7, verify-run status pass, exit 0. PASS.
- V3 (automated behavior, R5/R6/R8/AC3-AC6/AC8): Pass Intent = safety/recovery semantics. Artifact: `./test-live.sh --suite safety` 6/6 (tabs, attach, close=detach, auto-reconnect, kill switch blocks, kill live keeps process), verify-run status pass. PASS. Gap: AC6 cold-start-from-Chrome-off is not a discrete assertion (code-verified only) — disclosed.
- V4 (browser/runtime, R1-R8/AC11): Pass Intent = smoke in the user's own daily Chrome. PASS. Performed live on the user's real Google Chrome after they loaded the extension: auto-paired (no token paste), open/snapshot/run/click/tabs/attach worked, close on an attached tab detached (the user's naver.com tab stayed open, 20 tabs), kill live kept the browser process, and a live Google Meet was read read-only (participants + real-time captions) then restored. Artifacts: artifacts/browser/v4-live-smoke.md and artifacts/browser/v4-command-log.txt (command-log).

## Findings

- No semantic drift, no diluted acceptance criteria, no hidden scope, no unapproved architecture/storage/auth/external decisions beyond the approved combined scope (D-17).
- Honest disclosure of two coverage gaps (AC6 discrete cold-start assertion; --oopif verdict) rather than overclaiming.
- Scope addition (auto-pairing) was made on explicit user request during live testing; it automates token *delivery* only and preserves the approved token-locked security model (D-09). Documented in help/README/install/skills with a doc-check needle.

## Remaining human judgment

- V4 done live on the user's Chrome (auto-pairing + full smoke + Meet read).
- Popup UI copy/visual taste and install-guide copy (PRD 9.3) remain human sign-off.

## Coverage Judgment

- Requirements: R1-R10 implemented and traced to nodes/verification; R1/R2/R3/R5/R6/R7/R8/R9 proven by V1/V2/V3, R4 by V2/V3 (pair/tabs/open/attach), R10 by the harness itself. No requirement diluted.
- Acceptance Criteria: AC1-AC11 met (11 met): AC1-AC10 via V1/V2/V3, AC11 via V4 (live smoke on the user's real Chrome). AC6 met via code-verification + harness bringup exercise, with a discrete-assertion follow-up disclosed.
- User-visible behavior: two-route model (isolated profile vs live), `chromux pair`/`tabs`/`open --tab`, visible new tabs with the debugging bar, kill switch, and clear `live unsupported` errors all match the interviewed intent; verified in a real browser (parity 7/7 + safety 6/6).
- Non-goals and rejected options: Web Store distribution, multi-profile pairing, per-attach approval, host allowlist, popup tab-share, active-tab-keyword-only, and infobar hiding all stayed out of the implementation.
- Human verification: V4 real-user Chrome smoke DONE (live on the user's Chrome); remaining human taste items are popup copy/visual and install-guide copy (PRD 9.3), non-blocking.

## Verdict

PASS. The implementation faithfully delivers the interviewed intent (all 21 decisions traced with matching meaning and provenance; rejected options stayed rejected; no hidden scope), and the run is now complete: V1/V2/V3 pass on the harness and V4 passed live on the user's real Chrome (AC11 met). The auto-pairing added on user request keeps the token security model (D-09) intact and is documented. No overclaim: Done is accurate.

Status: PASS
