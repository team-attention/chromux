#!/bin/bash
set -e

CT="$(dirname "$0")/chromux.mjs"
PROFILE="test-$$"
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
  chmod -R u+rwX "$HOME/.chromux/profiles/$PROFILE" 2>/dev/null || true
  rm -rf "$HOME/.chromux/profiles/$PROFILE"
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
