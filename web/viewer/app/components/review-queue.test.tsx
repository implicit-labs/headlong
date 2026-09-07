import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReviewQueue } from "~/components/review-queue";
import type { ReviewRunDetail, ReviewRunSummary } from "~/lib/types";

afterEach(cleanup);

const run = {
  identity: { id: "i", name: "i" },
  manifest: {
    schema_version: 1, run_id: "r1", identity_id: "i", title: "Run", goal_ref: "g.md", status: "waiting_on_toma",
    started_at: "2026-09-06T00:00:00Z", deadline: "2026-09-06T03:00:00Z", primary_artifact: null,
    next_step_options: [
      { title: "Execute the Gate A retry", scope: "one session", expected_artifact: "report", stopping_rule: "35 min", duration_minutes: 35, recommended: true },
      { title: "Send the outreach", scope: "unchanged draft", expected_artifact: "email", stopping_rule: "5 min", duration_minutes: 5 },
    ],
    review_surface: { has_diagram: false, prose_words: 900, anchored_claims: 3, diagram_nodes: [], no_diagram_reason: "Five unrelated strands share no mechanism." },
  },
  valid: true, validation_errors: [], warnings: ["sentience-receipts.jsonl line 1 is invalid and was skipped"],
  time_remaining_s: 0, pending_decision_count: 2, artifact: null, provenance: [],
  sentience_receipts: [
    { receipt_id: "r-1", question: "Are the Smartbuds with you right now?", response: "Yes.", thread_ref: "t", request_ref: "p.json", timestamp: "2026-09-06T01:00:00Z", affected_claim_id: "c-buds", affected_decision_request_id: null, resulting_change: "no change - strand confirmed current" },
  ],
  decision_requests: [
    { decision_request_id: "dr-retry", question: "Authorize the Gate A retry as designed? It changes one variable.", authorized_scope: "one session", anchor_node: "filter", answered: false },
    { decision_request_id: "dr-outreach", question: "Send or hold the outreach?", authorized_scope: "send once", answered: false },
    { decision_request_id: "dr-schema", question: "Which side of the schema should change?", authorized_scope: "docs only", answered: true },
  ],
  decisions: [], annotations: [],
} as unknown as ReviewRunDetail;

const other: ReviewRunSummary = {
  run_id: "r0", title: "Earlier residency", goal_ref: "g.md", status: "waiting_on_toma", started_at: "2026-09-05T00:00:00Z",
  deadline: "2026-09-05T03:00:00Z", time_remaining_s: 0, primary_artifact: null, pending_decision_count: 5, valid: true, validation_errors: [], warnings: [],
} as ReviewRunSummary;

describe("review queue", () => {
  it("lists what is waiting on the human, grouped, with the ledger deciding what is done", () => {
    render(<ReviewQueue run={run} otherWaitingRuns={[other]} onOpenDecision={vi.fn()} onOpenClaim={vi.fn()} onOpenNextRun={vi.fn()} onOpenRun={vi.fn()} />);
    expect(screen.getByText("Before the next run")).toBeTruthy();
    expect(screen.getByText("1 of 3 decided")).toBeTruthy();
    expect(screen.getByText(/Authorize the Gate A retry as designed\?/)).toBeTruthy();
    expect(screen.getByText("· on filter")).toBeTruthy();
    expect(screen.queryByText(/Which side of the schema/)).toBeNull(); // decided → not in the queue
    expect(screen.getByText("Check what Sentience answered as you")).toBeTruthy();
    expect(screen.getByText(/No diagram — the agent's reason: Five unrelated strands/)).toBeTruthy();
    expect(screen.getByText(/line 1 is invalid and was skipped/)).toBeTruthy();
    expect(screen.getByText("Execute the Gate A retry")).toBeTruthy();
    expect(screen.getByText("Earlier residency")).toBeTruthy();
    expect(screen.getByText("7 items")).toBeTruthy(); // 2 to decide + 1 receipt + 2 notes + 1 next-run pick + 1 other run
  });

  it("jumps: a decision opens its card, a receipt opens the claim it changed, a run switches", () => {
    const onOpenDecision = vi.fn(); const onOpenClaim = vi.fn(); const onOpenNextRun = vi.fn(); const onOpenRun = vi.fn();
    render(<ReviewQueue run={run} otherWaitingRuns={[other]} onOpenDecision={onOpenDecision} onOpenClaim={onOpenClaim} onOpenNextRun={onOpenNextRun} onOpenRun={onOpenRun} />);
    fireEvent.click(screen.getByText(/Send or hold the outreach/));
    expect(onOpenDecision).toHaveBeenCalledWith(expect.objectContaining({ decision_request_id: "dr-outreach" }));
    fireEvent.click(screen.getByText(/Are the Smartbuds with you right now/));
    expect(onOpenClaim).toHaveBeenCalledWith("c-buds");
    fireEvent.click(screen.getByText("Execute the Gate A retry"));
    expect(onOpenNextRun).toHaveBeenCalled();
    fireEvent.click(screen.getByText("Earlier residency"));
    expect(onOpenRun).toHaveBeenCalledWith("r0");
  });

  it("says so plainly when nothing is waiting", () => {
    const quiet = { ...run, decision_requests: [], sentience_receipts: [], warnings: [], manifest: { ...run.manifest, next_step_options: [], review_surface: null } } as unknown as ReviewRunDetail;
    render(<ReviewQueue run={quiet} otherWaitingRuns={[]} onOpenDecision={vi.fn()} onOpenClaim={vi.fn()} onOpenNextRun={vi.fn()} onOpenRun={vi.fn()} />);
    expect(screen.getByText("Nothing waiting on you")).toBeTruthy();
  });
});
