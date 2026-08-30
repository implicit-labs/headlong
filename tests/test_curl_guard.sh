#!/usr/bin/env bash
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
GUARD="$(dirname "$HERE")/workspace-template/bin/curl"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
pass=0; fail=0
ok() { pass=$((pass+1)); printf 'ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf 'FAIL %s\n' "$1"; }

cat > "$WORK/real-curl" <<'STUB'
#!/bin/bash
printf '%s\n' "$*" >> "$CURL_CALLS"
printf 'stub response\n'
STUB
chmod +x "$WORK/real-curl"
export HEADLONG_REAL_CURL="$WORK/real-curl"
export CURL_CALLS="$WORK/calls"
: > "$CURL_CALLS"

if HEADLONG_NETWORK_MODE=deny "$GUARD" https://example.com >/dev/null 2>&1; then
    bad "network is denied by default"
else
    ok "network is denied by default"
fi

if HEADLONG_NETWORK_MODE=read-only HEADLONG_CURL_ALLOW_HOSTS=example.com \
    "$GUARD" -d payload https://example.com >/dev/null 2>&1; then
    bad "request bodies are blocked"
else
    ok "request bodies are blocked"
fi

if HEADLONG_NETWORK_MODE=read-only HEADLONG_CURL_ALLOW_HOSTS=example.com \
    "$GUARD" https://other.example >/dev/null 2>&1; then
    bad "hosts outside the allowlist are blocked"
else
    ok "hosts outside the allowlist are blocked"
fi

if output=$(HEADLONG_NETWORK_MODE=read-only HEADLONG_CURL_ALLOW_HOSTS=example.com \
    "$GUARD" --head https://example.com/path 2>/dev/null) \
    && [[ "$output" == "stub response" && "$(wc -l < "$CURL_CALLS" | tr -d ' ')" = 1 ]]; then
    ok "allowlisted read reaches real curl"
else
    bad "allowlisted read reaches real curl"
fi

if HEADLONG_NETWORK_MODE=read-only HEADLONG_CURL_ALLOW_HOSTS=example.com \
    "$GUARD" 'https://user:secret@example.com/private' >/dev/null 2>&1; then
    bad "URLs with embedded credentials are blocked"
else
    ok "URLs with embedded credentials are blocked"
fi

for bypass in '-L' '--connect-to example.com:443:other.example:443' \
    '--proxy http://other.example:8080' '--config injected.conf' \
    '--header Host:other.example'; do
    # shellcheck disable=SC2086  # intentional option splitting for test cases
    if HEADLONG_NETWORK_MODE=read-only HEADLONG_CURL_ALLOW_HOSTS=example.com \
        "$GUARD" $bypass https://example.com >/dev/null 2>&1; then
        bad "routing/auth bypass is blocked: $bypass"
    else
        ok "routing/auth bypass is blocked: $bypass"
    fi
done

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]]
