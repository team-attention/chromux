# chromux deep guide: recovery and human handoff

On-demand guide (`chromux skill recovery`). Read when a flow is stuck,
ambiguous, or blocked on something only a human can do.

## Stale refs after a re-render

SPAs re-render and `@refs` go stale (`Element not found`). Do not guess CSS —
click by what a human sees:

```bash
chromux click <s> --text "로그인"
```

Exact label match wins; if several elements share the text the error lists
the candidates. Re-snapshot (`--diff`) when more than one action follows.

## Dialogs (alert/confirm/prompt)

Dialogs are auto-handled per session policy (default: dismiss; `beforeunload`
always accepted) and reported in the acting response's `dialog` field with
the dialog's message. If the flow NEEDS acceptance
(`confirm("Delete item?")` → OK), reopen with the policy and redo the action:

```bash
chromux open <s> <url> --dialog accept
```

## Popups / new tabs

A click that opens a new tab reports `newSession` — continue in that session
instead of hunting for changes on the old tab. If a popup was opened by page
JS outside click/press (rare), `chromux list` still shows only adopted
sessions; re-click the trigger if you missed it.

## "No visible change" after an action

The action was dispatched; the page may be slow, or the result may be in a
dialog/new tab (both are reported when detected). Escalate in this order:
`wait-for-text` for the expected outcome → `snapshot --diff` → `watch <s>
console` / `watch <s> network` for silent failures. Never blindly repeat a
submit-like action.

## Human handoff: login, 2FA, CAPTCHA, payment

Credential walls are user-owned. The formal handoff loop — the profile is a
real persistent Chrome profile, so one human login persists across sessions:

```bash
# 1. Hard-stop agent work so nothing races the human
CHROMUX_PROFILE=<p> chromux pause
# 2. Put the blocked page in front of the user (profile must be HEADED)
CHROMUX_PROFILE=<p> chromux open --foreground handoff-<slug> <login-url>
# 3. Tell the user what to do and that you will not touch credentials
# 4. Wait for a signal only a logged-in page shows
CHROMUX_PROFILE=<p> chromux wait-for-selector handoff-<slug> "<authed-only-selector>" 300000
# 5. Resume and re-drive the interrupted flow FROM THE START
CHROMUX_PROFILE=<p> chromux resume
```

Redirects usually discard form/modal state, so after the handoff re-open the
modal, re-fill, re-submit; do not resume mid-flow. If the profile is
headless, relaunch headed first (`chromux kill <p> && chromux launch <p>`).
The same loop covers 2FA prompts, CAPTCHA walls, and payment confirmation
screens — anything where the human acts, then the agent resumes unattended.
