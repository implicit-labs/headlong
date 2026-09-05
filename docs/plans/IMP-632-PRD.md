# IMP-632: Provenance-backed Daily Review

**Source:** Linear IMP-632

**Status:** Approved for implementation
**Date:** 2026-09-04

## Problem

Headlong's trajectories are durable audit logs, but they do not provide a calm,
artifact-first daily review. Artifacts, evidence, Sentience judgments, and human
decisions currently use separate conventions, so Toma cannot quickly see what a
run produced, what needs a decision, why a claim exists, or what bounded run
should happen next.

## Product loop

Prove one local-first loop on a real run:

1. A run writes a versioned manifest and readable primary artifact.
2. The dashboard marks it ready for review.
3. The artifact is the reading canvas. A decision lens (`D`) makes passages
   selectable; Shift-click builds a multi-passage context without disturbing
   normal reading.
4. Persisted trace markers and the context sidebar expose evidence; passages
   without a trace stay explicitly unlinked.
5. Toma can discuss the selected persisted context with the live identity, or
   record a scoped decision or reasoning-quality annotation.
6. Later runs can consume the append-only correction and link an addressed
   replacement without erasing history.

## Requirements

- Run data lives below the identity's operator-configured `PROJECT_DIR` and is
  read through containment and filename checks. The client never supplies a
  filesystem path.
- Schema v1 supports running, ready-for-review, waiting-on-Toma, complete, and
  failed states.
- Ready and complete runs require a readable primary artifact. A recap is not
  an artifact.
- Provenance, Sentience receipts, decisions, and annotations are append-only
  JSONL ledgers.
- Claims are classified as observed, inferred, proposed, or Sentience judgment.
- The server never creates an evidence trace from model memory.
- Decisions are yes, no, hold, or need-more-evidence and always display the
  exact authorized scope before submission.
- Reversals append a new decision linked through `supersedes`.
- Artifacts carry a SHA-256 version, and annotations remain tied to that exact
  version. They may only be
  addressed by a later run through another append-only event.
- `/i/:identityId/review` is usable at 390 px and leads with the artifact,
  pending decisions, and next bounded run—not tokens or raw logs.
- Context chat resolves browser locators against the pinned artifact,
  provenance, and decision ledger on the server. It never trusts browser
  excerpts and never treats discussion as authorization.
- Context chat is disabled while the identity is asleep because the current
  dispatcher does not replay messages appended before startup.
- Review counts appear on the identity navigation and home table.
- One real completed residency is imported and exercised end to end.

## Storage contract

Each identity's trusted `PROJECT_DIR` may contain:

```text
artifacts/
  runs/
    <run-id>/
      manifest.json
      provenance.jsonl
      sentience-receipts.jsonl
      decisions.jsonl
      annotations.jsonl
```

Manifest references are relative to `PROJECT_DIR`. Reads fail closed when
the path is absolute, escapes through `..` or a symlink, has an unsupported
media type, or disagrees with the manifest/run/identity identifiers. Each
manifest includes explicit `decision_requests` (question and authorized scope)
and the primary artifact's `sha256`; neither pending work nor artifact identity
is inferred from mutable prose.

## API

- `GET /api/identities/:id/review`
- `GET /api/identities/:id/review/runs/:runId`
- `GET /api/identities/:id/review/runs/:runId/traces/:claimId`
- `POST /api/identities/:id/review/runs/:runId/decisions`
- `POST /api/identities/:id/review/runs/:runId/annotations`
- `POST /api/identities/:id/review/runs/:runId/annotations/:annotationId/address`
- `GET /api/identities/:id/review/runs/:runId/chat`
- `POST /api/identities/:id/review/runs/:runId/chat`

## Out of scope

Contradiction Watcher execution or automatic delivery, SenseTune/EEG capture,
blind experiment infrastructure, training-data mutation, raw chain-of-thought,
automatic publication, purchasing, outreach, deployment, or authorization of
unrelated future runs.

## Premortem

- **Schema drift:** validate one versioned contract and ship producer examples.
- **Trace overload:** show a one-line marker preview and disclose the full trace
  only on demand through a selectable decision lens and docked context panel.
- **Private-file exposure:** resolve only validated identity/run references and
  contained relative paths.
- **Fake certainty:** retain evidence class, source locator, rejected
  alternatives, uncertainty, and explicit no-link states.
- **Performative Sentience calls:** support receipts without quotas or mandatory
  calls.
- **Silent self-exoneration:** an annotation can only be addressed by a later
  run, with the replacement link preserved.
- **Lost asleep chat:** fail visibly while the identity is stopped; do not label
  a trajectory append as queued when the dispatcher cannot replay it.

## Verification

Backend contract and containment tests; frontend typecheck and interaction
tests; production build; browser checks at desktop and 390 px; an imported real
residency; and a separately observed Headlong run that remains productive for
at least 30 continuous minutes without treating 30 minutes as its stop limit.
