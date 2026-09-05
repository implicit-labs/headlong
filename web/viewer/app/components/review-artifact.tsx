import { ExternalLink, Link2Off } from "lucide-react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";
import type { ClaimTrace, ReviewArtifact } from "~/lib/types";

const RECORD_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/;

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

export function ArtifactReader({
  artifact,
  traces,
  onOpenTrace,
}: {
  artifact: ReviewArtifact;
  traces: ClaimTrace[];
  onOpenTrace: (claimId: string, trigger: HTMLElement) => void;
}) {
  const traceByClaim = new Map(traces.map((trace) => [trace.claim_id, trace]));

  return (
    <article className="min-w-0 overflow-hidden rounded-xl border bg-card shadow-sm">
      <header className="border-b px-4 py-3 sm:px-6">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Primary artifact
        </p>
        <h2 className="mt-1 text-lg font-semibold text-balance">
          {artifact.title}
        </h2>
        <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
          {artifact.path}
        </p>
      </header>
      <div className="prose prose-sm dark:prose-invert max-w-none [overflow-wrap:anywhere] px-4 py-5 sm:px-6 sm:py-7">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          urlTransform={(url) =>
            claimIdFromTraceHref(url) ? url : defaultUrlTransform(url)
          }
          components={{
            a: ({ href, children, ...props }) => {
              const claimId = claimIdFromTraceHref(href);
              if (!claimId) {
                return (
                  <a href={href} {...props}>
                    {children}
                  </a>
                );
              }

              const trace = traceByClaim.get(claimId);
              const preview = trace
                ? trace.reason || trace.sources[0]?.excerpt || trace.claim_text
                : "No evidence linked";

              return (
                <Tooltip delayDuration={250}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="not-prose mx-0.5 inline-flex min-h-11 min-w-11 translate-y-0.5 items-center justify-center rounded-md border bg-muted px-1.5 text-xs font-semibold text-foreground no-underline hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={`Open evidence for claim ${claimId}`}
                      onClick={(event) =>
                        onOpenTrace(claimId, event.currentTarget)
                      }
                    >
                      {trace ? (
                        <ExternalLink aria-hidden="true" className="size-3.5" />
                      ) : (
                        <Link2Off aria-hidden="true" className="size-3.5" />
                      )}
                      <span className="sr-only">{children}</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent
                    className="max-w-72 text-pretty"
                    side="top"
                    sideOffset={6}
                  >
                    <p className="font-medium">
                      {trace ? trace.evidence_class : "No evidence linked"}
                    </p>
                    {trace && <p className="mt-1 opacity-80">{preview}</p>}
                  </TooltipContent>
                </Tooltip>
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
