# Provenance-backed Daily Review

IMP-632 turns Headlong's durable run output into a calm, artifact-first review
loop. An identity now exposes `/i/<identity>/review`, backed by schema-v1 files
inside its configured workspace rather than by inferred model state.

Each launched run gets a manifest and append-only provenance, receipt,
decision, and annotation ledgers. Ready artifacts are immutable UTF-8 Markdown
snapshots with SHA-256 pins. Claim markers disclose persisted evidence on
demand; an absent trace stays explicitly absent. Sentience receipts are
redacted before persistence and again before response rendering.

Human decisions show and preserve their exact authorized scope. Reversals,
reasoning annotations, and later-run replacement links append events instead of
rewriting history. Stable operation IDs plus inter-process file locks make
mutation retries idempotent. Later launches receive prior decisions and
unresolved annotations as quoted feedback without treating them as new
authority.

The viewer adds review badges, mobile-first artifact reading, decision cards,
trace previews and a keyboard-contained evidence drawer, annotations, addressed
replacement links, and bounded next-run proposals. Malformed runs stay visible
with validation errors but do not count as ready work.

Verification covers the producer lifecycle, containment and read-only failures,
all five statuses, trace classes, decision reversal and mutation races,
frontend interactions, type checking, production build, desktop/390 px browser
checks, and a real completed Treasurer residency import. Release verification
also requires a separately observed Headlong run continuing beyond the
30-minute checkpoint; failed launches are recorded but do not satisfy that gate.
