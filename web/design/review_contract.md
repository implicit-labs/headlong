# Daily Review contract (schema v1)

The Daily Review is an artifact and decision surface over durable files. It is
not a reconstruction of model chain-of-thought and it never invents provenance.

## Workspace resolution

The server starts from an identity already resolved by Headlong discovery. It
reads that identity's operator-owned `.env`, resolves `PROJECT_DIR` (including
`$HOME`), and scans only:

```text
$PROJECT_DIR/artifacts/runs/<review-run-id>/manifest.json
```

HTTP callers provide identity, run, claim, decision, and annotation IDs—not
paths. All manifest paths are relative to `PROJECT_DIR`, resolved before use,
and rejected if they are absolute, traverse `..`, or escape through a symlink.
Persisted `local_file` evidence is displayed as a locator/excerpt but never
dereferenced by the review API.

## Manifest

Required schema-v1 fields are `run_id`, `identity_id`, `title`, `goal_ref`,
`status`, `started_at`, and `deadline`. Status is one of:

- `running`
- `ready_for_review`
- `waiting_on_toma`
- `complete`
- `failed`

Ready, waiting, and complete runs require a contained Markdown primary artifact
with a matching SHA-256. Running and failed runs may have no artifact; a failed
run instead carries an explicit `result` summary. A malformed run remains
visible with validation errors, but it never contributes a ready-review badge.

`decision_requests` explicitly name `decision_request_id`, `question`, and
`authorized_scope`. `next_step_options` name scope, duration, expected artifact,
and stopping rule. Neither is inferred from prose.

## Sidecars

The manifest names four append-only JSONL sidecars:

- `provenance.jsonl`: claim text, evidence class, persisted source
  excerpts/locators, concise reason, rejected alternatives, and uncertainty.
- `sentience-receipts.jsonl`: redacted question/response receipt, affected
  claim or decision, timestamp, and resulting change.
- `decisions.jsonl`: server-generated ID/time, selected request, answer,
  rationale, exact authorized scope, and optional same-run `supersedes` link.
- `annotations.jsonl`: server-generated ID/time, exact target, artifact path and
  SHA-256, category, note, plus later append-only addressed events.

Readers tolerate an incomplete final JSONL line as a pending write. A complete
malformed line is handled by who wrote it: in the agent-written ledgers
(`provenance.jsonl`, `sentience-receipts.jsonl`) it is skipped and reported in
the run's `warnings`, so one bad hand-written receipt cannot hide twenty-seven
good claims; in the human-authority ledgers (`decisions.jsonl`,
`annotations.jsonl`) it still invalidates the run, because a malformed record
there is a bug or tampering and the safe answer is to show nothing.

The agent-written ledgers only grow. `headlong-review-run ready` re-pins them
from the agent's cumulative source and refuses when a `claim_id` or
`receipt_id` present in the previous snapshot is missing now: a dropped record
must be kept, or joined by a new one saying why it no longer holds.

Receipts are written by the `ask-sentience` guardrail, not by hand. It runs the
question guard, makes one call, saves the payload beside the exact question,
and appends a receipt with every field filled except `resulting_change`, which
reads `PENDING` until the agent records what the answer changed. `ready`
refuses a receipt still marked `PENDING`. Every mutation carries a stable `operation_id`; exact retries return
the prior event and conflicting reuse fails. Writers take an inter-process file
lock around validation and one `O_APPEND` write containing the entire record
and newline.

## Evidence markers and diagram anchors

A claim is reachable two ways, and the producer requires one of them for every
persisted claim before it will snapshot:

- **Prose marker** — `[†](headlong://trace/<claim-id>)` on the sentence that
  makes the claim. The client recognizes only that exact scheme and a validated
  claim ID.
- **Diagram anchor** — `data-claim="<claim-id> …"` on an element inside an
  inline `<svg>`. `data-node="<id>"` names a node a decision request may anchor
  to through `anchor_node`.

The trace endpoint returns persisted data or
`{ "linked": false, "message": "No evidence linked" }`.

`headlong-review-run ready` refuses a snapshot when a persisted claim has
neither marker nor anchor, and equally when the artifact anchors a claim id
with no record behind it. This lives in the producer rather than the brief
because three consecutive runs wrote sound documents and an unreachable ledger
while only prose asked them not to.

## The brief comes first

A manifest carries `brief.question` - what the run set out to answer, ending
in `?`, under 120 characters - and `brief.finding` - what it found, in one or
two plain sentences under 320 characters. The reader shows these before
anything else. `ready` refuses a run without both, refuses a question that is
not a question, and refuses a finding that reads as inventory ("27 provenance
records filed"): that sentence describes the ledger, not what was learned.

Each decision request carries a `headline` (under 80 characters: the question
a person can answer at a glance) and a `summary` (under 220). The long form
stays in `question`; the exact terms stay in `authorized_scope`, shown on
demand and always before an answer is recorded.

## The brief format (preferred)

A primary artifact may be a **brief**: `application/vnd.headlong.brief+json`, a
JSON document with `"schema": "headlong.brief/1"`, the `question` and
`finding`, and a list of typed blocks - `flow`, `compare`, `decision`, `steps`,
`prose`, `figure`, `metric`. The agent supplies data; the page owns
presentation, so every node is clickable and every claim reachable without
the agent drawing anything. `workspace-template/exemplars/` holds validated
examples; `headlong-review-run validate-brief` checks one before `ready`.

The producer lifts `decision` blocks into `decision_requests` (with
`anchor_node`) and `steps` into `next_step_options`, so the ledger is
unchanged. It refuses: unknown block types, duplicate or dangling node ids,
edges to nothing, a decision anchored to a node no block defines, a compare
that changes no node, a claim in provenance no block references, a block
naming a claim with no record, no visual block without a specific
`no_visual_reason`, prose over 600 words, and any of `--decision-requests`,
`--next-steps`, `--question`, `--finding` passed alongside a brief - the brief
is the single source. The server re-validates the document on read and serves
`figure` files by index through
`GET /api/identities/:id/review/runs/:runId/figures/:index`, never by a
client path; SVG figures are served as images, where scripts do not run.

Markdown-with-inline-SVG artifacts remain supported.

## Visual-first review surface

The artifact is a surface to be read, not an essay to be finished. A primary
artifact is Markdown or SVG — **never HTML**, which keeps raw HTML and
arbitrary custom links disabled as before. Inline SVG carries the drawing;
`<script>`, `<foreignObject>`, embedded documents, inline event handlers,
external references, and `javascript:` URLs are rejected at snapshot time.

Two further gates, both overridable only on purpose:

- **A diagram, or a stated reason there is none.** Work whose decision turns on
  a mechanism should draw it. Work that genuinely has no drawable mechanism
  passes `--no-diagram-reason`; the waiver is stored in the manifest's
  `review_surface` and shown to the reader, so an opt-out is visible rather
  than silent. `import` waives by default, since curated completed work cannot
  be made to draw retroactively.
- **A prose budget.** Words outside `<svg>` blocks are capped (1500 by
  default, `--prose-budget` to change it deliberately). Reasoning belongs in
  provenance records the reader opens on demand, not in paragraphs they must
  parse to find the decision.

## Human authority

Decision answers are `yes`, `no`, `hold`, or `need_more_evidence`. The server
copies the request's exact `authorized_scope` into the append-only decision;
the browser cannot broaden it. Reversals append and link rather than overwrite.

Reasoning annotations use one of the eight IMP-632 categories and pin the
artifact SHA-256. Addressing appends a later-run event with a replacement
artifact or claim. The originating run cannot silently resolve its criticism.
Run launch presents prior decisions and unresolved annotations to the later
agent, and the producer's `address` command validates the replacement against
that later run's pinned artifact and provenance before appending the link.

Every write endpoint is disabled when the dashboard runs in read-only mode.
