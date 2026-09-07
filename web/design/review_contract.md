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

Readers tolerate an incomplete final JSONL line and report other malformed
records. Every mutation carries a stable `operation_id`; exact retries return
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
