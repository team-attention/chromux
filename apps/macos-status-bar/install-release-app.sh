#!/usr/bin/env bash
set -euo pipefail

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

if [ "$YES" -ne 1 ]; then
  if [ ! -t 0 ]; then
    echo "Skipping chromux macOS app install: non-interactive shell. Re-run with --yes to install."
    exit 0
  fi

  printf "Install the chromux macOS menu bar app to /Applications? [y/N] "
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

if ! command -v node >/dev/null 2>&1; then
  echo "Cannot install chromux.app: Node.js >= 22 is required." >&2
  exit 1
fi

if ! command -v unzip >/dev/null 2>&1; then
  echo "Cannot install chromux.app: unzip is required." >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

ZIP_PATH="$TMP_DIR/chromux-macos.zip"

if ! CHROMUX_MAC_APP_ZIP="$ZIP_PATH" node --input-type=module <<'NODE'
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const outputPath = process.env.CHROMUX_MAC_APP_ZIP;
const headers = { 'User-Agent': 'chromux-install' };
const releaseUrl = 'https://api.github.com/repos/modakbul-gongbang/chromux/releases/latest';

const releaseResponse = await fetch(releaseUrl, { headers });
if (!releaseResponse.ok) {
  console.error(`No GitHub Release macOS app is available yet (${releaseResponse.status}).`);
  process.exit(10);
}

const release = await releaseResponse.json();
const assets = Array.isArray(release.assets) ? release.assets : [];
const asset = assets.find(({ name }) => /^chromux-macos-[^/]+\.zip$/.test(name))
  || assets.find(({ name }) => /^Chromux-Status-macos-[^/]+\.zip$/.test(name))
  || assets.find(({ name }) => /macos.*\.zip$/i.test(name));

if (!asset?.browser_download_url) {
  console.error(`No chromux macOS app zip was found on ${release.tag_name}.`);
  process.exit(11);
}

const zipResponse = await fetch(asset.browser_download_url, { headers });
if (!zipResponse.ok || !zipResponse.body) {
  console.error(`Failed to download ${asset.name} (${zipResponse.status}).`);
  process.exit(12);
}

await pipeline(Readable.fromWeb(zipResponse.body), createWriteStream(outputPath));
console.log(`Downloaded ${asset.name} from ${release.tag_name}.`);
NODE
then
  echo "Skipping chromux macOS app install."
  exit 0
fi

quit_running_instance() {
  local pattern="chromux.app/Contents/MacOS/chromux"
  if ! pgrep -f "$pattern" >/dev/null 2>&1; then
    return 0
  fi
  echo "Quitting the running chromux app before reinstalling..."
  osascript -e 'tell application id "com.teamattention.chromux" to quit' >/dev/null 2>&1 || true
  for _ in $(seq 1 20); do
    pgrep -f "$pattern" >/dev/null 2>&1 || return 0
    sleep 0.25
  done
  echo "chromux app did not quit gracefully; forcing termination." >&2
  pkill -9 -f "$pattern" 2>/dev/null || true
  sleep 0.5
}

quit_running_instance

unzip -q "$ZIP_PATH" -d "$TMP_DIR/unpacked"

APP_SOURCE="$(find "$TMP_DIR/unpacked" -maxdepth 3 -name 'chromux.app' -type d -print -quit)"
if [ -z "$APP_SOURCE" ]; then
  APP_SOURCE="$(find "$TMP_DIR/unpacked" -maxdepth 3 -name 'Chromux Status.app' -type d -print -quit)"
fi

if [ -z "$APP_SOURCE" ]; then
  echo "Downloaded release did not contain chromux.app." >&2
  exit 1
fi

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

echo "Installed $TARGET_APP"

if [ "$OPEN_APP" -eq 1 ]; then
  open "$TARGET_APP"
fi
