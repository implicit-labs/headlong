import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ArtifactReader,
  claimIdFromTraceHref,
} from "~/components/review-artifact";
import { AnnotationForm } from "~/components/review-annotation-form";
import { DecisionCard } from "~/components/review-decision-card";
import { SentienceAnswers } from "~/components/review-sentience";
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

  it("shows trace indicators only under the lens, and never as controls", () => {
    const { rerender } = render(
      <ArtifactReader artifact={artifact} traces={[trace]} lensEnabled={false} selectedIds={new Set()} onSelect={vi.fn()} onOpenTrace={vi.fn()} />
    );
    // Lens off: the page reads as a document.
    expect(document.querySelector('[data-trace-indicator="claim-supported"]')).toHaveProperty("hidden", true);
    expect(screen.queryByRole("button", { name: /claim-supported/ })).toBeNull();

    rerender(
      <ArtifactReader artifact={artifact} traces={[trace]} lensEnabled selectedIds={new Set()} onSelect={vi.fn()} onOpenTrace={vi.fn()} />
    );
    expect(document.querySelector('[data-trace-indicator="claim-supported"]')).toHaveProperty("hidden", false);
    expect(screen.getByLabelText("1 linked claim: claim-supported")).toBeTruthy();
    expect(screen.getByLabelText("No reasoning linked for claim claim-missing")).toBeTruthy();
  });

  it("strips trace markers from the excerpt a reader sees", () => {
    const onSelect = vi.fn();
    render(
      <ArtifactReader artifact={artifact} traces={[trace]} lensEnabled selectedIds={new Set()} onSelect={onSelect} onOpenTrace={vi.fn()} />
    );
    fireEvent.click(screen.getByRole("button", { name: /A supported claim/ }));
    const selection = onSelect.mock.calls[0][0];
    expect(selection.excerpt).not.toContain("headlong://trace");
    expect(selection.excerpt).toContain("A supported claim");
  });

  it("renders an inline SVG diagram and selects an anchored node with its claims", () => {
    const diagramArtifact: ReviewArtifact = {
      ...artifact,
      content: [
        "# Gate A",
        "",
        "Prose before [t](headlong://trace/claim-supported).",
        "",
        '<svg viewBox="0 0 100 40" role="img" aria-label="path"><g data-node="filter" data-claim="claim-supported claim-missing" aria-label="Vendor filter"><rect x="2" y="2" width="40" height="20"/><text x="4" y="14">Vendor filter</text></g><g data-node="gate"><rect x="50" y="2" width="40" height="20"/></g><script>alert(1)</script></svg>',
        "",
        "Prose after.",
      ].join("\n"),
    };
    const onSelect = vi.fn();
    const { container, rerender } = render(
      <ArtifactReader artifact={diagramArtifact} traces={[trace]} lensEnabled={false} selectedIds={new Set()} onSelect={onSelect} onOpenTrace={vi.fn()} />
    );
    const svg = container.querySelector(".review-diagram svg");
    expect(svg).not.toBeNull();
    // The author omitted xmlns; the reader must still produce real SVG, not null-namespace text.
    expect(svg!.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(container.querySelector(".review-diagram rect")!.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(container.querySelector(".review-diagram script")).toBeNull(); // second-layer strip
    // Lens off: inert.
    fireEvent.click(container.querySelector('[data-node="filter"]')!);
    expect(onSelect).not.toHaveBeenCalled();

    rerender(
      <ArtifactReader artifact={diagramArtifact} traces={[trace]} lensEnabled selectedIds={new Set()} onSelect={onSelect} onOpenTrace={vi.fn()} />
    );
    const filter = container.querySelector('[data-node="filter"]')!;
    expect(filter.getAttribute("role")).toBe("button");
    fireEvent.click(filter.querySelector("text")!, { shiftKey: true });
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "node:1:filter",
        nodeId: "filter",
        claimIds: ["claim-supported", "claim-missing"],
        excerpt: "Vendor filter",
      }),
      true
    );
    // Prose around the diagram still selects, with offsets absolute in the full artifact.
    fireEvent.click(screen.getByText(/Prose after/));
    const after = onSelect.mock.calls.at(-1)![0];
    expect(diagramArtifact.content.slice(after.startOffset, after.endOffset)).toBe("Prose after.");
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

describe("review annotation", () => {
  it("shows and enforces the server's 4,000-character note limit", () => {
    render(<AnnotationForm onSubmit={vi.fn()} />);

    const note = screen.getByLabelText("Note");
    expect(note.getAttribute("maxlength")).toBe("4000");
    expect(screen.getByText("0 / 4,000")).toBeTruthy();

    fireEvent.change(note, { target: { value: "evidence gap" } });
    expect(screen.getByText("12 / 4,000")).toBeTruthy();
  });
});


describe("presentation hierarchy", () => {
  afterEach(cleanup);
  const request = {
    decision_request_id: "dr-retry",
    question: "Authorize the Gate A retry as designed: a single bounded session on the unfiltered OSC path with one changed variable.",
    headline: "Run the retry?",
    summary: "One 35-minute session, filter off, everything else identical to Aug 22.",
    authorized_scope: "A single bounded session; no other collection.",
    anchor_node: "filter",
  };

  it("a decision leads with its headline and shows answers before any form", () => {
    render(<DecisionCard request={request} onSubmit={vi.fn()} />);
    expect(screen.getByRole("heading", { level: 3 }).textContent).toBe("Run the retry?");
    expect(screen.getByText(/One 35-minute session, filter off/)).toBeTruthy();
    expect(screen.queryByLabelText("Rationale")).toBeNull();
    expect(screen.getByText("A single bounded session; no other collection.")).toBeTruthy(); // present, collapsed
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(screen.getByLabelText("Rationale")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Record decision" })).toBeTruthy();
  });

  it("without a headline it falls back to the first sentence, never the paragraph", () => {
    render(<DecisionCard request={{ ...request, headline: null, summary: null }} onSubmit={vi.fn()} />);
    expect(screen.getByRole("heading", { level: 3 }).textContent).toMatch(/^Authorize the Gate A retry as designed/);
    expect(screen.getByRole("heading", { level: 3 }).textContent!.length).toBeLessThan(120);
  });

  it("Sentience answers show the question and what changed, and open the claim", () => {
    const onOpenClaim = vi.fn();
    render(<SentienceAnswers onOpenClaim={onOpenClaim} receipts={[
      { receipt_id: "r1", question: "Are the earbuds with you right now? Or at an office?", response: "Yes.", thread_ref: "t", request_ref: "p", timestamp: "2026-09-06T01:00:00Z", affected_claim_id: "c-buds", affected_decision_request_id: null, resulting_change: "Confirmed present; outreach put on hold." },
    ]} />);
    expect(screen.getByText("Are the earbuds with you right now?")).toBeTruthy();
    expect(screen.getByText(/Confirmed present; outreach put on hold/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button"));
    expect(onOpenClaim).toHaveBeenCalledWith("c-buds");
  });
});
