#!/usr/bin/env bash
# The expiry watchdog reports files written outside the workspace during a run.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(dirname "$HERE")"
WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
pass=0 fail=0
ok()  { pass=$((pass+1)); printf 'ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf 'FAIL %s\n' "$1"; }

WS="$WORK/ws"; HOMEDIR="$WORK/home"; mkdir -p "$WS/guardrails" "$HOMEDIR/.headlong/artifacts/agent" "$HOMEDIR/.headlong/run"
touch "$WS/.run-deadline"; sleep 1
echo draft > "$HOMEDIR/.headlong/artifacts/agent/escaped.md"      # output that escaped
echo 123   > "$HOMEDIR/.headlong/run/dispatcher.pid"              # legitimate state, ignored
mkdir -p "$WORK/bin"; printf '#!/bin/bash\nexit 0\n' > "$WORK/bin/thinkers"; chmod +x "$WORK/bin/thinkers"

HOME="$HOMEDIR" PATH="$WORK/bin:$PATH" HEADLONG_WORKSPACE="$WS" IDENTITY_DIR="" HEADLONG_APP_DIR="" \
  timeout 20 "$REPO/workspace-template/bin/headlong-expiry" agent 0.0003 "$WS" >/dev/null 2>&1

if [[ -f "$WS/guardrails/stray-writes.txt" ]] && grep -q "artifacts/agent/escaped.md" "$WS/guardrails/stray-writes.txt"; then
    ok "expiry reports a file written under ~/.headlong during the run"
else bad "expiry reports a file written under ~/.headlong during the run"; cat "$WS/guardrails/expiry.log" 2>/dev/null; fi
if ! grep -q "dispatcher.pid" "$WS/guardrails/stray-writes.txt" 2>/dev/null; then
    ok "expiry ignores Headlong's own run state"
else bad "expiry ignores Headlong's own run state"; fi
if grep -q "STRAY WRITES: 1 file" "$WS/guardrails/expiry.log"; then
    ok "expiry log names the count"
else bad "expiry log names the count"; fi

printf '\n%s passed, %s failed\n' "$pass" "$fail"
[[ $fail -eq 0 ]]
