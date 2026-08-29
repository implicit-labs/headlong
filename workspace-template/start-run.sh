#!/bin/bash
# Arm and launch a run for this workspace's agent.
#
#   ./start-run.sh          # default hours (see .runconfig)
#   ./start-run.sh 2        # 2 hours
#   ./start-run.sh 20m      # 20 minutes, for a trial
#
# Reads identity and app dir from ./.runconfig. Everything the agent sees is
# UTC; local time is shown only for the human running this.
set -euo pipefail

WS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
[[ -f "$WS/.runconfig" ]] && source "$WS/.runconfig" || {
    echo "error: $WS/.runconfig not found. Expected NAME=, APP=, DEFAULT_HOURS=." >&2; exit 1; }
: "${NAME:?.runconfig must set NAME}"
: "${APP:?.runconfig must set APP}"

DURATION="${1:-${DEFAULT_HOURS:-4}}"
case "$DURATION" in
    *m|*M) HOURS=$(python3 -c "print(${DURATION%[mM]}/60)") ;;
    *h|*H) HOURS="${DURATION%[hH]}" ;;
    *)     HOURS="$DURATION" ;;
esac
LABEL="$DURATION"
export PATH="$WS/guardrails/bin:$HOME/.local/bin:$PATH"
export HEADLONG_WORKSPACE="$WS" HEADLONG_APP_DIR="$APP"

if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
    echo "error: ANTHROPIC_API_KEY is not set in this shell." >&2
    echo "It is not stored on disk; start the mind from a shell that exports it." >&2
    exit 1
fi

echo "==> Activating identity: $NAME"
cd "$APP"
# `activate` reads `interval=` from info.txt, which has no such line; under
# `set -e -o pipefail` that failing substitution would kill this script.
set +e +o pipefail
# shellcheck disable=SC1091
source ".identities/$NAME/activate"
set -e -o pipefail
[[ -n "${IDENTITY_NAME:-}" ]] || { echo "error: activation failed." >&2; exit 1; }

echo "    model:     $THINK_MODEL"
echo "    workspace: $WS"
echo "    goal:      ${GOAL_DOC:-$WS/GOAL.md}"
echo "    sudo ->    $(command -v sudo)"

echo "==> Recording the deadline (UTC epoch — the single source of truth)"
DEADLINE_EPOCH=$(python3 -c "import time;print(int(time.time()+$HOURS*3600))")
DEADLINE_UTC=$(python3 -c "import time;print(time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime($DEADLINE_EPOCH)))")
DEADLINE_LOCAL=$(python3 -c "import time;print(time.strftime('%H:%M %Z', time.localtime($DEADLINE_EPOCH)))")
STARTED=$(date -u '+%F %H:%M')
printf 'epoch=%s\nutc=%sZ\nlabel=%s\n' "$DEADLINE_EPOCH" "$DEADLINE_UTC" "$LABEL" > "$WS/.run-deadline"
echo "    deadline: ${DEADLINE_UTC}Z  (local $DEADLINE_LOCAL)"

GUIDANCE_FILE="$WS/RUN-GUIDANCE.md"
GUIDANCE="Work the brief in \`GOAL.md\`."
[[ -f "$GUIDANCE_FILE" ]] && GUIDANCE="$(cat "$GUIDANCE_FILE")"

cat > "$WS/RUN.md" <<RUNEOF
# This run

**All times are UTC.** Run \`timeleft\` to see NOW, DEADLINE and REMAINING.
Never do timezone arithmetic yourself and never trust \`date\` (local): a run
once stopped two hours early comparing a local-time log to a UTC deadline.

**Time budget: $LABEL.** Started ${STARTED}Z, deadline **${DEADLINE_UTC}Z**.
(Local, for the operator: ends $DEADLINE_LOCAL.)

$GUIDANCE
RUNEOF

# The monolith's wake prompt says everything needed is ALREADY in the prompt, so
# pointing it at RUN.md does not work. Putting facts in the stream does: an
# observation is part of the recent context every wake-up sees.
echo "==> Injecting run-start observation"
GOAL_NAME=$(basename "$(readlink "$WS/GOAL.md" 2>/dev/null || echo GOAL.md)")
traj append --field type=observation --field source=system --field content="=== NEW RUN STARTED: ${STARTED}Z (UTC) ===
Time budget: $LABEL. Deadline: ${DEADLINE_UTC}Z. ALL DEADLINES ARE UTC.
Run \`timeleft\` to see how long you have left. Do not do timezone math yourself.
Active goal: $GOAL_NAME. Workspace: $WS.
Nothing before this line belongs to this run. Anything earlier in your stream —
old deadlines, old corrections, old phase instructions — is HISTORY. If an older
instruction conflicts with this line, this line wins." >/dev/null 2>&1 \
    && echo "    injected (goal: $GOAL_NAME)" \
    || echo "    WARNING: traj append failed — the agent may not see the budget"

echo "==> Arming watchdog"
nohup "$WS/guardrails/bin/headlong-expiry" "$NAME" "$HOURS" "$WS" >/dev/null 2>&1 &
echo "    pid $!  (log: $WS/guardrails/expiry.log)"

echo "==> Starting the mind"
persona "$NAME" start
# `persona start` only starts the monolith, but the monolith's prompt says
# replying is NOT its job because "a dedicated responder handles every reply".
# Without this nothing is subscribed to [message] and chat replies never arrive.
thinkers start responder 2>/dev/null && echo "    responder started" \
                                     || echo "    WARNING: responder failed — chat replies will not work"

cat <<EOF

────────────────────────────────────────────────────────
$NAME is running. Deadline: ${DEADLINE_UTC}Z ($LABEL).
────────────────────────────────────────────────────────
  Talk     $NAME say "how's it going"
  Status   $NAME status
  Budget   timeleft
  Pause    $NAME stop
EOF
