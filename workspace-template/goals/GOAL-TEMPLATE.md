# GOAL 00N — (name the job in five words)

**Created:** YYYY-MM-DD
**Status:** active
**Predecessor:** `goals/00N-1-….md` — read it, do not re-execute it.
**Workspace:** /path/to/workspace
**Deadline:** read `RUN.md`. Run `timeleft` for the budget. All times UTC.

---

## THE DELIVERABLE — read this before every commit

> Delete this instruction line and write the real thing. This section is the
> single most load-bearing part of a goal file, and it exists because a run
> once produced output that satisfied every field of a schema and was hollow.
> **The specification was the easy part.** What needed saying out loud was
> what a good entry actually *is*.

**This is the main goal. Everything else in this file is detail underneath it.**

State, in plain language, what a reader gets from a finished unit of work — not
its shape, its substance. Then:

**Schema compliance is not doneness.** Give every field a plain-language test,
and say that a unit ships only if it passes all of them.

| field | the test it must pass |
|---|---|
| `example` | One sentence. Names something concrete. **If it could be written about anything else, it fails.** |
| `another` | Sourced from evidence, never from your own judgement that it reads well. If the source is missing, it does not ship. |

Write the tests so a failure is *observable*. "Is this insightful" is not a
test. "If sentence 3 could be written about any article, it fails" is.

---

## Phases

Number them. Each phase says what to produce and where it goes.

## Phase 1 — …

## Phase 2 — …

---

## Rules

1. **Where artifacts go.** Name the directory. Without this, scratch output
   becomes commits.
2. **Evidence is self-contained.** Write results into the file in full, from
   your own variables — never from captured shell output, which truncates. One
   trial file was saved containing the literal string
   `[... truncated: 2963 bytes total ...]` and its recovery pointer was dead.
   Re-read each file after writing it.
3. **Scoring is mechanical.** Never score on whether you liked the reasoning
   behind a result. If success is a judgement call, it will drift.
4. **Never fabricate a result.** If a tool or the network fails, say so, show
   the error, and log the partial outcome honestly.
5. Stay in this workspace. No `sudo`.

## Definition of done

Concrete and checkable. Include at least one item that can be verified by
running a command, not by reading prose.

## If you finish early

Name a default action. A run with no idle instruction spends half its budget
re-verifying finished work.

## If the result is null

Say so plainly and stop. A pre-registered stopping rule is what stops a fifth
null becoming a sixth. Name what you would *not* do next.

## The failure mode to watch for in yourself

When honest feedback is uniformly negative and offers no gradient, the pull is
toward a nearby metric that *can* move. That is how a project ends up
measuring something easier than the thing it set out to measure.

**If your success rate jumps, ask what changed about the test before you
celebrate.** A metric you can always beat is one you are no longer learning
from.
