import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BriefReader } from "~/components/review-brief";
import type { BriefDocument, ClaimTrace, ReviewArtifact } from "~/lib/types";

afterEach(cleanup);

const brief: BriefDocument = {
  schema: "headlong.brief/1",
  question: "Can one session work?",
  finding: "Probably.",
  blocks: [
    { type: "compare", before: { label: "Aug 22", tag: "FAILED" }, after: { label: "Retry", tag: "YOUR CALL" },
      nodes: [
        { id: "buds", label: "Earbuds", claims: ["c-buds"], after: null },
        { id: "filter", label: "Vendor filter", sub: "ON", state: "changed", claims: ["c-nogo", "c-one"], after: { sub: "OFF", state: "bypassed" } },
        { id: "rec", label: "Recording", claims: [], after: null },
      ],
      edges: [{ from: "buds", to: "filter" }, { from: "filter", to: "rec" }], note: "One thing changes." },
    { type: "metric", value: "~100", unit: "Hz", label: "per channel", claims: ["c-rate"] },
    { type: "figure", path: "artifacts/runs/r/artifacts/figure-abc.png", caption: "A picture.", claims: [] },
    { type: "decision", id: "dr-1", headline: "Go?", summary: "One step.", scope: "Only this." },
    { type: "prose", markdown: "Mains folds to 40 Hz [†](headlong://trace/c-rate)." },
  ],
};
const artifact = { path: "p", title: "Brief", media_type: "application/vnd.headlong.brief+json", sha256: "0".repeat(64), content: "{}", brief } as ReviewArtifact;
const traces = [{ claim_id: "c-rate", claim_text: "rate", evidence_class: "observed", reason: "r", sources: [] }] as unknown as ClaimTrace[];

describe("brief reader", () => {
  it("compiles blocks: a compare draws two lanes with the changed node bypassed; decisions render elsewhere", () => {
    const { container } = render(<BriefReader artifact={artifact} brief={brief} traces={traces} lensEnabled={false} selectedIds={new Set()} onSelect={vi.fn()} figureUrl={(i) => `/fig/${i}`} />);
    const filters = container.querySelectorAll('[data-node="filter"]');
    expect(filters.length).toBe(2);                                    // before and after lanes
    expect(filters[1].getAttribute("opacity")).toBe("0.5");            // bypassed in the after lane
    expect(container.querySelector('[data-node="filter"] rect')!.getAttribute("stroke-dasharray")).toBeNull();
    expect(filters[1].querySelector("rect")!.getAttribute("stroke-dasharray")).toBe("4 4");
    expect(screen.getByText("~100")).toBeTruthy();
    expect((container.querySelector("img") as HTMLImageElement).getAttribute("src")).toBe("/fig/0");
    expect(screen.queryByText("Go?")).toBeNull();                      // decisions are the route's job
    expect(screen.getByText(/Mains folds to 40 Hz/)).toBeTruthy();
  });

  it("under the lens a node selects with its claims and a shared id across lanes", () => {
    const onSelect = vi.fn();
    const { container } = render(<BriefReader artifact={artifact} brief={brief} traces={traces} lensEnabled selectedIds={new Set()} onSelect={onSelect} figureUrl={(i) => `/fig/${i}`} />);
    fireEvent.click(container.querySelectorAll('[data-node="filter"]')[1]);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "node:0:filter", nodeId: "filter", claimIds: ["c-nogo", "c-one"] }), false);
    fireEvent.click(screen.getByText("~100").closest("[data-review-tile]")!, { shiftKey: true });
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ id: "metric:1", claimIds: ["c-rate"] }), true);
  });

  it("is inert with the lens off", () => {
    const onSelect = vi.fn();
    const { container } = render(<BriefReader artifact={artifact} brief={brief} traces={traces} lensEnabled={false} selectedIds={new Set()} onSelect={onSelect} figureUrl={(i) => `/fig/${i}`} />);
    fireEvent.click(container.querySelector('[data-node="buds"]')!);
    expect(onSelect).not.toHaveBeenCalled();
    expect(container.querySelector('[data-node="buds"]')!.getAttribute("role")).toBeNull();
  });
});
