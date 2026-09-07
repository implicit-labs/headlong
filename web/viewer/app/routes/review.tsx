import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Clock3, FileText, Focus, PanelRight, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { toast } from "sonner";

import { IdentityTabs } from "~/components/identity-tabs";
import { ArtifactReader, type ArtifactPassageSelection } from "~/components/review-artifact";
import { ReviewContextSidebar, type SidebarTab } from "~/components/review-context-sidebar";
import { SentienceAnswers } from "~/components/review-sentience";
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
  const [requestedTab, setRequestedTab] = useState<SidebarTab | undefined>(undefined);
  const [requestedTabKey, setRequestedTabKey] = useState(0);

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
  const otherWaitingRuns = sortedRuns.filter((summary) =>
    summary.run_id !== selectedSummary.run_id && summary.valid && summary.status === "waiting_on_toma" && summary.pending_decision_count > 0);
  const openClaim = (claimId: string) => {
    const trace = run?.provenance.find((item) => item.claim_id === claimId);
    setSelections(new Map([[`claim:${claimId}`, { id: `claim:${claimId}`, startOffset: 0, endOffset: 1, excerpt: trace?.claim_text ?? claimId, claimIds: [claimId], directClaimId: claimId }]]));
    setRequestedTab("reasoning"); setRequestedTabKey((key) => key + 1);
    setSidebarOpen(true);
  };
  const openInSidebar = (tab: SidebarTab, elementId?: string) => {
    setRequestedTab(tab); setRequestedTabKey((key) => key + 1);
    setSidebarOpen(true);
    if (elementId) window.setTimeout(() => document.getElementById(elementId)?.scrollIntoView({ block: "start", behavior: "smooth" }), 50);
  };
  const selectedArray = [...selections.values()];
  const selectionCount = selections.size + selectedDecisionIds.size;
  const decisionsContent = run ? (
    <>
      {run.decision_requests.map((request) => {
        const latestDecision = latestDecisions.get(request.decision_request_id);
        return <div key={request.decision_request_id} id={`decision-${request.decision_request_id}`} className="scroll-mt-4"><DecisionCard
          request={request}
          latestDecision={latestDecision}
          onSubmit={(body) => decisionMutation.mutateAsync({ ...body, operation_id: crypto.randomUUID() }).then(() => undefined)}
          onAnnotate={run.artifact && latestDecision ? ({ decisionId, category, note }) => annotationMutation.mutateAsync({ operation_id: crypto.randomUUID(), target_type: "decision", target_id: decisionId, category, note }).then(() => undefined) : undefined}
        /></div>;
      })}
    </>
  ) : null;

  return (
    <div className="mx-auto w-full max-w-[96rem] px-4 sm:px-5">
      {header}
      <main className="review-page pb-16">
        <section className="mx-auto mb-8 max-w-[86rem]" aria-labelledby="review-question">
          <p className="text-xs uppercase tracking-[0.1em] text-muted-foreground">
            {review.identity.name} · {new Date(selectedSummary.started_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · {statusLabel(selectedSummary.status)}
            <span className="ml-2 inline-flex items-center gap-1 normal-case tracking-normal"><Clock3 aria-hidden="true" className="size-3" />{formatTimeRemaining(run?.time_remaining_s ?? selectedSummary.time_remaining_s)}</span>
            {!selectedSummary.valid && <Badge variant="destructive" className="ml-2">Invalid manifest</Badge>}
          </p>
          <h1 id="review-question" className="mt-3 max-w-[22ch] text-[clamp(1.75rem,3.6vw,2.75rem)] font-bold leading-[1.08] tracking-tight text-balance">
            {run?.manifest.brief?.question ?? selectedSummary.title}
          </h1>
          {(run?.manifest.brief?.finding || run?.manifest.progress_summary) && (
            <p className={cn("mt-4 max-w-[38em] text-[clamp(1rem,1.6vw,1.25rem)] leading-relaxed", run?.manifest.brief?.finding ? "text-foreground/85" : "text-muted-foreground")}>
              {run?.manifest.brief?.finding ?? run?.manifest.progress_summary}
            </p>
          )}
          {run && (() => {
            const pending = run.pending_decision_count, said = run.sentience_receipts.length, next = run.manifest.next_step_options?.length ?? 0;
            const parts = [
              pending > 0 && <span key="d"><b className="mr-1.5 text-xl font-bold">{pending}</b>{pending === 1 ? "answer" : "answers"} needed from you</span>,
              said > 0 && <span key="s"><b className="mr-1.5 text-xl font-bold">{said}</b>{said === 1 ? "thing" : "things"} Sentience said on your behalf</span>,
              next > 0 && <span key="n"><b className="mr-1.5 text-xl font-bold">{next}</b>next {next === 1 ? "session" : "sessions"} proposed</span>,
            ].filter(Boolean);
            return <p className="mt-5 flex flex-wrap gap-x-6 gap-y-2 border-t-2 border-foreground pt-4 text-[15px]">{parts.length ? parts : <span className="text-muted-foreground">Nothing waiting on you.</span>}</p>;
          })()}
        </section>

        <div className="mx-auto mb-3 flex max-w-[86rem] items-center justify-between gap-3 px-1">
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
        {selectedSummary.valid && selectedSummary.warnings?.length > 0 && <section className="mx-auto max-w-4xl rounded-xl border border-amber-500/40 bg-amber-500/5 p-4"><div className="flex items-center gap-2 text-amber-700 dark:text-amber-400"><AlertTriangle aria-hidden="true" className="size-4" /><h2 className="text-sm font-semibold">Reviewable, with {selectedSummary.warnings.length === 1 ? "one record" : `${selectedSummary.warnings.length} records`} skipped</h2></div><ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">{selectedSummary.warnings.map((message) => <li key={message}>{message}</li>)}</ul></section>}
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
                onOpenTrace={openClaim}
              /> : <section className="rounded-xl border border-dashed p-8 text-center"><FileText className="mx-auto size-5 text-muted-foreground" /><p className="mt-2 font-medium">No primary artifact</p></section>}

              {run.decision_requests.length > 0 && (
                <section className="mt-12" aria-labelledby="h-decide">
                  <h2 id="h-decide" className="review-h2">Decide</h2>
                  <div className="space-y-3">{decisionsContent}</div>
                </section>
              )}
              {(run.manifest.next_step_options?.length ?? 0) > 0 && (
                <section className="mt-12" aria-labelledby="h-next">
                  <h2 id="h-next" className="review-h2">Next</h2>
                  <div id="next-run" className="scroll-mt-4"><NextRunCard options={run.manifest.next_step_options ?? []} /></div>
                </section>
              )}
              {run.sentience_receipts.length > 0 && (
                <section className="mt-12" aria-labelledby="h-sentience">
                  <h2 id="h-sentience" className="review-h2">Sentience answered these as you</h2>
                  <p className="mb-3 text-sm text-muted-foreground">A model of you spoke for you. If one is wrong, open the claim it changed and annotate it.</p>
                  <SentienceAnswers receipts={run.sentience_receipts} onOpenClaim={openClaim} />
                </section>
              )}
              <details className="mt-12 text-sm text-muted-foreground">
                <summary className="cursor-pointer">Everything else — {run.provenance.length} evidence records, run log{priorRuns.length ? `, ${priorRuns.length} prior run${priorRuns.length === 1 ? "" : "s"}` : ""}</summary>
                <ul className="mt-3 space-y-1.5 pl-5 leading-relaxed [list-style:disc]">
                  <li>{run.provenance.length} claims{(() => { const c: Record<string, number> = {}; run.provenance.forEach((p) => { c[p.evidence_class] = (c[p.evidence_class] ?? 0) + 1; }); const o = ["observed", "inferred", "sentience_judgment", "proposed"].filter((k) => c[k]).map((k) => `${c[k]} ${k === "sentience_judgment" ? "from Sentience" : k}`); return o.length ? ` — ${o.join(", ")}` : ""; })()}</li>
                  <li className="break-all">Run <span className="font-mono text-xs">{selectedSummary.run_id}</span> · goal <span className="font-mono text-xs">{selectedSummary.goal_ref}</span>{run.artifact && <> · artifact <span className="font-mono text-xs">{run.artifact.path}</span></>}</li>
                  {run.manifest.review_surface?.no_diagram_reason && <li>No diagram — the agent's reason: {run.manifest.review_surface.no_diagram_reason}</li>}
                  {run.warnings.map((w) => <li key={w}>{w}</li>)}
                  {otherWaitingRuns.map((s) => <li key={s.run_id}><button type="button" className="underline-offset-2 hover:underline" onClick={() => { setSelectedRunId(s.run_id); window.scrollTo({ top: 0, behavior: "smooth" }); }}>{s.title}</button> is also waiting on you · {s.pending_decision_count} pending</li>)}
                  {priorRuns.map((summary) => <li key={summary.run_id}><button type="button" className="underline-offset-2 hover:underline" onClick={() => { setSelectedRunId(summary.run_id); window.scrollTo({ top: 0, behavior: "smooth" }); }}>{summary.title}</button> · {new Date(summary.started_at).toLocaleDateString()} · {summary.valid ? statusLabel(summary.status) : "invalid"}</li>)}
                </ul>
              </details>
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
              decisionsContent={null}
              chat={reviewChat}
              chatPending={chatMutation.isPending}
              onAnnotateClaim={(claimId, { category, note }) => annotationMutation.mutateAsync({ operation_id: crypto.randomUUID(), target_type: "claim", target_id: claimId, category, note }).then(() => undefined)}
              lensEnabled={lensEnabled}
              requestedTab={requestedTab}
              requestedTabKey={requestedTabKey}
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
