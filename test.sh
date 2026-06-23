#!/bin/bash
set -e

CT="$(dirname "$0")/chromux.mjs"
PROFILE="test-$$"
COLD_PROFILE="$PROFILE-cold"
LIVE_LOCK_PROFILE="$PROFILE-live-lock"
STALE_LOCK_PROFILE="$PROFILE-stale-lock"
PASS=0
FAIL=0

# Keep the suite independent from the user's shell defaults.
unset CHROMUX_LAUNCH_MODE CHROMUX_AUTO_LAUNCH_MODE CHROMUX_OPEN_BACKGROUND CHROMUX_BACKGROUND_TABS

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
  node "$CT" kill "$COLD_PROFILE" 2>/dev/null || true
  node "$CT" kill "$LIVE_LOCK_PROFILE" 2>/dev/null || true
  node "$CT" kill "$STALE_LOCK_PROFILE" 2>/dev/null || true
  chmod -R u+rwX "$HOME/.chromux/profiles/$PROFILE" "$HOME/.chromux/profiles/$COLD_PROFILE" "$HOME/.chromux/profiles/$LIVE_LOCK_PROFILE" "$HOME/.chromux/profiles/$STALE_LOCK_PROFILE" 2>/dev/null || true
  rm -rf "$HOME/.chromux/profiles/$PROFILE" "$HOME/.chromux/profiles/$COLD_PROFILE" "$HOME/.chromux/profiles/$LIVE_LOCK_PROFILE" "$HOME/.chromux/profiles/$STALE_LOCK_PROFILE"
  echo "  ✓ cleaned up profile $PROFILE"
}
trap cleanup EXIT

echo "=== chromux test suite ==="
echo "profile: $PROFILE"
echo ""

# --- Test 1: Launch ---
echo "--- Test 1: Launch headless profile ---"
R1=$(node "$CT" launch "$PROFILE" --headless 2>/dev/null)
check "profile launched" "port" "$R1"
check "profile name" "$PROFILE" "$R1"

# --- Test 1b: Removed hidden launch mode ---
echo ""
echo "--- Test 1b: Removed hidden launch mode ---"
if node "$CT" launch "$PROFILE-removed-hidden" --hidden >/tmp/chromux-hidden-out.txt 2>&1; then
  echo "  ✗ --hidden launch unexpectedly succeeded"
  FAIL=$((FAIL+1))
else
  HIDDEN_OUT=$(cat /tmp/chromux-hidden-out.txt)
  check "--hidden reports removal" "has been removed" "$HIDDEN_OUT"
fi
if CHROMUX_PROFILE="$PROFILE-removed-hidden-env" CHROMUX_LAUNCH_MODE=hidden node "$CT" open hidden-auto https://example.com >/tmp/chromux-hidden-env-out.txt 2>&1; then
  echo "  ✗ CHROMUX_LAUNCH_MODE=hidden unexpectedly succeeded"
  FAIL=$((FAIL+1))
else
  HIDDEN_ENV_OUT=$(cat /tmp/chromux-hidden-env-out.txt)
  check "hidden auto-launch env reports removal" "has been removed" "$HIDDEN_ENV_OUT"
fi
rm -f /tmp/chromux-hidden-out.txt /tmp/chromux-hidden-env-out.txt

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
R3A=$(CHROMUX_PROFILE=$PROFILE node "$CT" open tab-a https://example.com 2>/dev/null)
check "tab-a opened" "example.com" "$R3A"

R3B=$(CHROMUX_PROFILE=$PROFILE node "$CT" open tab-b https://example.org 2>/dev/null)
check "tab-b opened" "example.org" "$R3B"

R3C=$(CHROMUX_PROFILE=$PROFILE node "$CT" open --background tab-bg https://example.com 2>/dev/null)
check "background tab opened" "example.com" "$R3C"

R3D=$(CHROMUX_PROFILE=$PROFILE CHROMUX_OPEN_BACKGROUND=1 node "$CT" open tab-bg-env https://example.org 2>/dev/null)
check "background tab env opened" "example.org" "$R3D"

R3E=$(CHROMUX_PROFILE=$PROFILE CHROMUX_OPEN_BACKGROUND=0 node "$CT" open tab-fg-env https://example.net 2>/dev/null)
check "foreground tab env opened" "example.net" "$R3E"

# --- Test 4: Isolation ---
echo ""
echo "--- Test 4: Tab isolation ---"
URL_A=$(CHROMUX_PROFILE=$PROFILE node "$CT" eval tab-a "location.href" 2>/dev/null)
URL_B=$(CHROMUX_PROFILE=$PROFILE node "$CT" eval tab-b "location.href" 2>/dev/null)
check "tab-a URL correct" "example.com" "$URL_A"
check "tab-b URL correct" "example.org" "$URL_B"

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
check "run async js helper works" "example.com" "$RUN_HOST"

RUN_PAGE=$(CHROMUX_PROFILE=$PROFILE node "$CT" run tab-a "return await page('({url:location.href,title:document.title})')" 2>/dev/null)
check "run page helper works" "example.com" "$RUN_PAGE"

RUN_TIMEOUT_PROPAGATES=$(CHROMUX_PROFILE=$PROFILE node "$CT" run tab-a --timeout 15000 "return await js('new Promise(resolve => setTimeout(() => resolve(location.hostname), 11000))')" 2>/dev/null)
check "run --timeout propagates to js helper" "example.com" "$RUN_TIMEOUT_PROPAGATES"

RUN_JS_ISOLATED=$(CHROMUX_PROFILE=$PROFILE node "$CT" run tab-a - <<'JS' 2>/dev/null
await js('const input = 1; return input;');
return await js('const input = 2; return input;');
JS
)
check "run js helper isolates lexical declarations" "2" "$RUN_JS_ISOLATED"

TMP_PARAMS="/tmp/chromux-cdp-params-$$.json"
printf '{"expression":"location.hostname","returnByValue":true}' > "$TMP_PARAMS"
CDP_FILE=$(CHROMUX_PROFILE=$PROFILE node "$CT" cdp tab-a Runtime.evaluate --params-file "$TMP_PARAMS" 2>/dev/null)
rm -f "$TMP_PARAMS"
check "cdp --params-file works" "example.com" "$CDP_FILE"

# Regression: multi-line expression containing nested `const` must not be IIFE-wrapped.
# Previously the IIFE auto-wrap regex used the `m` flag and matched `const` inside nested
# function bodies, wrapping the top-level expression and swallowing its return value.
EVAL_MULTILINE_EXPR=$(CHROMUX_PROFILE=$PROFILE node "$CT" eval tab-a "$(cat <<'JS'
JSON.stringify(
  [1,2,3].map(x => {
    const y = x * 2;
    return y;
  })
)
JS
)" 2>/dev/null)
check "eval returns value of multi-line expression with nested const" "2,4,6" "$EVAL_MULTILINE_EXPR"

# Top-level const must still be IIFE-wrapped (no global REPL pollution).
CHROMUX_PROFILE=$PROFILE node "$CT" eval tab-a "const __chromux_iife_probe = 42;" >/dev/null 2>&1 || true
EVAL_IIFE_SCOPED=$(CHROMUX_PROFILE=$PROFILE node "$CT" eval tab-a "typeof __chromux_iife_probe" 2>/dev/null)
check "top-level const stays scoped to IIFE" "undefined" "$EVAL_IIFE_SCOPED"

# Top-level const preceded by leading comments must still be IIFE-wrapped.
CHROMUX_PROFILE=$PROFILE node "$CT" eval tab-a "$(cat <<'JS'
// leading single-line comment
/* and a block comment */
const __chromux_iife_probe_comment = 99;
JS
)" >/dev/null 2>&1 || true
EVAL_IIFE_COMMENT_SCOPED=$(CHROMUX_PROFILE=$PROFILE node "$CT" eval tab-a "typeof __chromux_iife_probe_comment" 2>/dev/null)
check "top-level const with leading comments stays scoped" "undefined" "$EVAL_IIFE_COMMENT_SCOPED"

# --- Test 5c: click --xy ---
echo ""
echo "--- Test 5c: Coordinate click ---"
CLICK_URL='data:text/html,%3Cbutton%20style%3D%22position%3Aabsolute%3Bleft%3A0%3Btop%3A0%3Bwidth%3A120px%3Bheight%3A80px%22%20onclick%3D%22document.title%3D%27clicked%27%22%3EClick%3C%2Fbutton%3E'
CHROMUX_PROFILE=$PROFILE node "$CT" open tab-click "$CLICK_URL" 2>/dev/null > /dev/null
XY_CLICK=$(CHROMUX_PROFILE=$PROFILE node "$CT" click tab-click --xy 40 40 2>/dev/null)
check "click --xy reports success" '"xy"' "$XY_CLICK"
CLICK_TITLE=$(CHROMUX_PROFILE=$PROFILE node "$CT" eval tab-click "document.title" 2>/dev/null)
check "click --xy changed page state" "clicked" "$CLICK_TITLE"
if CHROMUX_PROFILE=$PROFILE node "$CT" click tab-click --xy 999999 999999 >/tmp/chromux-xy-out-$$.txt 2>&1; then
  echo "  ✗ click --xy outside viewport unexpectedly succeeded"
  FAIL=$((FAIL+1))
else
  XY_OUT=$(cat /tmp/chromux-xy-out-$$.txt)
  check "click --xy outside viewport fails clearly" "outside viewport" "$XY_OUT"
fi
rm -f /tmp/chromux-xy-out-$$.txt

# --- Test 5c.1: text input shortcuts ---
echo ""
echo "--- Test 5c.1: Text input shortcuts ---"
INPUT_HTML='<input id="name" aria-label="Name"><script>window.inputCount=0;window.changeCount=0;const el=document.getElementById("name");el.addEventListener("input",()=>{window.inputCount+=1});el.addEventListener("change",()=>{window.changeCount+=1});</script>'
INPUT_URL="data:text/html,$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$INPUT_HTML")"
CHROMUX_PROFILE=$PROFILE node "$CT" open tab-input "$INPUT_URL" 2>/dev/null > /dev/null
INPUT_SNAP=$(CHROMUX_PROFILE=$PROFILE node "$CT" snapshot tab-input 2>/dev/null)
check "input snapshot has textbox ref" "@1" "$INPUT_SNAP"
CHROMUX_PROFILE=$PROFILE node "$CT" click tab-input @1 2>/dev/null > /dev/null
CHROMUX_PROFILE=$PROFILE node "$CT" type tab-input "Browser Test" 2>/dev/null > /dev/null
TYPE_STATE=$(CHROMUX_PROFILE=$PROFILE node "$CT" eval tab-input "document.getElementById('name').value" 2>/dev/null)
check "click then type updates focused input" "Browser Test" "$TYPE_STATE"
CHROMUX_PROFILE=$PROFILE node "$CT" eval tab-input "window.inputCount=0;window.changeCount=0" 2>/dev/null > /dev/null
CHROMUX_PROFILE=$PROFILE node "$CT" fill tab-input @1 "Filled Value" 2>/dev/null > /dev/null
FILL_STATE=$(CHROMUX_PROFILE=$PROFILE node "$CT" eval tab-input "JSON.stringify({value:document.getElementById('name').value,input:window.inputCount,change:window.changeCount})" 2>/dev/null)
check "fill sets input value" "Filled Value" "$FILL_STATE"
FILL_CHANGE_OK=$(CHROMUX_PROFILE=$PROFILE node "$CT" eval tab-input "window.changeCount > 0" 2>/dev/null)
check "fill dispatches change event" "true" "$FILL_CHANGE_OK"

# --- Test 5c.2: click target validation ---
echo ""
echo "--- Test 5c.2: Click target validation ---"
COVERED_HTML='<button id="target" style="position:absolute;left:20px;top:20px;width:120px;height:60px" onclick="document.title=&quot;clicked&quot;">Covered</button><div id="cover" style="position:absolute;left:0;top:0;width:200px;height:120px;background:rgba(0,0,0,.1)"></div>'
COVERED_URL="data:text/html,$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$COVERED_HTML")"
CHROMUX_PROFILE=$PROFILE node "$CT" open tab-covered "$COVERED_URL" 2>/dev/null > /dev/null
COVERED_SNAP=$(CHROMUX_PROFILE=$PROFILE node "$CT" snapshot tab-covered 2>/dev/null)
check "covered page exposes target ref" "@1" "$COVERED_SNAP"
if CHROMUX_PROFILE=$PROFILE node "$CT" click tab-covered @1 >/tmp/chromux-covered-out-$$.txt 2>&1; then
  echo "  ✗ covered target click unexpectedly succeeded"
  FAIL=$((FAIL+1))
else
  COVERED_OUT=$(cat /tmp/chromux-covered-out-$$.txt)
  check "covered target click fails clearly" "covered" "$COVERED_OUT"
fi
CHROMUX_PROFILE=$PROFILE node "$CT" eval tab-covered "document.getElementById('target').remove()" 2>/dev/null > /dev/null
if CHROMUX_PROFILE=$PROFILE node "$CT" click tab-covered @1 >/tmp/chromux-stale-ref-out-$$.txt 2>&1; then
  echo "  ✗ stale ref click unexpectedly succeeded"
  FAIL=$((FAIL+1))
else
  STALE_REF_OUT=$(cat /tmp/chromux-stale-ref-out-$$.txt)
  check "stale ref click fails clearly" "Element not found" "$STALE_REF_OUT"
fi
rm -f /tmp/chromux-covered-out-$$.txt /tmp/chromux-stale-ref-out-$$.txt

HIDDEN_HTML='<button id="hidden" style="display:none">Hidden</button><button id="zero" style="width:0;height:0;padding:0;border:0;overflow:hidden">Zero</button>'
HIDDEN_URL="data:text/html,$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$HIDDEN_HTML")"
CHROMUX_PROFILE=$PROFILE node "$CT" open tab-hidden "$HIDDEN_URL" 2>/dev/null > /dev/null
if CHROMUX_PROFILE=$PROFILE node "$CT" click tab-hidden "#hidden" >/tmp/chromux-hidden-out-$$.txt 2>&1; then
  echo "  ✗ hidden target click unexpectedly succeeded"
  FAIL=$((FAIL+1))
else
  HIDDEN_OUT=$(cat /tmp/chromux-hidden-out-$$.txt)
  check "hidden target click fails clearly" "not interactable" "$HIDDEN_OUT"
fi
if CHROMUX_PROFILE=$PROFILE node "$CT" click tab-hidden "#zero" >/tmp/chromux-zero-out-$$.txt 2>&1; then
  echo "  ✗ zero-size target click unexpectedly succeeded"
  FAIL=$((FAIL+1))
else
  ZERO_OUT=$(cat /tmp/chromux-zero-out-$$.txt)
  check "zero-size target click fails clearly" "not interactable" "$ZERO_OUT"
fi
rm -f /tmp/chromux-hidden-out-$$.txt /tmp/chromux-zero-out-$$.txt

# --- Test 5c.3: press and waits ---
echo ""
echo "--- Test 5c.3: Press and wait shortcuts ---"
PRESS_HTML='<input id="first" aria-label="First"><input id="second" aria-label="Second"><div id="root"></div><script>window.keys=[];document.addEventListener("keydown",e=>window.keys.push(e.key));setTimeout(()=>{document.getElementById("root").innerHTML="<strong id=\"ready\">Ready Text</strong>"},250);</script>'
PRESS_URL="data:text/html,$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$PRESS_HTML")"
CHROMUX_PROFILE=$PROFILE node "$CT" open tab-press "$PRESS_URL" 2>/dev/null > /dev/null
PRESS_SNAP=$(CHROMUX_PROFILE=$PROFILE node "$CT" snapshot tab-press 2>/dev/null)
check "press page exposes input refs" "@1" "$PRESS_SNAP"
CHROMUX_PROFILE=$PROFILE node "$CT" click tab-press @1 2>/dev/null > /dev/null
CHROMUX_PROFILE=$PROFILE node "$CT" type tab-press "abc" 2>/dev/null > /dev/null
CHROMUX_PROFILE=$PROFILE node "$CT" press tab-press Backspace 2>/dev/null > /dev/null
CHROMUX_PROFILE=$PROFILE node "$CT" press tab-press Enter 2>/dev/null > /dev/null
CHROMUX_PROFILE=$PROFILE node "$CT" press tab-press Tab 2>/dev/null > /dev/null
CHROMUX_PROFILE=$PROFILE node "$CT" press tab-press Escape 2>/dev/null > /dev/null
PRESS_STATE=$(CHROMUX_PROFILE=$PROFILE node "$CT" eval tab-press "JSON.stringify({value:document.getElementById('first').value,active:document.activeElement.id,keys:window.keys})" 2>/dev/null)
check "press Backspace edits focused input" '"value":"ab"' "$PRESS_STATE"
check "press Tab moves focus" '"active":"second"' "$PRESS_STATE"
check "press Enter recorded" "Enter" "$PRESS_STATE"
check "press Escape recorded" "Escape" "$PRESS_STATE"
WAIT_TEXT=$(CHROMUX_PROFILE=$PROFILE node "$CT" wait-for-text tab-press "Ready Text" 2000 2>/dev/null)
check "wait-for-text reports success" "Ready Text" "$WAIT_TEXT"
WAIT_SELECTOR=$(CHROMUX_PROFILE=$PROFILE node "$CT" wait-for-selector tab-press "#ready" 2000 2>/dev/null)
check "wait-for-selector reports success" "#ready" "$WAIT_SELECTOR"
if CHROMUX_PROFILE=$PROFILE node "$CT" wait-for-text tab-press "Never Appears" 300 >/tmp/chromux-wait-text-out-$$.txt 2>&1; then
  echo "  ✗ wait-for-text missing text unexpectedly succeeded"
  FAIL=$((FAIL+1))
else
  WAIT_TEXT_OUT=$(cat /tmp/chromux-wait-text-out-$$.txt)
  check "wait-for-text timeout names text" "Never Appears" "$WAIT_TEXT_OUT"
fi
if CHROMUX_PROFILE=$PROFILE node "$CT" wait-for-selector tab-press "#missing" 300 >/tmp/chromux-wait-selector-out-$$.txt 2>&1; then
  echo "  ✗ wait-for-selector missing selector unexpectedly succeeded"
  FAIL=$((FAIL+1))
else
  WAIT_SELECTOR_OUT=$(cat /tmp/chromux-wait-selector-out-$$.txt)
  check "wait-for-selector timeout names selector" "#missing" "$WAIT_SELECTOR_OUT"
fi
rm -f /tmp/chromux-wait-text-out-$$.txt /tmp/chromux-wait-selector-out-$$.txt

# --- Test 5d: watch and quiet aliases ---
echo ""
echo "--- Test 5d: Watch and compatibility aliases ---"
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
CLOSE_A=$(CHROMUX_PROFILE=$PROFILE node "$CT" close tab-a 2>/dev/null)
check "close returns site knowledge hint" "knowledgeHint" "$CLOSE_A"
check "close normalizes host in knowledge hint" "news.ycombinator.com" "$CLOSE_A"
CHROMUX_PROFILE=$PROFILE node "$CT" close tab-b 2>/dev/null > /dev/null
CHROMUX_PROFILE=$PROFILE node "$CT" close tab-bg 2>/dev/null > /dev/null
CHROMUX_PROFILE=$PROFILE node "$CT" close tab-bg-env 2>/dev/null > /dev/null
CHROMUX_PROFILE=$PROFILE node "$CT" close tab-fg-env 2>/dev/null > /dev/null
CHROMUX_PROFILE=$PROFILE node "$CT" close tab-click 2>/dev/null > /dev/null
CHROMUX_PROFILE=$PROFILE node "$CT" close tab-input 2>/dev/null > /dev/null
CHROMUX_PROFILE=$PROFILE node "$CT" close tab-covered 2>/dev/null > /dev/null
CHROMUX_PROFILE=$PROFILE node "$CT" close tab-hidden 2>/dev/null > /dev/null
CHROMUX_PROFILE=$PROFILE node "$CT" close tab-press 2>/dev/null > /dev/null
LIST2=$(CHROMUX_PROFILE=$PROFILE node "$CT" list 2>/dev/null)
check "all tabs closed" "{}" "$LIST2"

# --- Test 9b: Crawl batch, pause/resume, and resource guard ---
echo ""
echo "--- Test 9b: Crawl orchestration helpers ---"
BATCH_IN="/tmp/chromux-batch-urls-$$.txt"
BATCH_OUT="/tmp/chromux-batch-out-$$.jsonl"
printf 'https://example.com\nhttps://example.org\n' > "$BATCH_IN"
BATCH=$(CHROMUX_PROFILE=$PROFILE CHROMUX_MODE=crawl node "$CT" batch --file "$BATCH_IN" --workers 2 --out "$BATCH_OUT" --session-prefix batch-test 2>/dev/null)
check "batch reports total" '"total": 2' "$BATCH"
check "batch reports success" '"ok": 2' "$BATCH"
if [ "$(wc -l < "$BATCH_OUT" | tr -d ' ')" = "2" ]; then
  echo "  ✓ batch wrote JSONL output"
  PASS=$((PASS+1))
else
  echo "  ✗ batch JSONL output count wrong"
  FAIL=$((FAIL+1))
fi
rm -f "$BATCH_IN" "$BATCH_OUT"

PAUSE=$(CHROMUX_PROFILE=$PROFILE node "$CT" pause 2>/dev/null)
check "pause creates hard stop" '"paused": true' "$PAUSE"
if CHROMUX_PROFILE=$PROFILE CHROMUX_MODE=crawl node "$CT" open paused-tab https://example.com >/tmp/chromux-paused-out-$$.txt 2>&1; then
  echo "  ✗ open unexpectedly succeeded while paused"
  FAIL=$((FAIL+1))
else
  PAUSED_OUT=$(cat /tmp/chromux-paused-out-$$.txt)
  check "paused profile rejects open" "paused" "$PAUSED_OUT"
fi
RESUME=$(CHROMUX_PROFILE=$PROFILE node "$CT" resume 2>/dev/null)
check "resume clears hard stop" '"paused": false' "$RESUME"
rm -f /tmp/chromux-paused-out-$$.txt

GUARD_PROFILE="$PROFILE-guard"
if CHROMUX_PROFILE=$GUARD_PROFILE CHROMUX_MODE=crawl CHROMUX_MAX_CHROME_PROCESSES_PER_PROFILE=1 node "$CT" open guard-tab https://example.com >/tmp/chromux-guard-out-$$.txt 2>&1; then
  echo "  ✗ resource guard open unexpectedly succeeded"
  FAIL=$((FAIL+1))
else
  GUARD_OUT=$(cat /tmp/chromux-guard-out-$$.txt)
  check "resource guard rejects open" "resource guard" "$GUARD_OUT"
fi
node "$CT" kill "$GUARD_PROFILE" 2>/dev/null > /dev/null || true
chmod -R u+rwX "$HOME/.chromux/profiles/$GUARD_PROFILE" 2>/dev/null || true
rm -rf "$HOME/.chromux/profiles/$GUARD_PROFILE" /tmp/chromux-guard-out-$$.txt

PREFIX_OTHER="$PROFILE-prefix-other"
PREFIX_TARGET="$PROFILE-prefix"
CHROMUX_PROFILE=$PREFIX_OTHER CHROMUX_MODE=crawl node "$CT" open prefix-other https://example.org 2>/dev/null > /dev/null
if CHROMUX_PROFILE=$PREFIX_TARGET CHROMUX_MODE=crawl CHROMUX_MAX_CHROME_PROCESSES_PER_PROFILE=8 node "$CT" open prefix-target https://example.com >/tmp/chromux-prefix-out-$$.txt 2>&1; then
  PREFIX_OUT=$(cat /tmp/chromux-prefix-out-$$.txt)
  check "resource guard uses exact profile names" "example.com" "$PREFIX_OUT"
else
  PREFIX_OUT=$(cat /tmp/chromux-prefix-out-$$.txt)
  echo "  ✗ resource guard matched prefix profile incorrectly: $PREFIX_OUT"
  FAIL=$((FAIL+1))
fi
node "$CT" kill "$PREFIX_TARGET" 2>/dev/null > /dev/null || true
node "$CT" kill "$PREFIX_OTHER" 2>/dev/null > /dev/null || true
chmod -R u+rwX "$HOME/.chromux/profiles/$PREFIX_TARGET" "$HOME/.chromux/profiles/$PREFIX_OTHER" 2>/dev/null || true
rm -rf "$HOME/.chromux/profiles/$PREFIX_TARGET" "$HOME/.chromux/profiles/$PREFIX_OTHER" /tmp/chromux-prefix-out-$$.txt

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
echo "--- Test 11: Concurrent cold-start auto-launch ---"
node "$CT" kill "$COLD_PROFILE" 2>/dev/null > /dev/null || true
chmod -R u+rwX "$HOME/.chromux/profiles/$COLD_PROFILE" 2>/dev/null || true
rm -rf "$HOME/.chromux/profiles/$COLD_PROFILE"
PIDS=()
for i in 0 1 2; do
  (
    set +e
    CHROMUX_PROFILE=$COLD_PROFILE CHROMUX_MODE=crawl node "$CT" open "cold-$i" "https://example.com/?cold=$i" > "/tmp/chromux-cold-$i-$$.out" 2>&1
    echo $? > "/tmp/chromux-cold-$i-$$.status"
  ) &
  PIDS+=("$!")
done
for pid in "${PIDS[@]}"; do
  wait "$pid" || true
done
for i in 0 1 2; do
  COLD_OUT=$(cat "/tmp/chromux-cold-$i-$$.out" 2>/dev/null || true)
  COLD_STATUS=$(cat "/tmp/chromux-cold-$i-$$.status" 2>/dev/null || echo 1)
  if [ "$COLD_STATUS" = "0" ]; then
    check "cold-start worker $i opened" "example.com" "$COLD_OUT"
  else
    echo "  ✗ cold-start worker $i failed: $COLD_OUT"
    FAIL=$((FAIL+1))
  fi
done
COLD_LIST=$(CHROMUX_PROFILE=$COLD_PROFILE CHROMUX_MODE=crawl node "$CT" list 2>/dev/null)
check "cold-start shared daemon has worker sessions" "cold-0" "$COLD_LIST"
check "cold-start shared daemon has third worker" "cold-2" "$COLD_LIST"
COLD_PS=$(node "$CT" ps 2>/dev/null)
check "cold-start daemon is healthy" "$COLD_PROFILE" "$COLD_PS"
check "cold-start daemon health is ok" "ok" "$COLD_PS"
node "$CT" kill "$COLD_PROFILE" 2>/dev/null > /dev/null || true
chmod -R u+rwX "$HOME/.chromux/profiles/$COLD_PROFILE" 2>/dev/null || true
rm -rf "$HOME/.chromux/profiles/$COLD_PROFILE" /tmp/chromux-cold-*-$$.out /tmp/chromux-cold-*-$$.status

# --- Test 12: Live startup lock preservation ---
echo ""
echo "--- Test 12: Live startup lock preservation ---"
node "$CT" kill "$LIVE_LOCK_PROFILE" 2>/dev/null > /dev/null || true
chmod -R u+rwX "$HOME/.chromux/profiles/$LIVE_LOCK_PROFILE" 2>/dev/null || true
rm -rf "$HOME/.chromux/profiles/$LIVE_LOCK_PROFILE"
mkdir -p "$HOME/.chromux/run"
( node -e 'setTimeout(() => {}, 4000)' chromux.mjs ) &
LIVE_PID=$!
LIVE_LOCK="$HOME/.chromux/run/$LIVE_LOCK_PROFILE.lock"
printf '{"pid":%s,"ts":%s}' "$LIVE_PID" "$(date +%s000)" > "$LIVE_LOCK"
touch -t 200001010000 "$LIVE_LOCK"
(
  set +e
  CHROMUX_PROFILE=$LIVE_LOCK_PROFILE node "$CT" open live-lock-test https://example.com > "/tmp/chromux-live-lock-$$.out" 2>&1
  echo $? > "/tmp/chromux-live-lock-$$.status"
) &
WAITER_PID=$!
sleep 1
if [ -f "$LIVE_LOCK" ]; then
  echo "  ✓ live-owner startup lock preserved"
  PASS=$((PASS+1))
else
  echo "  ✗ live-owner startup lock was removed while owner was alive"
  FAIL=$((FAIL+1))
fi
wait "$LIVE_PID" || true
wait "$WAITER_PID" || true
LIVE_LOCK_OUT=$(cat "/tmp/chromux-live-lock-$$.out" 2>/dev/null || true)
LIVE_LOCK_STATUS=$(cat "/tmp/chromux-live-lock-$$.status" 2>/dev/null || echo 1)
if [ "$LIVE_LOCK_STATUS" = "0" ]; then
  check "open succeeds after live lock owner exits" "example.com" "$LIVE_LOCK_OUT"
else
  echo "  ✗ open after live lock owner exit failed: $LIVE_LOCK_OUT"
  FAIL=$((FAIL+1))
fi
node "$CT" kill "$LIVE_LOCK_PROFILE" 2>/dev/null > /dev/null || true
chmod -R u+rwX "$HOME/.chromux/profiles/$LIVE_LOCK_PROFILE" 2>/dev/null || true
rm -rf "$HOME/.chromux/profiles/$LIVE_LOCK_PROFILE" "/tmp/chromux-live-lock-$$.out" "/tmp/chromux-live-lock-$$.status"

# --- Test 13: Reused-PID stale lock recovery ---
echo ""
echo "--- Test 13: Reused-PID stale lock recovery ---"
node "$CT" kill "$STALE_LOCK_PROFILE" 2>/dev/null > /dev/null || true
chmod -R u+rwX "$HOME/.chromux/profiles/$STALE_LOCK_PROFILE" 2>/dev/null || true
rm -rf "$HOME/.chromux/profiles/$STALE_LOCK_PROFILE"
( sleep 6 ) &
STALE_PID=$!
STALE_LOCK="$HOME/.chromux/run/$STALE_LOCK_PROFILE.lock"
printf '{"pid":%s,"ts":%s,"command":"node /tmp/old/chromux.mjs open stale"}' "$STALE_PID" "$(date +%s000)" > "$STALE_LOCK"
touch -t 200001010000 "$STALE_LOCK"
(
  set +e
  CHROMUX_PROFILE=$STALE_LOCK_PROFILE node "$CT" open stale-lock-test https://example.com > "/tmp/chromux-stale-lock-$$.out" 2>&1
  echo $? > "/tmp/chromux-stale-lock-$$.status"
) &
STALE_WAITER_PID=$!
sleep 1
if kill -0 "$STALE_PID" 2>/dev/null; then
  echo "  ✓ stale lock owner process still alive during recovery"
  PASS=$((PASS+1))
else
  echo "  ✗ stale lock owner process exited before recovery check"
  FAIL=$((FAIL+1))
fi
wait "$STALE_WAITER_PID" || true
STALE_LOCK_OUT=$(cat "/tmp/chromux-stale-lock-$$.out" 2>/dev/null || true)
STALE_LOCK_STATUS=$(cat "/tmp/chromux-stale-lock-$$.status" 2>/dev/null || echo 1)
if [ "$STALE_LOCK_STATUS" = "0" ]; then
  check "open succeeds despite reused-pid stale lock" "example.com" "$STALE_LOCK_OUT"
else
  echo "  ✗ open with reused-pid stale lock failed: $STALE_LOCK_OUT"
  FAIL=$((FAIL+1))
fi
kill "$STALE_PID" 2>/dev/null || true
wait "$STALE_PID" 2>/dev/null || true
node "$CT" kill "$STALE_LOCK_PROFILE" 2>/dev/null > /dev/null || true
chmod -R u+rwX "$HOME/.chromux/profiles/$STALE_LOCK_PROFILE" 2>/dev/null || true
rm -rf "$HOME/.chromux/profiles/$STALE_LOCK_PROFILE" "/tmp/chromux-stale-lock-$$.out" "/tmp/chromux-stale-lock-$$.status"

# --- Test 14: Dead-PID startup lock recovery ---
echo ""
echo "--- Test 14: Dead-PID startup lock recovery ---"
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
