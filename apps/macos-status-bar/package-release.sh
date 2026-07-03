#!/usr/bin/env bash
set -euo pipefail

if [ "$(uname -s)" != "Darwin" ]; then
  echo "The macOS status app release package must be built on macOS." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APP_NAME="Chromux Status"
VERSION="${CHROMUX_STATUS_APP_VERSION:-$(PACKAGE_JSON="$ROOT/package.json" node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.env.PACKAGE_JSON, 'utf8')).version)")}"
DIST_DIR="$ROOT/apps/macos-status-bar/dist"
RELEASE_DIR="$ROOT/apps/macos-status-bar/release"
APP_DIR="$DIST_DIR/$APP_NAME.app"
ZIP_PATH="$RELEASE_DIR/Chromux-Status-macos-$VERSION.zip"
SHA_PATH="$ZIP_PATH.sha256"

"$ROOT/apps/macos-status-bar/build.sh"

rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"

if [ ! -d "$APP_DIR" ]; then
  echo "Expected app bundle was not built: $APP_DIR" >&2
  exit 1
fi

(
  cd "$DIST_DIR"
  ditto -c -k --keepParent --norsrc --noextattr "$APP_NAME.app" "$ZIP_PATH"
)

(
  cd "$RELEASE_DIR"
  shasum -a 256 "$(basename "$ZIP_PATH")" | tee "$(basename "$SHA_PATH")"
)
echo "Built $ZIP_PATH"
