#!/usr/bin/env bash
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(dirname "$HERE")"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
pass=0; fail=0
ok() { pass=$((pass+1)); printf 'ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf 'FAIL %s%s\n' "$1" "${2:+ — $2}"; }
mode() { stat -f '%Lp' "$1" 2>/dev/null || stat -c '%a' "$1"; }

mkdir -p "$WORK/home" "$WORK/wd"
cp -R "$REPO/bin" "$WORK/toolbin"
cat > "$WORK/toolbin/llm" <<'STUB'
#!/usr/bin/env bash
for arg in "$@"; do [[ "$arg" == "--thinking" ]] && main=1; done
if [[ "${main:-0}" -eq 1 ]]; then
    printf '```bash\nFINAL="child conclusion"\n```\n'
else
    printf '{}\n'
fi
STUB
chmod +x "$WORK/toolbin/llm"

export PATH="$WORK/toolbin:$PATH"
export HOME="$WORK/home"
export HEADLONG_HOME="$WORK/home/.headlong"
export HEADLONG_ARTIFACT_DIR="$WORK/private-artifacts"
export ANTHROPIC_API_KEY=test-key
export SHELLM_MODEL=test-model
export SHELLM_ENV=local

( cd "$WORK/wd" && _SHELLM_PARENT_TRAJ_ID=parent-test \
    "$WORK/toolbin/shellm" -q --workdir "$WORK/wd" --max-iterations 1 "child task" \
    > "$WORK/out" 2> "$WORK/err" < /dev/null )
rc=$?

manifests=("$HEADLONG_ARTIFACT_DIR/subruns"/*.json)
results=("$HEADLONG_ARTIFACT_DIR/subruns"/*.md)
if [[ "$rc" -eq 0 && ${#manifests[@]} -eq 1 && -f "${manifests[0]}" \
    && ${#results[@]} -eq 1 && -f "${results[0]}" ]]; then
    ok "completed child writes a result and manifest outside transient storage"
else
    bad "completed child writes a result and manifest outside transient storage" \
        "rc=$rc err=$(tail -2 "$WORK/err" | tr '\n' ' ')"
fi

if jq -e '.status == "complete" and .parent_traj == "parent-test" and (.child_traj | length > 0)' \
    "${manifests[0]}" >/dev/null \
    && grep -q 'child conclusion' "${results[0]}"; then
    ok "manifest links parent, child, and preserved conclusion"
else
    bad "manifest links parent, child, and preserved conclusion"
fi

if [[ "$(mode "$HEADLONG_ARTIFACT_DIR")" = 700 \
    && "$(mode "${manifests[0]}")" = 600 \
    && "$(mode "${results[0]}")" = 600 ]]; then
    ok "sub-run artifacts are private"
else
    bad "sub-run artifacts are private"
fi

if ! rg -q '/tmp/approach_[ab]\.txt' "$REPO/bin/shellm"; then
    ok "sub-run guidance no longer teaches transient evidence paths"
else
    bad "sub-run guidance no longer teaches transient evidence paths"
fi

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]]
