# docs/changelogs/

One file per change that is worth explaining later, newest first.

Upstream keeps release notes on the GitHub release and has no CHANGELOG file
(see [RELEASING.md](../RELEASING.md)). This directory is a fork-local addition
and does not conflict with that: it records *why* a change was made, at a
granularity a release note does not reach, so that a fix is not silently undone
six months from now by someone who cannot see what it cost.

Name entries `YYYY-MM-DD-<slug>.md`. Write them for the person who will hit the
same problem again.

| Date | Change | Summary |
|---|---|---|
| 2026-09-04 | [Provenance-backed Daily Review](2026-09-04-provenance-daily-review.md) | Add immutable review artifacts, traceable claims, scoped decisions, correction feedback, and a phone-first review route. |
| 2026-08-30 | [Shadow Contradiction Watcher](2026-08-30-shadow-contradiction-watcher.md) | Stop saturated spending; persist sub-runs; fail closed on filler/network; privately diff live memory without delivery. |
| 2026-08-29 | [Durable agent foundation](2026-08-29-durable-agent-foundation.md) | Stop executing model prose as shell; sonnet-5 defaults; reusable workspace template; consolidated operating docs. |
