#!/bin/bash
set -e

CT="$(cd "$(dirname "$0")" && pwd)/chromux.mjs"
PROFILE="test-$$"
COLD_PROFILE="$PROFILE-cold"
LIVE_LOCK_PROFILE="$PROFILE-live-lock"
STALE_LOCK_PROFILE="$PROFILE-stale-lock"
PASS=0
FAIL=0
REACH_FIXTURE_PID=""
REACH_FIXTURE_INFO=""
REACH_FIXTURE_LOG=""
RELATIVE_SHOT_DIR=""

if [ -z "${CHROMUX_HOME:-}" ]; then
  CHROMUX_HOME="$(mktemp -d /tmp/chromux-test-home-XXXXXX)"
  CHROMUX_TEST_OWNS_HOME=1
else
  CHROMUX_TEST_OWNS_HOME=0
fi
export CHROMUX_HOME

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

count_profile_chrome_processes() {
  local profile="$1"
  local dir="$CHROMUX_HOME/profiles/$profile"
  local ps_out="/tmp/chromux-ps-$profile-$$.txt"
  if ! ps -axo command= > "$ps_out" 2>/dev/null; then
    ps -eo args= > "$ps_out" 2>/dev/null || true
  fi
  grep -F -- "--user-data-dir=$dir" "$ps_out" 2>/dev/null | wc -l | tr -d ' '
  rm -f "$ps_out"
}

cleanup() {
  echo ""
  echo "--- Cleanup ---"
  if [ -n "$REACH_FIXTURE_PID" ]; then kill "$REACH_FIXTURE_PID" 2>/dev/null || true; fi
  rm -f "$REACH_FIXTURE_INFO" "$REACH_FIXTURE_LOG"
  if [ -n "$RELATIVE_SHOT_DIR" ]; then rm -rf "$RELATIVE_SHOT_DIR"; fi
  node "$CT" kill "$PROFILE" 2>/dev/null || true
  node "$CT" kill "$COLD_PROFILE" 2>/dev/null || true
  node "$CT" kill "$LIVE_LOCK_PROFILE" 2>/dev/null || true
  node "$CT" kill "$STALE_LOCK_PROFILE" 2>/dev/null || true
  chmod -R u+rwX "$CHROMUX_HOME/profiles/$PROFILE" "$CHROMUX_HOME/profiles/$COLD_PROFILE" "$CHROMUX_HOME/profiles/$LIVE_LOCK_PROFILE" "$CHROMUX_HOME/profiles/$STALE_LOCK_PROFILE" 2>/dev/null || true
  rm -rf "$CHROMUX_HOME/profiles/$PROFILE" "$CHROMUX_HOME/profiles/$COLD_PROFILE" "$CHROMUX_HOME/profiles/$LIVE_LOCK_PROFILE" "$CHROMUX_HOME/profiles/$STALE_LOCK_PROFILE"
  if [ "$CHROMUX_TEST_OWNS_HOME" = "1" ]; then
    rm -rf "$CHROMUX_HOME"
  fi
  echo "  ✓ cleaned up profile $PROFILE"
}
trap cleanup EXIT

echo "=== chromux test suite ==="
echo "profile: $PROFILE"
echo "chromux home: $CHROMUX_HOME"
echo ""

# --- Test 0: Status app data layer ---
echo "--- Test 0: Status app data layer ---"
SELF_TEST=$(node "$CT" app --self-test 2>/dev/null)
check "status app self-test passed" '"ok": true' "$SELF_TEST"
check "status app tests Task grouping" "timeline groups Task-labeled events" "$SELF_TEST"
check "status app tests redaction" "profile redaction removes URL and title fields" "$SELF_TEST"
if [ "$(uname -s)" = "Darwin" ] && command -v swiftc >/dev/null 2>&1; then
  MAC_APP_BUILD=$(./apps/macos-status-bar/build.sh 2>&1)
  check "macOS app builds" "Built" "$MAC_APP_BUILD"
  if [ -f "apps/macos-status-bar/dist/chromux.app/Contents/MacOS/chromux" ]; then
    echo "  ✓ macOS app executable exists"
    PASS=$((PASS+1))
  else
    echo "  ✗ macOS app executable missing"
    FAIL=$((FAIL+1))
  fi
else
  echo "  ✓ macOS app build skipped on non-Darwin or without swiftc"
  PASS=$((PASS+1))
fi
echo ""

# --- Test 1: Launch ---
echo "--- Test 1: Launch headless profile ---"
R1=$(node "$CT" launch "$PROFILE" --headless 2>/dev/null)
check "profile launched" "port" "$R1"
check "profile name" "$PROFILE" "$R1"
PROFILE_CDP_PORT=$(printf '%s' "$R1" | node -e 'let raw="";process.stdin.on("data",chunk=>raw+=chunk);process.stdin.on("end",()=>process.stdout.write(String(JSON.parse(raw).port)))')

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
PS_JSON=$(node "$CT" ps --json 2>/dev/null)
check "ps --json reports profiles" '"profiles"' "$PS_JSON"
check "ps --json reports resources" '"resources"' "$PS_JSON"

# --- Test 2b: Missing .state adoption ---
echo ""
echo "--- Test 2b: Missing .state adoption ---"
STATE="$CHROMUX_HOME/profiles/$PROFILE/.state"
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
node -e 'const fs=require("fs"); const state=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); state.sock=process.argv[2]; delete state.daemonPort; delete state.daemonEndpoint; fs.writeFileSync(process.argv[1], JSON.stringify(state,null,2)+"\n");' "$STATE" "/tmp/chromux-legacy-$PROFILE.sock"
R3A=$(CHROMUX_PROFILE=$PROFILE node "$CT" open tab-a https://example.com 2>/dev/null)
check "tab-a opened" "example.com" "$R3A"
STATE_ENDPOINT=$(node -e 'const fs=require("fs"); const st=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); console.log(`port=${st.port} cdpPort=${st.cdpPort} daemonPort=${st.daemonPort} sock=${Object.prototype.hasOwnProperty.call(st,"sock")}`);' "$STATE")
check "state keeps Chrome CDP port" "cdpPort=" "$STATE_ENDPOINT"
check "state stores daemonPort separately" "daemonPort=" "$STATE_ENDPOINT"
if echo "$STATE_ENDPOINT" | grep -q "sock=true"; then
  echo "  ✗ legacy socket state was not migrated away"
  FAIL=$((FAIL+1))
else
  echo "  ✓ legacy socket state migrated away"
  PASS=$((PASS+1))
fi
STATE_PORT_SEPARATE=$(node -e 'const fs=require("fs"); const st=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); console.log(st.port !== st.daemonPort && st.cdpPort !== st.daemonPort ? "separate" : "mixed");' "$STATE")
check "daemonPort differs from Chrome CDP port" "separate" "$STATE_PORT_SEPARATE"

R3B=$(CHROMUX_PROFILE=$PROFILE node "$CT" open tab-b https://example.org 2>/dev/null)
check "tab-b opened" "example.org" "$R3B"

R3C=$(CHROMUX_PROFILE=$PROFILE node "$CT" open --background tab-bg https://example.com 2>/dev/null)
check "background tab opened" "example.com" "$R3C"

R3D=$(CHROMUX_PROFILE=$PROFILE CHROMUX_OPEN_BACKGROUND=1 node "$CT" open tab-bg-env https://example.org 2>/dev/null)
check "background tab env opened" "example.org" "$R3D"

R3E=$(CHROMUX_PROFILE=$PROFILE CHROMUX_OPEN_BACKGROUND=0 node "$CT" open tab-fg-env https://example.net 2>/dev/null)
check "foreground tab env opened" "example.net" "$R3E"

echo ""
echo "--- Test 3b: Activity logging ---"
CHROMUX_PROFILE=$PROFILE CHROMUX_TASK=activity-suite node "$CT" snapshot tab-a >/tmp/chromux-activity-snapshot-$$.txt 2>/dev/null
CHROMUX_PROFILE=$PROFILE CHROMUX_TASK=activity-suite node "$CT" close tab-bg-env >/tmp/chromux-activity-close-$$.txt 2>/dev/null
ACTIVITY_SUMMARY=$(node -e 'const fs=require("fs"); const file=process.env.CHROMUX_HOME+"/activity/events.jsonl"; const events=fs.readFileSync(file,"utf8").trim().split(/\n/).filter(Boolean).map(JSON.parse).filter(e=>e.profile===process.argv[1]); const commands=[...new Set(events.map(e=>e.command))].sort().join(","); const hasTask=events.some(e=>e.task==="activity-suite"); const hasFullUrl=events.some(e=>e.command==="open"&&e.url&&e.url.includes("https://example.com")); const closeHasUrl=events.some(e=>e.command==="close"&&e.url); console.log(`${commands} task=${hasTask} fullUrl=${hasFullUrl} closeUrl=${closeHasUrl}`);' "$PROFILE")
check "activity log records open" "open" "$ACTIVITY_SUMMARY"
check "activity log records snapshot" "snapshot" "$ACTIVITY_SUMMARY"
check "activity log records close" "close" "$ACTIVITY_SUMMARY"
check "activity task metadata recorded" "task=true" "$ACTIVITY_SUMMARY"
check "activity log keeps full URL" "fullUrl=true" "$ACTIVITY_SUMMARY"
check "close activity records URL" "closeUrl=true" "$ACTIVITY_SUMMARY"
rm -f /tmp/chromux-activity-snapshot-$$.txt /tmp/chromux-activity-close-$$.txt

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

RUN_RECEIPT="/tmp/chromux-run-receipt-$$.json"
RUN_WITH_RECEIPT=$(CHROMUX_PROFILE=$PROFILE node "$CT" run tab-a "return {url: 'https://example.com/path?token=do-not-store&q=typed secret text#secret-fragment', href: 'file:///tmp/private.txt?token=do-not-store#secret-fragment', pageUrl: await js('location.href'), secretToken: 'do-not-store', text: 'typed secret text'}" --receipt "$RUN_RECEIPT" 2>/dev/null)
check "run --receipt preserves command result" "example.com" "$RUN_WITH_RECEIPT"
if [ -s "$RUN_RECEIPT" ]; then
  RECEIPT_SUMMARY=$(node -e 'const fs=require("fs"); const r=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const body=JSON.stringify(r); const stored=body.includes("do-not-store")||body.includes("typed secret text")||body.includes("secret-fragment"); const href=r.resultSummary&&r.resultSummary.href; const hrefOk=typeof href==="string"&&href.startsWith("file:///tmp/private.txt?token=")&&href.includes("#[redacted]")&&!href.startsWith("null/"); console.log(`ok=${r.ok} codeStored=${r.codeStored} leaked=${stored} hrefOk=${hrefOk} duration=${typeof r.durationMs}`);' "$RUN_RECEIPT")
  check "run receipt records success" "ok=true" "$RECEIPT_SUMMARY"
  check "run receipt does not store inline code" "codeStored=false" "$RECEIPT_SUMMARY"
  check "run receipt redacts sensitive strings" "leaked=false" "$RECEIPT_SUMMARY"
  check "run receipt preserves non-http URL protocol" "hrefOk=true" "$RECEIPT_SUMMARY"
else
  echo "  ✗ run receipt missing"
  FAIL=$((FAIL+1))
fi
rm -f "$RUN_RECEIPT"

UNSAFE_RECEIPT="/etc/chromux-disallowed-receipt-$$/receipt.json"
if CHROMUX_PROFILE=$PROFILE node "$CT" run tab-a "return 1" --receipt "$UNSAFE_RECEIPT" >/tmp/chromux-unsafe-receipt-$$.out 2>&1; then
  echo "  ✗ run receipt wrote outside allowed artifact roots"
  FAIL=$((FAIL+1))
else
  UNSAFE_OUT=$(cat /tmp/chromux-unsafe-receipt-$$.out)
  check "run receipt rejects unsafe artifact path before mkdir" "path not allowed" "$UNSAFE_OUT"
fi
if [ -e "/etc/chromux-disallowed-receipt-$$" ]; then
  echo "  ✗ unsafe receipt directory was created"
  FAIL=$((FAIL+1))
  rm -rf "/etc/chromux-disallowed-receipt-$$" 2>/dev/null || true
else
  echo "  ✓ unsafe receipt directory was not created"
  PASS=$((PASS+1))
fi
rm -f /tmp/chromux-unsafe-receipt-$$.out

RUN_WAIT_HELPERS=$(CHROMUX_PROFILE=$PROFILE node "$CT" run tab-a "const ready = await waitFor('Example Domain', { kind: 'text', timeoutMs: 5000 }); const asserted = await assertPage('document.body.innerText.includes(\"Example Domain\")'); return {ready, asserted};" 2>/dev/null)
check "run waitFor helper proves visible text" "Example Domain" "$RUN_WAIT_HELPERS"
check "run assertPage helper returns assertion proof" '"asserted": true' "$RUN_WAIT_HELPERS"

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
check "click response verifies by default" '"changed"' "$XY_CLICK"
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

# --- Test 5c.0a: screenshot coordinate metadata, DPR conversion, and crops ---
echo ""
echo "--- Test 5c.0a: Screenshot coordinate metadata and DPR-safe actions ---"
COORD_HTML='<title>CoordinatePage</title><style>html,body{margin:0;min-height:1400px}.target{position:absolute;left:40px;top:30px;width:100px;height:80px}.offscreen{position:absolute;left:55px;top:1000px;width:120px;height:70px;background:rgb(23,177,91)}</style><button id="target" class="target" aria-label="Coordinate target" onclick="document.title=&quot;image-clicked&quot;">Coordinate target</button><button id="offscreen" class="offscreen" aria-label="Offscreen coordinate target" onclick="document.title=&quot;offscreen-clicked&quot;">Offscreen target</button>'
COORD_URL="data:text/html,$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$COORD_HTML")"
CHROMUX_PROFILE=$PROFILE node "$CT" open tab-coord "$COORD_URL" 2>/dev/null > /dev/null
CHROMUX_PROFILE=$PROFILE node "$CT" cdp tab-coord Emulation.setDeviceMetricsOverride '{"width":400,"height":300,"deviceScaleFactor":1,"mobile":false}' 2>/dev/null > /dev/null
DPR1_SHOT=$(CHROMUX_PROFILE=$PROFILE node "$CT" screenshot tab-coord /tmp/chromux-dpr1-$$.png)
check "DPR 1 screenshot metadata records DPR" '"devicePixelRatio": 1' "$DPR1_SHOT"
check "DPR 1 screenshot metadata records image width" '"width": 400' "$DPR1_SHOT"
RELATIVE_SHOT_DIR=$(mktemp -d "${TMPDIR:-/tmp}/chromux-relative-shot-XXXXXX")
mkdir -p "$RELATIVE_SHOT_DIR/shots"
RELATIVE_SHOT=$(cd "$RELATIVE_SHOT_DIR" && CHROMUX_PROFILE=$PROFILE node "$CT" screenshot tab-coord ./shots/proof.png 2>/dev/null)
check "relative screenshot path resolves in the CLI working directory" '"path"' "$RELATIVE_SHOT"
if [ -s "$RELATIVE_SHOT_DIR/shots/proof.png" ]; then
  echo "  ✓ relative screenshot artifact written in caller directory"
  PASS=$((PASS+1))
else
  echo "  ✗ relative screenshot artifact missing from caller directory"
  FAIL=$((FAIL+1))
fi
rm -rf "$RELATIVE_SHOT_DIR"
RELATIVE_SHOT_DIR=""
CHROMUX_PROFILE=$PROFILE node "$CT" cdp tab-coord Emulation.setDeviceMetricsOverride '{"width":400,"height":300,"deviceScaleFactor":2,"mobile":false}' 2>/dev/null > /dev/null
DPR2_SHOT=$(CHROMUX_PROFILE=$PROFILE node "$CT" screenshot tab-coord /tmp/chromux-dpr2-$$.png 2>/dev/null)
check "DPR 2 screenshot metadata records DPR" '"devicePixelRatio": 2' "$DPR2_SHOT"
check "DPR 2 screenshot metadata records image width" '"width": 800' "$DPR2_SHOT"
IMAGE_CLICK=$(CHROMUX_PROFILE=$PROFILE node "$CT" click tab-coord --xy 180 140 --space image 2>/dev/null)
check "image-space click reports converted CSS coordinates" '"space": "image"' "$IMAGE_CLICK"
COORD_TITLE=$(CHROMUX_PROFILE=$PROFILE node "$CT" eval tab-coord "document.title" 2>/dev/null)
check "image-space click reaches DPR 2 target" "image-clicked" "$COORD_TITLE"
CHROMUX_PROFILE=$PROFILE node "$CT" eval tab-coord "document.title='CoordinatePage'" 2>/dev/null > /dev/null
REGION_SHOT=$(CHROMUX_PROFILE=$PROFILE node "$CT" screenshot tab-coord /tmp/chromux-region-$$.png --region 40 30 100 80 2>/dev/null)
check "CSS screenshot region reports crop source" '"source": "region"' "$REGION_SHOT"
check "DPR 2 CSS screenshot region produces scaled image width" '"width": 200' "$REGION_SHOT"
CHAINED_REGION_SHOT=$(CHROMUX_PROFILE=$PROFILE node "$CT" screenshot tab-coord /tmp/chromux-region-chained-$$.png --region 0 0 20 20 --space image 2>/dev/null)
CHAINED_REGION_META=$(printf '%s' "$CHAINED_REGION_SHOT" | node -e '
  let raw="";process.stdin.on("data",chunk=>raw+=chunk);process.stdin.on("end",()=>{
    const value=JSON.parse(raw);const rect=value.crop.cssRect;
    console.log([rect.x,rect.y,rect.width,rect.height,value.image.width].join(","));
  });')
check "image-space crop reuses the most recent crop-local mapping" "40,30,10,10,20" "$CHAINED_REGION_META"
COORD_SNAP=$(CHROMUX_PROFILE=$PROFILE node "$CT" snapshot tab-coord 2>/dev/null)
COORD_REF=$(echo "$COORD_SNAP" | grep "Coordinate target" | grep -o '@[0-9]*' | head -1)
REF_SHOT=$(CHROMUX_PROFILE=$PROFILE node "$CT" screenshot tab-coord /tmp/chromux-ref-$$.png --ref "$COORD_REF" 2>/dev/null)
check "ref screenshot crop reports crop source" '"source": "ref"' "$REF_SHOT"
OFFSCREEN_REF=$(echo "$COORD_SNAP" | grep "Offscreen coordinate target" | grep -o '@[0-9]*' | head -1)
OFFSCREEN_REF_SHOT=$(CHROMUX_PROFILE=$PROFILE node "$CT" screenshot tab-coord /tmp/chromux-ref-offscreen-$$.png --ref "$OFFSCREEN_REF" 2>/dev/null)
check "offscreen ref screenshot scrolls a reachable target into view" '"source": "ref"' "$OFFSCREEN_REF_SHOT"
OFFSCREEN_META=$(printf '%s' "$OFFSCREEN_REF_SHOT" | node -e '
  let raw="";process.stdin.on("data",chunk=>raw+=chunk);process.stdin.on("end",()=>{
    const value=JSON.parse(raw);const rect=value.crop.cssRect;const image=value.coordinateSpace.image;
    console.log([value.coordinateSpace.scroll.y,rect.x,rect.y,rect.width,rect.height,Math.floor(image.width/2),Math.floor(image.height/2)].join(" "));
  });')
read -r OFFSCREEN_SCROLL OFFSCREEN_X OFFSCREEN_Y OFFSCREEN_W OFFSCREEN_H OFFSCREEN_CLICK_X OFFSCREEN_CLICK_Y <<< "$OFFSCREEN_META"
if [ "${OFFSCREEN_SCROLL%.*}" -gt 0 ]; then
  echo "  ✓ offscreen ref crop records post-scroll viewport metadata"
  PASS=$((PASS+1))
else
  echo "  ✗ offscreen ref crop retained stale scroll metadata: $OFFSCREEN_SCROLL"
  FAIL=$((FAIL+1))
fi
OFFSCREEN_REGION_SHOT=$(CHROMUX_PROFILE=$PROFILE node "$CT" screenshot tab-coord /tmp/chromux-region-offscreen-$$.png --region "$OFFSCREEN_X" "$OFFSCREEN_Y" "$OFFSCREEN_W" "$OFFSCREEN_H" 2>/dev/null)
check "offscreen ref comparison region reports crop source" '"source": "region"' "$OFFSCREEN_REGION_SHOT"
if cmp -s /tmp/chromux-ref-offscreen-$$.png /tmp/chromux-region-offscreen-$$.png; then
  echo "  ✓ offscreen ref crop pixels match the post-scroll visible region"
  PASS=$((PASS+1))
else
  echo "  ✗ offscreen ref crop pixels do not match the post-scroll visible region"
  FAIL=$((FAIL+1))
fi
CHROMUX_PROFILE=$PROFILE node "$CT" click tab-coord --xy "$OFFSCREEN_CLICK_X" "$OFFSCREEN_CLICK_Y" --space image --no-verify 2>/dev/null > /dev/null
OFFSCREEN_TITLE=$(CHROMUX_PROFILE=$PROFILE node "$CT" eval tab-coord "document.title" 2>/dev/null)
check "offscreen ref crop local image coordinates reach the scrolled target" "offscreen-clicked" "$OFFSCREEN_TITLE"
CHROMUX_PROFILE=$PROFILE node "$CT" eval tab-coord "scrollTo(0,0);document.title='CoordinatePage'" 2>/dev/null > /dev/null
CHROMUX_PROFILE=$PROFILE node "$CT" cdp tab-coord Emulation.setPageScaleFactor '{"pageScaleFactor":1.5}' 2>/dev/null > /dev/null
ZOOM_SHOT=$(CHROMUX_PROFILE=$PROFILE node "$CT" screenshot tab-coord /tmp/chromux-zoom-$$.png 2>/dev/null)
check "zoomed screenshot records visual viewport scale" '"scale": 1.5' "$ZOOM_SHOT"
ZOOM_CLICK=$(CHROMUX_PROFILE=$PROFILE node "$CT" click tab-coord --xy 270 210 --space image 2>/dev/null)
check "zoomed image-space click reports converted CSS coordinates" '"css":' "$ZOOM_CLICK"
ZOOM_TITLE=$(CHROMUX_PROFILE=$PROFILE node "$CT" eval tab-coord "document.title" 2>/dev/null)
check "image-space click reaches target at visual viewport scale 1.5" "image-clicked" "$ZOOM_TITLE"
CHROMUX_PROFILE=$PROFILE node "$CT" close tab-coord 2>/dev/null > /dev/null
rm -f /tmp/chromux-dpr1-$$.png /tmp/chromux-dpr2-$$.png /tmp/chromux-region-$$.png /tmp/chromux-region-chained-$$.png /tmp/chromux-ref-$$.png /tmp/chromux-ref-offscreen-$$.png /tmp/chromux-region-offscreen-$$.png /tmp/chromux-zoom-$$.png

# --- Test 5c.0b: hover and real CDP drag paths ---
echo ""
echo "--- Test 5c.0b: Hover, pointer drag, and native HTML5 drag ---"
ACTION_HTML='<title>InputActions</title><style>body{margin:0}.hover{position:absolute;left:20px;top:20px;width:100px;height:40px}.tip{display:none;position:absolute;top:65px}.hover:hover+.tip{display:block}.sort{position:absolute;left:20px;top:120px;width:160px;margin:0;padding:0;list-style:none}.sortItem{height:44px;line-height:44px;padding:0 10px;box-sizing:border-box}.source{background:#9cf}.dest{background:#cfc}.htmlsrc{position:absolute;left:20px;top:240px;width:80px;height:50px;background:#fc9}.htmldest{position:absolute;left:220px;top:240px;width:100px;height:70px;background:#ccf}.badsrc{position:absolute;left:350px;top:240px;width:80px;height:50px;background:#fcc}.covered{position:absolute;left:340px;top:20px;width:60px;height:40px}.cover{position:absolute;left:335px;top:15px;width:70px;height:50px;background:#fff;z-index:2}#out{position:absolute;left:220px;top:120px}</style><button id="hover" class="hover">Hover me</button><p class="tip">Tooltip shown</p><ol id="pointerSort" class="sort"><li id="pointer" class="sortItem source" role="button">Pointer item</li><li id="pointerDest" class="sortItem dest" role="button">Pointer target</li></ol><div id="htmlsrc" class="htmlsrc" role="button" draggable="true">HTML source</div><div id="htmldest" class="htmldest" role="button">HTML target</div><div id="badsrc" class="badsrc" role="button">Bad source</div><button id="hidden" style="display:none">Hidden</button><button id="covered" class="covered">Covered</button><div class="cover">cover</div><p id="out">idle</p><script>const out=document.getElementById("out");const sort=document.getElementById("pointerSort");const pointer=document.getElementById("pointer");const pointerDest=document.getElementById("pointerDest");let down=false;pointer.addEventListener("pointerdown",e=>{down=true;pointer.setPointerCapture(e.pointerId)});pointer.addEventListener("pointermove",e=>{if(down&&e.clientY>=pointerDest.getBoundingClientRect().top+pointerDest.offsetHeight/2){sort.appendChild(pointer);out.textContent="sorted:"+Array.from(sort.children,el=>el.id).join(",")}});pointer.addEventListener("pointerup",()=>down=false);pointer.addEventListener("pointercancel",()=>down=false);document.getElementById("htmldest").addEventListener("dragover",e=>e.preventDefault());document.getElementById("htmldest").addEventListener("drop",e=>{e.preventDefault();out.textContent="html5 dropped"});window.badDrag={pointerup:0,captured:false};const bad=document.getElementById("badsrc");bad.addEventListener("pointerdown",e=>{bad.setPointerCapture(e.pointerId)});bad.addEventListener("gotpointercapture",()=>badDrag.captured=true);bad.addEventListener("lostpointercapture",()=>badDrag.captured=false);bad.addEventListener("pointerup",()=>badDrag.pointerup+=1)</script>'
ACTION_URL="data:text/html,$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$ACTION_HTML")"
CHROMUX_PROFILE=$PROFILE node "$CT" open tab-actions "$ACTION_URL" 2>/dev/null > /dev/null
ACTION_SNAP=$(CHROMUX_PROFILE=$PROFILE node "$CT" snapshot tab-actions 2>/dev/null)
HOVER_REF=$(echo "$ACTION_SNAP" | grep "Hover me" | grep -o '@[0-9]*' | head -1)
HOVER_RESULT=$(CHROMUX_PROFILE=$PROFILE node "$CT" hover tab-actions "$HOVER_REF" 2>/dev/null)
check "hover by ref exposes hover-only content" "Tooltip shown" "$HOVER_RESULT"
CHROMUX_PROFILE=$PROFILE node "$CT" hover tab-actions --xy 430 300 --no-verify 2>/dev/null > /dev/null
HOVER_XY=$(CHROMUX_PROFILE=$PROFILE node "$CT" hover tab-actions --xy 70 40 2>/dev/null)
check "hover by CSS coordinates reports target space" '"space": "css"' "$HOVER_XY"
if CHROMUX_PROFILE=$PROFILE node "$CT" hover tab-actions '#hidden' >/tmp/chromux-hover-hidden-$$.txt 2>&1; then
  echo "  ✗ hover accepted hidden target"
  FAIL=$((FAIL+1))
else
  check "hover rejects hidden target with repair hint" "fresh ref" "$(cat /tmp/chromux-hover-hidden-$$.txt)"
fi
if CHROMUX_PROFILE=$PROFILE node "$CT" hover tab-actions '#covered' >/tmp/chromux-hover-covered-$$.txt 2>&1; then
  echo "  ✗ hover accepted covered target"
  FAIL=$((FAIL+1))
else
  check "hover rejects covered target" "covered" "$(cat /tmp/chromux-hover-covered-$$.txt)"
fi
CHROMUX_PROFILE=$PROFILE node "$CT" eval tab-actions "document.getElementById('hover').remove()" 2>/dev/null > /dev/null
if CHROMUX_PROFILE=$PROFILE node "$CT" hover tab-actions "$HOVER_REF" >/tmp/chromux-hover-stale-$$.txt 2>&1; then
  echo "  ✗ hover accepted stale ref"
  FAIL=$((FAIL+1))
else
  check "hover rejects stale ref" "not found or stale" "$(cat /tmp/chromux-hover-stale-$$.txt)"
fi
if CHROMUX_PROFILE=$PROFILE node "$CT" hover tab-actions --xy 9999 9999 >/tmp/chromux-hover-out-$$.txt 2>&1; then
  echo "  ✗ hover accepted out-of-viewport coordinates"
  FAIL=$((FAIL+1))
else
  check "hover rejects out-of-viewport coordinates" "outside viewport" "$(cat /tmp/chromux-hover-out-$$.txt)"
fi
POINTER_DRAG=$(CHROMUX_PROFILE=$PROFILE node "$CT" drag tab-actions '#pointer' --to '#pointerDest' --drag-mode pointer 2>/dev/null)
check "pointer drag reports real CDP mode" '"mode": "pointer"' "$POINTER_DRAG"
check "pointer drag response reports sorted DOM state" "sorted:pointerDest,pointer" "$POINTER_DRAG"
POINTER_ORDER=$(CHROMUX_PROFILE=$PROFILE node "$CT" eval tab-actions "Array.from(document.querySelectorAll('#pointerSort > *'), el => el.id).join(',')" 2>/dev/null)
check "pointer drag changes actual sortable DOM order" "pointerDest,pointer" "$POINTER_ORDER"
POINTER_RELEASE_PROBE=$(node "$(dirname "$CT")/benchmarks/pointer-drag-release-probe.mjs" 2>&1)
check "pointer drag releases the mouse after an injected movement failure" "cleanup probe passed" "$POINTER_RELEASE_PROBE"
HTML5_DRAG=$(CHROMUX_PROFILE=$PROFILE node "$CT" drag tab-actions '#htmlsrc' --to '#htmldest' 2>/dev/null)
check "draggable source auto-selects native HTML5 mode" '"mode": "html5"' "$HTML5_DRAG"
check "native HTML5 drag changes fixture state" "html5 dropped" "$HTML5_DRAG"
check "drag response confirms no synthetic fallback" '"syntheticFallback": false' "$HTML5_DRAG"
if CHROMUX_PROFILE=$PROFILE node "$CT" drag tab-actions '#badsrc' --to '#htmldest' --drag-mode html5 >/tmp/chromux-html5-failed-$$.txt 2>&1; then
  echo "  ✗ forced HTML5 drag unexpectedly succeeded for a non-draggable source"
  FAIL=$((FAIL+1))
else
  check "failed native HTML5 drag reports no interception" "did not start" "$(cat /tmp/chromux-html5-failed-$$.txt)"
fi
BAD_DRAG_STATE=$(CHROMUX_PROFILE=$PROFILE node "$CT" eval tab-actions "JSON.stringify(badDrag)" 2>/dev/null)
check "failed native HTML5 drag releases pointer capture" '"pointerup":1,"captured":false' "$BAD_DRAG_STATE"
CHROMUX_PROFILE=$PROFILE node "$CT" close tab-actions 2>/dev/null > /dev/null
rm -f /tmp/chromux-hover-hidden-$$.txt /tmp/chromux-hover-covered-$$.txt /tmp/chromux-hover-stale-$$.txt /tmp/chromux-hover-out-$$.txt /tmp/chromux-html5-failed-$$.txt

DRAG_SCROLL_HTML='<title>DragScroll</title><style>body{margin:0;min-height:1800px}#source,#dest{position:absolute;left:20px;width:100px;height:50px}#source{top:20px}#dest{top:1500px}</style><button id="source">Far source</button><button id="dest">Far destination</button><script>window.sourceDown=0;document.getElementById("source").addEventListener("pointerdown",()=>sourceDown+=1)</script>'
DRAG_SCROLL_URL="data:text/html,$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$DRAG_SCROLL_HTML")"
CHROMUX_PROFILE=$PROFILE node "$CT" open tab-drag-scroll "$DRAG_SCROLL_URL" 2>/dev/null > /dev/null
if CHROMUX_PROFILE=$PROFILE node "$CT" drag tab-drag-scroll '#source' --to '#dest' --drag-mode pointer >/tmp/chromux-drag-scroll-$$.txt 2>&1; then
  echo "  ✗ drag with separated offscreen endpoints unexpectedly reported success"
  FAIL=$((FAIL+1))
else
  check "drag rejects endpoints that cannot share the current viewport" "current viewport" "$(cat /tmp/chromux-drag-scroll-$$.txt)"
fi
DRAG_SCROLL_EVENTS=$(CHROMUX_PROFILE=$PROFILE node "$CT" eval tab-drag-scroll "window.sourceDown" 2>/dev/null)
check "rejected offscreen drag dispatches no stale source event" "0" "$DRAG_SCROLL_EVENTS"
CHROMUX_PROFILE=$PROFILE node "$CT" eval tab-drag-scroll "scrollTo(0,0)" 2>/dev/null > /dev/null
CHROMUX_PROFILE=$PROFILE node "$CT" screenshot tab-drag-scroll /tmp/chromux-drag-mixed-$$.png 2>/dev/null > /dev/null
if CHROMUX_PROFILE=$PROFILE node "$CT" drag tab-drag-scroll --xy 70 45 --space image --to '#dest' --drag-mode pointer >/tmp/chromux-drag-mixed-image-$$.txt 2>&1; then
  echo "  ✗ mixed image-coordinate drag scrolled to a stale selector endpoint"
  FAIL=$((FAIL+1))
else
  check "mixed image-coordinate drag rejects an offscreen selector without scrolling" "current viewport" "$(cat /tmp/chromux-drag-mixed-image-$$.txt)"
fi
DRAG_MIXED_SCROLL=$(CHROMUX_PROFILE=$PROFILE node "$CT" eval tab-drag-scroll "window.scrollY" 2>/dev/null)
check "mixed image-coordinate rejection preserves the captured viewport" "0" "$DRAG_MIXED_SCROLL"
CHROMUX_PROFILE=$PROFILE node "$CT" eval tab-drag-scroll "scrollTo(0,1200)" 2>/dev/null > /dev/null
if CHROMUX_PROFILE=$PROFILE node "$CT" drag tab-drag-scroll '#source' --to-xy 70 45 --drag-mode pointer >/tmp/chromux-drag-mixed-css-$$.txt 2>&1; then
  echo "  ✗ mixed selector-coordinate drag scrolled to a stale source endpoint"
  FAIL=$((FAIL+1))
else
  check "mixed selector-coordinate drag rejects an offscreen selector without scrolling" "current viewport" "$(cat /tmp/chromux-drag-mixed-css-$$.txt)"
fi
DRAG_MIXED_EVENTS=$(CHROMUX_PROFILE=$PROFILE node "$CT" eval tab-drag-scroll "window.sourceDown" 2>/dev/null)
check "mixed endpoint rejections dispatch no pointerdown" "0" "$DRAG_MIXED_EVENTS"
CHROMUX_PROFILE=$PROFILE node "$CT" close tab-drag-scroll 2>/dev/null > /dev/null
rm -f /tmp/chromux-drag-scroll-$$.txt /tmp/chromux-drag-mixed-$$.png /tmp/chromux-drag-mixed-image-$$.txt /tmp/chromux-drag-mixed-css-$$.txt

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
FILL_RESPONSE=$(CHROMUX_PROFILE=$PROFILE node "$CT" fill tab-input @1 "Filled Value" 2>/dev/null)
check "fill response verifies by default" '"changed"' "$FILL_RESPONSE"
FILL_STATE=$(CHROMUX_PROFILE=$PROFILE node "$CT" eval tab-input "JSON.stringify({value:document.getElementById('name').value,input:window.inputCount,change:window.changeCount})" 2>/dev/null)
check "fill sets input value" "Filled Value" "$FILL_STATE"
FILL_CHANGE_OK=$(CHROMUX_PROFILE=$PROFILE node "$CT" eval tab-input "window.changeCount > 0" 2>/dev/null)
check "fill dispatches change event" "true" "$FILL_CHANGE_OK"

# Snapshot must never leak typed password values.
PASS_HTML='<input id="user" aria-label="User"><input id="pw" type="password" placeholder="Password">'
PASS_URL="data:text/html,$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$PASS_HTML")"
CHROMUX_PROFILE=$PROFILE node "$CT" open tab-password "$PASS_URL" 2>/dev/null > /dev/null
CHROMUX_PROFILE=$PROFILE node "$CT" fill tab-password "#pw" "hunter2secret" 2>/dev/null > /dev/null
PASS_SNAP=$(CHROMUX_PROFILE=$PROFILE node "$CT" snapshot tab-password 2>/dev/null)
check "password snapshot keeps placeholder" "Password" "$PASS_SNAP"
if echo "$PASS_SNAP" | grep -q "hunter2secret"; then
  echo "  ✗ snapshot leaked password value"
  FAIL=$((FAIL+1))
else
  echo "  ✓ snapshot does not leak password value"
  PASS=$((PASS+1))
fi
CHROMUX_PROFILE=$PROFILE node "$CT" close tab-password 2>/dev/null > /dev/null

# Sensitive non-password inputs (card numbers, OTPs) are usually type=text|tel;
# mask them by autocomplete/name/id heuristics.
# No aria-labels here on purpose: label-less inputs are the ones whose typed
# value would otherwise appear in the snapshot.
SENSITIVE_HTML='<input name="card_number" autocomplete="cc-number" placeholder="Card number"><input id="otp" type="tel" autocomplete="one-time-code" placeholder="Verification code"><input id="city" placeholder="City">'
SENSITIVE_URL="data:text/html,$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$SENSITIVE_HTML")"
CHROMUX_PROFILE=$PROFILE node "$CT" open tab-sensitive "$SENSITIVE_URL" 2>/dev/null > /dev/null
CHROMUX_PROFILE=$PROFILE node "$CT" fill tab-sensitive "[name=card_number]" "4111111111111111" 2>/dev/null > /dev/null
CHROMUX_PROFILE=$PROFILE node "$CT" fill tab-sensitive "#otp" "834920" 2>/dev/null > /dev/null
CHROMUX_PROFILE=$PROFILE node "$CT" fill tab-sensitive "#city" "Seoul" 2>/dev/null > /dev/null
SENSITIVE_SNAP=$(CHROMUX_PROFILE=$PROFILE node "$CT" snapshot tab-sensitive 2>/dev/null)
check "sensitive inputs keep their labels" "Card number" "$SENSITIVE_SNAP"
check "plain inputs still show typed values" "Seoul" "$SENSITIVE_SNAP"
if echo "$SENSITIVE_SNAP" | grep -qE "4111111111111111|834920"; then
  echo "  ✗ snapshot leaked a card number or OTP value"
  FAIL=$((FAIL+1))
else
  echo "  ✓ snapshot masks card number and OTP values"
  PASS=$((PASS+1))
fi
CHROMUX_PROFILE=$PROFILE node "$CT" close tab-sensitive 2>/dev/null > /dev/null

# --- Test 5c.1b: snapshot --interactive filter ---
echo ""
echo "--- Test 5c.1b: snapshot --interactive filter ---"
FILTER_HTML='<h1>Headline Heading</h1><p>Some descriptive paragraph text.</p><button aria-label="Do It">Go</button>'
FILTER_URL="data:text/html,$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$FILTER_HTML")"
CHROMUX_PROFILE=$PROFILE node "$CT" open tab-filter "$FILTER_URL" 2>/dev/null > /dev/null
FILTER_FULL=$(CHROMUX_PROFILE=$PROFILE node "$CT" snapshot tab-filter 2>/dev/null)
check "full snapshot includes heading" "Headline Heading" "$FILTER_FULL"
FILTER_ONLY=$(CHROMUX_PROFILE=$PROFILE node "$CT" snapshot tab-filter --interactive 2>/dev/null)
check "interactive snapshot keeps button ref" "@1 button" "$FILTER_ONLY"
if echo "$FILTER_ONLY" | grep -q "Headline Heading"; then
  echo "  ✗ interactive snapshot leaked non-interactive heading"
  FAIL=$((FAIL+1))
else
  echo "  ✓ interactive snapshot drops non-interactive nodes"
  PASS=$((PASS+1))
fi

# --- Test 5c.1c: fill on native select, snapshot --grep, run --arg ---
echo ""
echo "--- Test 5c.1c: select fill, snapshot --grep, run --arg ---"
SELECT_HTML='<title>SelectPage</title><form><input id="email" aria-label="Email"><select id="country" aria-label="Country"><option value="KR">South Korea</option><option value="US">United States</option></select><button id="go" type="button" aria-label="Go">Go</button></form><p id="out">status (pending)</p><script>window.changeCount=0;document.getElementById("country").addEventListener("change",()=>{window.changeCount+=1});</script>'
SELECT_URL="data:text/html,$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$SELECT_HTML")"
SELECT_OPEN=$(CHROMUX_PROFILE=$PROFILE node "$CT" open tab-select "$SELECT_URL" 2>/dev/null)
check "open inlines small-page interactive elements" '"elements"' "$SELECT_OPEN"
check "open inline elements carry refs" '@1' "$SELECT_OPEN"
CHROMUX_PROFILE=$PROFILE node "$CT" fill tab-select "#country" "US" 2>/dev/null > /dev/null
SELECT_STATE=$(CHROMUX_PROFILE=$PROFILE node "$CT" eval tab-select "JSON.stringify({value:document.getElementById('country').value,changes:window.changeCount})" 2>/dev/null)
check "fill selects option by value" '"value":"US"' "$SELECT_STATE"
check "fill on select dispatches change" '"changes":1' "$SELECT_STATE"
CHROMUX_PROFILE=$PROFILE node "$CT" fill tab-select "#country" "South Korea" 2>/dev/null > /dev/null
SELECT_LABEL=$(CHROMUX_PROFILE=$PROFILE node "$CT" eval tab-select "document.getElementById('country').value" 2>/dev/null)
check "fill selects option by label" "KR" "$SELECT_LABEL"
if CHROMUX_PROFILE=$PROFILE node "$CT" fill tab-select "#country" "Mars" >/tmp/chromux-select-out-$$.txt 2>&1; then
  echo "  ✗ fill with unknown option unexpectedly succeeded"
  FAIL=$((FAIL+1))
else
  SELECT_ERR=$(cat /tmp/chromux-select-out-$$.txt)
  check "fill with unknown option lists choices" "No option matching" "$SELECT_ERR"
fi
rm -f /tmp/chromux-select-out-$$.txt
GREP_OUT=$(CHROMUX_PROFILE=$PROFILE node "$CT" snapshot tab-select --grep "country" 2>/dev/null)
check "snapshot --grep keeps matching line" "Country" "$GREP_OUT"
check "snapshot --grep keeps ancestor context" "form" "$GREP_OUT"
check "snapshot --grep reports match count" "lines matched" "$GREP_OUT"
if echo "$GREP_OUT" | grep -q '"Email"'; then
  echo "  ✗ snapshot --grep leaked non-matching line"
  FAIL=$((FAIL+1))
else
  echo "  ✓ snapshot --grep drops non-matching lines"
  PASS=$((PASS+1))
fi
GREP_NONE=$(CHROMUX_PROFILE=$PROFILE node "$CT" snapshot tab-select --grep "zzz-not-there" 2>/dev/null)
check "snapshot --grep reports zero matches" "0 of" "$GREP_NONE"
GREP_LIT=$(CHROMUX_PROFILE=$PROFILE node "$CT" snapshot tab-select --grep "status (pending)" 2>/dev/null)
check "snapshot --grep retries valid regex literally" "matched literally" "$GREP_LIT"
check "snapshot --grep literal retry finds the line" "status (pending)" "$GREP_LIT"

# Silent-wrong guard: a valid regex that matches SOME lines while the literal
# reading matches MORE must say so instead of masquerading as the answer.
GREPNOTE_HTML='<title>GrepNotePage</title><p>price (USD) 10</p><p>price (USD) 20</p><p>price USD 30</p>'
GREPNOTE_URL="data:text/html,$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$GREPNOTE_HTML")"
CHROMUX_PROFILE=$PROFILE node "$CT" open tab-grepnote "$GREPNOTE_URL" 2>/dev/null > /dev/null
GREPNOTE_OUT=$(CHROMUX_PROFILE=$PROFILE node "$CT" snapshot tab-grepnote --grep "price (USD)" 2>/dev/null)
check "grep warns when the literal reading matches lines the regex missed" "read as literal text this pattern also matches 2 lines NOT shown here" "$GREPNOTE_OUT"
CHROMUX_PROFILE=$PROFILE node "$CT" close tab-grepnote 2>/dev/null > /dev/null
RUN_ARGS_OUT=$(CHROMUX_PROFILE=$PROFILE node "$CT" run tab-select 'return { s: args.label, n: args.count, o: args.fields }' --arg label=hello --arg count=7 --arg fields='{"#email":"a@b.c"}' 2>/dev/null)
check "run --arg passes string value" '"s": "hello"' "$RUN_ARGS_OUT"
check "run --arg parses JSON number" '"n": 7' "$RUN_ARGS_OUT"
check "run --arg parses JSON object" '"#email": "a@b.c"' "$RUN_ARGS_OUT"
FORM_FLOW_OUT=$(CHROMUX_PROFILE=$PROFILE node "$CT" run tab-select --file "$(dirname "$0")/snippets/_builtin/form-flow.js" --arg fields='{"#email":"agent@example.com","#country":"US"}' --arg submit='#go' 2>/dev/null)
check "form-flow fills multiple fields" '"submitted": true' "$FORM_FLOW_OUT"
check "form-flow handles native select" '"value": "US"' "$FORM_FLOW_OUT"
CHROMUX_PROFILE=$PROFILE node "$CT" close tab-select 2>/dev/null > /dev/null

# --- Test 5c.1d: clickable detection, state suffixes, --verify ---
echo ""
echo "--- Test 5c.1d: clickable detection, state suffixes, --verify ---"
CLICKABLE_HTML='<title>DivApp</title><style>.row{cursor:pointer}</style><div class="row" id="r1">Open item one</div><div class="row" id="r2">Open item two</div><p id="log">idle</p><script>document.querySelectorAll(".row").forEach(function(r){r.addEventListener("click",function(){document.getElementById("log").textContent="opened "+r.id})})</script>'
CLICKABLE_URL="data:text/html,$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$CLICKABLE_HTML")"
CLICKABLE_OPEN=$(CHROMUX_PROFILE=$PROFILE node "$CT" open tab-ckd "$CLICKABLE_URL" 2>/dev/null)
check "low-signal page inlines clickable divs on open" 'clickable \\"Open item one\\"' "$CLICKABLE_OPEN"
CLICKABLE_SNAP=$(CHROMUX_PROFILE=$PROFILE node "$CT" snapshot tab-ckd 2>/dev/null)
check "auto clickable detection assigns refs" '@1 clickable "Open item one"' "$CLICKABLE_SNAP"
VERIFY_OUT=$(CHROMUX_PROFILE=$PROFILE node "$CT" click tab-ckd @1 --verify 2>/dev/null)
check "click --verify returns changed diff" '"changed"' "$VERIFY_OUT"
check "click --verify diff shows the effect" "opened r1" "$VERIFY_OUT"
CHROMUX_PROFILE=$PROFILE node "$CT" close tab-ckd 2>/dev/null > /dev/null

STATE_HTML='<title>StatePage</title><input type="checkbox" id="cb" aria-label="Agree" checked><select id="sel" aria-label="Plan"><option value="a">Basic</option><option value="b" selected>Pro</option></select><button id="btn" disabled>Go</button><a href="/x">x</a><a href="/y">y</a><a href="/z">z</a>'
STATE_URL="data:text/html,$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$STATE_HTML")"
CHROMUX_PROFILE=$PROFILE node "$CT" open tab-state "$STATE_URL" 2>/dev/null > /dev/null
STATE_SNAP=$(CHROMUX_PROFILE=$PROFILE node "$CT" snapshot tab-state 2>/dev/null)
check "snapshot shows checkbox checked state" "[checkbox checked]" "$STATE_SNAP"
check "snapshot shows selected option value" '= "Pro"' "$STATE_SNAP"
check "snapshot shows disabled state" "(disabled)" "$STATE_SNAP"
if echo "$STATE_SNAP" | grep -q "clickable"; then
  echo "  ✗ clickable detection fired on a standard-element page"
  FAIL=$((FAIL+1))
else
  echo "  ✓ clickable detection stays off on standard pages"
  PASS=$((PASS+1))
fi
CHROMUX_PROFILE=$PROFILE node "$CT" close tab-state 2>/dev/null > /dev/null

# --- Test 5c.1e: slow-UI verify backoff + form-flow unfillable field ---
echo ""
echo "--- Test 5c.1e: Slow-UI verify backoff and unfillable-field error ---"
# The first verify of a session only primes the baseline, so each scenario
# clicks a primer button once before the click under test.
SLOW_HTML='<title>SlowPage</title><button id="prime">Prime</button><button id="go">Save</button><p id="out">idle</p><a href="/a">a</a><a href="/b">b</a><a href="/c">c</a><script>document.getElementById("go").addEventListener("click",function(){setTimeout(function(){document.getElementById("out").textContent="saved after wait"},1600)})</script>'
SLOW_URL="data:text/html,$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$SLOW_HTML")"
CHROMUX_PROFILE=$PROFILE node "$CT" open tab-slow "$SLOW_URL" 2>/dev/null > /dev/null
CHROMUX_PROFILE=$PROFILE node "$CT" click tab-slow "#prime" 2>/dev/null > /dev/null
SLOW_VERIFY=$(CHROMUX_PROFILE=$PROFILE node "$CT" click tab-slow "#go" 2>/dev/null)
check "verify backoff catches slow async update" "saved after wait" "$SLOW_VERIFY"
STATIC_HTML='<title>StaticPage</title><button id="noop">Noop</button><a href="/a">a</a><a href="/b">b</a><a href="/c">c</a>'
STATIC_URL="data:text/html,$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$STATIC_HTML")"
CHROMUX_PROFILE=$PROFILE node "$CT" open tab-noop "$STATIC_URL" 2>/dev/null > /dev/null
CHROMUX_PROFILE=$PROFILE node "$CT" click tab-noop "#noop" 2>/dev/null > /dev/null
NOOP_VERIFY=$(CHROMUX_PROFILE=$PROFILE node "$CT" click tab-noop "#noop" 2>/dev/null)
check "no-change verify is time-qualified, not definitive" "may still be updating" "$NOOP_VERIFY"
check "no-change verify warns before retrying" "BEFORE retrying" "$NOOP_VERIFY"
RICH_HTML='<title>RichPage</title><div id="rich" contenteditable="true" aria-label="Editor"><b>edit</b> me</div><div id="blocked" contenteditable="true" aria-label="Blocked editor">original</div><button id="s" type="button">Send</button><script>window.richEvents=[];document.getElementById("rich").addEventListener("beforeinput",e=>richEvents.push("beforeinput:"+e.inputType));document.getElementById("rich").addEventListener("input",e=>richEvents.push("input:"+e.inputType));document.getElementById("blocked").addEventListener("beforeinput",e=>e.preventDefault())</script>'
RICH_URL="data:text/html,$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$RICH_HTML")"
CHROMUX_PROFILE=$PROFILE node "$CT" open tab-rich "$RICH_URL" 2>/dev/null > /dev/null
RICH_SNAP=$(CHROMUX_PROFILE=$PROFILE node "$CT" snapshot tab-rich 2>/dev/null)
RICH_REF=$(echo "$RICH_SNAP" | grep "Editor" | grep -o '@[0-9]*' | head -1)
RICH_FILL=$(CHROMUX_PROFILE=$PROFILE node "$CT" fill tab-rich "$RICH_REF" "hello rich" 2>/dev/null)
check "fill replaces contenteditable text" '"observedText": "hello rich"' "$RICH_FILL"
check "fill identifies contenteditable route" '"contenteditable": true' "$RICH_FILL"
RICH_STATE=$(CHROMUX_PROFILE=$PROFILE node "$CT" run tab-rich "return await page('({text:document.getElementById(\"rich\").innerText,events:richEvents})')" 2>/dev/null)
check "contenteditable fill emits beforeinput" "beforeinput:insertText" "$RICH_STATE"
check "contenteditable fill emits input" "input:insertText" "$RICH_STATE"
CHROMUX_PROFILE=$PROFILE node "$CT" type tab-rich " plus" 2>/dev/null > /dev/null
RICH_TYPED=$(CHROMUX_PROFILE=$PROFILE node "$CT" eval tab-rich "document.getElementById('rich').innerText" 2>/dev/null)
check "type preserves insertion semantics after contenteditable fill" "hello rich plus" "$RICH_TYPED"
if CHROMUX_PROFILE=$PROFILE node "$CT" fill tab-rich '#blocked' "should not land" >/tmp/chromux-rich-blocked-$$.txt 2>&1; then
  echo "  ✗ cancelled contenteditable insertion unexpectedly reported success"
  FAIL=$((FAIL+1))
else
  check "cancelled contenteditable insertion fails loudly" "fill was rejected" "$(cat /tmp/chromux-rich-blocked-$$.txt)"
fi
BLOCKED_RICH_TEXT=$(CHROMUX_PROFILE=$PROFILE node "$CT" eval tab-rich "document.getElementById('blocked').innerText" 2>/dev/null)
check "cancelled contenteditable insertion preserves prior text" "original" "$BLOCKED_RICH_TEXT"
if CHROMUX_PROFILE=$PROFILE node "$CT" run tab-rich --file "$(dirname "$0")/snippets/_builtin/form-flow.js" --arg fields='{"#rich":"hello"}' --arg submit='#s' >/tmp/chromux-rich-out-$$.txt 2>&1; then
  echo "  ✗ form-flow silently accepted an unfillable contenteditable field"
  FAIL=$((FAIL+1))
else
  RICH_ERR=$(cat /tmp/chromux-rich-out-$$.txt)
  check "form-flow fails loudly on unfillable field" "not fillable via value" "$RICH_ERR"
fi
rm -f /tmp/chromux-rich-out-$$.txt /tmp/chromux-rich-blocked-$$.txt
CHROMUX_PROFILE=$PROFILE node "$CT" close tab-slow 2>/dev/null > /dev/null
CHROMUX_PROFILE=$PROFILE node "$CT" close tab-noop 2>/dev/null > /dev/null
CHROMUX_PROFILE=$PROFILE node "$CT" close tab-rich 2>/dev/null > /dev/null

# --- Test 5c.1f: ratio clickable gate and banded occlusion probe ---
echo ""
echo "--- Test 5c.1f: Ratio clickable gate and banded occlusion probe ---"
# Mixed page: plenty of standard links (old absolute gate would stay off) plus
# dense cursor-pointer tiles — the ratio gate must fire, and a clickable
# wrapper around a standard link must be deduplicated.
MIXED_HTML='<title>MixedApp</title><style>.tile{cursor:pointer;height:30px}</style><nav><a href="/1">n1</a> <a href="/2">n2</a> <a href="/3">n3</a> <a href="/4">n4</a> <a href="/5">n5</a> <a href="/6">n6</a> <a href="/7">n7</a> <a href="/8">n8</a> <a href="/9">n9</a> <a href="/10">n10</a> <a href="/11">n11</a> <a href="/12">n12</a></nav><div class="tile" id="t1">Tile one</div><div class="tile" id="t2">Tile two</div><div class="tile" id="t3">Tile three</div><div class="tile" id="t4">Tile four</div><div class="tile" id="t5">Tile five</div><div class="tile" id="t6">Tile six</div><div class="tile" id="t7">Tile seven</div><div class="tile" id="t8">Tile eight</div><div class="tile" id="wrap" style="height:16px"><a href="/inner" style="display:block;height:16px">Inner link</a></div><div class="tile" id="card" style="height:80px">Card nine <button style="width:20px;height:20px" aria-label="Fav"></button></div><p id="log">idle</p>'
MIXED_URL="data:text/html,$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$MIXED_HTML")"
CHROMUX_PROFILE=$PROFILE node "$CT" open tab-mixed "$MIXED_URL" 2>/dev/null > /dev/null
MIXED_SNAP=$(CHROMUX_PROFILE=$PROFILE node "$CT" snapshot tab-mixed 2>/dev/null)
check "ratio gate fires on standard-nav + div-control page" 'clickable "Tile one"' "$MIXED_SNAP"
if echo "$MIXED_SNAP" | grep -q 'clickable "Inner link"'; then
  echo "  ✗ clickable wrapper duplicating a same-size link was not deduplicated"
  FAIL=$((FAIL+1))
else
  echo "  ✓ clickable wrapper duplicating a same-size link deduplicated"
  PASS=$((PASS+1))
fi
check "card with a small inner button keeps its clickable ref" 'clickable "Card nine' "$MIXED_SNAP"
CHROMUX_PROFILE=$PROFILE node "$CT" close tab-mixed 2>/dev/null > /dev/null

# Verify baselines must be scroll-invariant: an action that only scrolls a
# clickable-dense page must not produce a "large update" fake diff.
SCROLL_TILES=$(node -e 'let h="";for(let i=1;i<=100;i++)h+=`<div class=\"tile\" id=\"s${i}\">Scroll tile ${i}</div>`;process.stdout.write(h)')
SCROLL_HTML='<title>ScrollApp</title><style>.tile{cursor:pointer;height:40px}</style><button id="noop">Noop</button><button id="jump">Jump</button>'"$SCROLL_TILES"'<script>document.getElementById("jump").addEventListener("click",()=>window.scrollTo(0,2400));document.querySelectorAll(".tile").forEach(t=>t.addEventListener("click",()=>{}));</script>'
SCROLL_URL="data:text/html,$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$SCROLL_HTML")"
CHROMUX_PROFILE=$PROFILE node "$CT" open tab-scrollv "$SCROLL_URL" 2>/dev/null > /dev/null
CHROMUX_PROFILE=$PROFILE node "$CT" click tab-scrollv "#noop" 2>/dev/null > /dev/null
SCROLL_VERIFY=$(CHROMUX_PROFILE=$PROFILE node "$CT" click tab-scrollv "#jump" 2>/dev/null)
if echo "$SCROLL_VERIFY" | grep -q "large update"; then
  echo "  ✗ scroll-only action produced a large fake verify diff"
  FAIL=$((FAIL+1))
else
  echo "  ✓ scroll-only action does not fake a large verify diff"
  PASS=$((PASS+1))
fi
CHROMUX_PROFILE=$PROFILE node "$CT" close tab-scrollv 2>/dev/null > /dev/null

# Occlusion: a dialog that spares the header but covers the middle and bottom
# of the viewport must be flagged; a bottom-fixed consent bar must not be.
OCCLUDE_LINKS='<div style="position:fixed;top:1vh;left:0"><a href="/h1">h1</a> <a href="/h2">h2</a> <a href="/h3">h3</a> <a href="/h4">h4</a> <a href="/h5">h5</a> <a href="/h6">h6</a> <a href="/h7">h7</a> <a href="/h8">h8</a> <a href="/h9">h9</a> <a href="/h10">h10</a></div><a style="position:fixed;top:40vh;left:2vw" href="/m1">m1</a><a style="position:fixed;top:45vh;left:2vw" href="/m2">m2</a><a style="position:fixed;top:50vh;left:2vw" href="/m3">m3</a><a style="position:fixed;top:55vh;left:2vw" href="/m4">m4</a><a style="position:fixed;top:78vh;left:2vw" href="/b1">b1</a><a style="position:fixed;top:88vh;left:2vw" href="/b2">b2</a>'
MODAL_HTML="<title>OccludePage</title>$OCCLUDE_LINKS"'<div id="modal" style="position:fixed;top:15vh;left:0;right:0;height:75vh;background:#fff;border:1px solid #000;z-index:9"><p>Subscribe to continue reading</p><button id="close">Close</button></div>'
MODAL_URL="data:text/html,$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$MODAL_HTML")"
CHROMUX_PROFILE=$PROFILE node "$CT" open tab-modal "$MODAL_URL" 2>/dev/null > /dev/null
MODAL_SNAP=$(CHROMUX_PROFILE=$PROFILE node "$CT" snapshot tab-modal 2>/dev/null)
check "header-sparing modal flagged as overlay" "overlay (covers page" "$MODAL_SNAP"
CHROMUX_PROFILE=$PROFILE node "$CT" close tab-modal 2>/dev/null > /dev/null
BAR_HTML="<title>ConsentBarPage</title>$OCCLUDE_LINKS"'<div id="bar" style="position:fixed;bottom:0;left:0;right:0;height:10vh;background:#333;color:#fff;z-index:9">We use cookies <button id="ok">OK</button></div>'
BAR_URL="data:text/html,$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$BAR_HTML")"
CHROMUX_PROFILE=$PROFILE node "$CT" open tab-bar "$BAR_URL" 2>/dev/null > /dev/null
BAR_SNAP=$(CHROMUX_PROFILE=$PROFILE node "$CT" snapshot tab-bar 2>/dev/null)
if echo "$BAR_SNAP" | grep -q "overlay (covers page"; then
  echo "  ✗ bottom consent bar was wrongly flagged as a page-wide overlay"
  FAIL=$((FAIL+1))
else
  echo "  ✓ bottom consent bar not flagged as overlay"
  PASS=$((PASS+1))
fi
check "consent bar button still listed" 'button "OK"' "$BAR_SNAP"
CHROMUX_PROFILE=$PROFILE node "$CT" close tab-bar 2>/dev/null > /dev/null

# Single-band pages (all controls in the header) must not promote a small
# ribbon covering them to a page-wide overlay directive.
RIBBON_HTML='<title>RibbonPage</title><div style="position:fixed;top:2vh;left:0"><a href="/h1">h1</a> <a href="/h2">h2</a> <a href="/h3">h3</a> <a href="/h4">h4</a> <a href="/h5">h5</a> <a href="/h6">h6</a> <a href="/h7">h7</a> <a href="/h8">h8</a> <a href="/h9">h9</a> <a href="/h10">h10</a></div><div id="ribbon" style="position:fixed;top:0;left:0;right:0;height:6vh;background:gold;z-index:9">Promo ribbon</div>'
RIBBON_URL="data:text/html,$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$RIBBON_HTML")"
CHROMUX_PROFILE=$PROFILE node "$CT" open tab-ribbon "$RIBBON_URL" 2>/dev/null > /dev/null
RIBBON_SNAP=$(CHROMUX_PROFILE=$PROFILE node "$CT" snapshot tab-ribbon 2>/dev/null)
if echo "$RIBBON_SNAP" | grep -q "overlay (covers page"; then
  echo "  ✗ small ribbon on a single-band page was promoted to page-wide overlay"
  FAIL=$((FAIL+1))
else
  echo "  ✓ small ribbon on a single-band page not promoted to overlay"
  PASS=$((PASS+1))
fi
CHROMUX_PROFILE=$PROFILE node "$CT" close tab-ribbon 2>/dev/null > /dev/null

# --- Test 5c.1g: iframe/shadow reach, dialogs, popups, upload/download, waits ---
echo ""
echo "--- Test 5c.1g: iframe/shadow reach, dialogs, popups, upload/download, waits ---"
IFRAME_HTML='<title>FramePage</title><p>Host page</p><iframe title="Embedded form" srcdoc="<input id=&quot;fi&quot; aria-label=&quot;Frame input&quot;><button id=&quot;fb&quot; onclick=&quot;fs.textContent=42&quot;>Frame Go</button><p id=&quot;fs&quot;>idle</p>"></iframe>'
IFRAME_URL="data:text/html,$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$IFRAME_HTML")"
CHROMUX_PROFILE=$PROFILE node "$CT" open tab-frame "$IFRAME_URL" 2>/dev/null > /dev/null
FRAME_SNAP=$(CHROMUX_PROFILE=$PROFILE node "$CT" snapshot tab-frame 2>/dev/null)
check "snapshot pierces same-origin iframe" "Frame input" "$FRAME_SNAP"
CHROMUX_PROFILE=$PROFILE node "$CT" fill tab-frame "#fi" "frame text" 2>/dev/null > /dev/null
FRAME_VALUE=$(CHROMUX_PROFILE=$PROFILE node "$CT" run tab-frame "return await js('document.querySelector(\"iframe\").contentDocument.getElementById(\"fi\").value')" 2>/dev/null)
check "fill reaches into iframe" "frame text" "$FRAME_VALUE"
FRAME_CLICK=$(CHROMUX_PROFILE=$PROFILE node "$CT" click tab-frame "#fb" 2>/dev/null)
check "click reaches into iframe" "42" "$FRAME_CLICK"
CHROMUX_PROFILE=$PROFILE node "$CT" close tab-frame 2>/dev/null > /dev/null

REACH_FIXTURE_INFO="/tmp/chromux-browser-reach-info-$$.json"
REACH_FIXTURE_LOG="/tmp/chromux-browser-reach-fixture-$$.log"
node benchmarks/browser-reach-fixture.mjs >"$REACH_FIXTURE_INFO" 2>"$REACH_FIXTURE_LOG" &
REACH_FIXTURE_PID=$!
for _ in $(seq 1 50); do
  if [ -s "$REACH_FIXTURE_INFO" ]; then break; fi
  sleep 0.1
done
if [ ! -s "$REACH_FIXTURE_INFO" ]; then
  echo "  ✗ cross-site fixture failed to start"
  cat "$REACH_FIXTURE_LOG" 2>/dev/null || true
  FAIL=$((FAIL+1))
else
  REACH_PARENT=$(node -e 'const fs=require("fs");console.log(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).parentUrl)' "$REACH_FIXTURE_INFO")
  REACH_GRADE=$(node -e 'const fs=require("fs");console.log(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).gradeUrl)' "$REACH_FIXTURE_INFO")
  REACH_ORIGIN=$(node -e 'const fs=require("fs");const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));console.log(new URL(v.gradeUrl).origin)' "$REACH_FIXTURE_INFO")
  REACH_CANVAS=$(node -e 'const fs=require("fs");console.log(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).canvasUrl)' "$REACH_FIXTURE_INFO")
  REACH_CANVAS_GRADE=$(node -e 'const fs=require("fs");console.log(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).canvasGradeUrl)' "$REACH_FIXTURE_INFO")
  # Tier 1 deliberately avoids target attachment. Prove its opaque geometry
  # and focused input path with normal Chrome site isolation still enabled.
  CHROMUX_PROFILE=$PROFILE node "$CT" open tab-opaque "$REACH_PARENT" 2>/dev/null > /dev/null
  CHROMUX_PROFILE=$PROFILE node "$CT" wait-for-selector tab-opaque 'iframe[data-loaded="true"]' 3000 2>/dev/null > /dev/null
  OPAQUE_SNAP=$(CHROMUX_PROFILE=$PROFILE node "$CT" snapshot tab-opaque 2>/dev/null)
  check "snapshot exposes opaque cross-origin frame ref" "cross-origin opaque" "$OPAQUE_SNAP"
  check "opaque frame snapshot exposes origin only" "origin=$REACH_ORIGIN" "$OPAQUE_SNAP"
  check "opaque frame snapshot exposes CSS rect" "rect=\[" "$OPAQUE_SNAP"
  if echo "$OPAQUE_SNAP" | grep -q "fixture-secret\|frame-child\|Private frame field"; then
    echo "  ✗ opaque frame snapshot leaked path, query, or child field data"
    FAIL=$((FAIL+1))
  else
    echo "  ✓ opaque frame snapshot redacts path, query, and child field data"
    PASS=$((PASS+1))
  fi
  OPAQUE_REF=$(echo "$OPAQUE_SNAP" | grep "cross-origin opaque" | grep -o '@[0-9]*' | head -1)
  CHROMUX_PROFILE=$PROFILE node "$CT" click tab-opaque "$OPAQUE_REF" --no-verify 2>/dev/null > /dev/null
  CHROMUX_PROFILE=$PROFILE node "$CT" type tab-opaque "opaque typed" --no-verify 2>/dev/null > /dev/null
  OPAQUE_GRADE=""
  for _ in $(seq 1 20); do
    OPAQUE_GRADE=$(node -e 'fetch(process.argv[1]).then(r=>r.text()).then(console.log)' "$REACH_GRADE" 2>/dev/null || true)
    if echo "$OPAQUE_GRADE" | grep -q "opaque typed"; then break; fi
    sleep 0.1
  done
  check "normal site-isolated opaque frame coordinate click plus type completes graded write" "opaque typed" "$OPAQUE_GRADE"
  CHROMUX_PROFILE=$PROFILE node "$CT" close tab-opaque 2>/dev/null > /dev/null

  OOPIF_OPEN=$(CHROMUX_PROFILE=$PROFILE node "$CT" open tab-oopif "$REACH_PARENT" --oopif 2>/dev/null)
  check "OOPIF opt-in reports enabled routing" '"enabled": true' "$OOPIF_OPEN"
  check "OOPIF opt-in attaches isolated frame" '"attachedFrames": 1' "$OOPIF_OPEN"
  OOPIF_SNAP=$(CHROMUX_PROFILE=$PROFILE node "$CT" snapshot tab-oopif 2>/dev/null)
  check "OOPIF snapshot exposes namespaced child ref" '@f[0-9]*g[0-9]*:[0-9]* textbox "Private frame field"' "$OOPIF_SNAP"
  if echo "$OOPIF_SNAP" | grep -q "fixture-secret\|frame-child\|account/private\|link-secret\|opaque typed"; then
    echo "  ✗ OOPIF snapshot leaked path, query, or frame field value"
    FAIL=$((FAIL+1))
  else
    echo "  ✓ OOPIF snapshot redacts path, query, and frame field value"
    PASS=$((PASS+1))
  fi
  OOPIF_REF=$(echo "$OOPIF_SNAP" | grep "Private frame field" | grep -o '@[A-Za-z0-9:]*' | head -1)
  OOPIF_NAV_REF=$(echo "$OOPIF_SNAP" | grep "Navigate child" | grep -o '@[A-Za-z0-9:]*' | head -1)
  OOPIF_SHADOW_BUTTON_REF=$(echo "$OOPIF_SNAP" | grep "Shadow child button" | grep -o '@[A-Za-z0-9:]*' | head -1)
  OOPIF_SHADOW_INPUT_REF=$(echo "$OOPIF_SNAP" | grep "Shadow child field" | grep -o '@[A-Za-z0-9:]*' | head -1)
  OOPIF_NESTED_BUTTON_REF=$(echo "$OOPIF_SNAP" | grep "Nested frame button" | grep -o '@[A-Za-z0-9:]*' | head -1)
  OOPIF_NESTED_INPUT_REF=$(echo "$OOPIF_SNAP" | grep "Nested frame field" | grep -o '@[A-Za-z0-9:]*' | head -1)
  OOPIF_SELECT_REF=$(echo "$OOPIF_SNAP" | grep "Frame mode" | grep -o '@[A-Za-z0-9:]*' | head -1)
  OOPIF_WAIT_TEXT=$(CHROMUX_PROFILE=$PROFILE node "$CT" wait-for-text tab-oopif "Opaque child ready" 3000 2>/dev/null)
  check "wait-for-text searches opted-in OOPIF targets" '"searchedOopif": true' "$OOPIF_WAIT_TEXT"
  OOPIF_CLICK=$(CHROMUX_PROFILE=$PROFILE node "$CT" click tab-oopif "$OOPIF_REF" --no-verify 2>/dev/null)
  check "namespaced click routes to OOPIF child" '"namespace": "f' "$OOPIF_CLICK"
  OOPIF_FILL=$(CHROMUX_PROFILE=$PROFILE node "$CT" fill tab-oopif "$OOPIF_REF" "oopif filled" --no-verify 2>/dev/null)
  check "namespaced fill routes to OOPIF child" '"filled": "@f' "$OOPIF_FILL"
  OOPIF_WAIT=$(CHROMUX_PROFILE=$PROFILE node "$CT" wait-for-selector tab-oopif "$OOPIF_REF" 3000 2>/dev/null)
  check "namespaced wait routes to OOPIF child" '"frame": "f' "$OOPIF_WAIT"
  OOPIF_GRADE=""
  for _ in $(seq 1 20); do
    OOPIF_GRADE=$(node -e 'fetch(process.argv[1]).then(r=>r.text()).then(console.log)' "$REACH_GRADE" 2>/dev/null || true)
    if echo "$OOPIF_GRADE" | grep -q "oopif filled"; then break; fi
    sleep 0.1
  done
  check "OOPIF fill reaches machine-grade endpoint" "oopif filled" "$OOPIF_GRADE"
  CHROMUX_PROFILE=$PROFILE node "$CT" click tab-oopif "$OOPIF_SHADOW_BUTTON_REF" --no-verify 2>/dev/null > /dev/null
  OOPIF_SHADOW_CLICK_GRADE=""
  for _ in $(seq 1 20); do
    OOPIF_SHADOW_CLICK_GRADE=$(node -e 'fetch(process.argv[1]).then(r=>r.text()).then(console.log)' "$REACH_GRADE" 2>/dev/null || true)
    if echo "$OOPIF_SHADOW_CLICK_GRADE" | grep -q "shadow-clicked"; then break; fi
    sleep 0.1
  done
  check "OOPIF namespaced click pierces child shadow DOM" "shadow-clicked" "$OOPIF_SHADOW_CLICK_GRADE"
  CHROMUX_PROFILE=$PROFILE node "$CT" fill tab-oopif "$OOPIF_SHADOW_INPUT_REF" "deep value" --no-verify 2>/dev/null > /dev/null
  OOPIF_SHADOW_FILL_GRADE=""
  for _ in $(seq 1 20); do
    OOPIF_SHADOW_FILL_GRADE=$(node -e 'fetch(process.argv[1]).then(r=>r.text()).then(console.log)' "$REACH_GRADE" 2>/dev/null || true)
    if echo "$OOPIF_SHADOW_FILL_GRADE" | grep -q "shadow:deep value"; then break; fi
    sleep 0.1
  done
  check "OOPIF namespaced fill pierces child shadow DOM" "shadow:deep value" "$OOPIF_SHADOW_FILL_GRADE"
  CHROMUX_PROFILE=$PROFILE node "$CT" click tab-oopif "$OOPIF_NESTED_BUTTON_REF" --no-verify 2>/dev/null > /dev/null
  OOPIF_NESTED_CLICK_GRADE=""
  for _ in $(seq 1 20); do
    OOPIF_NESTED_CLICK_GRADE=$(node -e 'fetch(process.argv[1]).then(r=>r.text()).then(console.log)' "$REACH_GRADE" 2>/dev/null || true)
    if echo "$OOPIF_NESTED_CLICK_GRADE" | grep -q "nested-clicked"; then break; fi
    sleep 0.1
  done
  check "OOPIF namespaced click pierces a child same-origin iframe" "nested-clicked" "$OOPIF_NESTED_CLICK_GRADE"
  CHROMUX_PROFILE=$PROFILE node "$CT" fill tab-oopif "$OOPIF_NESTED_INPUT_REF" "nested value" --no-verify 2>/dev/null > /dev/null
  OOPIF_NESTED_FILL_GRADE=""
  for _ in $(seq 1 20); do
    OOPIF_NESTED_FILL_GRADE=$(node -e 'fetch(process.argv[1]).then(r=>r.text()).then(console.log)' "$REACH_GRADE" 2>/dev/null || true)
    if echo "$OOPIF_NESTED_FILL_GRADE" | grep -q "nested:nested value"; then break; fi
    sleep 0.1
  done
  check "OOPIF namespaced fill pierces a child same-origin iframe" "nested:nested value" "$OOPIF_NESTED_FILL_GRADE"
  CHROMUX_PROFILE=$PROFILE node "$CT" fill tab-oopif "$OOPIF_SELECT_REF" "Beta" --no-verify 2>/dev/null > /dev/null
  OOPIF_SELECT_GRADE=""
  for _ in $(seq 1 20); do
    OOPIF_SELECT_GRADE=$(node -e 'fetch(process.argv[1]).then(r=>r.text()).then(console.log)' "$REACH_GRADE" 2>/dev/null || true)
    if echo "$OOPIF_SELECT_GRADE" | grep -q 'select:b'; then break; fi
    sleep 0.1
  done
  check "OOPIF namespaced fill supports native select labels" "select:b" "$OOPIF_SELECT_GRADE"
  CHROMUX_PROFILE=$PROFILE node "$CT" click tab-oopif "$OOPIF_NAV_REF" --no-verify 2>/dev/null > /dev/null
  OOPIF_NAV_LIST=$(CHROMUX_PROFILE=$PROFILE node "$CT" list 2>/dev/null)
  check "OOPIF navigation transition is not misclassified as a crash" '"crashedTotal": 0' "$OOPIF_NAV_LIST"
  sleep 0.4
  OOPIF_NAV_SNAP=$(CHROMUX_PROFILE=$PROFILE node "$CT" snapshot tab-oopif 2>/dev/null)
  OOPIF_NEW_REF=$(echo "$OOPIF_NAV_SNAP" | grep "Navigated frame field" | grep -o '@[A-Za-z0-9:]*' | head -1)
  check "OOPIF frame navigation produces new generation ref" '@f[0-9]*g[0-9]*:[0-9]* textbox "Navigated frame field"' "$OOPIF_NAV_SNAP"
  if [ "$OOPIF_REF" = "$OOPIF_NEW_REF" ]; then
    echo "  ✗ OOPIF ref generation did not change after navigation"
    FAIL=$((FAIL+1))
  else
    echo "  ✓ OOPIF ref generation changes after navigation"
    PASS=$((PASS+1))
  fi
  if CHROMUX_PROFILE=$PROFILE node "$CT" click tab-oopif "$OOPIF_REF" --no-verify >/tmp/chromux-oopif-stale-$$.txt 2>&1; then
    echo "  ✗ old OOPIF ref survived navigation"
    FAIL=$((FAIL+1))
  else
    check "old OOPIF ref is stale after navigation" "stale or detached" "$(cat /tmp/chromux-oopif-stale-$$.txt)"
  fi
  CHROMUX_PROFILE=$PROFILE node "$CT" run tab-oopif "return await js('document.getElementById(\"opaque-frame\").remove();true')" 2>/dev/null > /dev/null
  sleep 0.4
  OOPIF_LIST=$(CHROMUX_PROFILE=$PROFILE node "$CT" list 2>/dev/null)
  check "OOPIF detach removes child session" '"attachedFrames": 0' "$OOPIF_LIST"
  check "OOPIF detach increments cleanup count" '"detachedTotal": 1' "$OOPIF_LIST"
  check "OOPIF lifecycle leaves no pending setup" '"pending": 0' "$OOPIF_LIST"
  if CHROMUX_PROFILE=$PROFILE node "$CT" fill tab-oopif "$OOPIF_NEW_REF" "stale" --no-verify >/tmp/chromux-oopif-detached-$$.txt 2>&1; then
    echo "  ✗ detached OOPIF ref remained actionable"
    FAIL=$((FAIL+1))
  else
    check "detached OOPIF ref is invalidated" "stale or detached" "$(cat /tmp/chromux-oopif-detached-$$.txt)"
  fi
  CHROMUX_PROFILE=$PROFILE node "$CT" close tab-oopif 2>/dev/null > /dev/null
  rm -f /tmp/chromux-oopif-stale-$$.txt /tmp/chromux-oopif-detached-$$.txt

  OOPIF_CRASH_OPEN=$(CHROMUX_PROFILE=$PROFILE node "$CT" open tab-oopif-crash "$REACH_PARENT" --oopif 2>/dev/null)
  check "OOPIF crash fixture starts with attached child" '"attachedFrames": 1' "$OOPIF_CRASH_OPEN"
  OOPIF_CRASH=$(node benchmarks/oopif-crash-probe.mjs "$PROFILE_CDP_PORT" 2>/dev/null)
  check "OOPIF crash probe dispatches Page.crash to child target" '"dispatched":true' "$OOPIF_CRASH"
  OOPIF_CRASH_LIST=""
  for _ in $(seq 1 20); do
    OOPIF_CRASH_LIST=$(CHROMUX_PROFILE=$PROFILE node "$CT" list 2>/dev/null)
    if echo "$OOPIF_CRASH_LIST" | grep -q '"crashedTotal": 1'; then break; fi
    sleep 0.1
  done
  check "OOPIF renderer crash removes child session" '"attachedFrames": 0' "$OOPIF_CRASH_LIST"
  check "OOPIF renderer crash increments crash cleanup count" '"crashedTotal": 1' "$OOPIF_CRASH_LIST"
  check "OOPIF renderer crash leaves no pending setup" '"pending": 0' "$OOPIF_CRASH_LIST"
  OOPIF_CRASH_PARENT=$(CHROMUX_PROFILE=$PROFILE node "$CT" eval tab-oopif-crash "document.title" 2>/dev/null)
  check "parent session survives OOPIF renderer crash" "Browser Reach Parent" "$OOPIF_CRASH_PARENT"
  CHROMUX_PROFILE=$PROFILE node "$CT" close tab-oopif-crash 2>/dev/null > /dev/null

  OOPIF_CLOSE_OPEN=$(CHROMUX_PROFILE=$PROFILE node "$CT" open tab-oopif-close "$REACH_PARENT" --oopif 2>/dev/null)
  check "OOPIF close fixture starts with attached child" '"attachedFrames": 1' "$OOPIF_CLOSE_OPEN"
  OOPIF_CLOSE=$(CHROMUX_PROFILE=$PROFILE node "$CT" close tab-oopif-close 2>/dev/null)
  check "OOPIF close reports attached child before cleanup" '"attachedFrames": 1' "$OOPIF_CLOSE"
  check "OOPIF close disables child routing" '"enabled": false' "$OOPIF_CLOSE"
  check "OOPIF close drains child setup" '"pending": 0' "$OOPIF_CLOSE"
  check "OOPIF close drains CDP waiters" '"waiters": 0' "$OOPIF_CLOSE"
  check "OOPIF close removes CDP listener methods" '"listenerMethods": 0' "$OOPIF_CLOSE"
  check "OOPIF close removes every CDP listener" '"listeners": 0' "$OOPIF_CLOSE"
  OOPIF_CLOSED_LIST=$(CHROMUX_PROFILE=$PROFILE node "$CT" list 2>/dev/null)
  if echo "$OOPIF_CLOSED_LIST" | grep -q 'tab-oopif-close'; then
    echo "  ✗ OOPIF session remained listed after close"
    FAIL=$((FAIL+1))
  else
    echo "  ✓ OOPIF session is absent after close"
    PASS=$((PASS+1))
  fi

  echo ""
  echo "--- Test 5c.1h: Canvas crops and image-space actions at DPR 1 and 2 ---"
  for CANVAS_DPR in 1 2; do
    node -e 'fetch(process.argv[1].replace(/canvas-grade$/, "canvas-reset"), {method:"POST"})' "$REACH_CANVAS_GRADE" 2>/dev/null
    CANVAS_SESSION="tab-canvas-dpr$CANVAS_DPR"
    CANVAS_FULL="/tmp/chromux-canvas-full-$CANVAS_DPR-$$.png"
    CANVAS_REGION="/tmp/chromux-canvas-region-$CANVAS_DPR-$$.png"
    CHROMUX_PROFILE=$PROFILE node "$CT" open "$CANVAS_SESSION" "$REACH_CANVAS" 2>/dev/null > /dev/null
    CHROMUX_PROFILE=$PROFILE node "$CT" cdp "$CANVAS_SESSION" Emulation.setDeviceMetricsOverride "{\"width\":800,\"height\":600,\"deviceScaleFactor\":$CANVAS_DPR,\"mobile\":false}" 2>/dev/null > /dev/null
    CANVAS_META=$(CHROMUX_PROFILE=$PROFILE node "$CT" screenshot "$CANVAS_SESSION" "$CANVAS_FULL" --ref '#reach-canvas' 2>/dev/null)
    check "canvas DPR $CANVAS_DPR ref crop reports measured DPR" "\"devicePixelRatio\": $CANVAS_DPR" "$CANVAS_META"
    check "canvas DPR $CANVAS_DPR ref crop is bounded to element" '"source": "ref"' "$CANVAS_META"
    check "canvas DPR $CANVAS_DPR ref crop is not viewport-clipped" '"clipped": false' "$CANVAS_META"
    check "canvas DPR $CANVAS_DPR ref crop exposes local image coordinate source" '"imageSource": "ref"' "$CANVAS_META"
    CANVAS_POINTS=$(printf '%s' "$CANVAS_META" | node -e '
      let raw=""; process.stdin.on("data",c=>raw+=c); process.stdin.on("end",()=>{
        const value=JSON.parse(raw); const rect=value.crop.cssRect; const image=value.coordinateSpace.image;
        const css=(x,y)=>({x:rect.x+x*rect.width/600,y:rect.y+y*rect.height/360});
        const local=(x,y)=>({x:Math.round(x*image.width/600),y:Math.round(y*image.height/360)});
        const points=[[480,70],[300,180],[100,280],[500,280]].map(([x,y])=>local(x,y));
        const region=css(260,140); const expectedWidth=image.width;
        console.log([...points.flatMap(p=>[p.x,p.y]),region.x,region.y,80*rect.width/600,80*rect.height/360,expectedWidth].join(" "));
      });')
    read -r CANVAS_HOVER_X CANVAS_HOVER_Y CANVAS_CLICK_X CANVAS_CLICK_Y CANVAS_DRAG_X CANVAS_DRAG_Y CANVAS_DROP_X CANVAS_DROP_Y CANVAS_REGION_X CANVAS_REGION_Y CANVAS_REGION_W CANVAS_REGION_H CANVAS_EXPECTED_WIDTH <<< "$CANVAS_POINTS"
    check "canvas DPR $CANVAS_DPR ref crop image width follows measured scale" "\"width\": $CANVAS_EXPECTED_WIDTH" "$CANVAS_META"
    CHROMUX_PROFILE=$PROFILE node "$CT" hover "$CANVAS_SESSION" --xy "$CANVAS_HOVER_X" "$CANVAS_HOVER_Y" --space image --no-verify 2>/dev/null > /dev/null
    CHROMUX_PROFILE=$PROFILE node "$CT" click "$CANVAS_SESSION" --xy "$CANVAS_CLICK_X" "$CANVAS_CLICK_Y" --space image --no-verify 2>/dev/null > /dev/null
    CHROMUX_PROFILE=$PROFILE node "$CT" drag "$CANVAS_SESSION" --xy "$CANVAS_DRAG_X" "$CANVAS_DRAG_Y" --to-xy "$CANVAS_DROP_X" "$CANVAS_DROP_Y" --space image --drag-mode pointer --steps 12 --no-verify 2>/dev/null > /dev/null
    CANVAS_GRADE=""
    for _ in $(seq 1 20); do
      CANVAS_GRADE=$(node -e 'fetch(process.argv[1]).then(r=>r.text()).then(console.log)' "$REACH_CANVAS_GRADE" 2>/dev/null || true)
      if echo "$CANVAS_GRADE" | grep -q '"hover"' && echo "$CANVAS_GRADE" | grep -q '"click"' && echo "$CANVAS_GRADE" | grep -q '"drag"'; then break; fi
      sleep 0.1
    done
    check "canvas DPR $CANVAS_DPR image-space hover reaches target" '"hover"' "$CANVAS_GRADE"
    check "canvas DPR $CANVAS_DPR image-space click reaches target" '"click"' "$CANVAS_GRADE"
    check "canvas DPR $CANVAS_DPR image-space drag reaches target" '"drag"' "$CANVAS_GRADE"
    CANVAS_REGION_META=$(CHROMUX_PROFILE=$PROFILE node "$CT" screenshot "$CANVAS_SESSION" "$CANVAS_REGION" --region "$CANVAS_REGION_X" "$CANVAS_REGION_Y" "$CANVAS_REGION_W" "$CANVAS_REGION_H" 2>/dev/null)
    check "canvas DPR $CANVAS_DPR region crop reports region source" '"source": "region"' "$CANVAS_REGION_META"
    CHROMUX_PROFILE=$PROFILE node "$CT" close "$CANVAS_SESSION" 2>/dev/null > /dev/null
    rm -f "$CANVAS_FULL" "$CANVAS_REGION"
  done
fi
kill "$REACH_FIXTURE_PID" 2>/dev/null || true
wait "$REACH_FIXTURE_PID" 2>/dev/null || true
REACH_FIXTURE_PID=""
rm -f "$REACH_FIXTURE_INFO" "$REACH_FIXTURE_LOG"
REACH_FIXTURE_INFO=""
REACH_FIXTURE_LOG=""

SHADOW_HTML='<title>ShadowPage</title><div id="host"></div><div id="shadow-cover" style="display:none;position:fixed;inset:0;z-index:9999"></div><p id="out">idle</p><script>const r=document.getElementById("host").attachShadow({mode:"open"});r.innerHTML="<button id=\"sbtn\">Shadow button</button>";r.getElementById("sbtn").addEventListener("click",()=>{document.getElementById("out").textContent="shadow clicked"});</script>'
SHADOW_URL="data:text/html,$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$SHADOW_HTML")"
CHROMUX_PROFILE=$PROFILE node "$CT" open tab-shadow "$SHADOW_URL" 2>/dev/null > /dev/null
SHADOW_SNAP=$(CHROMUX_PROFILE=$PROFILE node "$CT" snapshot tab-shadow 2>/dev/null)
check "snapshot pierces open shadow DOM" "Shadow button" "$SHADOW_SNAP"
SHADOW_REF=$(echo "$SHADOW_SNAP" | grep "Shadow button" | grep -o '@[0-9]*' | head -1)
SHADOW_CLICK=$(CHROMUX_PROFILE=$PROFILE node "$CT" click tab-shadow "$SHADOW_REF" 2>/dev/null)
check "click reaches into shadow DOM" "shadow clicked" "$SHADOW_CLICK"
CHROMUX_PROFILE=$PROFILE node "$CT" eval tab-shadow 'document.getElementById("shadow-cover").style.display="block"' 2>/dev/null > /dev/null
if CHROMUX_PROFILE=$PROFILE node "$CT" click tab-shadow "$SHADOW_REF" --no-verify >/tmp/chromux-shadow-covered-$$.txt 2>&1; then
  echo "  ✗ shadow target click ignored a covering light-DOM overlay"
  FAIL=$((FAIL+1))
else
  check "shadow target rejects covering light-DOM overlay" "target is covered" "$(cat /tmp/chromux-shadow-covered-$$.txt)"
fi
rm -f /tmp/chromux-shadow-covered-$$.txt
CHROMUX_PROFILE=$PROFILE node "$CT" close tab-shadow 2>/dev/null > /dev/null

DIALOG_HTML='<title>DialogPage</title><button id="warn">Warn</button><p id="r">idle</p><a href="/x">x</a><a href="/y">y</a><a href="/z">z</a><script>document.getElementById("warn").addEventListener("click",()=>{const ok=confirm("Really do it?");document.getElementById("r").textContent=ok?"confirmed":"declined"});</script>'
DIALOG_URL="data:text/html,$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$DIALOG_HTML")"
CHROMUX_PROFILE=$PROFILE node "$CT" open tab-dialog "$DIALOG_URL" 2>/dev/null > /dev/null
DIALOG_CLICK=$(CHROMUX_PROFILE=$PROFILE node "$CT" click tab-dialog "#warn" 2>/dev/null)
check "JS dialog auto-handled with note" "dialog auto-dismissed" "$DIALOG_CLICK"
check "dialog message surfaced" "Really do it?" "$DIALOG_CLICK"
DIALOG_ALIVE=$(CHROMUX_PROFILE=$PROFILE node "$CT" run tab-dialog "return await js('1+1')" 2>/dev/null)
check "session alive after dialog" "2" "$DIALOG_ALIVE"
CHROMUX_PROFILE=$PROFILE node "$CT" close tab-dialog 2>/dev/null > /dev/null

POPUP_HTML='<title>PopupPage</title><a id="ext" href="https://example.com" target="_blank">Open externally</a><a href="/y">y</a><a href="/z">z</a>'
POPUP_URL="data:text/html,$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$POPUP_HTML")"
CHROMUX_PROFILE=$PROFILE node "$CT" open tab-popup "$POPUP_URL" 2>/dev/null > /dev/null
POPUP_CLICK=$(CHROMUX_PROFILE=$PROFILE node "$CT" click tab-popup "#ext" 2>/dev/null)
check "popup click adopts new session" "newSession" "$POPUP_CLICK"
check "adopted session is named" "tab-popup-popup" "$POPUP_CLICK"
CHROMUX_PROFILE=$PROFILE node "$CT" close tab-popup-popup 2>/dev/null > /dev/null
CHROMUX_PROFILE=$PROFILE node "$CT" close tab-popup 2>/dev/null > /dev/null

UPLOAD_FILE="/tmp/chromux-upload-$$.txt"
printf 'hello upload' > "$UPLOAD_FILE"
UPLOAD_HTML='<title>UploadPage</title><input type="file" id="up" aria-label="Attachment"><p id="uname">none</p><a href="/x">x</a><a href="/y">y</a><a href="/z">z</a><script>document.getElementById("up").addEventListener("change",(e)=>{document.getElementById("uname").textContent="got "+e.target.files[0].name});</script>'
UPLOAD_URL="data:text/html,$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$UPLOAD_HTML")"
CHROMUX_PROFILE=$PROFILE node "$CT" open tab-upload "$UPLOAD_URL" 2>/dev/null > /dev/null
UPLOAD_OUT=$(CHROMUX_PROFILE=$PROFILE node "$CT" fill tab-upload "#up" --file "$UPLOAD_FILE" 2>/dev/null)
check "fill --file uploads into file input" "got chromux-upload-$$.txt" "$UPLOAD_OUT"
CHROMUX_PROFILE=$PROFILE node "$CT" close tab-upload 2>/dev/null > /dev/null
rm -f "$UPLOAD_FILE"

DOWNLOAD_HTML='<title>DownloadPage</title><a id="dl" href="data:text/plain;charset=utf-8,download-payload" download="chromux-report.txt">Download report</a><a href="/y">y</a><a href="/z">z</a>'
DOWNLOAD_URL="data:text/html,$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$DOWNLOAD_HTML")"
CHROMUX_PROFILE=$PROFILE node "$CT" open tab-download "$DOWNLOAD_URL" 2>/dev/null > /dev/null
DOWNLOAD_OUT=$(CHROMUX_PROFILE=$PROFILE node "$CT" download tab-download "#dl" --to /tmp 2>/dev/null)
check "download completes with file path" '"downloaded": "chromux-report' "$DOWNLOAD_OUT"
DOWNLOAD_PATH=$(echo "$DOWNLOAD_OUT" | grep -o '"path": "[^"]*"' | cut -d'"' -f4)
if [ -n "$DOWNLOAD_PATH" ] && grep -q "download-payload" "$DOWNLOAD_PATH" 2>/dev/null; then
  echo "  ✓ downloaded file has expected content"
  PASS=$((PASS+1))
else
  echo "  ✗ downloaded file missing or wrong content ($DOWNLOAD_PATH)"
  FAIL=$((FAIL+1))
fi
rm -f "$DOWNLOAD_PATH"
CHROMUX_PROFILE=$PROFILE node "$CT" close tab-download 2>/dev/null > /dev/null

GONE_HTML='<title>GonePage</title><div id="spinner">Loading...</div><a href="/x">x</a><a href="/y">y</a><a href="/z">z</a><script>setTimeout(()=>document.getElementById("spinner").remove(),400);</script>'
GONE_URL="data:text/html,$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$GONE_HTML")"
CHROMUX_PROFILE=$PROFILE node "$CT" open tab-gone "$GONE_URL" 2>/dev/null > /dev/null
GONE_OUT=$(CHROMUX_PROFILE=$PROFILE node "$CT" wait-for-selector tab-gone "#spinner" 3000 --gone 2>/dev/null)
check "wait-for-selector --gone resolves after removal" "goneSelector" "$GONE_OUT"
IDLE_OUT=$(CHROMUX_PROFILE=$PROFILE node "$CT" run tab-gone "return await waitFor(null, { kind: 'network-idle', timeoutMs: 5000, idleMs: 300 })" 2>/dev/null)
check "run waitFor network-idle resolves on quiet page" '"kind": "network-idle"' "$IDLE_OUT"
CHROMUX_PROFILE=$PROFILE node "$CT" close tab-gone 2>/dev/null > /dev/null

# --- Test 5c.1h: autocomplete --pick, click --text, skill topics, verify priming ---
echo ""
echo "--- Test 5c.1h: autocomplete --pick, click --text, skill topics, verify priming ---"
# The static nav <li> "Seoul Guide" is a trap: it is visible BEFORE typing and
# substring-matches the pick text, so only appeared-after-typing candidate
# filtering picks the real suggestion.
PICK_PAGE_HTML='<title>PickPage</title><nav><ul><li><a href="/guide">Seoul Guide</a></li><li><a href="/deals">Deals</a></li></ul></nav><input id="city" aria-label="City"><ul id="sug" hidden></ul><p id="chosen">none</p><a href="/x">x</a><a href="/y">y</a><a href="/z">z</a><script>const SUG={se:["Seattle (SEA)","Seoul (SEL)"],lo:["London (LHR)"]};const input=document.getElementById("city");input.addEventListener("input",()=>{const list=document.getElementById("sug");const opts=SUG[input.value.toLowerCase()]||[];setTimeout(()=>{list.innerHTML=opts.map(o=>`<li role="option">${o}</li>`).join("");list.hidden=!opts.length;},200);});document.getElementById("sug").addEventListener("click",(e)=>{const li=e.target.closest("li");if(!li)return;input.value=li.textContent;document.getElementById("chosen").textContent="chose "+li.textContent;document.getElementById("sug").hidden=true;});</script>'
PICK_URL="data:text/html,$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$PICK_PAGE_HTML")"
CHROMUX_PROFILE=$PROFILE node "$CT" open tab-pick "$PICK_URL" 2>/dev/null > /dev/null
PICK_OUT=$(CHROMUX_PROFILE=$PROFILE node "$CT" fill tab-pick "#city" "se" --pick "Seoul (SEL)" 2>/dev/null)
check "fill --pick chooses the matching suggestion" '"picked": "Seoul (SEL)"' "$PICK_OUT"
check "fill --pick effect visible in verify diff" "chose Seoul (SEL)" "$PICK_OUT"
PICK_TRAP=$(CHROMUX_PROFILE=$PROFILE node "$CT" fill tab-pick "#city" "se" --pick "Seoul" 2>/dev/null)
check "fill --pick ignores pre-existing nav items matching the text" '"picked": "Seoul (SEL)"' "$PICK_TRAP"
check "fill --pick reports its observed effect" '"pickEffect"' "$PICK_TRAP"
if CHROMUX_PROFILE=$PROFILE node "$CT" fill tab-pick "#city" "zz" --pick "Nowhere" >/tmp/chromux-pick-miss-$$.txt 2>&1; then
  echo "  ✗ fill --pick with no matching suggestion unexpectedly succeeded"
  FAIL=$((FAIL+1))
else
  PICK_MISS=$(cat /tmp/chromux-pick-miss-$$.txt)
  check "fill --pick fails with a hint when nothing appears" "No suggestion matching" "$PICK_MISS"
fi
rm -f /tmp/chromux-pick-miss-$$.txt
CHROMUX_PROFILE=$PROFILE node "$CT" close tab-pick 2>/dev/null > /dev/null

# The [onclick] wrapper is a trap: its innerText CONTAINS "Save draft" but is a
# huge section — substring matches must prefer the tightly-labeled inner control.
TEXTCLICK_HTML='<title>TextClickPage</title><div onclick="document.title=&quot;wrapper clicked&quot;"><p>A long descriptive section about drafts and saving and much more prose that makes this container label huge and unclickworthy as a unit.</p><button id="sv">Save draft</button></div><button>Delete</button><button>Delete</button><a href="/x">x</a><a href="/y">y</a><script>document.getElementById("sv").addEventListener("click",function(e){e.stopPropagation();document.title=this.textContent.trim()});</script>'
TEXTCLICK_URL="data:text/html,$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$TEXTCLICK_HTML")"
CHROMUX_PROFILE=$PROFILE node "$CT" open tab-textclick "$TEXTCLICK_URL" 2>/dev/null > /dev/null
TEXT_CLICK=$(CHROMUX_PROFILE=$PROFILE node "$CT" click tab-textclick --text "Save draft" 2>/dev/null)
check "click --text resolves a unique label" '"text": "Save draft"' "$TEXT_CLICK"
TEXT_TITLE=$(CHROMUX_PROFILE=$PROFILE node "$CT" eval tab-textclick "document.title" 2>/dev/null)
check "click --text actually clicked" "Save draft" "$TEXT_TITLE"
if CHROMUX_PROFILE=$PROFILE node "$CT" click tab-textclick --text "Delete" >/tmp/chromux-text-amb-$$.txt 2>&1; then
  echo "  ✗ ambiguous click --text unexpectedly succeeded"
  FAIL=$((FAIL+1))
else
  TEXT_AMB=$(cat /tmp/chromux-text-amb-$$.txt)
  check "ambiguous click --text lists candidates" "matches 2 elements" "$TEXT_AMB"
fi
rm -f /tmp/chromux-text-amb-$$.txt
CHROMUX_PROFILE=$PROFILE node "$CT" close tab-textclick 2>/dev/null > /dev/null

# Human handoff loop (skill recovery): waits must survive a paused profile.
HANDOFF_HTML='<title>HandoffPage</title><div id="pending">Waiting for login...</div><a href="/x">x</a><a href="/y">y</a><a href="/z">z</a><script>setTimeout(()=>{const d=document.createElement("div");d.id="authed";d.textContent="Welcome back";document.body.appendChild(d)},600);</script>'
HANDOFF_URL="data:text/html,$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$HANDOFF_HTML")"
CHROMUX_PROFILE=$PROFILE node "$CT" open tab-handoff "$HANDOFF_URL" 2>/dev/null > /dev/null
CHROMUX_PROFILE=$PROFILE node "$CT" pause 2>/dev/null > /dev/null
HANDOFF_WAIT=$(CHROMUX_PROFILE=$PROFILE node "$CT" wait-for-selector tab-handoff "#authed" 5000 2>/dev/null)
check "wait-for-selector works while profile is paused" "foundSelector" "$HANDOFF_WAIT"
if CHROMUX_PROFILE=$PROFILE node "$CT" click tab-handoff "#authed" >/tmp/chromux-paused-click-$$.txt 2>&1; then
  echo "  ✗ click unexpectedly succeeded while paused"
  FAIL=$((FAIL+1))
else
  PAUSED_CLICK=$(cat /tmp/chromux-paused-click-$$.txt)
  check "actions stay blocked while paused" "paused" "$PAUSED_CLICK"
fi
rm -f /tmp/chromux-paused-click-$$.txt
CHROMUX_PROFILE=$PROFILE node "$CT" resume 2>/dev/null > /dev/null
CHROMUX_PROFILE=$PROFILE node "$CT" close tab-handoff 2>/dev/null > /dev/null

SKILL_LIST=$(node "$CT" skill 2>/dev/null)
check "skill lists topics" '"forms"' "$SKILL_LIST"
SKILL_TOPIC=$(node "$CT" skill recovery 2>/dev/null)
check "skill topic prints human handoff recipe" "open --foreground" "$SKILL_TOPIC"
if node "$CT" skill nope-topic >/tmp/chromux-skill-miss-$$.txt 2>&1; then
  echo "  ✗ unknown skill topic unexpectedly succeeded"
  FAIL=$((FAIL+1))
else
  SKILL_MISS=$(cat /tmp/chromux-skill-miss-$$.txt)
  check "unknown skill topic lists available ones" "recovery" "$SKILL_MISS"
fi
rm -f /tmp/chromux-skill-miss-$$.txt

# Verify baseline is primed at open: the FIRST action on a large page must
# return a real diff, not "first observation of a large page".
PRIMED_HTML='<title>PrimedPage</title><button id="add">Add</button><script>document.getElementById("add").addEventListener("click",()=>{const p=document.createElement("p");p.textContent="added row";document.body.appendChild(p)});</script>'"$(node -e 'let h="";for(let i=0;i<80;i++)h+=`<p>Filler paragraph ${i} with enough words to make the page large.</p>`;process.stdout.write(h)')"
PRIMED_URL="data:text/html,$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$PRIMED_HTML")"
CHROMUX_PROFILE=$PROFILE node "$CT" open tab-primed "$PRIMED_URL" 2>/dev/null > /dev/null
PRIMED_OUT=$(CHROMUX_PROFILE=$PROFILE node "$CT" click tab-primed "#add" 2>/dev/null)
check "first action on a large page gets a real verify diff" "added row" "$PRIMED_OUT"
if echo "$PRIMED_OUT" | grep -q "first observation of a large page"; then
  echo "  ✗ verify baseline was not primed at open"
  FAIL=$((FAIL+1))
else
  echo "  ✓ verify baseline primed at open"
  PASS=$((PASS+1))
fi
CHROMUX_PROFILE=$PROFILE node "$CT" close tab-primed 2>/dev/null > /dev/null

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

# --- Test 5c.2: snapshot --diff and stable refs ---
echo ""
echo "--- Test 5c.2: snapshot --diff and stable refs ---"
DIFF_HTML='<title>DiffPage</title><button id="a">Alpha</button><button id="b">Beta</button>'
DIFF_URL="data:text/html,$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$DIFF_HTML")"
CHROMUX_PROFILE=$PROFILE node "$CT" open tab-diff "$DIFF_URL" 2>/dev/null > /dev/null
DIFF_FIRST=$(CHROMUX_PROFILE=$PROFILE node "$CT" snapshot tab-diff --diff 2>/dev/null)
check "first --diff falls back to full snapshot" "no previous snapshot" "$DIFF_FIRST"
check "first --diff still lists elements" '@1 button "Alpha"' "$DIFF_FIRST"
CHROMUX_PROFILE=$PROFILE node "$CT" eval tab-diff "const g=document.createElement('button');g.textContent='Gamma';document.body.appendChild(g);document.getElementById('a').remove();" 2>/dev/null > /dev/null
DIFF_OUT=$(CHROMUX_PROFILE=$PROFILE node "$CT" snapshot tab-diff --diff 2>/dev/null)
check "diff marks added element with new ref" '+ @3 button "Gamma"' "$DIFF_OUT"
check "diff marks removed element" '\- @1 button "Alpha"' "$DIFF_OUT"
check "diff omits unchanged lines" "1 unchanged omitted" "$DIFF_OUT"
DIFF_QUIET=$(CHROMUX_PROFILE=$PROFILE node "$CT" snapshot tab-diff --diff 2>/dev/null)
check "diff reports no changes when page is stable" "no changes since previous snapshot" "$DIFF_QUIET"
DIFF_FULL=$(CHROMUX_PROFILE=$PROFILE node "$CT" snapshot tab-diff 2>/dev/null)
check "surviving element keeps its ref across snapshots" '@2 button "Beta"' "$DIFF_FULL"
CHROMUX_PROFILE=$PROFILE node "$CT" close tab-diff 2>/dev/null > /dev/null

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
CHROMUX_PROFILE=$PROFILE node "$CT" press tab-press ArrowDown 2>/dev/null > /dev/null
CHROMUX_PROFILE=$PROFILE node "$CT" press tab-press Home 2>/dev/null > /dev/null
PRESS_STATE=$(CHROMUX_PROFILE=$PROFILE node "$CT" eval tab-press "JSON.stringify({value:document.getElementById('first').value,active:document.activeElement.id,keys:window.keys})" 2>/dev/null)
check "press Backspace edits focused input" '"value":"ab"' "$PRESS_STATE"
check "press Tab moves focus" '"active":"second"' "$PRESS_STATE"
check "press Enter recorded" "Enter" "$PRESS_STATE"
check "press Escape recorded" "Escape" "$PRESS_STATE"
check "press ArrowDown recorded" "ArrowDown" "$PRESS_STATE"
check "press Home recorded" "Home" "$PRESS_STATE"
WAIT_TEXT=$(CHROMUX_PROFILE=$PROFILE node "$CT" wait-for-text tab-press "Ready Text" 2000 2>/dev/null)
check "wait-for-text reports success" "Ready Text" "$WAIT_TEXT"
WAIT_SELECTOR=$(CHROMUX_PROFILE=$PROFILE node "$CT" wait-for-selector tab-press "#ready" 2000 2>/dev/null)
check "wait-for-selector reports success" "#ready" "$WAIT_SELECTOR"
RUN_FALLBACK=$(CHROMUX_PROFILE=$PROFILE node "$CT" run tab-press - <<'JS' 2>/dev/null
return await waitFor(['#missing-primary', '#ready', '#also-missing'], { kind: 'selector', timeoutMs: 3000 });
JS
)
check "waitFor fallback resolves the matching candidate" '"matched": "#ready"' "$RUN_FALLBACK"
if CHROMUX_PROFILE=$PROFILE node "$CT" run tab-press "return await waitFor(['#nope-a', '#nope-b'], { kind: 'selector', timeoutMs: 300 })" >/tmp/chromux-fallback-out-$$.txt 2>&1; then
  echo "  ✗ waitFor fallback with no matching candidate unexpectedly succeeded"
  FAIL=$((FAIL+1))
else
  FALLBACK_OUT=$(cat /tmp/chromux-fallback-out-$$.txt)
  check "waitFor fallback failure lists all candidates" "#nope-a | #nope-b" "$FALLBACK_OUT"
fi
rm -f /tmp/chromux-fallback-out-$$.txt
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

# --- Test 5c.4: saved action scripts and schema validation ---
echo ""
echo "--- Test 5c.4: Saved action scripts and schema validation ---"
SCRIPT_NAME="test-extract-$$"
SCRIPT_FILE="/tmp/chromux-script-$$.js"
cat > "$SCRIPT_FILE" <<'EOF'
return await page('({title: document.title, url: location.href})');
EOF
SAVE_OUT=$(node "$CT" script save "example.com/$SCRIPT_NAME" --file "$SCRIPT_FILE" 2>&1)
check "script save reports script path" "scripts/example.com" "$SAVE_OUT"
LIST_OUT=$(node "$CT" script example.com 2>&1)
check "script host listing shows saved script" "$SCRIPT_NAME" "$LIST_OUT"
SUB_LIST_OUT=$(node "$CT" script sub.example.com 2>&1)
check "script listing walks parent domains" "$SCRIPT_NAME" "$SUB_LIST_OUT"
SHOW_OUT=$(node "$CT" script show "example.com/$SCRIPT_NAME" 2>&1)
check "script show prints saved code" "location.href" "$SHOW_OUT"
OPEN_SCRIPT=$(CHROMUX_PROFILE=$PROFILE node "$CT" open tab-script https://example.com 2>/dev/null)
check "open surfaces saved scripts for the host" "$SCRIPT_NAME" "$OPEN_SCRIPT"
check "open includes a replay command" "chromux run tab-script --script example.com/$SCRIPT_NAME" "$OPEN_SCRIPT"
RUN_SCRIPT=$(CHROMUX_PROFILE=$PROFILE node "$CT" run tab-script --script "example.com/$SCRIPT_NAME" 2>/dev/null)
check "script replay returns page data" "example.com" "$RUN_SCRIPT"
SCHEMA_FILE="/tmp/chromux-schema-$$.json"
printf '{"type":"object","required":["title","url"],"properties":{"title":{"type":"string","minLength":1},"url":{"type":"string","pattern":"^https://"}}}' > "$SCHEMA_FILE"
RUN_SCHEMA_OK=$(CHROMUX_PROFILE=$PROFILE node "$CT" run tab-script --script "example.com/$SCRIPT_NAME" --schema "$SCHEMA_FILE" 2>/dev/null)
check "schema-validated replay prints result" "example.com" "$RUN_SCHEMA_OK"
BAD_SCHEMA_FILE="/tmp/chromux-bad-schema-$$.json"
printf '{"type":"object","required":["missingField"],"properties":{"title":{"type":"number"}}}' > "$BAD_SCHEMA_FILE"
if CHROMUX_PROFILE=$PROFILE node "$CT" run tab-script --script "example.com/$SCRIPT_NAME" --schema "$BAD_SCHEMA_FILE" >/tmp/chromux-schema-out-$$.txt 2>&1; then
  echo "  ✗ schema mismatch unexpectedly succeeded"
  FAIL=$((FAIL+1))
else
  SCHEMA_OUT=$(cat /tmp/chromux-schema-out-$$.txt)
  check "schema mismatch names missing property" "missingField" "$SCHEMA_OUT"
  check "schema mismatch names wrong type path" '\$.title' "$SCHEMA_OUT"
  check "failed replay points back at the script" "chromux script save example.com/$SCRIPT_NAME" "$SCHEMA_OUT"
fi
RM_OUT=$(node "$CT" script rm "example.com/$SCRIPT_NAME" 2>&1)
check "script rm removes saved script" '"removed": true' "$RM_OUT"
CHROMUX_PROFILE=$PROFILE node "$CT" close tab-script 2>/dev/null > /dev/null
rm -f "$SCRIPT_FILE" "$SCHEMA_FILE" "$BAD_SCHEMA_FILE" /tmp/chromux-schema-out-$$.txt

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

if node -e "const fs=require('fs'); const files=fs.readdirSync('snippets/_builtin').filter(f=>f.endsWith('.js')); const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor; for (const file of files) new AsyncFunction('cdp','js','sleep','waitLoad','page','waitFor','assertPage', fs.readFileSync('snippets/_builtin/'+file,'utf8'));" 2>/dev/null; then
  echo "  ✓ builtin helpers compile for chromux run"
  PASS=$((PASS+1))
else
  echo "  ✗ builtin helpers failed to compile for chromux run"
  FAIL=$((FAIL+1))
fi
if grep -q "innerText" snippets/_builtin/page-extract.js; then
  echo "  ✗ page-extract uses layout-triggering innerText"
  FAIL=$((FAIL+1))
else
  echo "  ✓ page-extract uses textContent for metadata extraction"
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
CHROMUX_PROFILE=$PROFILE node "$CT" close tab-filter 2>/dev/null > /dev/null
LIST2=$(CHROMUX_PROFILE=$PROFILE node "$CT" list 2>/dev/null)
check "all tabs closed" "{}" "$LIST2"

# --- Test 9b: Crawl batch, pause/resume, and resource guard ---
echo ""
echo "--- Test 9b: Crawl orchestration helpers ---"
BATCH_IN="/tmp/chromux-batch-urls-$$.txt"
BATCH_OUT="/tmp/chromux-batch-out-$$.jsonl"
printf 'https://example.com\nhttps://example.org\n' > "$BATCH_IN"
BATCH=$(CHROMUX_PROFILE=$PROFILE CHROMUX_MODE=crawl node "$CT" batch --file "$BATCH_IN" --workers 2 --retries 1 --host-backoff-ms 20 --out "$BATCH_OUT" --session-prefix batch-test 2>/dev/null)
check "batch reports total" '"total": 2' "$BATCH"
check "batch reports success" '"ok": 2' "$BATCH"
check "batch reports retry budget" '"retries": 1' "$BATCH"
check "batch reports p50 timing" '"p50DurationMs"' "$BATCH"
if [ "$(wc -l < "$BATCH_OUT" | tr -d ' ')" = "2" ]; then
  echo "  ✓ batch wrote JSONL output"
  PASS=$((PASS+1))
else
  echo "  ✗ batch JSONL output count wrong"
  FAIL=$((FAIL+1))
fi
if node -e 'const fs=require("fs"); const rows=fs.readFileSync(process.argv[1],"utf8").trim().split(/\n/).filter(Boolean).map(JSON.parse); if (!rows.every(row => row.attempts >= 1 && "failureKind" in row && row.host)) process.exit(1);' "$BATCH_OUT"; then
  echo "  ✓ batch JSONL includes attempts, host, and failureKind"
  PASS=$((PASS+1))
else
  echo "  ✗ batch JSONL missing scheduler metadata"
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
chmod -R u+rwX "$CHROMUX_HOME/profiles/$GUARD_PROFILE" 2>/dev/null || true
rm -rf "$CHROMUX_HOME/profiles/$GUARD_PROFILE" /tmp/chromux-guard-out-$$.txt

PREFIX_OTHER="$PROFILE-prefix-other"
PREFIX_TARGET="$PROFILE-prefix"
CHROMUX_PROFILE=$PREFIX_OTHER CHROMUX_MODE=crawl node "$CT" open prefix-other https://example.org 2>/dev/null > /dev/null
CHROMUX_PROFILE=$PREFIX_TARGET CHROMUX_MODE=crawl node "$CT" open prefix-target https://example.com 2>/dev/null > /dev/null
PREFIX_TARGET_COUNT=$(count_profile_chrome_processes "$PREFIX_TARGET")
PREFIX_OTHER_COUNT=$(count_profile_chrome_processes "$PREFIX_OTHER")
PREFIX_LIMIT=$((PREFIX_TARGET_COUNT + 1))
if [ "$PREFIX_TARGET_COUNT" -gt 0 ] && [ "$PREFIX_OTHER_COUNT" -gt 0 ] && CHROMUX_PROFILE=$PREFIX_TARGET CHROMUX_MODE=crawl CHROMUX_MAX_CHROME_PROCESSES_PER_PROFILE=$PREFIX_LIMIT node "$CT" open prefix-target-2 https://example.com/?second=1 >/tmp/chromux-prefix-out-$$.txt 2>&1; then
  PREFIX_OUT=$(cat /tmp/chromux-prefix-out-$$.txt)
  check "resource guard uses exact profile names" "example.com" "$PREFIX_OUT"
else
  PREFIX_OUT=$(cat /tmp/chromux-prefix-out-$$.txt 2>/dev/null || true)
  echo "  ✗ resource guard matched prefix profile incorrectly: target=$PREFIX_TARGET_COUNT other=$PREFIX_OTHER_COUNT limit=$PREFIX_LIMIT $PREFIX_OUT"
  FAIL=$((FAIL+1))
fi
node "$CT" kill "$PREFIX_TARGET" 2>/dev/null > /dev/null || true
node "$CT" kill "$PREFIX_OTHER" 2>/dev/null > /dev/null || true
chmod -R u+rwX "$CHROMUX_HOME/profiles/$PREFIX_TARGET" "$CHROMUX_HOME/profiles/$PREFIX_OTHER" 2>/dev/null || true
rm -rf "$CHROMUX_HOME/profiles/$PREFIX_TARGET" "$CHROMUX_HOME/profiles/$PREFIX_OTHER" /tmp/chromux-prefix-out-$$.txt

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
chmod -R u+rwX "$CHROMUX_HOME/profiles/$COLD_PROFILE" 2>/dev/null || true
rm -rf "$CHROMUX_HOME/profiles/$COLD_PROFILE"
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
chmod -R u+rwX "$CHROMUX_HOME/profiles/$COLD_PROFILE" 2>/dev/null || true
rm -rf "$CHROMUX_HOME/profiles/$COLD_PROFILE" /tmp/chromux-cold-*-$$.out /tmp/chromux-cold-*-$$.status

# --- Test 12: Live startup lock preservation ---
echo ""
echo "--- Test 12: Live startup lock preservation ---"
node "$CT" kill "$LIVE_LOCK_PROFILE" 2>/dev/null > /dev/null || true
chmod -R u+rwX "$CHROMUX_HOME/profiles/$LIVE_LOCK_PROFILE" 2>/dev/null || true
rm -rf "$CHROMUX_HOME/profiles/$LIVE_LOCK_PROFILE"
mkdir -p "$CHROMUX_HOME/run"
( node -e 'setTimeout(() => {}, 4000)' chromux.mjs ) &
LIVE_PID=$!
LIVE_LOCK="$CHROMUX_HOME/run/$LIVE_LOCK_PROFILE.lock"
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
chmod -R u+rwX "$CHROMUX_HOME/profiles/$LIVE_LOCK_PROFILE" 2>/dev/null || true
rm -rf "$CHROMUX_HOME/profiles/$LIVE_LOCK_PROFILE" "/tmp/chromux-live-lock-$$.out" "/tmp/chromux-live-lock-$$.status"

# --- Test 13: Reused-PID stale lock recovery ---
echo ""
echo "--- Test 13: Reused-PID stale lock recovery ---"
node "$CT" kill "$STALE_LOCK_PROFILE" 2>/dev/null > /dev/null || true
chmod -R u+rwX "$CHROMUX_HOME/profiles/$STALE_LOCK_PROFILE" 2>/dev/null || true
rm -rf "$CHROMUX_HOME/profiles/$STALE_LOCK_PROFILE"
( sleep 6 ) &
STALE_PID=$!
STALE_LOCK="$CHROMUX_HOME/run/$STALE_LOCK_PROFILE.lock"
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
chmod -R u+rwX "$CHROMUX_HOME/profiles/$STALE_LOCK_PROFILE" 2>/dev/null || true
rm -rf "$CHROMUX_HOME/profiles/$STALE_LOCK_PROFILE" "/tmp/chromux-stale-lock-$$.out" "/tmp/chromux-stale-lock-$$.status"

# --- Test 14: Dead-PID startup lock recovery ---
echo ""
echo "--- Test 14: Dead-PID startup lock recovery ---"
mkdir -p "$CHROMUX_HOME/run"
( : ) &
DEAD_PID=$!
wait "$DEAD_PID" || true
LOCK="$CHROMUX_HOME/run/$PROFILE.lock"
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

# --- Test 15: Benchmark and docs verifier ---
echo ""
echo "--- Test 15: Benchmark and docs verifier ---"
BENCH_OUT="/tmp/chromux-benchmark-smoke-$$.json"
BENCH_URLS="/tmp/chromux-benchmark-urls-$$.txt"
BENCH=$(CHROMUX_HOME="$CHROMUX_HOME" node benchmarks/chromux-benchmark.mjs --smoke --out "$BENCH_OUT" 2>/tmp/chromux-benchmark-smoke-$$.err)
check "benchmark smoke reports ok" '"ok": true' "$BENCH"
check "benchmark reports cold launch" '"coldLaunchMs"' "$BENCH"
check "benchmark reports batch p95" '"batchP95DurationMs"' "$BENCH"
if [ -s "$BENCH_OUT" ]; then
  echo "  ✓ benchmark wrote JSON artifact"
  PASS=$((PASS+1))
else
  echo "  ✗ benchmark JSON artifact missing"
  FAIL=$((FAIL+1))
fi
if [ -e "$BENCH_URLS" ]; then
  echo "  ✗ benchmark temp URL file was not cleaned up"
  FAIL=$((FAIL+1))
else
  echo "  ✓ benchmark temp URL file cleaned up"
  PASS=$((PASS+1))
fi
WEBGAMES_POLICY=$(node --input-type=module -e '
  import { webgamesCommandAllowed, webgamesPasswordMatches } from "./benchmarks/webgames.mjs";
  console.log(JSON.stringify({
    help: webgamesCommandAllowed("help"),
    screenshot: webgamesCommandAllowed("screenshot"),
    eval: webgamesCommandAllowed("eval"),
    wrong: webgamesPasswordMatches("canvas-catch-easy", "anything"),
    unknown: webgamesPasswordMatches("not-a-pinned-task", "anything"),
  }));')
check "WebGames policy allows CLI help and visual screenshot commands" '"help":true,"screenshot":true' "$WEBGAMES_POLICY"
check "WebGames policy blocks runtime eval commands" '"eval":false' "$WEBGAMES_POLICY"
check "WebGames machine grade rejects wrong and unpinned passwords" '"wrong":false,"unknown":false' "$WEBGAMES_POLICY"
DOC_CHECK=$(node benchmarks/chromux-doc-check.mjs 2>/dev/null)
check "doc check passed" '"ok": true' "$DOC_CHECK"
TOKEN_BENCH_OUT="/tmp/chromux-token-suite-$$.json"
if TOKEN_BENCH=$(node benchmarks/chromux-token-benchmark.mjs --out "$TOKEN_BENCH_OUT" 2>&1); then
  check "full suite payload benchmark records the report schema" '"schema": "chromux.token-benchmark.v1"' "$TOKEN_BENCH"
  check "full suite enforces named payload budgets" "Payload budgets: all within limits" "$TOKEN_BENCH"
  if [ -s "$TOKEN_BENCH_OUT" ]; then
    echo "  ✓ full suite payload benchmark wrote a report artifact"
    PASS=$((PASS+1))
  else
    echo "  ✗ full suite payload benchmark report is missing"
    FAIL=$((FAIL+1))
  fi
else
  echo "  ✗ full suite payload benchmark failed: $TOKEN_BENCH"
  FAIL=$((FAIL+1))
fi
rm -f "$BENCH_OUT" "$BENCH_URLS" "$TOKEN_BENCH_OUT" "${BENCH_OUT%.json}.png" "${BENCH_OUT%.json}-run-receipt.json" "${BENCH_OUT%.json}-batch.jsonl" /tmp/chromux-benchmark-smoke-$$.err

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
