import { CircleHelp, Link2Off } from "lucide-react";
import type { ComponentPropsWithoutRef, KeyboardEvent, MouseEvent, ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "~/lib/utils";
import type { ClaimTrace, ReviewArtifact } from "~/lib/types";

const RECORD_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/;
const TRACE_LINK = /\[[^\]]*\]\(headlong:\/\/trace\/([^/?#)]+)\)/g;

export interface ArtifactPassageSelection {
  id: string;
  startOffset: number;
  endOffset: number;
  excerpt: string;
  claimIds: string[];
  directClaimId?: string;
}

interface PositionedNode {
  position?: {
    start?: { offset?: number };
    end?: { offset?: number };
  };
}

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
  offsets: Array<{ claimId: string; offset: number }>
): ArtifactPassageSelection | null {
  const startOffset = node?.position?.start?.offset;
  const endOffset = node?.position?.end?.offset;
  if (startOffset === undefined || endOffset === undefined || endOffset <= startOffset) {
    return null;
  }
  return {
    id: `${startOffset}:${endOffset}`,
    startOffset,
    endOffset,
    excerpt: content.slice(startOffset, endOffset).trim(),
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
  offsets: Array<{ claimId: string; offset: number }>;
  lensEnabled: boolean;
  selectedIds: Set<string>;
  onPassageSelect: (selection: ArtifactPassageSelection, additive: boolean) => void;
  className?: string;
  children?: ReactNode;
} & Record<string, unknown>) {
  const passage = passageFromNode(node, content, offsets);
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

export function ArtifactReader({
  artifact,
  traces,
  lensEnabled,
  selectedIds,
  onSelect,
  onOpenTrace,
}: {
  artifact: ReviewArtifact;
  traces: ClaimTrace[];
  lensEnabled: boolean;
  selectedIds: Set<string>;
  onSelect: (selection: ArtifactPassageSelection, additive: boolean) => void;
  onOpenTrace: (claimId: string) => void;
}) {
  const traceByClaim = new Map(traces.map((trace) => [trace.claim_id, trace]));
  const offsets = traceOffsets(artifact.content);
  const blockProps = {
    content: artifact.content,
    offsets,
    lensEnabled,
    selectedIds,
    onPassageSelect: onSelect,
  };

  return (
    <article className="review-reader min-w-0 rounded-2xl border bg-card shadow-[0_20px_70px_-50px_rgba(0,0,0,0.7)]">
      <header className="mx-auto max-w-[76ch] border-b px-5 py-6 sm:px-10 sm:py-8">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Primary artifact
        </p>
        <h2 className="mt-2 text-2xl font-semibold leading-tight tracking-tight text-balance sm:text-3xl">
          {artifact.title}
        </h2>
      </header>
      <div className={cn(
        "prose dark:prose-invert mx-auto max-w-[76ch] [overflow-wrap:anywhere] px-5 py-8 text-[17px] leading-[1.75] sm:px-10 sm:py-12 sm:text-[18px]",
        "prose-headings:scroll-mt-24 prose-headings:tracking-tight prose-p:my-5 prose-li:my-1",
        lensEnabled && "[&_p]:px-2 [&_p]:-mx-2 [&_li]:px-2 [&_li]:-mx-2 [&_h1]:px-2 [&_h1]:-mx-2 [&_h2]:px-2 [&_h2]:-mx-2 [&_h3]:px-2 [&_h3]:-mx-2"
      )}>
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
              return (
                <button
                  type="button"
                  className={cn(
                    "not-prose mx-1 inline-flex size-7 translate-y-1 items-center justify-center rounded-full border bg-background text-muted-foreground no-underline outline-none hover:border-primary/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                    lensEnabled && "pointer-events-none border-primary/40 bg-primary/10 text-primary"
                  )}
                  aria-label={`${trace ? "Inspect reasoning" : "No reasoning linked"} for claim ${claimId}`}
                  title={lensEnabled ? "Select this passage" : trace?.reason || "No reasoning linked"}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onOpenTrace(claimId);
                  }}
                >
                  {trace ? <CircleHelp aria-hidden="true" className="size-3.5" /> : <Link2Off aria-hidden="true" className="size-3.5" />}
                  <span className="sr-only">{children}</span>
                </button>
              );
            },
          }}
        >
          {artifact.content}
        </ReactMarkdown>
      </div>
    </article>
  );
}
