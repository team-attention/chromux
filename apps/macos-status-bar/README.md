# chromux macOS app

This folder contains the native macOS companion app for chromux: a SwiftUI
`MenuBarExtra` "cx" item plus a real `Window` main window, so the app
appears in the Dock and Cmd+Tab switcher like a normal desktop app, not just
as a background accessory. It starts the local `chromux app` HTTP server and
talks to it as a plain REST client — no profile-management logic is
duplicated in Swift.

The core npm CLI stays zero-dependency. The app bundle copies `chromux.mjs`
and `status-app/` into `Contents/Resources` at build time and runs them with
the system `node` command.

The app requires Node.js >= 22 on the Mac. When launched from Finder, it resolves
Node from `CHROMUX_NODE`, common Homebrew/system paths, and then `PATH`.

## Architecture

The app is a Swift Package Manager executable target (`Package.swift`),
split into two targets:

- `ChromuxStatusBarCore` — pure logic with no UI or networking dependency:
  JSON models for the `chromux app` REST API, profile sort/filter/search
  (ported from `status-app/app.js`), byte formatting, and the delete-dialog
  name-truncation and result-summary formatting. Covered by
  `ChromuxStatusBarCoreTests` (Swift Testing).
- `ChromuxStatusBar` — the SwiftUI app: `MenuBarExtra` + `Window` +
  `Settings` under one `@main App`, the HTTP client, and the local server
  process supervisor.

The `MenuBarExtra` dropdown is intentionally read-only (profile name,
status, disk usage); it never exposes kill/delete controls, to avoid
accidental destructive clicks on a frequently-reordering list. Clicking a
profile row opens/focuses the main window. The main window provides the
full native profile list (search, status filter, active-first sort) and
detail (runtime facts, action buttons: Launch headed, Open foreground, Stop
daemon, Kill profile, multi-select bulk Delete with a native confirmation
dialog).

Timeline, Raw log, and Lifecycle (retention/redact) are not reimplemented
natively; they stay on the existing web dashboard (`status-app/`), reachable
by opening the server's base URL in a browser.

## Build

```bash
./apps/macos-status-bar/build.sh
open "apps/macos-status-bar/dist/chromux.app"
```

`build.sh` runs `swift build -c release` for the `ChromuxStatusBar` product,
then assembles the app bundle (binary, icon, `chromux.mjs`, `status-app/`,
`Info.plist`) under `apps/macos-status-bar/dist/`. Set
`CHROMUX_STATUS_APP_CONFIGURATION=debug` to build a debug binary instead.

You can also work on the Swift sources directly with the package tools:

```bash
swift build --package-path apps/macos-status-bar
swift test --package-path apps/macos-status-bar
```

## Install From Checkout

Build and install the app to `/Applications` so Spotlight and Launchpad can
find and launch it:

```bash
./apps/macos-status-bar/install-app.sh
```

The installer asks before building; pass `--yes` for non-interactive installs
and `--no-open` to skip launching the app afterwards. If a previous
`chromux.app` instance is running, the installer quits it first (falling
back to a forceful terminate if it does not exit within a few seconds) so
reinstalling never leaves two menu bar icons behind. If `/Applications` is
not writable, it falls back to `~/Applications/chromux.app`. Building
requires the Xcode Command Line Tools (`swift build`).

## App Icon

The bundle ships `assets/chromux.icns`, generated from
`assets/logo/chromux-app-icon.svg` at the repo root. Regenerate it after icon
changes (requires local Google Chrome for the SVG render):

```bash
./apps/macos-status-bar/make-icon.sh
```

## Release Package

Build a zipped app bundle for GitHub Releases from macOS:

```bash
./apps/macos-status-bar/package-release.sh
ls apps/macos-status-bar/release/
```

The package script creates `chromux-macos-<version>.zip` and a matching `.sha256`
file under `apps/macos-status-bar/release/`. The version defaults to
`package.json` and can be overridden with `CHROMUX_STATUS_APP_VERSION`.

To install the latest GitHub Release app on macOS:

```bash
./apps/macos-status-bar/install-release-app.sh
```

The installer asks before copying the app to `/Applications/chromux.app`.
Pass `--yes` for non-interactive installs. It quits a previously running
instance first, the same as `install-app.sh`. If `/Applications` is not
writable, it falls back to `~/Applications/chromux.app`.

The GitHub Actions workflow at
`.github/workflows/release-macos-status-app.yml` runs the same package script for
`v*` tags and manual dispatch. For tag runs, it uploads the zip and checksum to
the GitHub Release.

The app inherits `CHROMUX_HOME`, `CHROMUX_PROFILE`, and other environment values
from its launch environment when started from a shell. When launched from
Finder, it uses the normal default chromux home at `~/.chromux`.

The app does not install or update the global `chromux` CLI. Install the CLI
from a checkout when you want terminal or agent usage.

## Behavior

- Adds a `cx` item to the macOS status bar, and a normal app entry in the
  Dock and Cmd+Tab switcher (the app runs with the regular activation
  policy, not as a menu-bar-only accessory).
- Starts `chromux app --host 127.0.0.1 --port 0` at launch and keeps it
  running for the life of the app.
- The `cx` dropdown shows a read-only summary of active profiles (name,
  status, disk usage); clicking a row opens/focuses the main window. When
  the local server is unreachable, the dropdown shows a "Server not
  running" state with a Restart Server action.
- The main window provides a native profile list (search, active-first
  sort, status filter) and a detail pane per profile (runtime facts,
  activity facts, and action buttons: Launch headed, Open foreground, Stop
  daemon, Kill profile).
- Multi-select bulk Delete shows a native confirmation dialog listing up to
  6 profile names plus "and N more"; the result reports succeeded/failed
  counts by name, not a bare HTTP status.
- Closing the main window keeps the app resident (menu bar icon and local
  server keep running); Quit (from the dropdown, the app menu, or Cmd+Q)
  stops the local server before the app exits.
- The main window and dropdown auto-refresh (~7s) only while at least one is
  visible; there is no background polling or menu bar badge when both are
  closed.
- Provides a "Launch at Login" toggle (macOS 13+ `SMAppService`) in the
  `Settings` scene so the menu bar item is always present after login.

## Design

The native window reuses the color tokens from `status-app/DESIGN.md` (dark
canvas `#010102`, lavender-blue accent `#5e6ad2`) so it reads as one
continuous surface with the rest of the chromux visual system. UI work in
this folder and in `status-app/` must follow the AGENTS.md guides next to
those files.
