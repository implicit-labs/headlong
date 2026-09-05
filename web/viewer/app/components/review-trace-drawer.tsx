import { Link2Off, X } from "lucide-react";
import { useEffect, useRef } from "react";

import {
  AnnotationForm,
  annotationCategoryLabel,
} from "~/components/review-annotation-form";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { LoadingDots } from "~/components/ui/loading-dots";
import type {
  AnnotationLedgerEvent,
  AnnotationCategory,
  ClaimTraceResponse,
  ReasoningAddress,
  ReasoningAnnotation,
} from "~/lib/types";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function inertOutside(element: HTMLElement): () => void {
  const changed: Array<{
    element: HTMLElement;
    inert: boolean;
    ariaHidden: string | null;
  }> = [];
  let branch: HTMLElement | null = element;

  while (branch?.parentElement && branch.parentElement !== document.body) {
    for (const sibling of branch.parentElement.children) {
      if (sibling === branch || !(sibling instanceof HTMLElement)) continue;
      changed.push({
        element: sibling,
        inert: sibling.hasAttribute("inert"),
        ariaHidden: sibling.getAttribute("aria-hidden"),
      });
      sibling.inert = true;
      sibling.setAttribute("inert", "");
      sibling.setAttribute("aria-hidden", "true");
    }
    branch = branch.parentElement;
  }

  return () => {
    for (const previous of changed) {
      previous.element.inert = previous.inert;
      if (!previous.inert) previous.element.removeAttribute("inert");
      if (previous.ariaHidden === null) {
        previous.element.removeAttribute("aria-hidden");
      } else {
        previous.element.setAttribute("aria-hidden", previous.ariaHidden);
      }
    }
  };
}

export function TraceDrawer({
  claimId,
  result,
  loading,
  error,
  annotations,
  onClose,
  onAnnotate,
  returnFocusTo,
  replacementHref,
}: {
  claimId: string;
  result?: ClaimTraceResponse;
  loading: boolean;
  error?: Error | null;
  annotations: AnnotationLedgerEvent[];
  onClose: () => void;
  onAnnotate: (input: {
    category: AnnotationCategory;
    note: string;
  }) => Promise<void> | void;
  returnFocusTo?: HTMLElement | null;
  replacementHref: (address: ReasoningAddress) => string;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const restoreOutside = overlayRef.current
      ? inertOutside(overlayRef.current)
      : () => {};
    headingRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;

      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)
      ).filter((element) => !element.hidden);
      if (focusable.length === 0) {
        event.preventDefault();
        headingRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panelRef.current.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !panelRef.current.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      restoreOutside();
      window.removeEventListener("keydown", onKeyDown);
      if (returnFocusTo?.isConnected) returnFocusTo.focus();
    };
  }, [onClose, returnFocusTo]);

  const claimAnnotations = annotations.filter(
    (annotation): annotation is ReasoningAnnotation =>
      annotation.type === "annotation" &&
      annotation.target_type === "claim" && annotation.target_id === claimId
  );
  const addressByAnnotation = new Map(
    annotations
      .filter(
        (event): event is ReasoningAddress => event.type === "addressed"
      )
      .map((address) => [address.annotation_id, address])
  );

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 bg-black/35"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="trace-drawer-heading"
        className="absolute inset-x-0 bottom-0 max-h-[88dvh] overflow-y-auto rounded-t-2xl border bg-background shadow-2xl sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-none sm:w-[min(32rem,100vw)] sm:rounded-none"
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b bg-background/95 px-4 py-3 backdrop-blur sm:px-5">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Claim trace
            </p>
            <h2
              id="trace-drawer-heading"
              ref={headingRef}
              tabIndex={-1}
              className="mt-1 break-all font-mono text-base font-semibold outline-none"
            >
              {claimId}
            </h2>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11"
            aria-label="Close evidence drawer"
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </Button>
        </header>

        <div className="space-y-5 px-4 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-5">
          {loading && (
            <div className="flex justify-center py-12" aria-label="Loading evidence">
              <LoadingDots />
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
              <p className="font-medium text-destructive">Could not load evidence</p>
              <p className="mt-1 text-sm text-muted-foreground">{error.message}</p>
            </div>
          )}

          {result && !result.linked && (
            <div className="rounded-lg border border-dashed p-5 text-center">
              <Link2Off className="mx-auto size-5 text-muted-foreground" />
              <p className="mt-2 font-medium">No evidence linked</p>
              <p className="mt-1 text-sm text-muted-foreground">
                This claim has no provenance record in the current run.
              </p>
            </div>
          )}

          {result?.linked && (
            <>
              <section aria-labelledby="claim-heading" className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 id="claim-heading" className="font-semibold">
                    Claim
                  </h3>
                  <Badge variant="outline">{result.trace.evidence_class}</Badge>
                </div>
                <p className="text-sm leading-relaxed">{result.trace.claim_text}</p>
                {result.trace.reason && (
                  <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
                    {result.trace.reason}
                  </p>
                )}
              </section>

              <section aria-labelledby="sources-heading">
                <h3 id="sources-heading" className="font-semibold">
                  Sources
                </h3>
                {result.trace.sources.length === 0 ? (
                  <p className="mt-2 text-sm font-medium text-muted-foreground">
                    No evidence linked
                  </p>
                ) : (
                  <ol className="mt-2 space-y-2">
                    {result.trace.sources.map((source, index) => (
                      <li key={`${source.ref}-${index}`} className="rounded-lg border p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="secondary">{source.kind.replaceAll("_", " ")}</Badge>
                          <p className="text-sm font-medium">{source.label}</p>
                        </div>
                        <p className="mt-2 text-sm leading-relaxed">{source.excerpt}</p>
                        <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
                          {source.ref}
                        </p>
                      </li>
                    ))}
                  </ol>
                )}
              </section>

              {result.sentience_receipts.length > 0 && (
                <section aria-labelledby="receipts-heading">
                  <h3 id="receipts-heading" className="font-semibold">
                    Sentience receipts
                  </h3>
                  <div className="mt-2 space-y-2">
                    {result.sentience_receipts.map((receipt) => (
                      <article key={receipt.receipt_id} className="rounded-lg border p-3 text-sm">
                        <p className="font-medium">{receipt.question}</p>
                        <p className="mt-1 text-muted-foreground">{receipt.response}</p>
                        <p className="mt-2 text-xs">Changed: {receipt.resulting_change}</p>
                      </article>
                    ))}
                  </div>
                </section>
              )}

              {(result.trace.rejected_alternatives?.length ?? 0) > 0 && (
                <section aria-labelledby="alternatives-heading">
                  <h3 id="alternatives-heading" className="font-semibold">
                    Rejected alternatives
                  </h3>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                    {result.trace.rejected_alternatives?.map((alternative) => (
                      <li key={alternative}>{alternative}</li>
                    ))}
                  </ul>
                </section>
              )}

              {result.trace.uncertainty && (
                <section aria-labelledby="uncertainty-heading">
                  <h3 id="uncertainty-heading" className="font-semibold">
                    Uncertainty
                  </h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {result.trace.uncertainty}
                  </p>
                </section>
              )}
            </>
          )}

          {claimAnnotations.length > 0 && (
            <section aria-labelledby="notes-heading">
              <h3 id="notes-heading" className="font-semibold">
                Reasoning notes
              </h3>
              <div className="mt-2 space-y-2">
                {claimAnnotations.map((annotation) => (
                  <article
                    key={annotation.annotation_id}
                    className="rounded-lg border p-3 text-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">
                        {annotationCategoryLabel(annotation.category)}
                      </p>
                      {addressByAnnotation.has(annotation.annotation_id) && (
                        <Badge variant="secondary">Addressed</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-muted-foreground">{annotation.note}</p>
                    {(() => {
                      const address = addressByAnnotation.get(
                        annotation.annotation_id
                      );
                      if (!address) return null;
                      return (
                        <div className="mt-3 rounded-md bg-muted p-3">
                          <p className="font-medium">Replacement</p>
                          {address.note && (
                            <p className="mt-1 text-muted-foreground">
                              {address.note}
                            </p>
                          )}
                          <a
                            className="mt-2 inline-block break-all font-medium text-primary underline underline-offset-4"
                            href={replacementHref(address)}
                          >
                            {address.replacement_artifact_ref} · {address.replacement_claim_id}
                          </a>
                          <p className="mt-1 font-mono text-xs text-muted-foreground">
                            Addressed by {address.addressed_by_run_id}
                          </p>
                        </div>
                      );
                    })()}
                  </article>
                ))}
              </div>
            </section>
          )}

          {!loading && !error && (
            <section aria-labelledby="annotation-heading">
              <h3 id="annotation-heading" className="mb-2 font-semibold">
                Annotate the reasoning
              </h3>
              <AnnotationForm onSubmit={onAnnotate} />
            </section>
          )}
        </div>
      </section>
    </div>
  );
}
