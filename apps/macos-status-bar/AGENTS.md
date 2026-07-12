# macOS status bar app agent guide

This directory holds the native AppKit wrapper (menu bar item + WebKit window)
for the chromux status dashboard. The dashboard UI itself lives in
`status-app/` and is loaded into the WKWebView.

## Design source of truth

Any visual work follows [status-app/DESIGN.md](../../status-app/DESIGN.md)
(the Linear design analysis): near-black canvas #010102, lavender-blue accent
#5e6ad2, hairline borders, SF Pro system type.

Apply it to the native layer as follows:

- The dashboard window must read as one continuous dark surface with the web
  content: set the window `backgroundColor` to the DESIGN.md canvas color and
  prefer a unified/dark titlebar appearance so no white flash or light chrome
  frames the dark page.
- The status bar item and its dropdown menu stay native macOS controls. Do not
  recolor NSMenu; use system fonts, system separators, and SF Symbols. The
  design system applies to the web dashboard, not to the OS menu chrome.
- Menu content should stay terse and scannable: short profile lines, monospace
  only for ports/counts where it aids alignment.

## Working rules

- Keep the wrapper thin: server lifecycle, menu, window. Dashboard features
  belong in `status-app/`, not in Swift.
- After UI-affecting changes, rebuild and smoke test:
  `./apps/macos-status-bar/build.sh && open apps/macos-status-bar/dist/chromux.app`.
- The app copies `chromux.mjs` and `status-app/` into the bundle at build
  time; changes to `status-app/` require a rebuild to show up in the app.
