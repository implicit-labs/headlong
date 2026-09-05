#!/usr/bin/env bash
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WATCHER="$(dirname "$HERE")/bin/headlong-contradiction-watcher"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
MEM="$WORK/mem"
LEDGER="$WORK/private-ledger"
mkdir -p "$MEM" "$WORK/stub"
pass=0; fail=0
ok() { pass=$((pass+1)); printf 'ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf 'FAIL %s%s\n' "$1" "${2:+ — $2}"; }
mode() { stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"; }

cat > "$WORK/stub/sentience" <<'STUB'
#!/bin/bash
touch "$SENTIENCE_MARKER"
exit 99
STUB
chmod +x "$WORK/stub/sentience"
export SENTIENCE_MARKER="$WORK/sentience-was-called"

cat > "$MEM/01-belief.md" <<'EOF'
---
id: belief-1
summary: Keep weekday evenings unscheduled
type: belief
created: 2026-08-20 12:00:00
stated_by: toma
topic: weekday-evenings
---

I want to protect weekday evenings and keep them unscheduled.
EOF

cat > "$MEM/02-decision.md" <<'EOF'
---
id: decision-1
summary: Book recurring weekday evening calls
type: decision
created: 2026-08-29 12:00:00
topic: weekday-evenings
---

I decided to book recurring weekday evening calls.
EOF

result=$(PATH="$WORK/stub:$PATH" "$WATCHER" \
    --mem-dir "$MEM" --ledger-dir "$LEDGER" \
    --now 2026-08-30T12:00:00Z --json)
if [[ "$(printf '%s' "$result" | jq -r .new_candidates)" = 1 ]] \
    && [[ "$(wc -l < "$LEDGER/candidates.jsonl" | tr -d ' ')" = 1 ]] \
    && jq -e '.mode == "shadow" and .delivery == "disabled" and .requires_human_review == true' \
        "$LEDGER/candidates.jsonl" >/dev/null; then
    ok "material conflict is recorded as a private shadow candidate"
else
    bad "material conflict is recorded as a private shadow candidate" "$result"
fi

result2=$(PATH="$WORK/stub:$PATH" "$WATCHER" \
    --mem-dir "$MEM" --ledger-dir "$LEDGER" \
    --now 2026-08-30T12:05:00Z --json)
if [[ "$(printf '%s' "$result2" | jq -r .new_candidates)" = 0 ]] \
    && [[ "$(wc -l < "$LEDGER/candidates.jsonl" | tr -d ' ')" = 1 ]]; then
    ok "candidate recording is idempotent across runs"
else
    bad "candidate recording is idempotent across runs" "$result2"
fi

if [[ ! -e "$SENTIENCE_MARKER" ]]; then
    ok "watcher never invokes a Sentience executable"
else
    bad "watcher never invokes a Sentience executable"
fi

if [[ "$(mode "$LEDGER")" = 700 && "$(mode "$LEDGER/candidates.jsonl")" = 600 \
    && "$(mode "$LEDGER/runs.jsonl")" = 600 ]]; then
    ok "ledger directory and records are private"
else
    bad "ledger directory and records are private" \
        "dir=$(mode "$LEDGER") candidates=$(mode "$LEDGER/candidates.jsonl") runs=$(mode "$LEDGER/runs.jsonl")"
fi

# A later same-subject belief between the original belief and action is an
# adjacent resolution. Re-run in a fresh ledger to ensure it suppresses the
# otherwise-valid pair rather than relying on candidate deduplication.
cat > "$MEM/015-resolution.md" <<'EOF'
---
id: belief-2
summary: Weekday evening rule changed for recurring calls
type: belief
created: 2026-08-25 12:00:00
stated_by: toma
topic: weekday-evenings
---

I changed my mind and now want recurring weekday evening calls.
EOF
RESOLVED_LEDGER="$WORK/resolved-ledger"
resolved=$(PATH="$WORK/stub:$PATH" "$WATCHER" \
    --mem-dir "$MEM" --ledger-dir "$RESOLVED_LEDGER" \
    --now 2026-08-30T12:00:00Z --json)
if [[ "$(printf '%s' "$resolved" | jq -r .new_candidates)" = 0 ]] \
    && [[ "$(printf '%s' "$resolved" | jq -r .screened_conflicts)" -ge 1 ]] \
    && jq -e '.status == "screened-out" and (.reasons[0] | contains("may resolve"))' \
        "$RESOLVED_LEDGER/screened.jsonl" >/dev/null; then
    ok "adjacent resolution suppresses the candidate and remains auditable"
else
    bad "adjacent resolution suppresses the candidate and remains auditable" "$resolved"
fi

# Legacy entries are only recovered when their body has an explicit kind
# label; an ordinary note is not semantically guessed into a belief/action.
UNTYPED="$WORK/untyped"
mkdir -p "$UNTYPED"
cat > "$UNTYPED/note.md" <<'EOF'
---
id: note-1
summary: I did a thing that might sound contradictory
type: note
created: 2026-08-29 12:00:00
---

This is just a note, not a tagged belief or decision.
EOF
untyped=$("$WATCHER" --mem-dir "$UNTYPED" --ledger-dir "$WORK/untyped-ledger" \
    --now 2026-08-30T12:00:00Z --json)
if [[ "$(printf '%s' "$untyped" | jq -r .typed_entries)" = 0 ]]; then
    ok "untagged prose is not semantically classified"
else
    bad "untagged prose is not semantically classified" "$untyped"
fi

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]]
