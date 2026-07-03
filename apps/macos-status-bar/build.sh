#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APP_DIR="$ROOT/apps/macos-status-bar/dist/Chromux Status.app"
CONTENTS="$APP_DIR/Contents"
MACOS="$CONTENTS/MacOS"
RESOURCES="$CONTENTS/Resources"
VERSION="${CHROMUX_STATUS_APP_VERSION:-$(PACKAGE_JSON="$ROOT/package.json" node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.env.PACKAGE_JSON, 'utf8')).version)")}"
BUILD_NUMBER="${CHROMUX_STATUS_APP_BUILD:-1}"

rm -rf "$APP_DIR"
mkdir -p "$MACOS" "$RESOURCES/status-app"

swiftc \
  "$ROOT/apps/macos-status-bar/src/ChromuxStatusBar/main.swift" \
  -o "$MACOS/Chromux Status" \
  -framework AppKit \
  -framework WebKit

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
  <string>Chromux Status</string>
  <key>CFBundleIdentifier</key>
  <string>com.teamattention.chromux.status</string>
  <key>CFBundleName</key>
  <string>Chromux Status</string>
  <key>CFBundleDisplayName</key>
  <string>Chromux Status</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>$VERSION</string>
  <key>CFBundleVersion</key>
  <string>$BUILD_NUMBER</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>LSUIElement</key>
  <true/>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
PLIST

echo "Built $APP_DIR"
