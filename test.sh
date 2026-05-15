#!/bin/bash
set -e

CT="$(dirname "$0")/chromux.mjs"
PROFILE="test-$$"
HIDDEN_PROFILE="$PROFILE-hidden"
PASS=0
FAIL=0

check() {
  local desc="$1" expected="$2" actual="$3"
  if echo "$actual" | grep -q "$expected"; then
    echo "  ✓ $desc"
    PASS=$((PASS+1))
  else
    echo "  ✗ $desc (expected '$expected', got: $actual)"
    FAIL=$((FAIL+1))
  fi
}

cleanup() {
  echo ""
  echo "--- Cleanup ---"
  node "$CT" kill "$PROFILE" 2>/dev/null || true
  node "$CT" kill "$HIDDEN_PROFILE" 2>/dev/null || true
  chmod -R u+rwX "$HOME/.chromux/profiles/$PROFILE" 2>/dev/null || true
  chmod -R u+rwX "$HOME/.chromux/profiles/$HIDDEN_PROFILE" 2>/dev/null || true
  rm -rf "$HOME/.chromux/profiles/$PROFILE"
  rm -rf "$HOME/.chromux/profiles/$HIDDEN_PROFILE"
  echo "  ✓ cleaned up profile $PROFILE"
}
trap cleanup EXIT

echo "=== chromux test suite ==="
echo "profile: $PROFILE"
echo ""

# --- Test 1: Launch ---
echo "--- Test 1: Launch profile ---"
R1=$(node "$CT" launch "$PROFILE" 2>/dev/null)
check "profile launched" "port" "$R1"
check "profile name" "$PROFILE" "$R1"

# --- Test 1b: Hidden headed launch ---
echo ""
echo "--- Test 1b: Hidden headed launch ---"
RH=$(node "$CT" launch "$HIDDEN_PROFILE" --hidden 2>/dev/null)
check "hidden launch mode" '"launchMode": "hidden"' "$RH"
check "hidden launch is headed" '"headless": false' "$RH"
check "hidden flag present" '"hidden": true' "$RH"
node "$CT" kill "$HIDDEN_PROFILE" 2>/dev/null > /dev/null || true

RH_AUTO=$(CHROMUX_PROFILE="$HIDDEN_PROFILE" CHROMUX_LAUNCH_MODE=hidden node "$CT" open hidden-auto https://example.com 2>/dev/null)
check "hidden auto-launch opens tab" "example.com" "$RH_AUTO"
HIDDEN_STATE=$(cat "$HOME/.chromux/profiles/$HIDDEN_PROFILE/.state")
check "hidden auto-launch state" '"launchMode": "hidden"' "$HIDDEN_STATE"
node "$CT" kill "$HIDDEN_PROFILE" 2>/dev/null > /dev/null || true

# --- Test 2: PS ---
echo ""
echo "--- Test 2: PS ---"
PS=$(node "$CT" ps 2>/dev/null)
check "ps shows profile" "$PROFILE" "$PS"
check "ps shows running" "running" "$PS"

# --- Test 2b: Missing .state adoption ---
echo ""
echo "--- Test 2b: Missing .state adoption ---"
STATE="$HOME/.chromux/profiles/$PROFILE/.state"
rm -f "$STATE"
PS_ADOPT=$(node "$CT" ps 2>/dev/null)
check "ps adopts profile without .state" "$PROFILE" "$PS_ADOPT"
check "ps adopted profile as running" "running" "$PS_ADOPT"
if [ -f "$STATE" ]; then
  echo "  ✓ .state cache restored"
  PASS=$((PASS+1))
else
  echo "  ✗ .state cache not restored"
  FAIL=$((FAIL+1))
fi

# --- Test 3: Open tabs ---
echo ""
echo "--- Test 3: Open tabs ---"
R3A=$(CHROMUX_PROFILE=$PROFILE node "$CT" open tab-a https://httpbin.org/user-agent 2>/dev/null)
check "tab-a opened" "httpbin.org/user-agent" "$R3A"

R3B=$(CHROMUX_PROFILE=$PROFILE node "$CT" open tab-b https://httpbin.org/ip 2>/dev/null)
check "tab-b opened" "httpbin.org/ip" "$R3B"

# --- Test 4: Isolation ---
echo ""
echo "--- Test 4: Tab isolation ---"
URL_A=$(CHROMUX_PROFILE=$PROFILE node "$CT" eval tab-a "location.href" 2>/dev/null)
URL_B=$(CHROMUX_PROFILE=$PROFILE node "$CT" eval tab-b "location.href" 2>/dev/null)
check "tab-a URL correct" "user-agent" "$URL_A"
check "tab-b URL correct" "/ip" "$URL_B"

# --- Test 5: Real Chrome ---
echo ""
echo "--- Test 5: Real Chrome ---"
UA=$(CHROMUX_PROFILE=$PROFILE node "$CT" eval tab-a "navigator.userAgent" 2>/dev/null)
check "Chrome UA present" "Chrome/" "$UA"
if echo "$UA" | grep -q "HeadlessChrome"; then
  echo "  ✗ HeadlessChrome detected"
  FAIL=$((FAIL+1))
else
  echo "  ✓ Not HeadlessChrome"
  PASS=$((PASS+1))
fi

# --- Test 5b: Core exec surface ---
echo ""
echo "--- Test 5b: Core exec surface ---"
CDP_TITLE=$(CHROMUX_PROFILE=$PROFILE node "$CT" cdp tab-a Runtime.evaluate '{"expression":"document.title","returnByValue":true}' 2>/dev/null)
check "cdp Runtime.evaluate works" '"value"' "$CDP_TITLE"

RUN_HOST=$(CHROMUX_PROFILE=$PROFILE node "$CT" run tab-a "return await js('location.hostname')" 2>/dev/null)
check "run async js helper works" "httpbin.org" "$RUN_HOST"

TMP_PARAMS="/tmp/chromux-cdp-params-$$.json"
printf '{"expression":"location.hostname","returnByValue":true}' > "$TMP_PARAMS"
CDP_FILE=$(CHROMUX_PROFILE=$PROFILE node "$CT" cdp tab-a Runtime.evaluate --params-file "$TMP_PARAMS" 2>/dev/null)
rm -f "$TMP_PARAMS"
check "cdp --params-file works" "httpbin.org" "$CDP_FILE"

# --- Test 5c: click --xy ---
echo ""
echo "--- Test 5c: Coordinate click ---"
CLICK_URL='data:text/html,%3Cbutton%20style%3D%22position%3Aabsolute%3Bleft%3A0%3Btop%3A0%3Bwidth%3A120px%3Bheight%3A80px%22%20onclick%3D%22document.title%3D%27clicked%27%22%3EClick%3C%2Fbutton%3E'
CHROMUX_PROFILE=$PROFILE node "$CT" open tab-click "$CLICK_URL" 2>/dev/null > /dev/null
XY_CLICK=$(CHROMUX_PROFILE=$PROFILE node "$CT" click tab-click --xy 40 40 2>/dev/null)
check "click --xy reports success" '"xy"' "$XY_CLICK"
CLICK_TITLE=$(CHROMUX_PROFILE=$PROFILE node "$CT" eval tab-click "document.title" 2>/dev/null)
check "click --xy changed page state" "clicked" "$CLICK_TITLE"

# --- Test 5d: watch and quiet aliases ---
echo ""
echo "--- Test 5d: Watch and hidden compatibility ---"
WATCH_EMPTY=$(CHROMUX_PROFILE=$PROFILE node "$CT" watch tab-a console 2>/dev/null)
check "watch console enables quietly" "No console messages" "$WATCH_EMPTY"
CHROMUX_PROFILE=$PROFILE node "$CT" run tab-a "return await js(\"console.log('watch-ok')\")" 2>/dev/null > /dev/null
WATCH_LOG=$(CHROMUX_PROFILE=$PROFILE node "$CT" watch tab-a console 2>/dev/null)
check "watch console reads logs" "watch-ok" "$WATCH_LOG"
CONSOLE_ALIAS=$(CHROMUX_PROFILE=$PROFILE node "$CT" console tab-a 2>/dev/null)
check "console alias remains quiet" "No console messages" "$CONSOLE_ALIAS"
WAIT_ALIAS=$(CHROMUX_PROFILE=$PROFILE node "$CT" wait tab-a 10 2>/dev/null)
check "wait alias remains available" "waited" "$WAIT_ALIAS"
HELP_TEXT=$(node "$CT" help)
if echo "$HELP_TEXT" | grep -q "chromux eval <session>"; then
  echo "  ✗ eval still appears as primary help command"
  FAIL=$((FAIL+1))
else
  echo "  ✓ deprecated eval command hidden from primary help"
  PASS=$((PASS+1))
fi

if node -e "const fs=require('fs'); const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor; new AsyncFunction('cdp','js','sleep','waitLoad', fs.readFileSync('snippets/_builtin/scroll-until.js','utf8'));" 2>/dev/null; then
  echo "  ✓ builtin scroll-until helper compiles for chromux run"
  PASS=$((PASS+1))
else
  echo "  ✗ builtin scroll-until helper failed to compile for chromux run"
  FAIL=$((FAIL+1))
fi

# --- Test 6: Snapshot ---
echo ""
echo "--- Test 6: Snapshot ---"
CHROMUX_PROFILE=$PROFILE node "$CT" open tab-a https://news.ycombinator.com 2>/dev/null > /dev/null
sleep 2
SNAP=$(CHROMUX_PROFILE=$PROFILE node "$CT" snapshot tab-a 2>/dev/null)
check "snapshot has title" "Hacker News" "$SNAP"
check "snapshot has @ref" "@1" "$SNAP"

# --- Test 7: Screenshot ---
echo ""
echo "--- Test 7: Screenshot ---"
CHROMUX_PROFILE=$PROFILE node "$CT" screenshot tab-a /tmp/chromux-test.png 2>/dev/null > /dev/null
if [ -f /tmp/chromux-test.png ] && [ -s /tmp/chromux-test.png ]; then
  SIZE=$(wc -c < /tmp/chromux-test.png | tr -d ' ')
  echo "  ✓ Screenshot saved (${SIZE} bytes)"
  PASS=$((PASS+1))
else
  echo "  ✗ Screenshot missing or empty"
  FAIL=$((FAIL+1))
fi
rm -f /tmp/chromux-test.png

# --- Test 8: List ---
echo ""
echo "--- Test 8: List sessions ---"
LIST=$(CHROMUX_PROFILE=$PROFILE node "$CT" list 2>/dev/null)
check "list shows tab-a" "tab-a" "$LIST"
check "list shows tab-b" "tab-b" "$LIST"

# --- Test 9: Close ---
echo ""
echo "--- Test 9: Close tabs ---"
CHROMUX_PROFILE=$PROFILE node "$CT" close tab-a 2>/dev/null > /dev/null
CHROMUX_PROFILE=$PROFILE node "$CT" close tab-b 2>/dev/null > /dev/null
CHROMUX_PROFILE=$PROFILE node "$CT" close tab-click 2>/dev/null > /dev/null
LIST2=$(CHROMUX_PROFILE=$PROFILE node "$CT" list 2>/dev/null)
check "all tabs closed" "{}" "$LIST2"

# --- Test 10: Kill profile ---
echo ""
echo "--- Test 10: Kill profile ---"
rm -f "$STATE"
node "$CT" kill "$PROFILE" 2>/dev/null > /dev/null
sleep 1
PS2=$(node "$CT" ps 2>/dev/null)
if echo "$PS2" | grep -q "$PROFILE"; then
  echo "  ✗ Profile still showing in ps"
  FAIL=$((FAIL+1))
else
  echo "  ✓ Profile killed and removed from ps"
  PASS=$((PASS+1))
fi

# --- Test 11: Dead-PID startup lock recovery ---
echo ""
echo "--- Test 11: Dead-PID startup lock recovery ---"
mkdir -p "$HOME/.chromux/run"
( : ) &
DEAD_PID=$!
wait "$DEAD_PID" || true
LOCK="$HOME/.chromux/run/$PROFILE.lock"
printf '{"pid":%s,"ts":%s}' "$DEAD_PID" "$(date +%s000)" > "$LOCK"
R11=$(CHROMUX_PROFILE=$PROFILE node "$CT" open lock-test https://example.com 2>&1)
check "open succeeds after dead-PID lock" "example.com" "$R11"
if [ -f "$LOCK" ]; then
  echo "  ✗ Dead-PID lock still exists"
  FAIL=$((FAIL+1))
else
  echo "  ✓ Dead-PID lock removed"
  PASS=$((PASS+1))
fi
CHROMUX_PROFILE=$PROFILE node "$CT" kill "$PROFILE" 2>/dev/null > /dev/null || true

# Cancel the EXIT trap since kill already cleaned up
trap - EXIT

# --- Summary ---
echo ""
echo "==========================="
echo "Results: $PASS passed, $FAIL failed"
if [ $FAIL -eq 0 ]; then
  echo "✓ All tests passed!"
else
  echo "✗ Some tests failed"
  exit 1
fi
