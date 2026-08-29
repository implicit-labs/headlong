#!/usr/bin/env bash
# test_shellm_extract_code.sh — tests for bin/shellm extract_code()/_looks_like_shell()
#
# extract_code() pulls the first fenced code block out of an LLM response.
# When the response has NO fence at all it falls back to the raw text, which is
# correct for a model that emits a bare command — but was also executing plain
# prose. The first word then runs as a binary ("do: command not found") and the
# whole step is lost. Observed at ~19% of shell steps on a long-running agent,
# including trajectory field markers like [content] and [in_tok] being run.
#
# _looks_like_shell() gates that fallback. These tests pin both halves: prose is
# never executed, and genuinely unfenced commands still are.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(dirname "$HERE")"

pass=0
fail=0
ok()  { pass=$((pass+1)); printf 'ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf 'FAIL %s%s\n' "$1" "${2:+ — $2}"; }

# Extract the two functions from bin/shellm without running main. A plain
# sed range would stop at the first column-0 "}" inside extract_code's awk
# program, so take each function's exact line span instead.
fns=$(python3 - "$REPO/bin/shellm" <<'PY'
import sys, pathlib
lines = pathlib.Path(sys.argv[1]).read_text().split('\n')
out = []
for fn in ('_looks_like_shell', 'extract_code'):
    st = next(i for i, l in enumerate(lines) if l.startswith(fn + '() {'))
    en = next(i for i in range(st + 1, len(lines)) if lines[i] == '}')
    out.extend(lines[st:en + 1])
print('\n'.join(out))
PY
)
eval "$fns"

NOTICE='no code fence in your last response'

# --- prose must never be executed --------------------------------------------

check_prose() {
    local label="$1" text="$2" out
    out=$(extract_code "$text")
    if [[ "$out" != *"$NOTICE"* ]]; then
        bad "$label" "prose would have been executed: ${out:0:60}"
        return
    fi
    # The notice must itself be a harmless, syntactically valid no-op.
    if bash -c "$out" 2>/dev/null; then
        ok "$label"
    else
        bad "$label" "notice is not a clean no-op"
    fi
}

check_prose 'prose sentence'        'The judge explicitly recognized the real text as almost verbatim.'
check_prose 'prose starting "do"'   'do this now and report back'
check_prose 'prose starting "then"' 'then we should check the scorecard'
check_prose '[content] marker'      '[content]
The deadline shown in the guardrails log is local time'
check_prose '[in_tok] telemetry'    '
[in_tok] 2

[llm_s] 3'
check_prose 'bare uuid'             '57b372d5-3132-49fc-a0e7-e2c67c30e526'
check_prose 'bracketed prose'       '[Now let me add the new rule, then wrap up.'

# --- real shell must still run ------------------------------------------------

check_code() {
    local label="$1" text="$2" want="$3" out
    out=$(extract_code "$text")
    if [[ "$out" == *"$NOTICE"* ]]; then
        bad "$label" "real shell was rejected as prose"
    elif [[ "$out" == *"$want"* ]]; then
        ok "$label"
    else
        bad "$label" "expected to contain '$want', got: ${out:0:60}"
    fi
}

# Fenced blocks are the normal path and must be untouched by the gate.
check_code 'fenced block' 'Let me check the time.
```bash
date -u
```' 'date -u'

check_code 'fenced, heredoc with inner fence' 'writing a file
```bash
cat > /tmp/x <<EOF
```
EOF
```' 'cat > /tmp/x'

# Unfenced-but-real commands keep working (the reason the fallback exists).
check_code 'unfenced bare command' 'echo hello'                      'echo hello'
check_code 'unfenced cd builtin'   'cd /tmp
ls'                                                                  'cd /tmp'
check_code 'unfenced assignment'   'FOO="bar baz"
echo "$FOO"'                                                         'FOO='
check_code 'unfenced comment then cmd' '# check the time
date -u'                                                             'date -u'
check_code 'unfenced absolute path' '/usr/bin/env python3 -c "print(1)"' '/usr/bin/env'
check_code 'unfenced relative path' './start-run.sh 2'               './start-run.sh'
check_code 'unfenced if block'      'if [[ -f x ]]; then echo y; fi' 'if [[ -f x ]]'
check_code 'unfenced subshell'      '(cd /tmp && ls)'                '(cd /tmp'
check_code 'unfenced pipeline'      'cat file | head -5'             'cat file'
check_code 'leading blank lines'    '

date -u'                                                             'date -u'

# --- telemetry glued to the end of a genuinely unfenced command ----------------
# Observed live: the model emits real shell with trajectory field markers
# appended. The command ran, then the step died on the garbage.
telemetry_case='cd /tmp
wc -l /tmp/x

[in_tok]
2

[llm_s]
8

[run_id]
82226323-98ea-452e-bc9b-cb3d93038847'
out=$(extract_code "$telemetry_case")
if [[ "$out" == *'[in_tok]'* || "$out" == *'[run_id]'* ]]; then
    bad 'telemetry tail stripped' "telemetry survived: ${out}"
elif [[ "$out" != *'cd /tmp'* || "$out" != *'wc -l'* ]]; then
    bad 'telemetry tail stripped' "real command was lost: ${out}"
elif bash -n <(printf '%s\n' "$out") 2>/dev/null; then
    ok 'telemetry tail stripped'
else
    bad 'telemetry tail stripped' 'result is not valid shell'
fi

# --- <bash> tags instead of a markdown fence -----------------------------------
# Observed 149 times across three agents: the model wraps its command in
# <bash>...</bash>, extract_code does not see a fence, and the stray closing tag
# runs as shell ("syntax error near unexpected token `newline'").
tagged='cd /tmp
ls -la
</bash>'
out=$(extract_code "$tagged")
if [[ "$out" == *'</bash>'* || "$out" == *'<bash>'* ]]; then
    bad 'stray <bash> tag stripped' "tag survived: ${out}"
elif [[ "$out" != *'cd /tmp'* || "$out" != *'ls -la'* ]]; then
    bad 'stray <bash> tag stripped' "real command lost: ${out}"
elif bash -n <(printf '%s\n' "$out") 2>/dev/null; then
    ok 'stray <bash> tag stripped'
else
    bad 'stray <bash> tag stripped' 'result is not valid shell'
fi

out=$(extract_code '<bash>
date -u
</bash>')
if [[ "$out" == *'bash>'* ]]; then bad 'opening <bash> tag stripped' "tag survived"
elif [[ "$out" == *'date -u'* ]]; then ok 'opening <bash> tag stripped'
else bad 'opening <bash> tag stripped' "command lost: ${out}"; fi

# --- stray markdown fence line in an unfenced response -------------------------
# A bare ``` run as shell dies with "unexpected EOF while looking for matching `".
out=$(extract_code 'cd /tmp
ls -la
```')
if [[ "$out" == *'```'* ]]; then bad 'stray fence line stripped' "fence survived: ${out}"
elif [[ "$out" != *'ls -la'* ]]; then bad 'stray fence line stripped' "command lost"
elif bash -n <(printf '%s\n' "$out") 2>/dev/null; then ok 'stray fence line stripped'
else bad 'stray fence line stripped' 'not valid shell'; fi

# --- <bash> treated as a real fence, not stripped residue ---------------------
# Prose before the tag must NOT run; only the tag body should.
out=$(extract_code 'Let me look at the workspace.
<bash>
cd /tmp
ls -la
</bash>')
if [[ "$out" == *'Let me look'* ]]; then
    bad '<bash> body only' "prose leaked into code: ${out}"
elif [[ "$out" == *'bash>'* ]]; then
    bad '<bash> body only' "tag survived: ${out}"
elif [[ "$out" == *'cd /tmp'* && "$out" == *'ls -la'* ]]; then
    ok '<bash> body only'
else
    bad '<bash> body only' "body lost: ${out}"
fi

out=$(extract_code 'checking.
<shell>
date -u
</shell>')
if [[ "$out" == *'date -u'* && "$out" != *'checking'* && "$out" != *'shell>'* ]]; then
    ok '<shell> body only'
else
    bad '<shell> body only' "got: ${out}"
fi

# --- telemetry-ONLY response (no command to salvage) ---------------------------
# Seen live in canon after the tail-truncation fix: the whole response is field
# markers, so there is no leading command and the marker itself ran.
check_prose 'telemetry-only response' '
[in_tok]
2

[llm_s]
9

[run_id]
3f017558-70ab-4f0c-a101-1112bcb14924'

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]]
