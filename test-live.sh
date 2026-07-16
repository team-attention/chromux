#!/usr/bin/env bash
# Live-mode harness runner. Drives the real chromux extension -> WS -> daemon
# path in a throwaway Chrome for Testing / Chromium instance (never the user's
# own Chrome).
#
# Usage:
#   ./test-live.sh                 # run both suites
#   ./test-live.sh --suite parity  # parity commands only
#   ./test-live.sh --suite safety  # tab/attach/kill-switch safety only
#
# Browser resolution order: $CHROMUX_TEST_BROWSER, then a Playwright-managed
# Chromium/Chrome-for-Testing in the local cache. Skips (exit 0) when none is
# found so CI without a browser stays green.
set -euo pipefail
cd "$(dirname "$0")"

if [ "${1:-}" = "--suite" ]; then
  exec node test-live.mjs "$@"
fi

# No explicit suite: run both, fail if either fails.
rc=0
node test-live.mjs --suite parity "$@" || rc=1
node test-live.mjs --suite safety "$@" || rc=1
exit $rc
