import { CircleHelp, Link2Off } from "lucide-react";
import { useEffect, useRef } from "react";
import type { ComponentPropsWithoutRef, KeyboardEvent, MouseEvent, ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "~/lib/utils";
import type { ClaimTrace, ReviewArtifact } from "~/lib/types";

const RECORD_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/;
const TRACE_LINK = /\[[^\]]*\]\(headlong:\/\/trace\/([^/?#)]+)\)/g;
// The producer guarantees every <svg> block is script-free and self-contained;
// the reader still re-checks (below) because a contract enforced once is a
// contract enforced nowhere.
const SVG_BLOCK = /<svg\b[\s\S]*?<\/svg>/gi;

export interface ArtifactPassageSelection {
  id: string;
  startOffset: number;
  endOffset: number;
  excerpt: string;
  claimIds: string[];
  directClaimId?: string;
  /** Set when the selection came from a diagram node rather than prose. */
  nodeId?: string;
}

interface PositionedNode {
  position?: {
    start?: { offset?: number };
    end?: { offset?: number };
  };
}

export type ArtifactSegment =
  | { kind: "markdown"; text: string; offset: number }
  | { kind: "svg"; text: string; offset: number };

export function claimIdFromTraceHref(href?: string): string | null {
  if (!href) return null;
  const match = /^headlong:\/\/trace\/([^/?#]+)$/.exec(href);
  if (!match) return null;
  try {
    const claimId = decodeURIComponent(match[1]);
    return RECORD_ID.test(claimId) ? claimId : null;
  } catch {
    return null;
  }
}

/** Split an artifact into prose and diagram segments with absolute offsets, so
 *  passage locators keep meaning the same bytes the server pinned. */
export function splitArtifact(content: string): ArtifactSegment[] {
  const segments: ArtifactSegment[] = [];
  let cursor = 0;
  for (const match of content.matchAll(SVG_BLOCK)) {
    const start = match.index ?? 0;
    if (start > cursor) segments.push({ kind: "markdown", text: content.slice(cursor, start), offset: cursor });
    segments.push({ kind: "svg", text: match[0], offset: start });
    cursor = start + match[0].length;
  }
  if (cursor < content.length) segments.push({ kind: "markdown", text: content.slice(cursor), offset: cursor });
  return segments;
}

/** What a reader sees, not what the author typed: trace markers stripped. */
export { traceOffsets };
export function readableExcerpt(source: string): string {
  return source.replace(TRACE_LINK, "").replace(/[ \t]{2,}/g, " ").trim();
}

function traceOffsets(content: string) {
  return Array.from(content.matchAll(TRACE_LINK)).flatMap((match) => {
    const claimId = claimIdFromTraceHref(`headlong://trace/${match[1]}`);
    return claimId && match.index !== undefined
      ? [{ claimId, offset: match.index }]
      : [];
  });
}

function passageFromNode(
  node: PositionedNode | undefined,
  content: string,
  baseOffset: number,
  offsets: Array<{ claimId: string; offset: number }>
): ArtifactPassageSelection | null {
  const localStart = node?.position?.start?.offset;
  const localEnd = node?.position?.end?.offset;
  if (localStart === undefined || localEnd === undefined || localEnd <= localStart) {
    return null;
  }
  const startOffset = baseOffset + localStart;
  const endOffset = baseOffset + localEnd;
  return {
    id: `${startOffset}:${endOffset}`,
    startOffset,
    endOffset,
    excerpt: readableExcerpt(content.slice(startOffset, endOffset)),
    claimIds: Array.from(new Set(
      offsets
        .filter(({ offset }) => offset >= startOffset && offset < endOffset)
        .map(({ claimId }) => claimId)
    )),
  };
}

function SelectableBlock({
  as: Tag,
  node,
  content,
  baseOffset,
  offsets,
  lensEnabled,
  selectedIds,
  onPassageSelect,
  className,
  children,
  ...props
}: {
  as: "p" | "h1" | "h2" | "h3" | "li" | "blockquote";
  node?: PositionedNode;
  content: string;
  baseOffset: number;
  offsets: Array<{ claimId: string; offset: number }>;
  lensEnabled: boolean;
  selectedIds: Set<string>;
  onPassageSelect: (selection: ArtifactPassageSelection, additive: boolean) => void;
  className?: string;
  children?: ReactNode;
} & Record<string, unknown>) {
  const passage = passageFromNode(node, content, baseOffset, offsets);
  const selected = passage ? selectedIds.has(passage.id) : false;

  const select = (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) => {
    if (!lensEnabled || !passage) return;
    const closest = (event.target as HTMLElement).closest("[data-review-passage]");
    if (closest !== event.currentTarget) return;
    event.preventDefault();
    event.stopPropagation();
    onPassageSelect(passage, "shiftKey" in event && event.shiftKey);
  };

  return (
    <Tag
      {...props}
      data-review-passage={passage?.id}
      role={lensEnabled && passage ? "button" : undefined}
      tabIndex={lensEnabled && passage ? 0 : undefined}
      aria-pressed={lensEnabled && passage ? selected : undefined}
      className={cn(
        className,
        lensEnabled && passage &&
          "relative cursor-crosshair rounded-md outline-none transition-[background-color,box-shadow] hover:bg-primary/7 focus-visible:ring-2 focus-visible:ring-primary/50",
        selected && "bg-primary/10 ring-2 ring-primary/60"
      )}
      onClick={select}
      onKeyDown={(event: KeyboardEvent<HTMLElement>) => {
        if (event.key === "Enter" || event.key === " ") select(event);
      }}
    >
      {children}
    </Tag>
  );
}

const UNSAFE_SVG_ELEMENTS = new Set(["script", "foreignobject", "iframe", "object", "embed", "link", "meta", "style"]);

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

/** Authors writing inline SVG in Markdown omit xmlns, because HTML parsing
 *  forgives it. XML parsing does not: without it every element lands in the
 *  null namespace and renders as inline text. Supply what the author left out. */
function withNamespaces(text: string): string {
  return text.replace(/<svg\b([^>]*)>/i, (whole, attrs: string) => {
    let extra = "";
    if (!/\bxmlns\s*=/.test(attrs)) extra += ` xmlns="${SVG_NS}"`;
    if (/\bxlink:/.test(text) && !/\bxmlns:xlink\s*=/.test(attrs)) extra += ` xmlns:xlink="${XLINK_NS}"`;
    return extra ? `<svg${attrs}${extra}>` : whole;
  });
}

/** Parse as XML (never executes), keep only the safe subset, return the root. */
function parseSafeSvg(text: string): SVGSVGElement | null {
  if (typeof DOMParser === "undefined") return null;
  const doc = new DOMParser().parseFromString(withNamespaces(text), "image/svg+xml");
  const root = doc.documentElement;
  if (!root || root.localName !== "svg" || root.namespaceURI !== SVG_NS || doc.querySelector("parsererror")) return null;
  const walker = doc.createTreeWalker(root, 1 /* SHOW_ELEMENT */);
  const doomed: Element[] = [];
  for (let el = walker.currentNode as Element | null; el; el = walker.nextNode() as Element | null) {
    if (UNSAFE_SVG_ELEMENTS.has(el.nodeName.toLowerCase())) { doomed.push(el); continue; }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim();
      if (name.startsWith("on")) el.removeAttribute(attr.name);
      else if ((name === "href" || name === "xlink:href" || name === "src") && !value.startsWith("#")) el.removeAttribute(attr.name);
      else if (/javascript:/i.test(value)) el.removeAttribute(attr.name);
    }
  }
  doomed.forEach((el) => el.remove());
  return root as unknown as SVGSVGElement;
}

function DiagramBlock({
  segment,
  index,
  lensEnabled,
  selectedIds,
  onSelect,
}: {
  segment: Extract<ArtifactSegment, { kind: "svg" }>;
  index: number;
  lensEnabled: boolean;
  selectedIds: Set<string>;
  onSelect: (selection: ArtifactPassageSelection, additive: boolean) => void;
}) {
  const host = useRef<HTMLDivElement>(null);

  // Mount the parsed drawing once per segment text; React does not own it.
  useEffect(() => {
    const container = host.current;
    if (!container) return;
    container.replaceChildren();
    const root = parseSafeSvg(segment.text);
    if (!root) {
      container.setAttribute("data-diagram-invalid", "true");
      return;
    }
    container.removeAttribute("data-diagram-invalid");
    container.appendChild(document.importNode(root, true));
  }, [segment.text]);

  // Selection and lens state are reflected onto the anchored nodes.
  useEffect(() => {
    const container = host.current;
    if (!container) return;
    container.querySelectorAll<SVGElement>("[data-claim],[data-node]").forEach((el, i) => {
      const id = selectionIdFor(index, el, i);
      el.classList.toggle("review-node", true);
      el.classList.toggle("review-node-selected", selectedIds.has(id));
      if (lensEnabled) {
        el.setAttribute("tabindex", "0");
        el.setAttribute("role", "button");
        el.setAttribute("aria-pressed", String(selectedIds.has(id)));
      } else {
        el.removeAttribute("tabindex");
        el.removeAttribute("role");
        el.removeAttribute("aria-pressed");
      }
    });
    container.classList.toggle("review-diagram-lens", lensEnabled);
  }, [index, lensEnabled, selectedIds, segment.text]);

  const activate = (target: EventTarget | null, additive: boolean) => {
    if (!lensEnabled || !host.current) return false;
    const el = (target as Element | null)?.closest?.("[data-claim],[data-node]") as SVGElement | null;
    if (!el || !host.current.contains(el)) return false;
    const all = Array.from(host.current.querySelectorAll<SVGElement>("[data-claim],[data-node]"));
    const i = all.indexOf(el);
    const nodeId = el.getAttribute("data-node") || undefined;
    const claimIds = (el.getAttribute("data-claim") || "").split(/\s+/).filter((c) => RECORD_ID.test(c));
    const label = el.getAttribute("aria-label")
      || Array.from(el.querySelectorAll("text")).map((t) => t.textContent?.trim()).filter(Boolean).join(" · ")
      || nodeId || "diagram node";
    onSelect({
      id: selectionIdFor(index, el, i),
      startOffset: segment.offset,
      endOffset: segment.offset + segment.text.length,
      excerpt: label,
      claimIds,
      nodeId,
    }, additive);
    return true;
  };

  return (
    <figure className="not-prose my-8 overflow-x-auto rounded-xl border bg-background p-4 sm:p-6">
      <div
        ref={host}
        className="review-diagram [&>svg]:mx-auto [&>svg]:block [&>svg]:h-auto [&>svg]:max-w-full"
        data-review-diagram={index}
        onClick={(event) => { if (activate(event.target, event.shiftKey)) { event.preventDefault(); event.stopPropagation(); } }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          if (activate(event.target, event.shiftKey)) { event.preventDefault(); event.stopPropagation(); }
        }}
      />
    </figure>
  );
}

function selectionIdFor(segmentIndex: number, el: Element, ordinal: number): string {
  const nodeId = el.getAttribute("data-node");
  return `node:${segmentIndex}:${nodeId || ordinal}`;
}


/** Markdown with selectable passages and trace indicators. Shared by the
 *  Markdown reader (per segment) and by prose blocks in a brief. */
export function ProseMarkdown({
  content,
  text,
  baseOffset,
  offsets,
  traceByClaim,
  lensEnabled,
  selectedIds,
  onSelect,
}: {
  /** The full artifact text, for absolute-offset excerpts. */
  content: string;
  /** The markdown to render (a segment of `content` starting at baseOffset). */
  text: string;
  baseOffset: number;
  offsets: Array<{ claimId: string; offset: number }>;
  traceByClaim: Map<string, ClaimTrace>;
  lensEnabled: boolean;
  selectedIds: Set<string>;
  onSelect: (selection: ArtifactPassageSelection, additive: boolean) => void;
}) {
  const blockProps = { content, baseOffset, offsets, lensEnabled, selectedIds, onPassageSelect: onSelect };
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      urlTransform={(url) => claimIdFromTraceHref(url) ? url : defaultUrlTransform(url)}
      components={{
        p: ({ node, ...props }) => <SelectableBlock as="p" node={node} {...blockProps} {...props} />,
        h1: ({ node, ...props }) => <SelectableBlock as="h1" node={node} {...blockProps} {...props} />,
        h2: ({ node, ...props }) => <SelectableBlock as="h2" node={node} {...blockProps} {...props} />,
        h3: ({ node, ...props }) => <SelectableBlock as="h3" node={node} {...blockProps} {...props} />,
        li: ({ node, ...props }) => <SelectableBlock as="li" node={node} {...blockProps} {...props} />,
        blockquote: ({ node, ...props }) => <SelectableBlock as="blockquote" node={node} {...blockProps} {...props} />,
        a: ({ href, children, ...props }: ComponentPropsWithoutRef<"a">) => {
          const claimId = claimIdFromTraceHref(href);
          if (!claimId) return <a href={href} {...props}>{children}</a>;
          const trace = traceByClaim.get(claimId);
          // Lens off: the page reads as a document. Lens on: a quiet indicator
          // that this passage carries a trace; the passage itself is the control.
          return (
            <span
              hidden={!lensEnabled}
              className="not-prose mx-1 inline-flex size-5 translate-y-0.5 items-center justify-center rounded-full border border-primary/40 bg-primary/10 text-primary"
              aria-label={trace ? `1 linked claim: ${claimId}` : `No reasoning linked for claim ${claimId}`}
              title={trace?.reason || "No reasoning linked"}
              data-trace-indicator={claimId}
            >
              {trace ? <CircleHelp aria-hidden="true" className="size-3" /> : <Link2Off aria-hidden="true" className="size-3" />}
              <span className="sr-only">{children}</span>
            </span>
          );
        },
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

export function ArtifactReader({
  artifact,
  traces,
  lensEnabled,
  selectedIds,
  onSelect,
  onOpenTrace: _onOpenTrace,
}: {
  artifact: ReviewArtifact;
  traces: ClaimTrace[];
  lensEnabled: boolean;
  selectedIds: Set<string>;
  onSelect: (selection: ArtifactPassageSelection, additive: boolean) => void;
  /** Retained for deep-links; the in-artifact marker is an indicator, not a control. */
  onOpenTrace: (claimId: string) => void;
}) {
  const traceByClaim = new Map(traces.map((trace) => [trace.claim_id, trace]));
  const offsets = traceOffsets(artifact.content);
  const segments = splitArtifact(artifact.content);

  return (
    <article className="review-reader min-w-0 rounded-2xl border bg-card shadow-[0_20px_70px_-50px_rgba(0,0,0,0.7)]">
      <h2 className="sr-only">{artifact.title}</h2>
      <div className={cn(
        "prose dark:prose-invert mx-auto max-w-[76ch] [overflow-wrap:anywhere] px-5 py-8 text-[17px] leading-[1.75] sm:px-10 sm:py-12 sm:text-[18px]",
        "prose-headings:scroll-mt-24 prose-headings:tracking-tight prose-p:my-5 prose-li:my-1",
        lensEnabled && "[&_p]:px-2 [&_p]:-mx-2 [&_li]:px-2 [&_li]:-mx-2 [&_h1]:px-2 [&_h1]:-mx-2 [&_h2]:px-2 [&_h2]:-mx-2 [&_h3]:px-2 [&_h3]:-mx-2"
      )}>
        {segments.map((segment, index) => {
          if (segment.kind === "svg") {
            return (
              <DiagramBlock
                key={`svg:${segment.offset}`}
                segment={segment}
                index={index}
                lensEnabled={lensEnabled}
                selectedIds={selectedIds}
                onSelect={onSelect}
              />
            );
          }
          return (
            <ProseMarkdown
              key={`md:${segment.offset}`}
              content={artifact.content}
              text={segment.text}
              baseOffset={segment.offset}
              offsets={offsets}
              traceByClaim={traceByClaim}
              lensEnabled={lensEnabled}
              selectedIds={selectedIds}
              onSelect={onSelect}
            />
          );
        })}
      </div>
    </article>
  );
}
