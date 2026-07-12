#!/usr/bin/env bash
# Regenerate apps/macos-status-bar/assets/chromux.icns from
# assets/logo/chromux-app-icon.svg. Requires macOS (sips, iconutil) and a
# local Google Chrome/Chromium for the SVG render. The generated .icns is
# committed so build.sh does not need Chrome.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SVG="$ROOT/assets/logo/chromux-app-icon.svg"
OUT_DIR="$ROOT/apps/macos-status-bar/assets"
ICNS="$OUT_DIR/chromux.icns"

CHROME="${CHROMUX_ICON_CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
if [ ! -x "$CHROME" ]; then
  echo "Chrome not found at $CHROME (set CHROMUX_ICON_CHROME)." >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

BASE_PNG="$TMP_DIR/chromux-1024.png"
"$CHROME" \
  --headless=new \
  --disable-gpu \
  --default-background-color=00000000 \
  --window-size=1024,1024 \
  --screenshot="$BASE_PNG" \
  "file://$SVG" >/dev/null 2>&1

ICONSET="$TMP_DIR/chromux.iconset"
mkdir -p "$ICONSET"

render() {
  local size="$1" name="$2"
  sips -z "$size" "$size" "$BASE_PNG" --out "$ICONSET/$name" >/dev/null
}

render 16 icon_16x16.png
render 32 icon_16x16@2x.png
render 32 icon_32x32.png
render 64 icon_32x32@2x.png
render 128 icon_128x128.png
render 256 icon_128x128@2x.png
render 256 icon_256x256.png
render 512 icon_256x256@2x.png
render 512 icon_512x512.png
cp "$BASE_PNG" "$ICONSET/icon_512x512@2x.png"

mkdir -p "$OUT_DIR"
iconutil -c icns "$ICONSET" -o "$ICNS"
echo "Wrote $ICNS"
