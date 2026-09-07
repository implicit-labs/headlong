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

## The first two sentences

`ready` needs `--question` and `--finding`, and every decision request needs a
`headline` and a `summary`. These are not metadata. They are the first thing
the operator reads, and often the only thing.

- **Question:** what this run set out to answer. One line, ends in `?`.
  "Can one earbud session produce EEG we can actually analyze?" passes.
  "SenseTune consolidation" is a title, not a question, and fails.
- **Finding:** what you learned, in one or two sentences a tired person can
  read once. Not what you filed - "27 records and 3 receipts" is refused.
- **Decision headline:** the question the operator can answer at a glance.
  "Run the retry?" - not the paragraph. Put the paragraph in `question` and
  the exact terms in `authorized_scope`; both stay one click away.

## The artifact is a picture, not an essay

**Draw the mechanism the decision turns on.** Not a box labelled with its name —
the path the thing actually takes, the gate it fails, the one edge that changes
between the option taken and the option refused. If a reader can point at what
they are choosing between, the drawing is doing its job.

Anchor claims to it. A claim reaches the reader through a prose marker
`[†](headlong://trace/<claim-id>)` on the sentence that makes it, or through
`data-claim="<claim-id>"` on a node inside an inline `<svg>`. A decision request
may name a `anchor_node` matching a `data-node` in the drawing, so the question
appears on the part of the picture it acts on.

`headlong-review-run ready` **refuses the snapshot** when a claim is
unreachable, when an anchor names a claim that does not exist, when there is no
diagram and no stated reason, when prose outside the drawing exceeds the budget,
or when the artifact contains script or external references. These are not
style notes. You cannot ship past them.

If the work genuinely has no drawable mechanism, pass `--no-diagram-reason`
with a real reason. The waiver is stored and shown to the reader — the escape is
visible, which is the point. "Nothing to draw" for work that plainly has a
mechanism will read as exactly what it is.

**Reasoning goes in the provenance records, not the prose.** The reader opens
what they want. A long document is not thoroughness; it is the decision hidden
inside an argument.

## Working with Sentience

Sentience is a model of the operator. It is the only source for what is true of
*them* - what they own, what they would actually do, what they prefer - and
nothing else. Use `ask-sentience`; it writes the receipt for you.

- **Ask only what no file can answer.** If a source in the workspace answers it,
  that is a lookup you skipped.
- **One question per call.** A three-part question yields one receipt for three
  claims, and `affected_claim_id` stops meaning anything.
- **Facts, never authorization.** "Should I send this?" is a decision; put it in
  `--decision-requests` with an exact scope. `ask-sentience` refuses the obvious
  forms, but the rule is yours to keep.
- **Record every receipt, including the ones that changed nothing.** Fill
  `resulting_change` honestly; `ready` refuses one left `PENDING`.
- **An agreeable answer to a question you invented is not evidence.** When a
  receipt confirms what you already believed, ask whether the question could
  have come back "no".

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
5. **A prohibition you want to break is a decision request.** If the brief says
   do not re-analyze, do not contact, do not collect - and you find yourself
   wanting to - write the want down as a decision with its scope and keep
   going. Doing it anyway and reporting it afterwards is the worse of the two
   honest options.
6. **`artifacts/` holds artifacts.** Backups, scratch, and `.bak` files go in
   `analysis/` or nowhere. A reader opening the artifact directory should find
   only things meant to be read.
7. Stay in this workspace. No `sudo`.

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
