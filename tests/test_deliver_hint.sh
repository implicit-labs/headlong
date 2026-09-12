#!/usr/bin/env bash
# The handoff hint is computed from state; the expiry marks snapshotless runs failed.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(dirname "$HERE")"
W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
pass=0 fail=0; ok(){ pass=$((pass+1)); printf 'ok   %s\n' "$1"; }; bad(){ fail=$((fail+1)); printf 'FAIL %s\n' "$1"; }
# mk <dir> <started-min-ago> <deadline-min-ahead> <art|none> <status>
mk() { python3 - "$@" <<'PYFIX'
import json, sys, os, time, datetime, pathlib
d, started_ago, ahead, art, status = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4], sys.argv[5]
root = pathlib.Path(d); (root/"artifacts/runs/r1/artifacts").mkdir(parents=True, exist_ok=True); (root/"analysis").mkdir(exist_ok=True); (root/"guardrails").mkdir(exist_ok=True)
now = int(time.time()); (root/".run-deadline").write_text(f"epoch={now+ahead*60}\nutc=x\nlabel=t\n"); (root/".review-run-id").write_text("r1\n")
artifact = None
if art != "none":
    (root/"artifacts/runs/r1/artifacts/p.md").write_text("# p\n")
    artifact = {"path":"artifacts/runs/r1/artifacts/p.md","title":"t","media_type":"text/markdown","sha256":"a"*64}
m = {"schema_version":1,"run_id":"r1","identity_id":"i","title":"t","goal_ref":"g","status":status,
     "started_at": datetime.datetime.fromtimestamp(now-started_ago*60, datetime.timezone.utc).isoformat(),
     "deadline":"2099-01-01T00:00:00+00:00","progress_summary":"s","primary_artifact":artifact,"supporting_artifacts":[],
     "sentience_receipt_ref":"artifacts/runs/r1/sentience-receipts.jsonl","provenance_ref":"artifacts/runs/r1/provenance.jsonl",
     "decision_ledger_ref":"artifacts/runs/r1/decisions.jsonl","annotation_ledger_ref":"artifacts/runs/r1/annotations.jsonl","decision_requests":[],"next_step_options":[]}
(root/"artifacts/runs/r1/manifest.json").write_text(json.dumps(m))
PYFIX
}
H="$REPO/bin/headlong-deliver-hint"
mk "$W/a" 10 80 none running;  out=$("$H" "$W/a"); [[ "$out" == *"NO reviewable snapshot"* && "$out" != *"Only"* ]] && ok "no snapshot, plenty of budget: a nudge" || { bad "no snapshot, plenty of budget: a nudge"; echo "$out"; }
mk "$W/b" 80 10 none running;  out=$("$H" "$W/b"); [[ "$out" == *"Only "*" minutes remain"* ]] && ok "no snapshot, budget nearly gone: escalates to deliver now" || { bad "escalates"; echo "$out"; }
mk "$W/c" 10 80 art running;   out=$("$H" "$W/c"); [[ -z "$out" ]] && ok "snapshot exists and nothing newer: silent" || { bad "silent with snapshot"; echo "$out"; }
mk "$W/d" 10 80 art running;   python3 -c "import os,time; p='$W/d/analysis/brief.json'; open(p,'w').write('{}'); t=time.time()+300; os.utime(p,(t,t))"; out=$("$H" "$W/d"); [[ "$out" == *"newer than the last snapshot"* ]] && ok "brief newer than snapshot: suggests deliver" || { bad "newer brief"; echo "$out"; }
mk "$W/e" 10 80 none failed;   out=$("$H" "$W/e"); [[ -z "$out" ]] && ok "failed run: silent" || bad "failed run: silent"
out=$("$H" "$W/nonexistent"); [[ -z "$out" ]] && ok "no workspace: silent, exit 0" || bad "no workspace"

mkdir -p "$W/bin" "$W/xhome/.headlong"; printf '#!/bin/bash\nexit 0\n' > "$W/bin/thinkers"; chmod +x "$W/bin/thinkers"
mk "$W/x" 1 0 none running
HOME="$W/xhome" PATH="$W/bin:$PATH" HEADLONG_WORKSPACE="$W/x" HEADLONG_APP_DIR="$REPO" IDENTITY_DIR="" timeout 20 "$REPO/workspace-template/bin/headlong-expiry" agent 0.0003 "$W/x" >/dev/null 2>&1
st=$(python3 -c "import json;print(json.load(open('$W/x/artifacts/runs/r1/manifest.json'))['status'])")
[[ "$st" == failed ]] && grep -q "deadline with no snapshot" "$W/x/guardrails/expiry.log" && ok "expiry marks a snapshotless run failed with the reason" || { bad "expiry marks failed (got $st)"; tail -3 "$W/x/guardrails/expiry.log" 2>/dev/null; }
mk "$W/y" 1 0 art running
HOME="$W/xhome" PATH="$W/bin:$PATH" HEADLONG_WORKSPACE="$W/y" HEADLONG_APP_DIR="$REPO" IDENTITY_DIR="" timeout 20 "$REPO/workspace-template/bin/headlong-expiry" agent 0.0003 "$W/y" >/dev/null 2>&1
[[ "$(python3 -c "import json;print(json.load(open('$W/y/artifacts/runs/r1/manifest.json'))['status'])")" == running ]] && ok "expiry leaves a run with a snapshot alone" || bad "expiry leaves snapshotted run alone"

printf '\n%s passed, %s failed\n' "$pass" "$fail"; [[ $fail -eq 0 ]]
