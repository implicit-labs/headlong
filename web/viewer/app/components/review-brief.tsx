import type { KeyboardEvent, MouseEvent } from "react";

import { ProseMarkdown, readableExcerpt, traceOffsets } from "~/components/review-artifact";
import type { ArtifactPassageSelection } from "~/components/review-artifact";
import { cn } from "~/lib/utils";
import type { BriefBlock, BriefDocument, BriefEdge, BriefNode, BriefNodeState, ClaimTrace, ReviewArtifact } from "~/lib/types";

type Lane = { label: string; tag?: string | null; nodes: BriefNode[]; edges: BriefEdge[]; accent?: boolean };

const NODE_H = 46, GAP = 44, LANE_H = 118, LABEL_ROW = 30;

function nodeWidth(node: BriefNode): number {
  const longest = Math.max(node.label.length, (node.sub ?? "").length * 0.8);
  return Math.max(112, Math.min(200, Math.round(longest * 8.6 + 34)));
}

function applyAfter(node: BriefNode): BriefNode {
  if (!node.after) return { ...node, after: null };
  return { ...node, label: node.after.label ?? node.label, sub: node.after.sub ?? node.sub, state: node.after.state ?? node.state, after: null };
}

function strokeFor(state?: BriefNodeState | null): string {
  switch (state) {
    case "failed": return "var(--destructive)";
    case "changed": case "pending": return "var(--primary)";
    case "ok": return "oklch(0.6 0.13 160)";
    default: return "var(--border)";
  }
}

/** Boxes and arrows from data. One lane for a flow, two for a compare. Nodes
 *  with state "bypassed" are drawn dashed and the arrow skips over them. */
export function FlowDiagram({
  blockIndex,
  lanes,
  note,
  lensEnabled,
  selectedIds,
  onSelect,
  ariaLabel,
}: {
  blockIndex: number;
  lanes: Lane[];
  note?: string | null;
  lensEnabled: boolean;
  selectedIds: Set<string>;
  onSelect: (selection: ArtifactPassageSelection, additive: boolean) => void;
  ariaLabel: string;
}) {
  // shared x layout across lanes so the same node sits in the same column
  const widths = new Map<string, number>();
  lanes.forEach((lane) => lane.nodes.forEach((n) => widths.set(n.id, Math.max(widths.get(n.id) ?? 0, nodeWidth(n)))));
  const order = lanes[0].nodes.map((n) => n.id);
  const xs = new Map<string, number>();
  let cursor = 0;
  order.forEach((id) => { xs.set(id, cursor); cursor += (widths.get(id) ?? 112) + GAP; });
  const width = Math.max(560, cursor - GAP);
  const height = lanes.length * LANE_H + (note ? 24 : 0);
  const selId = (id: string) => `node:${blockIndex}:${id}`;

  const activate = (node: BriefNode, event: MouseEvent | KeyboardEvent) => {
    if (!lensEnabled) return;
    event.preventDefault(); event.stopPropagation();
    onSelect({
      id: selId(node.id), startOffset: 0, endOffset: 0,
      excerpt: [node.label, node.sub].filter(Boolean).join(": "),
      claimIds: node.claims ?? [], nodeId: node.id,
    }, "shiftKey" in event && event.shiftKey);
  };

  return (
    <figure className="not-prose my-8 overflow-x-auto rounded-xl border bg-background p-4 sm:p-6">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}
           className={cn("review-diagram mx-auto block h-auto w-full text-muted-foreground", lensEnabled && "review-diagram-lens")} style={{ minWidth: 520 }}>
        <defs><marker id={`ar-${blockIndex}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><polygon points="0,1 9,5 0,9" fill="currentColor" /></marker></defs>
        {lanes.map((lane, li) => {
          const top = li * LANE_H;
          const byId = new Map(lane.nodes.map((n) => [n.id, n]));
          const bypassed = new Set(lane.nodes.filter((n) => n.state === "bypassed").map((n) => n.id));
          const next = new Map(lane.edges.map((e) => [e.from, e.to]));
          return (
            <g key={li}>
              <text x={0} y={top + 14} fontSize={13} fontWeight={700} fill="var(--foreground)" style={{ fontFamily: "inherit" }}>{lane.label}</text>
              {lane.tag && <text x={width} y={top + 14} textAnchor="end" fontSize={10} letterSpacing={1} fill={lane.accent ? "var(--primary)" : "currentColor"} style={{ fontFamily: "ui-monospace, monospace" }}>{lane.tag}</text>}
              {lane.edges.map((e, ei) => {
                const a = byId.get(e.from), b = byId.get(e.to);
                if (!a || !b || bypassed.has(e.from)) return null;
                const ax = (xs.get(a.id) ?? 0) + (widths.get(a.id) ?? 0), y = top + LABEL_ROW + NODE_H / 2;
                if (bypassed.has(e.to)) {
                  const c = byId.get(next.get(e.to) ?? ""); if (!c) return null;
                  const cx = xs.get(c.id) ?? 0;
                  return <g key={ei}><path d={`M ${ax + 2} ${y - 8} C ${ax + 40} ${y - 40}, ${cx - 40} ${y - 40}, ${cx - 2} ${y - 8}`} fill="none" stroke="var(--primary)" strokeWidth={1.8} markerEnd={`url(#ar-${blockIndex})`} />
                    <text x={(ax + cx) / 2} y={y - 34} textAnchor="middle" fontSize={10} fill="var(--primary)" style={{ fontFamily: "ui-monospace, monospace" }}>{e.label ?? "bypassed"}</text></g>;
                }
                const bx = xs.get(b.id) ?? 0;
                return <g key={ei}><line x1={ax + 2} y1={y} x2={bx - 2} y2={y} stroke="currentColor" strokeWidth={1.4} markerEnd={`url(#ar-${blockIndex})`} />
                  {e.label && <text x={(ax + bx) / 2} y={y - 6} textAnchor="middle" fontSize={10} fill="currentColor" style={{ fontFamily: "ui-monospace, monospace" }}>{e.label}</text>}</g>;
              })}
              {lane.nodes.map((n) => {
                const x = xs.get(n.id) ?? 0, w = widths.get(n.id) ?? 112, y = top + LABEL_ROW;
                const isBypassed = n.state === "bypassed", dashed = isBypassed || n.state === "provisional";
                const selected = selectedIds.has(selId(n.id));
                return (
                  <g key={n.id} data-node={n.id} data-claim={(n.claims ?? []).join(" ")} aria-label={[n.label, n.sub].filter(Boolean).join(": ")}
                     className={cn("review-node", selected && "review-node-selected")} role={lensEnabled ? "button" : undefined} tabIndex={lensEnabled ? 0 : undefined}
                     aria-pressed={lensEnabled ? selected : undefined} opacity={isBypassed ? 0.5 : 1}
                     onClick={(e) => activate(n, e)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") activate(n, e); }}>
                    <rect x={x} y={y} width={w} height={NODE_H} rx={3} fill="var(--card)" stroke={strokeFor(n.state)} strokeWidth={n.state && n.state !== "provisional" ? 2 : 1.4} strokeDasharray={dashed ? "4 4" : undefined} />
                    <text x={x + w / 2} y={y + 19} textAnchor="middle" fontSize={14} fontWeight={600} fill="var(--foreground)" style={{ fontFamily: "inherit" }}>{n.label}</text>
                    {n.sub && <text x={x + w / 2} y={y + 35} textAnchor="middle" fontSize={11} fill="currentColor" style={{ fontFamily: "inherit" }}>{n.sub}</text>}
                    {isBypassed && <line x1={x + 14} y1={y + NODE_H - 6} x2={x + w - 14} y2={y + 6} stroke="var(--destructive)" strokeWidth={1.4} opacity={0.8} />}
                  </g>
                );
              })}
            </g>
          );
        })}
        {note && <text x={0} y={height - 6} fontSize={12} fill="currentColor" style={{ fontFamily: "inherit" }}>{note}</text>}
      </svg>
    </figure>
  );
}

function ClaimTile({ id, claimIds, lensEnabled, selectedIds, onSelect, excerpt, children, className }: {
  id: string; claimIds: string[]; lensEnabled: boolean; selectedIds: Set<string>;
  onSelect: (selection: ArtifactPassageSelection, additive: boolean) => void; excerpt: string; children: React.ReactNode; className?: string;
}) {
  const selected = selectedIds.has(id);
  const act = (e: MouseEvent | KeyboardEvent) => { if (!lensEnabled) return; e.preventDefault(); onSelect({ id, startOffset: 0, endOffset: 0, excerpt, claimIds }, "shiftKey" in e && e.shiftKey); };
  return (
    <div data-review-tile={id} role={lensEnabled ? "button" : undefined} tabIndex={lensEnabled ? 0 : undefined} aria-pressed={lensEnabled ? selected : undefined}
         className={cn(className, lensEnabled && "cursor-crosshair outline-none hover:ring-2 hover:ring-primary/40 focus-visible:ring-2 focus-visible:ring-primary/50", selected && "ring-2 ring-primary/60")}
         onClick={act} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") act(e); }}>
      {children}
    </div>
  );
}

/** Compiles a brief's blocks into the page. Decisions and steps are not
 *  rendered here: the producer lifted them into the manifest and the route
 *  renders them as the Decide and Next sections. */
export function BriefReader({
  artifact, brief, traces, lensEnabled, selectedIds, onSelect, figureUrl,
}: {
  artifact: ReviewArtifact; brief: BriefDocument; traces: ClaimTrace[]; lensEnabled: boolean; selectedIds: Set<string>;
  onSelect: (selection: ArtifactPassageSelection, additive: boolean) => void; figureUrl: (index: number) => string;
}) {
  const traceByClaim = new Map(traces.map((t) => [t.claim_id, t]));
  let figureIndex = -1;
  const common = { lensEnabled, selectedIds, onSelect };
  return (
    <article className="review-reader min-w-0 rounded-2xl border bg-card shadow-[0_20px_70px_-50px_rgba(0,0,0,0.7)]" data-review-brief>
      <h2 className="sr-only">{artifact.title}</h2>
      <div className="prose dark:prose-invert mx-auto max-w-[76ch] px-5 py-8 text-[17px] leading-[1.75] sm:px-10 sm:py-10 sm:text-[18px]">
        {brief.blocks.map((block: BriefBlock, index) => {
          switch (block.type) {
            case "flow":
              return <FlowDiagram key={index} blockIndex={index} {...common} note={block.note}
                lanes={[{ label: block.title ?? "", tag: block.tag, nodes: block.nodes, edges: block.edges }]}
                ariaLabel={block.title ?? "flow"} />;
            case "compare":
              return <FlowDiagram key={index} blockIndex={index} {...common} note={block.note}
                lanes={[
                  { label: block.before.label, tag: block.before.tag, nodes: block.nodes.map((n) => ({ ...n, after: null })), edges: block.edges },
                  { label: block.after.label, tag: block.after.tag, nodes: block.nodes.map(applyAfter), edges: block.edges, accent: true },
                ]}
                ariaLabel={`${block.before.label} versus ${block.after.label}`} />;
            case "metric":
              return (
                <ClaimTile key={index} id={`metric:${index}`} claimIds={block.claims} excerpt={`${block.value} ${block.unit ?? ""} — ${block.label}`} {...common}
                  className="not-prose my-6 inline-flex flex-col rounded-xl border bg-background px-5 py-4">
                  <span className="text-3xl font-bold tracking-tight">{block.value}<span className="ml-1.5 text-base font-medium text-muted-foreground">{block.unit}</span></span>
                  <span className="mt-1 max-w-[36ch] text-sm text-muted-foreground">{block.label}</span>
                </ClaimTile>
              );
            case "figure": {
              figureIndex += 1;
              return (
                <ClaimTile key={index} id={`figure:${index}`} claimIds={block.claims} excerpt={block.caption} {...common} className="not-prose my-8 rounded-xl border bg-background p-3">
                  <img src={figureUrl(figureIndex)} alt={block.caption} className="mx-auto block h-auto max-w-full rounded" loading="lazy" />
                  <figcaption className="mt-2 text-sm text-muted-foreground">{block.caption}</figcaption>
                </ClaimTile>
              );
            }
            case "prose":
              return <ProseMarkdown key={index} content={block.markdown} text={block.markdown} baseOffset={0} offsets={traceOffsets(block.markdown)}
                traceByClaim={traceByClaim} {...common} />;
            default:
              return null;
          }
        })}
        {brief.no_visual_reason && <p className="not-prose mt-6 rounded-lg bg-muted p-3 text-xs text-muted-foreground">No diagram in this brief — the agent's reason: {brief.no_visual_reason}</p>}
      </div>
    </article>
  );
}

export { readableExcerpt };
