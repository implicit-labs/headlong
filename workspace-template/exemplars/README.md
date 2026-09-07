# Exemplars: briefs the review page compiles

A brief is what a run hands the operator. It is data, not a document: a
question, a finding, and a list of typed blocks. The review page owns how each
block looks, so every node is clickable, every claim is reachable, and the
layout is consistent - and you never draw anything.

**Start by copying the exemplar closest to your work, then replace its content.**
Each ships with the provenance file it references, and each is validated in CI:
if one stops passing, the build fails.

| exemplar | shows |
|---|---|
| `gate-a-retry` | a before/after `compare`, a `metric`, decisions anchored to nodes, next `steps`, a short `prose` block with an inline marker |
| `minimal` | the smallest honest brief: one `flow`, one decision |
| `figure-and-metric` | an image the run produced (`figure`) beside a number (`metric`) |

Check yours before `ready`:

```bash
headlong-review-run validate-brief --workspace . --brief analysis/brief.json --provenance analysis/provenance.json
```

## Blocks

- **`question` / `finding`** - the two sentences read first. The question ends
  in `?`; the finding says what was learned, never what was filed.
- **`flow`** - nodes `{id, label, sub?, state?, claims?}` and edges `[from, to]`.
  States: `ok failed changed bypassed pending provisional`.
- **`compare`** - a flow drawn twice, `before` and `after`. Give at least one
  node an `after: {label?, sub?, state?}`; that is the thing that changes.
- **`decision`** - `id, headline, summary, scope`, optional long `question`,
  optional `anchor` (a node id) and `claim_id`. Becomes a decision request the
  operator answers with four buttons.
- **`steps`** - next-run options.
- **`prose`** - short Markdown, budgeted at 600 words across all prose blocks.
  Inline `[†](headlong://trace/<claim-id>)` markers still work here.
- **`figure`** - a workspace-relative image you produced, with a caption.
- **`metric`** - `value, unit?, label`, with the claim behind the number.

Every claim in provenance must be attached to some block; every claim a block
names must exist in provenance. A brief needs at least one visual block
(`flow`, `compare`, `figure`, `metric`) or a specific `no_visual_reason`.
