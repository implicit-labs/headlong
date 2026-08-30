#!/usr/bin/env bash
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
GUARD="$(dirname "$HERE")/workspace-template/bin/headlong-question-guard"
pass=0; fail=0
ok() { pass=$((pass+1)); printf 'ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf 'FAIL %s\n' "$1"; }

accept() {
    local label="$1" input="$2"
    if output=$("$GUARD" "$input" 2>/dev/null) && [[ -n "$output" ]]; then ok "$label"; else bad "$label"; fi
}
reject() {
    local label="$1" input="$2"
    if "$GUARD" "$input" >/dev/null 2>&1; then bad "$label"; else ok "$label"; fi
}

accept "short real question passes" "Why?"
accept "specific question passes" "Which belief conflicts with the new launch decision?"
reject "empty question is blocked" "   "
reject "test filler is blocked" "test"
reject "punctuated connectivity filler is blocked" " Ping?! "
reject "option string is blocked" "--json"
reject "non-word payload is blocked" "12345"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]]
