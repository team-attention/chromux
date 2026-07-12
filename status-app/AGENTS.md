# status-app agent guide

This directory is the chromux status dashboard UI (plain HTML/CSS/JS, served by
`chromux app` and wrapped by the macOS app in `apps/macos-status-bar/`).

## Design source of truth

All UI work in this directory MUST follow [DESIGN.md](./DESIGN.md) (the Linear
design analysis). Read it before changing any markup or styles.

Non-negotiables when styling this app:

- Dark canvas only. Page background is `{colors.canvas}` #010102; never ship a
  light theme here.
- Hierarchy comes from the four-step surface ladder (canvas -> surface-1 ->
  surface-2 -> surface-3 -> surface-4) plus 1px hairline borders. No drop
  shadows, no gradients, no spotlight effects.
- One chromatic accent: lavender-blue `{colors.primary}` #5e6ad2, used only for
  the brand mark, primary CTA, focus rings, and link emphasis. Never as a
  panel fill or section background.
- Typography follows the DESIGN.md scale exactly (sizes, weights, negative
  tracking on display sizes). System stack: SF Pro Display / -apple-system for
  display and body, ui-monospace for mono tokens (ports, session ids, URLs).
- Radii: 8px buttons/inputs, 12px cards, 16px only for the largest framed
  panels, pill only for status badges and tab toggles. Never pill-round
  buttons.
- Spacing on the 4px base scale from DESIGN.md tokens; no ad hoc values.

## Product-UI deviations (allowed, keep scarce)

DESIGN.md documents a marketing canvas. This is a product dashboard, so:

- Status semantics may use `{colors.semantic-success}` #27a644 for
  running/healthy. Error/failed and stale/locked states may use desaturated
  red/amber, styled as `status-badge` pills only, never as large fills.
- Data-dense rows (tables, timelines) may drop to 13px/12px per the body-sm
  and caption tokens.

## Implementation rules

- Define every DESIGN.md color/spacing/radius token as a CSS custom property
  in `styles.css` `:root` and reference tokens, not literals, everywhere.
- Keep it zero-dependency: no frameworks, no external fonts, no CDN assets.
  The system font stack is the correct substitute for the Linear families.
- Dynamic class names generated in `app.js` (e.g. pill status classes) must
  keep matching the CSS; check `app.js` before renaming any class.
- Verify visually against a running instance (`node chromux.mjs app`) after
  style changes; the WebKit window in the macOS app renders the same pages.
