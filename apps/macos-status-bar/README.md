# chromux macOS status bar app

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
open "apps/macos-status-bar/dist/Chromux Status.app"
```

## Release Package

Build a zipped app bundle for GitHub Releases from macOS:

```bash
./apps/macos-status-bar/package-release.sh
ls apps/macos-status-bar/release/
```

The package script creates `Chromux-Status-macos-<version>.zip` and a matching
`.sha256` file under `apps/macos-status-bar/release/`. The version defaults to
`package.json` and can be overridden with `CHROMUX_STATUS_APP_VERSION`.

The GitHub Actions workflow at
`.github/workflows/release-macos-status-app.yml` runs the same package script for
`v*` tags and manual dispatch. For tag runs, it uploads the zip and checksum to
the GitHub Release.

The app inherits `CHROMUX_HOME`, `CHROMUX_PROFILE`, and other environment values
from its launch environment when started from a shell. When launched from
Finder, it uses the normal default chromux home at `~/.chromux`.

## Behavior

- Adds a `cx` item to the macOS status bar.
- Starts `chromux app --host 127.0.0.1 --port 0`.
- Opens the local dashboard in a native WebKit window.
- Shows currently active profiles in the `cx` menu when it opens.
- Supports active-first sorting, filtering, bulk profile selection, and deletion
  through the dashboard.
- Provides menu items for opening the dashboard, opening the URL in a browser,
  restarting the local server, and quitting.
- Stops the local server process on quit.
