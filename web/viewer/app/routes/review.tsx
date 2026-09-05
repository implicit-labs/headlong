import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Clock3, FileText, RefreshCw } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { toast } from "sonner";

import { IdentityTabs } from "~/components/identity-tabs";
import { ArtifactReader } from "~/components/review-artifact";
import { DecisionCard } from "~/components/review-decision-card";
import { NextRunCard } from "~/components/review-next-run";
import { TraceDrawer } from "~/components/review-trace-drawer";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "~/components/ui/empty";
import { LoadingDots } from "~/components/ui/loading-dots";
import {
  fetchClaimTrace,
  fetchIdentityStatus,
  fetchReview,
  fetchReviewRun,
  submitAnnotation,
  submitDecision,
} from "~/lib/api";
import type {
  AnnotationCategory,
  DecisionAnswer,
  HumanDecision,
  ReviewRunStatus,
} from "~/lib/types";

export function meta() {
  return [{ title: "Headlong · review" }];
}

function formatTimeRemaining(seconds: number | null): string {
  if (seconds === null) return "No deadline";
  if (seconds <= 0) return "Deadline reached";
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes}m remaining`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m remaining` : `${hours}h remaining`;
}

function statusLabel(status: ReviewRunStatus): string {
  return status.replaceAll("_", " ");
}

function runPriority(status: ReviewRunStatus): number {
  if (status === "waiting_on_toma") return 0;
  if (status === "ready_for_review") return 1;
  if (status === "running") return 2;
  return 3;
}

export default function ReviewPage() {
  const { identityId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(() =>
    searchParams.get("run")
  );
  const [openClaimId, setOpenClaimId] = useState<string | null>(() =>
    searchParams.get("claim")
  );
  const traceTriggerRef = useRef<HTMLElement | null>(null);

  const { data: status } = useQuery({
    queryKey: ["status", identityId],
    queryFn: () => fetchIdentityStatus(identityId),
    refetchInterval: 5000,
  });

  const {
    data: review,
    isLoading,
    error: reviewError,
    refetch: refetchReview,
  } = useQuery({
    queryKey: ["review", identityId],
    queryFn: () => fetchReview(identityId),
    refetchInterval: 5000,
  });

  const sortedRuns = [...(review?.runs ?? [])].sort((left, right) => {
    const byPriority = runPriority(left.status) - runPriority(right.status);
    if (byPriority !== 0) return byPriority;
    return new Date(right.started_at).getTime() - new Date(left.started_at).getTime();
  });
  const selectedSummary =
    sortedRuns.find((run) => run.run_id === selectedRunId) ?? sortedRuns[0];

  const {
    data: run,
    isLoading: runLoading,
    error: runError,
  } = useQuery({
    queryKey: ["review-run", identityId, selectedSummary?.run_id],
    queryFn: () => fetchReviewRun(identityId, selectedSummary!.run_id),
    enabled: Boolean(selectedSummary?.run_id && selectedSummary.valid),
    refetchInterval: selectedSummary?.status === "running" ? 2000 : 10000,
    retry: false,
  });

  const traceQuery = useQuery({
    queryKey: ["claim-trace", identityId, selectedSummary?.run_id, openClaimId],
    queryFn: () =>
      fetchClaimTrace(identityId, selectedSummary!.run_id, openClaimId!),
    enabled: Boolean(openClaimId && selectedSummary?.run_id && selectedSummary.valid),
    retry: false,
  });

  const refreshReviewData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["review", identityId] }),
      queryClient.invalidateQueries({
        queryKey: ["review-run", identityId, selectedSummary?.run_id],
      }),
      queryClient.invalidateQueries({ queryKey: ["identities"] }),
    ]);
  };

  const decisionMutation = useMutation({
    mutationFn: (body: {
      operation_id: string;
      decision_request_id: string;
      answer: DecisionAnswer;
      rationale: string;
      supersedes?: string | null;
    }) => submitDecision(identityId, selectedSummary!.run_id, body),
    onSuccess: async () => {
      toast.success("Decision recorded");
      await refreshReviewData();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const annotationMutation = useMutation({
    mutationFn: (body: {
      operation_id: string;
      target_type: "claim" | "decision";
      target_id: string;
      category: AnnotationCategory;
      note: string;
    }) =>
      submitAnnotation(identityId, selectedSummary!.run_id, {
        ...body,
        artifact_ref: run!.artifact!.path,
        artifact_sha256: run!.artifact!.sha256,
      }),
    onSuccess: async () => {
      toast.success("Reasoning note saved");
      await refreshReviewData();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const closeTrace = useCallback(() => setOpenClaimId(null), []);

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <LoadingDots />
      </div>
    );
  }

  const header = (
    <IdentityTabs
      identityId={identityId}
      live={status?.live ?? false}
      active="review"
      name={review?.identity.name}
    />
  );

  if (reviewError || !review) {
    return (
      <div className="mx-auto w-full max-w-7xl px-4">
        {header}
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Review unavailable</EmptyTitle>
            <EmptyDescription>
              {reviewError instanceof Error
                ? reviewError.message
                : "The review inbox could not be loaded."}
            </EmptyDescription>
          </EmptyHeader>
          <Button variant="outline" onClick={() => void refetchReview()}>
            <RefreshCw aria-hidden="true" />
            Try again
          </Button>
        </Empty>
      </div>
    );
  }

  if (!selectedSummary) {
    return (
      <div className="mx-auto w-full max-w-7xl px-4">
        {header}
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Nothing to review</EmptyTitle>
            <EmptyDescription>
              Completed Headlong runs will appear here with their artifacts,
              evidence, and decisions.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  const priorRuns = sortedRuns.filter(
    (summary) => summary.run_id !== selectedSummary.run_id
  );
  const latestDecisions = new Map<string, HumanDecision>();
  for (const decision of run?.decisions ?? []) {
    const previous = latestDecisions.get(decision.decision_request_id);
    if (!previous || decision.decided_at > previous.decided_at) {
      latestDecisions.set(decision.decision_request_id, decision);
    }
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4">
      {header}
      <main className="mx-auto w-full max-w-6xl space-y-6 pb-12">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{statusLabel(selectedSummary.status)}</Badge>
              {selectedSummary.pending_decision_count > 0 && (
                <Badge>{selectedSummary.pending_decision_count} pending</Badge>
              )}
              {!selectedSummary.valid && (
                <Badge variant="destructive">Invalid manifest</Badge>
              )}
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
              {selectedSummary.title}
            </h1>
            <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
              {selectedSummary.goal_ref} · {selectedSummary.run_id}
            </p>
          </div>
          <p className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
            <Clock3 aria-hidden="true" className="size-4" />
            {formatTimeRemaining(run?.time_remaining_s ?? selectedSummary.time_remaining_s)}
          </p>
        </header>

        {!selectedSummary.valid && (
          <section className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 sm:p-5">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle aria-hidden="true" className="size-5" />
              <h2 className="font-semibold">This run is not safe to review</h2>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Artifact, trace, and mutation endpoints are closed until the manifest is valid.
            </p>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
              {selectedSummary.validation_errors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </section>
        )}

        {selectedSummary.valid && runLoading && (
          <div className="flex justify-center py-16">
            <LoadingDots />
          </div>
        )}

        {selectedSummary.valid && runError && (
          <section className="rounded-xl border border-destructive/40 p-4">
            <p className="font-medium text-destructive">Could not load this review run</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {runError instanceof Error ? runError.message : "Unknown error"}
            </p>
          </section>
        )}

        {run && (
          <>
            {run.manifest.progress_summary && (
              <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
                {run.manifest.progress_summary}
              </p>
            )}

            {run.decision_requests.length > 0 && (
              <section aria-labelledby="decisions-heading" className="space-y-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Human judgment
                  </p>
                  <h2 id="decisions-heading" className="mt-1 text-xl font-semibold">
                    Decisions
                  </h2>
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  {run.decision_requests.map((request) => {
                    const latestDecision = latestDecisions.get(
                      request.decision_request_id
                    );
                    return (
                      <DecisionCard
                        key={request.decision_request_id}
                        request={request}
                        latestDecision={latestDecision}
                        onSubmit={(body) =>
                          decisionMutation
                            .mutateAsync({
                              ...body,
                              operation_id: crypto.randomUUID(),
                            })
                            .then(() => undefined)
                        }
                        onAnnotate={
                          run.artifact && latestDecision
                            ? ({ decisionId, category, note }) =>
                                annotationMutation
                                  .mutateAsync({
                                    operation_id: crypto.randomUUID(),
                                    target_type: "decision",
                                    target_id: decisionId,
                                    category,
                                    note,
                                  })
                                  .then(() => undefined)
                            : undefined
                        }
                      />
                    );
                  })}
                </div>
              </section>
            )}

            <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
              {run.artifact ? (
                <ArtifactReader
                  artifact={run.artifact}
                  traces={run.provenance}
                  onOpenTrace={(claimId, trigger) => {
                    traceTriggerRef.current = trigger;
                    setOpenClaimId(claimId);
                  }}
                />
              ) : (
                <section className="rounded-xl border border-dashed p-8 text-center">
                  <FileText className="mx-auto size-5 text-muted-foreground" />
                  <p className="mt-2 font-medium">No primary artifact</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    This run did not publish a readable artifact.
                  </p>
                </section>
              )}
              <NextRunCard options={run.manifest.next_step_options ?? []} />
            </div>
          </>
        )}

        {priorRuns.length > 0 && (
          <section aria-labelledby="prior-runs-heading">
            <h2 id="prior-runs-heading" className="text-lg font-semibold">
              Prior runs
            </h2>
            <div className="mt-2 divide-y rounded-xl border bg-card">
              {priorRuns.map((summary) => (
                <details key={summary.run_id} className="group p-4">
                  <summary className="cursor-pointer list-none rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-balance">{summary.title}</p>
                        <p className="mt-1 font-mono text-xs text-muted-foreground">
                          {new Date(summary.started_at).toLocaleString()}
                        </p>
                      </div>
                      <Badge variant={summary.valid ? "outline" : "destructive"}>
                        {summary.valid ? statusLabel(summary.status) : "invalid"}
                      </Badge>
                    </div>
                  </summary>
                  <div className="mt-3 space-y-3 border-t pt-3">
                    <p className="break-all text-sm text-muted-foreground">
                      {summary.primary_artifact?.title ?? "No primary artifact"}
                    </p>
                    {summary.validation_errors.length > 0 && (
                      <ul className="list-disc space-y-1 pl-5 text-sm text-destructive">
                        {summary.validation_errors.map((message) => (
                          <li key={message}>{message}</li>
                        ))}
                      </ul>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11 w-full sm:w-auto"
                      onClick={() => {
                        setSelectedRunId(summary.run_id);
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                    >
                      Open this run
                    </Button>
                  </div>
                </details>
              ))}
            </div>
          </section>
        )}
      </main>

      {openClaimId && run?.artifact && (
        <TraceDrawer
          claimId={openClaimId}
          result={traceQuery.data}
          loading={traceQuery.isLoading}
          error={traceQuery.error instanceof Error ? traceQuery.error : null}
          annotations={run.annotations}
          onClose={closeTrace}
          returnFocusTo={traceTriggerRef.current}
          replacementHref={(address) =>
            `/i/${encodeURIComponent(identityId)}/review?run=${encodeURIComponent(address.addressed_by_run_id)}&claim=${encodeURIComponent(address.replacement_claim_id)}`
          }
          onAnnotate={({ category, note }) =>
            annotationMutation
              .mutateAsync({
                operation_id: crypto.randomUUID(),
                target_type: "claim",
                target_id: openClaimId,
                category,
                note,
              })
              .then(() => undefined)
          }
        />
      )}
    </div>
  );
}
