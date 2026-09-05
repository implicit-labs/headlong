#!/usr/bin/env bash
# Producer contract for versioned review manifests and immutable artifacts.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(dirname "$HERE")"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

pass=0 fail=0
ok()  { pass=$((pass+1)); printf 'ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf 'FAIL %s\n' "$1"; }

mkdir -p "$WORK/analysis"
printf '# Result\n\nObserved claim.\n' > "$WORK/analysis/result.md"
printf '[{"request_id":"approve","question":"Proceed?","authorized_scope":"Only the named follow-up."}]\n' > "$WORK/requests.json"
printf '[{"title":"Validate follow-up","scope":"Read-only validation","duration":"45m","expected_artifact":"validation.md","stopping_rule":"Stop at the recorded deadline."}]\n' > "$WORK/next.json"
printf '[{"claim_id":"ready-claim","claim_text":"Observed claim.","evidence_class":"observed","sources":[],"reason":"Persisted test evidence."}]\n' > "$WORK/provenance-ready.json"

run_id=$("$REPO/tools/headlong-review-run" begin --workspace "$WORK" \
    --identity reviewer --run-id residency-test --title Test --goal-ref goals/test.md \
    --started-at 2026-09-05T00:00:00+00:00 --deadline 2026-09-05T01:00:00+00:00)
manifest="$WORK/artifacts/runs/$run_id/manifest.json"
if [[ -f "$manifest" ]] && [[ "$(jq -r .status "$manifest")" == running ]]; then
    ok "begin creates a running schema-v1 manifest"
else
    bad "begin creates a running schema-v1 manifest"
fi

"$REPO/tools/headlong-review-run" checkpoint --workspace "$WORK" --run-id "$run_id" \
    --progress-summary "Source audit complete." >/dev/null
if [[ "$(jq -r .progress_summary "$manifest")" == "Source audit complete." ]]; then
    ok "checkpoint updates compact progress"
else
    bad "checkpoint updates compact progress"
fi

"$REPO/tools/headlong-review-run" ready --workspace "$WORK" --run-id "$run_id" \
    --artifact analysis/result.md --artifact-title Result \
    --progress-summary "Artifact ready." --status waiting_on_toma \
    --decision-requests requests.json --next-steps next.json \
    --provenance provenance-ready.json >/dev/null
artifact=$(jq -r .primary_artifact.path "$manifest")
if [[ "$(jq -r .status "$manifest")" == waiting_on_toma ]] \
    && [[ -f "$WORK/$artifact" ]] \
    && [[ "$(jq -r '.primary_artifact.sha256 | length' "$manifest")" -eq 64 ]] \
    && grep -q 'ready-claim' "$WORK/artifacts/runs/$run_id/provenance.jsonl"; then
    ok "ready snapshots and hashes the primary artifact"
else
    bad "ready snapshots and hashes the primary artifact"
fi

printf 'changed\n' >> "$WORK/analysis/result.md"
if ! grep -q changed "$WORK/$artifact"; then
    ok "artifact snapshot is immutable from later source edits"
else
    bad "artifact snapshot is immutable from later source edits"
fi

if "$REPO/tools/headlong-review-run" begin --workspace "$WORK" --identity reviewer \
    --run-id ../escape --title Bad --goal-ref x --deadline 2026-09-05T01:00:00Z \
    >/dev/null 2>&1; then
    bad "invalid run ids fail closed"
else
    ok "invalid run ids fail closed"
fi

printf '[{"claim_id":"claim-1","artifact_ref":"source.md","claim_text":"A traced claim.","evidence_class":"observed","sources":[],"reason":"Persisted evidence."}]\n' > "$WORK/provenance.json"
"$REPO/tools/headlong-review-run" import --workspace "$WORK" --identity reviewer \
    --run-id imported-real --title Imported --goal-ref goals/004.md \
    --artifact analysis/result.md --artifact-title "Imported result" \
    --started-at 2026-09-04T00:00:00Z --deadline 2026-09-04T01:00:00Z \
    --progress-summary "Imported and ready." --provenance provenance.json >/dev/null
imported="$WORK/artifacts/runs/imported-real/manifest.json"
imported_artifact=$(jq -r .primary_artifact.path "$imported")
if grep -q 'headlong://trace/claim-1' "$WORK/$imported_artifact" \
    && grep -q 'claim-1' "$WORK/artifacts/runs/imported-real/provenance.jsonl"; then
    ok "import adds explicit evidence markers and persisted traces"
else
    bad "import adds explicit evidence markers and persisted traces"
fi

if "$REPO/tools/headlong-review-run" ready --workspace "$WORK" --run-id "$run_id" \
    --artifact analysis/result.md --artifact-title Invalid \
    --progress-summary "Invalid wait." --status waiting_on_toma >/dev/null 2>&1; then
    bad "waiting_on_toma without a decision request fails closed"
else
    ok "waiting_on_toma without a decision request fails closed"
fi

printf '%s\n' '{"type":"annotation","annotation_id":"note-1","run_id":"imported-real","target_type":"claim","target_id":"claim-1","artifact_ref":"unused","artifact_sha256":"0000000000000000000000000000000000000000000000000000000000000000","category":"wrong_fact","note":"Replace this claim.","created_at":"2026-09-04T02:00:00Z"}' >> "$WORK/artifacts/runs/imported-real/annotations.jsonl"
feedback=$($REPO/tools/headlong-review-run feedback --workspace "$WORK" --format json)
if [[ "$(jq '.unresolved_annotations | length' <<<"$feedback")" -eq 1 ]]; then
    ok "later runs receive unresolved review feedback"
else
    bad "later runs receive unresolved review feedback"
fi

printf '# Replacement\n' > "$WORK/analysis/replacement.md"
printf '[{"claim_id":"replacement-1","artifact_ref":"source.md","claim_text":"Corrected claim.","evidence_class":"observed","sources":[],"reason":"Rechecked evidence."}]\n' > "$WORK/replacement-provenance.json"
$REPO/tools/headlong-review-run import --workspace "$WORK" --identity reviewer \
    --run-id later-run --title Later --goal-ref goals/later.md \
    --artifact analysis/replacement.md --artifact-title Replacement \
    --started-at 2026-09-05T02:00:00Z --deadline 2026-09-05T03:00:00Z \
    --progress-summary "Replacement ready." --provenance replacement-provenance.json >/dev/null
first_address=$($REPO/tools/headlong-review-run address --workspace "$WORK" \
    --run-id imported-real --annotation-id note-1 --later-run-id later-run \
    --replacement-claim-id replacement-1 --operation-id address-op-1)
second_address=$($REPO/tools/headlong-review-run address --workspace "$WORK" \
    --run-id imported-real --annotation-id note-1 --later-run-id later-run \
    --replacement-claim-id replacement-1 --operation-id address-op-1)
feedback=$($REPO/tools/headlong-review-run feedback --workspace "$WORK" --format json)
if [[ "$first_address" == "$second_address" ]] \
    && [[ "$(jq '.unresolved_annotations | length' <<<"$feedback")" -eq 0 ]]; then
    ok "later run addresses feedback append-only and idempotently"
else
    bad "later run addresses feedback append-only and idempotently"
fi

printf '%s\n' '[{"receipt_id":"receipt-secret","question":"Bearer secretsecret","response":"eyJabc.eyJdef.signature","timestamp":"2026-09-04T00:30:00Z","resulting_change":"AKIAABCDEFGHIJKLMNOP"}]' > "$WORK/receipts.json"
$REPO/tools/headlong-review-run import --workspace "$WORK" --identity reviewer \
    --run-id redacted-run --title Redacted --goal-ref goals/redacted.md \
    --artifact analysis/replacement.md --artifact-title Redacted \
    --started-at 2026-09-05T04:00:00Z --deadline 2026-09-05T05:00:00Z \
    --progress-summary "Redacted receipt." --sentience-receipts receipts.json >/dev/null
if grep -q '<redacted>' "$WORK/artifacts/runs/redacted-run/sentience-receipts.jsonl" \
    && ! grep -q 'AKIAABCDEFGHIJKLMNOP\|eyJabc' "$WORK/artifacts/runs/redacted-run/sentience-receipts.jsonl"; then
    ok "Sentience secrets are redacted before persistence"
else
    bad "Sentience secrets are redacted before persistence"
fi

printf '\n%s passed, %s failed\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]]
