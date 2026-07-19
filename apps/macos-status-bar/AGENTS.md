# macOS status bar app agent guide

This directory holds the native SwiftUI companion app for chromux: a
`MenuBarExtra` "cx" item plus a real `Window` main window, built as a
Swift Package Manager executable target. It is a pure REST client of the
local `chromux app` HTTP server; profile-management logic lives only in
`chromux.mjs`, never in Swift.

## Source layout

- `Package.swift` — SPM manifest (macOS 13 platform), three targets:
  `ChromuxStatusBarCore` (pure logic), `ChromuxStatusBar` (the SwiftUI app,
  depends on Core), `ChromuxStatusBarCoreTests` (Swift Testing, depends on
  Core).
- `Sources/ChromuxStatusBarCore/` — JSON models, profile sort/filter/search
  logic, byte formatting, delete-dialog name-truncation and result-summary
  formatting. No SwiftUI or networking imports here; this is what
  `ChromuxStatusBarCoreTests` exercises.
- `Sources/ChromuxStatusBar/` — the app: `ChromuxApp.swift` (`@main`),
  `AppDelegate.swift` (activation policy, window-close-stays-resident,
  Quit-stops-server), `AppModel.swift` (server lifecycle, polling,
  actions), `APIClient.swift`, `ServerProcess.swift`, and the SwiftUI views
  (`MenuBarContentView`, `MainWindowView`, `ProfileListView`,
  `ProfileDetailView`, `SettingsView`, `DesignTokens`).
- `Tests/ChromuxStatusBarCoreTests/` — Swift Testing (`import Testing`, not
  XCTest; this machine's Xcode Command Line Tools ship the Testing
  framework but not XCTest.framework).

## Design source of truth

Any visual work follows [status-app/DESIGN.md](../../status-app/DESIGN.md)
(the Linear design analysis): near-black canvas #010102, lavender-blue accent
#5e6ad2, hairline borders, SF Pro system type. `DesignTokens.swift` ports the
relevant color values so the native window reads as one continuous dark
surface with the rest of the chromux visual system.

- The `MenuBarExtra` dropdown stays a native macOS menu — do not recolor it;
  use system fonts, system separators, and SF Symbols.
- The main window is native SwiftUI, not a WebKit view; apply the design
  tokens to its background, text, and status-pill colors directly.
- Menu content should stay terse and scannable: short profile lines,
  monospace only for ports/counts where it aids alignment.

## Working rules

- Keep `ChromuxStatusBarCore` free of SwiftUI/AppKit/networking imports — it
  exists so profile sort/filter/formatting logic is unit-testable without a
  running server or a rendered window.
- The `MenuBarExtra` dropdown stays read-only (view + click-to-open-window):
  no kill/delete controls there, to avoid accidental destructive clicks on a
  frequently-reordering list. Destructive and mutating actions live only in
  the main window.
- The app talks only to the existing local `chromux app` HTTP REST API
  (`GET /api/state`, `POST /api/profiles/delete`,
  `POST /api/profiles/:name/action`); do not duplicate profile-management
  logic in Swift or add new backend endpoints from this folder.
- Do not add persistent background polling or a menu bar badge; polling in
  `AppModel` is gated by `markWindowVisible()`/`markWindowHidden()` so it
  only runs while the dropdown or main window is visible.
- Timeline, Raw log, and Lifecycle (retention/redact) are intentionally not
  reimplemented here; they stay on `status-app/`, reachable through a
  browser pointed at the local server's base URL.
- After UI-affecting changes, rebuild and smoke test:
  `./apps/macos-status-bar/build.sh && open apps/macos-status-bar/dist/chromux.app`.
- After logic changes in `ChromuxStatusBarCore`, run
  `swift test --package-path apps/macos-status-bar`.
- The app bundle copies `chromux.mjs` and `status-app/` into
  `Contents/Resources` at build time; changes to either require a rebuild to
  show up in the app (the native views themselves don't read `status-app/`
  directly, but the bundled server does, for the browser-based Timeline/Raw
  log/Lifecycle fallback).
- `install-app.sh` and `install-release-app.sh` quit any already-running
  `chromux.app` instance (matched by executable path, falling back to a
  forceful terminate after a short poll) before overwriting, so reinstalling
  never leaves two menu bar icons behind.
