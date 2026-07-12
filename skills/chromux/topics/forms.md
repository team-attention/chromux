# chromux deep guide: forms and inputs

On-demand guide (`chromux skill forms`). The main skill stays small because
its text is paid as input on every agent turn; read this only when a form
task gets non-trivial.

## Whole forms: one call

`open` inlines small pages' interactive `@refs`; feed them straight into
form-flow — fill + submit + readiness + outcome text in one round-trip:

```bash
chromux run <s> --file snippets/_builtin/form-flow.js \
  --arg fields='{"@1":"Jane Doe","@2":"Team"}' --arg submit='@3' \
  --arg readyText='Thanks' --arg report='#status'
```

Fields inside same-origin iframes and open shadow DOM resolve like any other
selector. `report` returns the element's final text so the confirmation code
or error message rides back in the same response.

## Autocomplete / combobox: type then pick

The universal "type a few letters, wait for the popup, choose the matching
suggestion" pattern is one command:

```bash
chromux fill <s> @4 "par" --pick "Paris (CDG)"
```

The response's `picked` field is the label actually chosen (exact match wins
over prefix over substring). If no suggestion appears the command fails with
a hint — some widgets only react to key events; fall back to
`click` + `type` + `press ArrowDown` + `press Enter`.
For search flows that also submit and read results, see
`snippets/_builtin/search-and-pick.js`.

## Native selects vs custom dropdowns

`fill <s> @N "US"` on a native `<select>` matches an option by value or label
and fires `change` — never `type` into a select. A div styled as a combobox
is NOT a select: `click` it, then drive with arrow keys, or try `--pick`.

## Multi-step wizards

```bash
chromux run <s> --file snippets/_builtin/wizard-flow.js \
  --arg steps='[{"fields":{"#name":"Jane"},"next":"#to-2","waitText":"Step 2"},
                {"fields":{"#plan":"Team"},"next":"#finish","waitText":"Done"}]' \
  --arg report='#status'
```

Each step proves it advanced (`waitText`/`waitSelector`) before the next one
runs, so a failed transition stops the flow with a precise error.

## File inputs

```bash
chromux fill <s> @6 --file /tmp/report.pdf          # repeat --file for multiple
```

Sets the input through `DOM.setFileInputFiles` and dispatches input/change so
frameworks see it. Rich editors (contenteditable) are not value-fillable:
form-flow fails loudly on them — use `click` + `type`.

## Slow confirmations and double submits

Submitting with no immediate UI change is normal (server round-trips).
Action responses escalate internally (~2.2s) before reporting "no visible
change"; when you see that message, `wait-for-text <s> "confirmed" 10000`
BEFORE re-submitting — a second submit is usually a duplicate order.
