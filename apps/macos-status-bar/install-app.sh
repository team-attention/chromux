#!/usr/bin/env bash
# Build chromux.app from this checkout and install it to /Applications so
# Spotlight and Launchpad can find it. Falls back to ~/Applications when
# /Applications is not writable.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

YES=0
OPEN_APP=1

for arg in "$@"; do
  case "$arg" in
    --yes)
      YES=1
      ;;
    --no-open)
      OPEN_APP=0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

if [ "$(uname -s)" != "Darwin" ]; then
  echo "Skipping chromux macOS app install: this host is not macOS."
  exit 0
fi

if ! xcrun --find swiftc >/dev/null 2>&1; then
  echo "Cannot build chromux.app: swiftc is required (install the Xcode Command Line Tools)." >&2
  echo "Without them, use ./apps/macos-status-bar/install-release-app.sh instead." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Cannot build chromux.app: Node.js >= 22 is required." >&2
  exit 1
fi

if [ "$YES" -ne 1 ]; then
  if [ ! -t 0 ]; then
    echo "Skipping chromux macOS app install: non-interactive shell. Re-run with --yes to install."
    exit 0
  fi

  printf "Build and install the chromux macOS menu bar app to /Applications? [y/N] "
  read -r answer
  case "$answer" in
    y|Y|yes|YES)
      ;;
    *)
      echo "Skipping chromux macOS app install."
      exit 0
      ;;
  esac
fi

"$ROOT/apps/macos-status-bar/build.sh"

APP_SOURCE="$ROOT/apps/macos-status-bar/dist/chromux.app"

install_app() {
  local install_dir="$1"
  local target="$install_dir/chromux.app"

  mkdir -p "$install_dir"
  rm -rf "$target"
  ditto "$APP_SOURCE" "$target"
  printf '%s\n' "$target"
}

if TARGET_APP="$(install_app "/Applications" 2>/dev/null)"; then
  :
else
  TARGET_APP="$(install_app "$HOME/Applications")"
fi

# Register the fresh bundle with LaunchServices so Spotlight picks it up
# without waiting for a background rescan.
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
if [ -x "$LSREGISTER" ]; then
  "$LSREGISTER" -f "$TARGET_APP" || true
fi

echo "Installed $TARGET_APP"

if [ "$OPEN_APP" -eq 1 ]; then
  open "$TARGET_APP"
fi
