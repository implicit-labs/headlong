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
printf '# Result\n\nObserved claim [t](headlong://trace/ready-claim).\n' > "$WORK/analysis/result.md"
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
    --provenance provenance-ready.json --no-diagram-reason "fixture: contract behaviour under test is not the drawing" >/dev/null
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
printf '# Imported result\n\nCurated from completed work.\n' > "$WORK/analysis/imported-source.md"
"$REPO/tools/headlong-review-run" import --workspace "$WORK" --identity reviewer \
    --run-id imported-real --title Imported --goal-ref goals/004.md \
    --artifact analysis/imported-source.md --artifact-title "Imported result" \
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


# --- Visual-first artifact contract ------------------------------------------
# These gates live in the producer on purpose. Three runs in a row wrote good
# documents and an unreachable ledger because only prose asked them not to.
VIS="$WORK/vis"; mkdir -p "$VIS/analysis"
vis_run=$("$REPO/tools/headlong-review-run" begin --workspace "$VIS" \
    --identity reviewer --run-id residency-visual --title Visual --goal-ref goals/test.md \
    --started-at 2026-09-05T00:00:00+00:00 --deadline 2026-09-05T01:00:00+00:00)
vis_manifest="$VIS/artifacts/runs/$vis_run/manifest.json"
printf '[{"claim_id":"c-one","claim_text":"A claim.","evidence_class":"observed","sources":[],"reason":"Test evidence."}]\n' > "$VIS/prov.json"
try() { "$REPO/tools/headlong-review-run" ready --workspace "$VIS" --run-id "$vis_run" \
    --artifact-title T --progress-summary S --provenance prov.json "$@" >/dev/null 2>&1; }

printf '# Report\n\nA claim with no marker at all.\n' > "$VIS/analysis/unreachable.md"
if try --artifact analysis/unreachable.md --no-diagram-reason x; then
    bad "ready refuses a claim with no marker or diagram anchor"
else ok "ready refuses a claim with no marker or diagram anchor"; fi

printf '# Report\n\nGhost [x](headlong://trace/c-missing), real [y](headlong://trace/c-one).\n' > "$VIS/analysis/dangling.md"
if try --artifact analysis/dangling.md --no-diagram-reason x; then
    bad "ready refuses a marker with no provenance record"
else ok "ready refuses a marker with no provenance record"; fi

printf '# Report\n\nReachable [t](headlong://trace/c-one).\n' > "$VIS/analysis/nodiagram.md"
if try --artifact analysis/nodiagram.md; then
    bad "ready refuses an artifact with no diagram and no waiver"
else ok "ready refuses an artifact with no diagram and no waiver"; fi

if try --artifact analysis/nodiagram.md --no-diagram-reason "Five unrelated strands share no mechanism." \
   && [[ "$(jq -r '.review_surface.no_diagram_reason' "$vis_manifest")" == Five* ]]; then
    ok "the no-diagram waiver is recorded in the manifest for the reader"
else bad "the no-diagram waiver is recorded in the manifest for the reader"; fi

printf '# Report\n\n<svg viewBox="0 0 10 10"><g data-node="n1" data-claim="c-one"><rect x="0" y="0" width="4" height="4"/></g></svg>\n' > "$VIS/analysis/diagram.md"
if try --artifact analysis/diagram.md \
   && [[ "$(jq -r '.review_surface.has_diagram' "$vis_manifest")" == true ]]; then
    ok "a diagram node anchors a claim with no prose marker"
else bad "a diagram node anchors a claim with no prose marker"; fi

printf '# Report\n\n<svg viewBox="0 0 10 10"><g data-claim="c-one"></g><script>alert(1)</script></svg>\n' > "$VIS/analysis/unsafe.md"
if try --artifact analysis/unsafe.md; then
    bad "ready refuses script inside the artifact"
else ok "ready refuses script inside the artifact"; fi

python3 -c "
import pathlib
pathlib.Path('$VIS/analysis/verbose.md').write_text(
    '# Report\n\nReachable [t](headlong://trace/c-one).\n\n' + ' '.join(['word'] * 1800) + '\n')"
if try --artifact analysis/verbose.md --no-diagram-reason x; then
    bad "ready refuses prose over the budget"
else ok "ready refuses prose over the budget"; fi
if try --artifact analysis/verbose.md --no-diagram-reason x --prose-budget 2500; then
    ok "a deliberately raised budget is honoured"
else bad "a deliberately raised budget is honoured"; fi


# --- The ledger never shrinks; receipts are never left PENDING ----------------
LED="$WORK/ledger"; mkdir -p "$LED/analysis"
led_run=$("$REPO/tools/headlong-review-run" begin --workspace "$LED" \
    --identity reviewer --run-id residency-ledger --title L --goal-ref goals/test.md \
    --started-at 2026-09-05T00:00:00+00:00 --deadline 2026-09-05T01:00:00+00:00)
printf '# R\n\n[a](headlong://trace/c-a) [b](headlong://trace/c-b)\n' > "$LED/analysis/two.md"
printf '# R\n\n[a](headlong://trace/c-a)\n' > "$LED/analysis/one.md"
printf '[{"claim_id":"c-a","claim_text":"A.","evidence_class":"observed","sources":[],"reason":"r"},{"claim_id":"c-b","claim_text":"B.","evidence_class":"observed","sources":[],"reason":"r"}]\n' > "$LED/two.json"
printf '[{"claim_id":"c-a","claim_text":"A.","evidence_class":"observed","sources":[],"reason":"r"}]\n' > "$LED/one.json"
ltry() { "$REPO/tools/headlong-review-run" ready --workspace "$LED" --run-id "$led_run" \
    --artifact-title T --progress-summary S --no-diagram-reason x "$@" >/dev/null 2>&1; }

ltry --artifact analysis/two.md --provenance two.json
if ltry --artifact analysis/one.md --provenance one.json; then
    bad "ready refuses a provenance ledger that shrank between snapshots"
else ok "ready refuses a provenance ledger that shrank between snapshots"; fi
if ltry --artifact analysis/two.md --provenance two.json; then
    ok "re-snapshotting the same or larger claim set is allowed"
else bad "re-snapshotting the same or larger claim set is allowed"; fi

printf '[{"receipt_id":"r-1","question":"Q?","response":"A.","timestamp":"2026-09-05T00:30:00Z","resulting_change":"PENDING: say what changed"}]\n' > "$LED/pending.json"
if ltry --artifact analysis/two.md --provenance two.json --sentience-receipts pending.json; then
    bad "ready refuses a receipt whose resulting_change is still PENDING"
else ok "ready refuses a receipt whose resulting_change is still PENDING"; fi

# --- ask-sentience writes the payload AND a valid receipt stub ---------------
AS="$WORK/ask"; mkdir -p "$AS/fakebin" "$AS/guardrails/bin"
cat > "$AS/fakebin/sentience" <<'FAKE'
#!/bin/bash
# stand-in for the production CLI: same flags, same JSON shape, no network
printf '{"production": true, "thread_id": "cnvthr_test1234", "response": "Yes, they are here."}\n'
FAKE
chmod +x "$AS/fakebin/sentience"
ln -sfn "$REPO/workspace-template/bin/headlong-question-guard" "$AS/guardrails/bin/headlong-question-guard"
ln -sfn "$REPO/workspace-template/bin/ask-sentience" "$AS/guardrails/bin/ask-sentience"
if out=$(cd "$AS" && HEADLONG_WORKSPACE="$AS" PATH="$AS/guardrails/bin:$AS/fakebin:$PATH" \
        ask-sentience --claim c-buds "Are the Smartbuds with you right now?" 2>&1) \
   && [[ "$out" == *"Yes, they are here."* ]] \
   && [[ "$(jq -r '.[0].receipt_id' "$AS/analysis/receipts.json")" == r-* ]] \
   && [[ "$(jq -r '.[0].affected_claim_id' "$AS/analysis/receipts.json")" == c-buds ]] \
   && [[ "$(jq -r '.[0].resulting_change' "$AS/analysis/receipts.json")" == PENDING* ]] \
   && [[ "$(jq -r '.[0].thread_ref' "$AS/analysis/receipts.json")" == cnvthr_test1234 ]] \
   && ls "$AS"/analysis/sentience/*-are-the-smartbuds-with-you-right-now.json >/dev/null 2>&1; then
    ok "ask-sentience saves the payload and appends a valid receipt stub"
else
    bad "ask-sentience saves the payload and appends a valid receipt stub"; printf '%s\n' "$out" | head -5
fi
if (cd "$AS" && HEADLONG_WORKSPACE="$AS" PATH="$AS/guardrails/bin:$AS/fakebin:$PATH" ask-sentience "ping" >/dev/null 2>&1); then
    bad "ask-sentience refuses a filler probe before touching the network"
else ok "ask-sentience refuses a filler probe before touching the network"; fi


# ask-sentience refuses a decision dressed as a question, before any network
before=$(ls "$AS"/analysis/sentience 2>/dev/null | wc -l | tr -d ' ')
if (cd "$AS" && HEADLONG_WORKSPACE="$AS" PATH="$AS/guardrails/bin:$AS/fakebin:$PATH" \
      ask-sentience "Do you want me to send the NextSense outreach now?" >/dev/null 2>&1); then
    bad "ask-sentience refuses an authorization question"
else
    after=$(ls "$AS"/analysis/sentience 2>/dev/null | wc -l | tr -d ' ')
    if [[ "$before" == "$after" ]]; then ok "ask-sentience refuses an authorization question"
    else bad "ask-sentience refuses an authorization question (but still called the API)"; fi
fi
# ...while a preference phrased as a fact about Toma still passes
if (cd "$AS" && HEADLONG_WORKSPACE="$AS" PATH="$AS/guardrails/bin:$AS/fakebin:$PATH" \
      ask-sentience "Does Toma prefer to send outreach before or after a retry?" >/dev/null 2>&1); then
    ok "ask-sentience allows a preference asked as a fact"
else bad "ask-sentience allows a preference asked as a fact"; fi
printf '\n%s passed, %s failed\n' "$pass" "$fail"
[[ $fail -eq 0 ]]
