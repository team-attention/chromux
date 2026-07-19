#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PKG_DIR="$ROOT/apps/macos-status-bar"
APP_NAME="chromux"
APP_DIR="$PKG_DIR/dist/$APP_NAME.app"
LEGACY_APP_DIR="$PKG_DIR/dist/Chromux Status.app"
CONTENTS="$APP_DIR/Contents"
MACOS="$CONTENTS/MacOS"
RESOURCES="$CONTENTS/Resources"
VERSION="${CHROMUX_STATUS_APP_VERSION:-$(PACKAGE_JSON="$ROOT/package.json" node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.env.PACKAGE_JSON, 'utf8')).version)")}"
BUILD_NUMBER="${CHROMUX_STATUS_APP_BUILD:-1}"
CONFIGURATION="${CHROMUX_STATUS_APP_CONFIGURATION:-release}"

rm -rf "$APP_DIR" "$LEGACY_APP_DIR"
mkdir -p "$MACOS" "$RESOURCES/status-app"

swift build --package-path "$PKG_DIR" -c "$CONFIGURATION" --product ChromuxStatusBar
BIN_PATH="$(swift build --package-path "$PKG_DIR" -c "$CONFIGURATION" --show-bin-path)/ChromuxStatusBar"

cp "$BIN_PATH" "$MACOS/$APP_NAME"

cp "$PKG_DIR/assets/chromux.icns" "$RESOURCES/chromux.icns"
cp "$ROOT/chromux.mjs" "$RESOURCES/chromux.mjs"
cp "$ROOT/status-app/index.html" "$RESOURCES/status-app/index.html"
cp "$ROOT/status-app/app.js" "$RESOURCES/status-app/app.js"
cp "$ROOT/status-app/styles.css" "$RESOURCES/status-app/styles.css"

cat > "$CONTENTS/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>$APP_NAME</string>
  <key>CFBundleIdentifier</key>
  <string>com.teamattention.chromux</string>
  <key>CFBundleName</key>
  <string>$APP_NAME</string>
  <key>CFBundleDisplayName</key>
  <string>$APP_NAME</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleIconFile</key>
  <string>chromux</string>
  <key>CFBundleShortVersionString</key>
  <string>$VERSION</string>
  <key>CFBundleVersion</key>
  <string>$BUILD_NUMBER</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>LSUIElement</key>
  <false/>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
PLIST

echo "Built $APP_DIR"
