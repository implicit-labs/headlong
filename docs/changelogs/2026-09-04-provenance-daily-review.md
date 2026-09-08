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

The viewer adds review badges and an artifact-dominant reading canvas with an
optional decision lens (`D`). Passages become selectable without changing the
normal reading experience; Shift-click builds a multi-passage context, and a
docked desktop/mobile sidebar exposes reasoning, decisions, annotations, and
bounded next-run proposals. Malformed runs stay visible with validation errors
but do not count as ready work.

The sidebar can chat over selected passages, claim traces, and decision
requests. The server resolves every locator against the pinned artifact and
validated ledgers before messaging the identity, rejects forged or cross-run
context, and preserves idempotency through a stable operation marker. Chat is
disabled while the identity is asleep because Headlong does not replay messages
written before dispatcher startup; the UI does not pretend those messages are
queued.

Verification covers the producer lifecycle, containment and read-only failures,
all five statuses, trace classes, decision reversal and mutation races,
frontend interactions, type checking, production build, desktop/390 px browser
checks, and a real completed Treasurer residency import. Release verification
also requires a separately observed Headlong run continuing beyond the
30-minute checkpoint; failed launches are recorded but do not satisfy that gate.

The release gate was satisfied by the real Anthropic-backed run
`residency-20260905T014813Z-e05932eb`: it started at 01:48:13Z, produced its
first model work at 01:48:24Z, remained live beyond minute 30, wrote fresh
safety-test evidence at 02:19:24–02:19:29Z, and was stopped by its watchdog at
02:24:13Z. The final immutable artifact is SHA-256
`0a7b4943e7dabbe4cd516fe45edbda818934fe166ff7a9e1a3b04231e9998823`
with three linked provenance records. Early publish attempts and an old
identity-seed timestamp were rejected during the audit rather than counted as
proof of the run.

That live run required one narrowly scoped network exception. The curl guard
now permits the Anthropic Messages endpoint only when an operator explicitly
sets `HEADLONG_ANTHROPIC_TRANSPORT=1`; it accepts only the two public protocol
headers, private file-backed auth and payload inputs, and an optional private
response file. Alternate hosts, inline bodies, redirects, proxies, arbitrary
headers, and caller-selected files remain denied.

The final visual pass also made wide Markdown tables scroll inside the artifact
instead of widening the phone canvas. The run's N1 finding was fixed: reasoning
annotations now expose and enforce the server's 4,000-character note limit in
the composer, with a live count and regression coverage.
