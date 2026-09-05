import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ArtifactReader,
  claimIdFromTraceHref,
} from "~/components/review-artifact";
import { DecisionCard } from "~/components/review-decision-card";
import { ReviewContextSidebar } from "~/components/review-context-sidebar";
import type { ClaimTrace, DecisionRequest, HumanDecision, ReviewArtifact } from "~/lib/types";

afterEach(cleanup);

const artifact: ReviewArtifact = {
  path: "artifacts/brief.md",
  title: "Decision brief",
  media_type: "text/markdown",
  sha256: "sha256-brief",
  content:
    "A supported claim [trace](headlong://trace/claim-supported) and an unsupported claim [trace](headlong://trace/claim-missing).",
};

const trace: ClaimTrace = {
  claim_id: "claim-supported",
  artifact_ref: artifact.path,
  claim_text: "A supported claim",
  evidence_class: "observed",
  sources: [
    {
      kind: "local_file",
      ref: "research/source.md#L12",
      label: "Research note",
      excerpt: "Directly observed evidence.",
      retrieved_at: "2026-09-04T12:00:00Z",
    },
  ],
  reason: "This source directly supports the claim.",
};

describe("review artifact", () => {
  it("accepts only exact contract-valid trace URLs", () => {
    expect(claimIdFromTraceHref("headlong://trace/claim-1:_ok.value")).toBe(
      "claim-1:_ok.value"
    );
    expect(claimIdFromTraceHref("HEADLONG://trace/claim-1")).toBeNull();
    expect(claimIdFromTraceHref("headlong://trace/claim-1?next=bad")).toBeNull();
    expect(claimIdFromTraceHref("headlong://trace/claim%2Fescape")).toBeNull();
    expect(claimIdFromTraceHref("headlong://trace/%ZZ")).toBeNull();
    expect(claimIdFromTraceHref("headlong://trace/-starts-wrong")).toBeNull();
  });

  it("renders trace markers and opens both linked and unlinked claims", () => {
    const onOpenTrace = vi.fn();
    render(
      <ArtifactReader
        artifact={artifact}
        traces={[trace]}
        lensEnabled={false}
        selectedIds={new Set()}
        onSelect={vi.fn()}
        onOpenTrace={onOpenTrace}
      />
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Inspect reasoning for claim claim-supported",
      })
    );
    expect(onOpenTrace).toHaveBeenLastCalledWith(
      "claim-supported"
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "No reasoning linked for claim claim-missing",
      })
    );
    expect(onOpenTrace).toHaveBeenLastCalledWith(
      "claim-missing"
    );
  });

  it("selects passages only while the decision lens is active", () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <ArtifactReader artifact={artifact} traces={[trace]} lensEnabled={false} selectedIds={new Set()} onSelect={onSelect} onOpenTrace={vi.fn()} />
    );
    fireEvent.click(screen.getByText(/A supported claim/));
    expect(onSelect).not.toHaveBeenCalled();

    rerender(
      <ArtifactReader artifact={artifact} traces={[trace]} lensEnabled selectedIds={new Set()} onSelect={onSelect} onOpenTrace={vi.fn()} />
    );
    fireEvent.click(screen.getByRole("button", { name: /A supported claim/ }));
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ claimIds: ["claim-supported", "claim-missing"] }),
      false
    );
  });
});

const request: DecisionRequest = {
  decision_request_id: "request-1",
  question: "Publish the recommendation?",
  authorized_scope: "Publish the brief only; do not contact customers.",
};

const priorDecision: HumanDecision = {
  operation_id: "operation-1",
  decision_id: "decision-1",
  run_id: "run-1",
  decision_request_id: request.decision_request_id,
  question: request.question,
  answer: "hold",
  rationale: "Wait for the final source.",
  decided_at: "2026-09-04T12:10:00Z",
  supersedes: null,
  authorized_scope: request.authorized_scope,
};

describe("review decision", () => {
  it("shows all four answers, the authorized scope, and supersedes a prior answer", async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(
      <DecisionCard
        request={request}
        latestDecision={priorDecision}
        onSubmit={onSubmit}
      />
    );

    expect(screen.getByText(request.authorized_scope)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Change decision" }));

    expect(screen.getByRole("button", { name: /^Yes/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^No/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Hold/ })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /^Need more evidence/ })
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Yes/ }));
    fireEvent.change(screen.getByLabelText("Rationale"), {
      target: { value: "The direct evidence is now complete." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record decision" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        decision_request_id: "request-1",
        answer: "yes",
        rationale: "The direct evidence is now complete.",
        supersedes: "decision-1",
      })
    );
  });
});

describe("review context sidebar", () => {
  it("shows selected reasoning and disables chat honestly while the identity is asleep", () => {
    const onToggleDecision = vi.fn();
    render(
      <ReviewContextSidebar
        open
        onClose={vi.fn()}
        selections={[{
          id: "0:20",
          startOffset: 0,
          endOffset: 20,
          excerpt: "A supported claim",
          claimIds: [trace.claim_id],
        }]}
        traces={[trace]}
        annotations={[]}
        decisionRequests={[request]}
        selectedDecisionIds={new Set()}
        onToggleDecision={onToggleDecision}
        decisionsContent={null}
        chat={{
          identity: { id: "reviewer", name: "Reviewer" },
          live: false,
          chat_ready: false,
          sender: "review-thread",
          messages: [],
          outcomes: {},
        }}
        chatPending={false}
        onSendChat={vi.fn()}
        onAnnotateClaim={vi.fn()}
        replacementHref={() => "/review"}
      />
    );

    expect(screen.getByText(trace.reason)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Chat" }));
    expect(screen.getByText(/cannot replay messages/)).toBeTruthy();
    expect(screen.getByLabelText("Ask about selected context").hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("tab", { name: "Decisions" }));
    fireEvent.click(screen.getByRole("button", { name: request.question }));
    expect(onToggleDecision).toHaveBeenCalledWith(request.decision_request_id);
  });
});
