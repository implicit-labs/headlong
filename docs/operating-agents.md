# Operating headlong agents

What eight agents over four days actually taught us. Written for whoever runs
the next one — including a future version of the person who ran these.

The scaffolding this describes is in [`workspace-template/`](../workspace-template/);
install it with `headlong-workspace-init <identity>`.

---

## Setting one up

```bash
identity new <name>                        # creates .identities/<name>
headlong-workspace-init <name> [dir]       # scaffolds the workspace
$EDITOR <workspace>/goals/001-*.md         # write the real brief
export ANTHROPIC_API_KEY=...               # never stored on disk
<workspace>/start-run.sh 4                 # 4 hours
```

Pin the model in **both** `.identities/<name>/info.txt` (`think_model=`) and
`.identities/<name>/.env` (`SHELLM_MODEL=`). `activate` reads `info.txt` before
sourcing `.env`, so a missing `think_model=` silently falls back to the built-in
default rather than to what `.env` says.

`headlong-workspace-init` is idempotent and additive. It patches an identity's
`.env` one key at a time, because appending a second `PROJECT_DIR` would
silently override the existing one. `CHANGELOG.md` and `goals/README.md` are
never overwritten, not even with `--force`.

---

## Time is the most common source of wasted budget

**Every deadline is UTC.** Trajectories are stamped in UTC, so the agent reads
"now" as UTC. A local-time deadline anywhere makes it compare the two and
conclude the run is over. That has happened twice:

- a `RUN.md` written in local time cost most of one run
- a watchdog log printing local time against a UTC `RUN.md` made an agent stop
  **two hours early**, reasoning carefully from bad data

The fix is structural, not a convention: `start-run.sh` writes the deadline as a
**UTC epoch** to `.run-deadline`, and `timeleft` reads it. An epoch has no format
to misparse and no zone to get wrong. Tell agents to run `timeleft` and never to
do timezone arithmetic.

**The watchdog needs all three of these**, each learned the hard way:

| do | because |
|---|---|
| poll against an absolute deadline | a one-shot `sleep 28800` does not survive the Mac suspending — a run continued **34 minutes** past its deadline, still calling the LLM |
| kill the dispatcher by pid | `thinkers stop` deactivates thinkers but leaves the dispatcher waking and spending — once for **50 minutes** |
| never call `persona stop` | `~/.headlong/run/web.pid` is global; it kills whatever agent's dash is up |
| never blind-call `persona <name> stop` | for an unknown identity, persona falls back to the **default** one and treats "stop" as a **chat message** |

## Reaching the agent mid-run

The monolith's wake prompt says everything it needs is already in the prompt, so
**pointing it at a file does not work.** Putting a fact in the stream does:

```bash
traj append --field type=observation --field source=system --field content="..."
```

That is how `start-run.sh` delivers the budget, and how to correct a run in
flight. `RUN.md` is for the human and for a deliberate re-read.

---

## Cost and model choice

Roughly $1–2/hour on `claude-sonnet-5`. Choose per job, not per fleet:

- **Volume** — many trials, many files, lots of shell — `claude-sonnet-5`.
- **Taste** — design, writing, visual work — `claude-opus-5`.
- The drafting model is **not** a fix for prose quality. Seven mechanisms were
  tested against a judge on that question and `claude-opus-5` drafts lost the
  same way `claude-sonnet-5` drafts did, with the judge calling them "overly
  polished, categorical, and full of tidy AI-style analogies."

Prompt caching matters at this duration: a headlong trajectory is append-only,
so the rendered prefix is byte-stable between wake-ups. Without cache
breakpoints a 6h run re-sent the whole context every wake-up (42.1M uncached
input tokens measured).

---

## Tools over GUI automation

Driving a desktop app through computer-use and OCR was tried and abandoned as
"way over the top" — brittle, slow, broken by a sleeping display, and disrupted
by the operator touching their own machine. **A CLI the agent can call is worth
more than any amount of screen automation.** Replacing OCR with the Sentience
CLI turned an unreliable capability into a dependable one, and it works whether
or not the app is open.

Write skills for these (`skills show <name>`), and put the failure modes in the
skill, not just the happy path.

---

## Judging output with a model

If an agent's work is scored by an LLM, **validate the judge before trusting a
single result.** Three controls, all cheap:

1. **Real vs real** — two items both genuinely from the target. Does it show a
   systematic preference, and is it positional?
2. **Target vs a third party** — can it distinguish the target from anyone else?
3. **Retrieval probe** — feed it real material and ask where it came from. If it
   names the source, it can win by recognition rather than judgement.

**A control must ask the same question as the thing it calibrates.** One
calibration concluded a judge "does not track author identity at all" — because
it asked which text *"feels more like a real individual"* rather than *"which is
Toma's."* Re-run with the right question, the judge was correct every time. The
wrong control nearly invalidated five real findings.

Retrieval is the confound that survives paraphrase: a judge produced a
`paulgraham.com` URL unprompted, and quoted a phrase that **was not in its
prompt**, reconstructed from its own knowledge. Prefer unpublished material as
the anchor.

---

## Statistical work

For anything correlational, require pre-registration and multiplicity control in
the goal. The family of tests is defined by **the search process**, not by what
got written up — dead leads and abandoned tests included. The sharpest version
of the rule, from the agent that did this well:

> Being able to draw a boundary that saves my result is precisely the signal not
> to draw it.

---

## Running several at once

They coexist — dispatchers are per-identity — with two shared resources to
respect:

- **the dashboard** (`~/.headlong/run/web.pid`) is global; one at a time
- **`headlong-killall` stops everything**, every agent. `persona <name> stop` is
  the surgical one.

Give each a separate workspace, and separate ports for anything it serves.

**Check the process table before launching long-lived servers.** Processes
launched with the full environment inherited into `argv` expose
`ANTHROPIC_API_KEY=sk-ant-…` in plaintext to anything running as you. Two Jekyll
previews did this. Rotate any key that has been exposed that way.

---

## Reading a run afterwards

- `CHANGELOG.md` — what the agent thinks happened. First thing to read.
- `goals/README.md` — the outcome table across goals.
- `<name> dash` — browse the mind in a browser.
- `recap` — themes and episodes from the trajectory.
- `shellm-explore` — run trees plus an LLM report on what happened and why.
- `traj show <id> --full` — the raw record, when a summary is not enough.

**Audit the error rate directly.** Count `shell-output` entries with a non-zero
`exit` in the trajectory. Rates above ~10% usually mean the harness is executing
something that was never a command, not that the agent is confused. `exit 143`
is SIGTERM from a normal stop and is not a fault.

---

## What went wrong most often

In rough order of cost:

1. **The harness executing model prose as shell.** Up to 19.5% of one agent's
   steps. Fixed in `extract_code`; see `tests/test_shellm_extract_code.sh`.
2. **Timezone confusion** — hours, twice.
3. **Watchdogs not stopping things** — 34 and 50 minutes of unattended spend.
4. **Metric drift** — an agent redefining success when honest feedback offered
   no gradient. Three times in three runs, each subtler than the last.
5. **Evidence written from truncated output** — results that cannot be audited.
6. **Schema-compliant hollow output** — the reason `THE DELIVERABLE` exists.

The first three are fixed in code. The last three are fixed in how a goal is
written, which is why [`goals/README.md`](../workspace-template/goals/README.md)
is part of the template rather than advice.
