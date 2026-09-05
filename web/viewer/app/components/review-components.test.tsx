import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ArtifactReader,
  claimIdFromTraceHref,
} from "~/components/review-artifact";
import { DecisionCard } from "~/components/review-decision-card";
import { TraceDrawer } from "~/components/review-trace-drawer";
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
        onOpenTrace={onOpenTrace}
      />
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open evidence for claim claim-supported",
      })
    );
    expect(onOpenTrace).toHaveBeenLastCalledWith(
      "claim-supported",
      expect.any(HTMLElement)
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open evidence for claim claim-missing",
      })
    );
    expect(onOpenTrace).toHaveBeenLastCalledWith(
      "claim-missing",
      expect.any(HTMLElement)
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

describe("trace drawer modal", () => {
  it("inerts the background, traps focus, restores focus, and links addressed replacements", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      const triggerRef = useRef<HTMLButtonElement>(null);
      return (
        <>
          <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>
            Open trace
          </button>
          {open && (
            <TraceDrawer
              claimId="claim-supported"
              result={{
                claim_id: "claim-supported",
                linked: false,
                message: "No evidence linked",
              }}
              loading={false}
              annotations={[
                {
                  type: "annotation",
                  operation_id: "operation-annotation",
                  annotation_id: "annotation-1",
                  run_id: "run-1",
                  target_type: "claim",
                  target_id: "claim-supported",
                  artifact_ref: "artifacts/brief.md",
                  artifact_sha256: "a".repeat(64),
                  category: "wrong_fact",
                  note: "This number is stale.",
                  created_at: "2026-09-04T12:00:00Z",
                },
                {
                  type: "addressed",
                  operation_id: "operation-address",
                  address_id: "address-1",
                  annotation_id: "annotation-1",
                  addressed_by_run_id: "run-2",
                  replacement_claim_id: "claim-replacement",
                  replacement_artifact_ref: "artifacts/replacement.md",
                  replacement_artifact_sha256: "b".repeat(64),
                  note: "Corrected in the next run.",
                  addressed_at: "2026-09-04T13:00:00Z",
                },
              ]}
              onClose={() => setOpen(false)}
              onAnnotate={vi.fn()}
              returnFocusTo={triggerRef.current}
              replacementHref={(address) =>
                `/review?run=${address.addressed_by_run_id}&claim=${address.replacement_claim_id}`
              }
            />
          )}
        </>
      );
    }

    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Open trace" });
    fireEvent.click(trigger);

    await waitFor(() =>
      expect(trigger.hasAttribute("inert")).toBe(true)
    );
    expect(screen.getByText("Addressed")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /replacement\.md/ }).getAttribute("href")
    ).toBe("/review?run=run-2&claim=claim-replacement");

    const note = screen.getByLabelText("Note");
    note.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Close evidence drawer" })
    );
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(note);

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(trigger.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });
});
