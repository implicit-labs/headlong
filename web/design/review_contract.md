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

## Evidence markers

Artifacts opt into traces with `[†](headlong://trace/<claim-id>)`. The client
recognizes only that exact scheme and a validated claim ID. The trace endpoint
returns persisted data or `{ "linked": false, "message": "No evidence linked" }`.
Raw HTML and arbitrary custom links remain disabled.

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
