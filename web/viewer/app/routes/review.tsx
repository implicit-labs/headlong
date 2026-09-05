import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Clock3, FileText, Focus, PanelRight, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { toast } from "sonner";

import { IdentityTabs } from "~/components/identity-tabs";
import { ArtifactReader, type ArtifactPassageSelection } from "~/components/review-artifact";
import { ReviewContextSidebar } from "~/components/review-context-sidebar";
import { DecisionCard } from "~/components/review-decision-card";
import { NextRunCard } from "~/components/review-next-run";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "~/components/ui/empty";
import { LoadingDots } from "~/components/ui/loading-dots";
import {
  fetchIdentityStatus,
  fetchReview,
  fetchReviewChat,
  fetchReviewRun,
  sendReviewChat,
  submitAnnotation,
  submitDecision,
} from "~/lib/api";
import { cn } from "~/lib/utils";
import type { AnnotationCategory, DecisionAnswer, HumanDecision, ReviewContextSelection, ReviewRunStatus } from "~/lib/types";

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

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(
    target.closest("input, textarea, select, [contenteditable='true']")
  );
}

function updatePassageSelections(
  current: Map<string, ArtifactPassageSelection>,
  selection: ArtifactPassageSelection,
  additive: boolean
): Map<string, ArtifactPassageSelection> {
  if (!additive) {
    return current.size === 1 && current.has(selection.id)
      ? new Map()
      : new Map([[selection.id, selection]]);
  }
  const entries = [...current.entries()].filter(([id]) => id !== selection.id);
  return current.has(selection.id)
    ? new Map(entries)
    : new Map([...entries, [selection.id, selection]]);
}

export default function ReviewPage() {
  const { identityId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [selectedRunId, setSelectedRunId] = useState<string | null>(() => searchParams.get("run"));
  const requestedClaimId = searchParams.get("claim");
  const [lensEnabled, setLensEnabled] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selections, setSelections] = useState<Map<string, ArtifactPassageSelection>>(new Map());
  const [selectedDecisionIds, setSelectedDecisionIds] = useState<Set<string>>(new Set());
  const handledClaimKey = useRef<string | null>(null);

  const { data: status } = useQuery({
    queryKey: ["status", identityId],
    queryFn: () => fetchIdentityStatus(identityId),
    refetchInterval: 5000,
  });
  const { data: review, isLoading, error: reviewError, refetch: refetchReview } = useQuery({
    queryKey: ["review", identityId],
    queryFn: () => fetchReview(identityId),
    refetchInterval: 5000,
  });

  const sortedRuns = [...(review?.runs ?? [])].sort((left, right) => {
    const byPriority = runPriority(left.status) - runPriority(right.status);
    return byPriority || new Date(right.started_at).getTime() - new Date(left.started_at).getTime();
  });
  const selectedSummary = sortedRuns.find((run) => run.run_id === selectedRunId) ?? sortedRuns[0];
  const { data: run, isLoading: runLoading, error: runError } = useQuery({
    queryKey: ["review-run", identityId, selectedSummary?.run_id],
    queryFn: () => fetchReviewRun(identityId, selectedSummary!.run_id),
    enabled: Boolean(selectedSummary?.run_id && selectedSummary.valid),
    refetchInterval: selectedSummary?.status === "running" ? 2000 : 10000,
    retry: false,
  });
  const { data: reviewChat } = useQuery({
    queryKey: ["review-chat", identityId, selectedSummary?.run_id],
    queryFn: () => fetchReviewChat(identityId, selectedSummary!.run_id),
    enabled: Boolean(selectedSummary?.run_id && selectedSummary.valid),
    refetchInterval: 2000,
    retry: false,
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      if (event.key.toLowerCase() === "d") {
        event.preventDefault();
        if (!lensEnabled) setSidebarOpen(true);
        setLensEnabled(!lensEnabled);
      } else if (event.key === "Escape") {
        if (sidebarOpen) setSidebarOpen(false);
        else if (lensEnabled) setLensEnabled(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [lensEnabled, sidebarOpen]);

  useEffect(() => {
    setSelections(new Map());
    setSelectedDecisionIds(new Set());
    setSidebarOpen(false);
    setLensEnabled(false);
  }, [selectedSummary?.run_id]);

  useEffect(() => {
    if (!run || !requestedClaimId) return;
    const claimKey = `${run.manifest.run_id}:${requestedClaimId}`;
    if (handledClaimKey.current === claimKey) return;
    const trace = run.provenance.find((item) => item.claim_id === requestedClaimId);
    if (!trace) return;
    handledClaimKey.current = claimKey;
    setSelections(new Map([[`claim:${trace.claim_id}`, {
      id: `claim:${trace.claim_id}`,
      startOffset: 0,
      endOffset: 1,
      excerpt: trace.claim_text,
      claimIds: [trace.claim_id],
      directClaimId: trace.claim_id,
    }]]));
    setSidebarOpen(true);
  }, [requestedClaimId, run]);

  const refreshReviewData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["review", identityId] }),
      queryClient.invalidateQueries({ queryKey: ["review-run", identityId, selectedSummary?.run_id] }),
      queryClient.invalidateQueries({ queryKey: ["identities"] }),
    ]);
  };
  const decisionMutation = useMutation({
    mutationFn: (body: { operation_id: string; decision_request_id: string; answer: DecisionAnswer; rationale: string; supersedes?: string | null }) =>
      submitDecision(identityId, selectedSummary!.run_id, body),
    onSuccess: async () => { toast.success("Decision recorded"); await refreshReviewData(); },
    onError: (error: Error) => toast.error(error.message),
  });
  const annotationMutation = useMutation({
    mutationFn: (body: { operation_id: string; target_type: "claim" | "decision"; target_id: string; category: AnnotationCategory; note: string }) =>
      submitAnnotation(identityId, selectedSummary!.run_id, {
        ...body,
        artifact_ref: run!.artifact!.path,
        artifact_sha256: run!.artifact!.sha256,
      }),
    onSuccess: async () => { toast.success("Reasoning note saved"); await refreshReviewData(); },
    onError: (error: Error) => toast.error(error.message),
  });
  const chatMutation = useMutation({
    mutationFn: ({ question, context }: { question: string; context: ReviewContextSelection[] }) =>
      sendReviewChat(identityId, selectedSummary!.run_id, {
        operation_id: crypto.randomUUID(),
        artifact_sha256: run!.artifact!.sha256,
        question,
        selections: context,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["review-chat", identityId, selectedSummary?.run_id] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const latestDecisions = useMemo(() => {
    const map = new Map<string, HumanDecision>();
    for (const decision of run?.decisions ?? []) {
      const previous = map.get(decision.decision_request_id);
      if (!previous || decision.decided_at > previous.decided_at) map.set(decision.decision_request_id, decision);
    }
    return map;
  }, [run?.decisions]);

  if (isLoading) return <div className="flex justify-center py-20"><LoadingDots /></div>;

  const header = <IdentityTabs identityId={identityId} live={status?.live ?? false} active="review" name={review?.identity.name} />;
  if (reviewError || !review) {
    return <div className="mx-auto w-full max-w-7xl px-4">{header}<Empty><EmptyHeader><EmptyTitle>Review unavailable</EmptyTitle><EmptyDescription>{reviewError instanceof Error ? reviewError.message : "The review inbox could not be loaded."}</EmptyDescription></EmptyHeader><Button variant="outline" onClick={() => void refetchReview()}><RefreshCw aria-hidden="true" />Try again</Button></Empty></div>;
  }
  if (!selectedSummary) {
    return <div className="mx-auto w-full max-w-7xl px-4">{header}<Empty><EmptyHeader><EmptyTitle>Nothing to review</EmptyTitle><EmptyDescription>Completed Headlong runs will appear here with their artifacts, evidence, and decisions.</EmptyDescription></EmptyHeader></Empty></div>;
  }

  const priorRuns = sortedRuns.filter((summary) => summary.run_id !== selectedSummary.run_id);
  const selectedArray = [...selections.values()];
  const selectionCount = selections.size + selectedDecisionIds.size;
  const decisionsContent = run ? (
    <>
      {run.decision_requests.map((request) => {
        const latestDecision = latestDecisions.get(request.decision_request_id);
        return <DecisionCard
          key={request.decision_request_id}
          request={request}
          latestDecision={latestDecision}
          onSubmit={(body) => decisionMutation.mutateAsync({ ...body, operation_id: crypto.randomUUID() }).then(() => undefined)}
          onAnnotate={run.artifact && latestDecision ? ({ decisionId, category, note }) => annotationMutation.mutateAsync({ operation_id: crypto.randomUUID(), target_type: "decision", target_id: decisionId, category, note }).then(() => undefined) : undefined}
        />;
      })}
      <NextRunCard options={run.manifest.next_step_options ?? []} />
    </>
  ) : null;

  return (
    <div className="mx-auto w-full max-w-[96rem] px-4 sm:px-5">
      {header}
      <main className="pb-16">
        <header className="mx-auto mb-4 flex max-w-[86rem] flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{statusLabel(selectedSummary.status)}</Badge>
              {selectedSummary.pending_decision_count > 0 && <Badge>{selectedSummary.pending_decision_count} pending</Badge>}
              {!selectedSummary.valid && <Badge variant="destructive">Invalid manifest</Badge>}
            </div>
            <h1 className="mt-2 text-xl font-semibold tracking-tight text-balance sm:text-2xl">{selectedSummary.title}</h1>
            <details className="mt-1 text-xs text-muted-foreground">
              <summary className="cursor-pointer">Run details</summary>
              <p className="mt-2 break-all font-mono">{selectedSummary.goal_ref} · {selectedSummary.run_id}</p>
              {run?.artifact && <p className="mt-1 break-all font-mono">{run.artifact.path}</p>}
            </details>
          </div>
          <p className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground"><Clock3 aria-hidden="true" className="size-4" />{formatTimeRemaining(run?.time_remaining_s ?? selectedSummary.time_remaining_s)}</p>
        </header>

        <div className="mx-auto mb-4 flex max-w-[86rem] items-center justify-between gap-3 rounded-xl border bg-background p-2 shadow-sm">
          <div className="flex items-center gap-2">
            <Button type="button" variant={lensEnabled ? "default" : "outline"} className="min-h-11 flex-1 px-2 sm:flex-none sm:px-4" aria-pressed={lensEnabled} onClick={() => { setLensEnabled((value) => !value); setSidebarOpen(true); }}>
              <Focus aria-hidden="true" /><span className="sm:hidden">{lensEnabled ? "Lens on" : "Inspect"}</span><span className="hidden sm:inline">{lensEnabled ? "Decision lens on" : "Inspect decisions"}</span><kbd className="ml-1 hidden rounded border px-1.5 py-0.5 font-mono text-[10px] opacity-75 sm:inline">D</kbd>
            </Button>
            <p className="hidden text-xs text-muted-foreground md:block">Click a passage · Shift-click to add</p>
          </div>
          <Button type="button" variant="ghost" className="min-h-11 flex-1 px-2 sm:flex-none sm:px-4" onClick={() => setSidebarOpen(true)}>
            <PanelRight aria-hidden="true" />{selectionCount ? `${selectionCount} selected` : <><span className="sm:hidden">Context</span><span className="hidden sm:inline">Review context</span></>}
          </Button>
        </div>

        {!selectedSummary.valid && <section className="mx-auto max-w-4xl rounded-xl border border-destructive/40 bg-destructive/5 p-4"><div className="flex items-center gap-2 text-destructive"><AlertTriangle aria-hidden="true" className="size-5" /><h2 className="font-semibold">This run is not safe to review</h2></div><ul className="mt-3 list-disc space-y-1 pl-5 text-sm">{selectedSummary.validation_errors.map((message) => <li key={message}>{message}</li>)}</ul></section>}
        {selectedSummary.valid && runLoading && <div className="flex justify-center py-16"><LoadingDots /></div>}
        {selectedSummary.valid && runError && <section className="mx-auto max-w-4xl rounded-xl border border-destructive/40 p-4"><p className="font-medium text-destructive">Could not load this review run</p><p className="mt-1 text-sm text-muted-foreground">{runError instanceof Error ? runError.message : "Unknown error"}</p></section>}

        {run && (
          <div className="mx-auto flex max-w-[86rem] items-start gap-5">
            <div className={cn("min-w-0 flex-1", !sidebarOpen && "mx-auto max-w-5xl")}>
              {run.artifact ? <ArtifactReader
                artifact={run.artifact}
                traces={run.provenance}
                lensEnabled={lensEnabled}
                selectedIds={new Set(selections.keys())}
                onSelect={(selection, additive) => {
                  setSelections((current) => updatePassageSelections(current, selection, additive));
                  setSidebarOpen(true);
                }}
                onOpenTrace={(claimId) => {
                  const trace = run.provenance.find((item) => item.claim_id === claimId);
                  setSelections(new Map([[`claim:${claimId}`, { id: `claim:${claimId}`, startOffset: 0, endOffset: 1, excerpt: trace?.claim_text ?? claimId, claimIds: [claimId], directClaimId: claimId }]]));
                  setSidebarOpen(true);
                }}
              /> : <section className="rounded-xl border border-dashed p-8 text-center"><FileText className="mx-auto size-5 text-muted-foreground" /><p className="mt-2 font-medium">No primary artifact</p></section>}

              {priorRuns.length > 0 && <details className="mt-6 rounded-xl border bg-card p-4"><summary className="cursor-pointer font-medium">Prior runs ({priorRuns.length})</summary><div className="mt-3 divide-y">{priorRuns.map((summary) => <button key={summary.run_id} type="button" className="flex min-h-14 w-full items-center justify-between gap-3 py-3 text-left" onClick={() => { setSelectedRunId(summary.run_id); window.scrollTo({ top: 0, behavior: "smooth" }); }}><span><span className="block text-sm font-medium">{summary.title}</span><span className="mt-1 block text-xs text-muted-foreground">{new Date(summary.started_at).toLocaleString()}</span></span><Badge variant={summary.valid ? "outline" : "destructive"}>{summary.valid ? statusLabel(summary.status) : "invalid"}</Badge></button>)}</div></details>}
            </div>

            <ReviewContextSidebar
              open={sidebarOpen}
              onClose={() => setSidebarOpen(false)}
              selections={selectedArray}
              traces={run.provenance}
              annotations={run.annotations}
              decisionRequests={run.decision_requests}
              selectedDecisionIds={selectedDecisionIds}
              onToggleDecision={(requestId) => setSelectedDecisionIds((current) => { const next = new Set(current); if (next.has(requestId)) next.delete(requestId); else next.add(requestId); return next; })}
              decisionsContent={decisionsContent}
              chat={reviewChat}
              chatPending={chatMutation.isPending}
              onAnnotateClaim={(claimId, { category, note }) => annotationMutation.mutateAsync({ operation_id: crypto.randomUUID(), target_type: "claim", target_id: claimId, category, note }).then(() => undefined)}
              replacementHref={(address) => `/i/${encodeURIComponent(identityId)}/review?run=${encodeURIComponent(address.addressed_by_run_id)}&claim=${encodeURIComponent(address.replacement_claim_id)}`}
              onSendChat={(question) => {
                const context: ReviewContextSelection[] = [
                  ...selectedArray.map((selection): ReviewContextSelection => selection.directClaimId ? { type: "claim", claim_id: selection.directClaimId } : { type: "passage", start_offset: selection.startOffset, end_offset: selection.endOffset, claim_ids: selection.claimIds }),
                  ...[...selectedDecisionIds].map((decision_request_id): ReviewContextSelection => ({ type: "decision_request", decision_request_id })),
                ];
                return chatMutation.mutateAsync({ question, context }).then(() => undefined);
              }}
            />
          </div>
        )}
      </main>
    </div>
  );
}
