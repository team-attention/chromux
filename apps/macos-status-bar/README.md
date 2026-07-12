# chromux macOS app

This folder contains the native macOS companion wrapper for the chromux status
dashboard. It builds a small AppKit status bar app that starts the local
`chromux app` HTTP server, shows a `cx` menu bar item, and opens the dashboard in
a native window.

The core npm CLI stays zero-dependency. The app bundle copies `chromux.mjs` and
`status-app/` into `Contents/Resources` at build time and runs them with the
system `node` command.

The app requires Node.js >= 22 on the Mac. When launched from Finder, it resolves
Node from `CHROMUX_NODE`, common Homebrew/system paths, and then `PATH`.

## Build

```bash
./apps/macos-status-bar/build.sh
open "apps/macos-status-bar/dist/chromux.app"
```

## Install From Checkout

Build and install the app to `/Applications` so Spotlight and Launchpad can
find and launch it:

```bash
./apps/macos-status-bar/install-app.sh
```

The installer asks before building; pass `--yes` for non-interactive installs
and `--no-open` to skip launching the app afterwards. If `/Applications` is not
writable, it falls back to `~/Applications/chromux.app`. Building requires the
Xcode Command Line Tools (`swiftc`).

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
Pass `--yes` for non-interactive installs. If `/Applications` is not writable,
it falls back to `~/Applications/chromux.app`.

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

- Adds a `cx` item to the macOS status bar.
- Starts `chromux app --host 127.0.0.1 --port 0`.
- Opens the local dashboard in a native WebKit window with dark chrome
  (window background and titlebar match the dashboard canvas color).
- Shows currently active profiles in the `cx` menu when it opens, including
  each profile's disk usage; clicking an active profile entry opens the
  dashboard window.
- Supports active-first sorting, search, status filtering, per-profile disk
  usage, bulk profile selection, and deletion through the dashboard. Bulk
  actions appear only while at least one profile is selected.
- Provides menu items for opening the dashboard, opening the URL in a browser,
  restarting the local server, and quitting.
- Provides a "Launch at Login" toggle (macOS 13+ `SMAppService`) so the menu
  bar item is always present after login.
- Stops the local server process on quit.

## Design

The dashboard UI in `status-app/` follows `status-app/DESIGN.md` (dark token
system). UI work in this folder and in `status-app/` must follow the AGENTS.md
guides next to those files.

For window-chrome QA without the OS Screen Recording permission, run the app
binary with `CHROMUX_STATUS_WINDOW_SNAPSHOT=<path-prefix>`; after the dashboard
loads it writes `<prefix>-chrome.png` (window frame including titlebar) and
`<prefix>-content.png` (rendered dashboard).
