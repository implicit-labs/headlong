import { ArrowUpRight, Bot, Check, CircleDot, FileWarning, ListChecks, Route } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "~/components/ui/badge";
import { cn } from "~/lib/utils";
import type { DecisionRequest, NextStepOption, ReviewRunDetail, ReviewRunSummary, SentienceReceipt } from "~/lib/types";

const MAX_INLINE = 3;

function firstSentence(text: string, max = 110): string {
  const cut = text.split(/(?<=[.?!])\s/)[0] ?? text;
  return cut.length > max ? `${cut.slice(0, max - 1)}…` : cut;
}

function Row({
  icon,
  title,
  count,
  done,
  children,
}: {
  icon: ReactNode;
  title: string;
  count: number;
  done?: boolean;
  children?: ReactNode;
}) {
  return (
    <li className={cn("flex gap-3 py-3", done && "opacity-60")}>
      <span className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border", done ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400" : "border-primary/40 text-primary")} aria-hidden="true">
        {done ? <Check className="size-3.5" /> : icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {title}
          <span className="ml-2 font-normal text-muted-foreground">{count}</span>
        </p>
        {children}
      </div>
    </li>
  );
}

function JumpList<T>({
  items,
  render,
  onJump,
  more,
}: {
  items: T[];
  render: (item: T) => ReactNode;
  onJump?: (item: T) => void;
  more: string;
}) {
  if (!items.length) return null;
  return (
    <ul className="mt-1.5 space-y-1">
      {items.slice(0, MAX_INLINE).map((item, index) => (
        <li key={index}>
          {onJump ? (
            <button
              type="button"
              className="group flex w-full items-start gap-1.5 rounded-md py-0.5 text-left text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => onJump(item)}
            >
              <span className="min-w-0 flex-1">{render(item)}</span>
              <ArrowUpRight aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
            </button>
          ) : (
            <p className="py-0.5 text-sm text-muted-foreground">{render(item)}</p>
          )}
        </li>
      ))}
      {items.length > MAX_INLINE && <li className="text-xs text-muted-foreground">+{items.length - MAX_INLINE} {more}</li>}
    </ul>
  );
}

export function ReviewQueue({
  run,
  otherWaitingRuns,
  onOpenDecision,
  onOpenClaim,
  onOpenNextRun,
  onOpenRun,
}: {
  run: ReviewRunDetail;
  /** Other runs of this identity still waiting on a human. */
  otherWaitingRuns: ReviewRunSummary[];
  onOpenDecision: (request: DecisionRequest) => void;
  onOpenClaim: (claimId: string) => void;
  onOpenNextRun: () => void;
  onOpenRun: (runId: string) => void;
}) {
  const pending = run.decision_requests.filter((request) => !request.answered);
  const decided = run.decision_requests.length - pending.length;
  const receipts = run.sentience_receipts;
  const options: NextStepOption[] = run.manifest.next_step_options ?? [];
  const surface = run.manifest.review_surface;
  const notes: Array<{ key: string; text: string }> = [
    ...(surface?.no_diagram_reason ? [{ key: "waiver", text: `No diagram — the agent's reason: ${surface.no_diagram_reason}` }] : []),
    ...run.warnings.map((text, index) => ({ key: `warning-${index}`, text })),
  ];

  const total = pending.length + receipts.length + notes.length + (options.length ? 1 : 0) + otherWaitingRuns.length;
  const nothingLeft = total === 0;

  return (
    <section
      aria-labelledby="review-queue-heading"
      className="mx-auto mb-4 max-w-[86rem] rounded-xl border bg-card px-4 shadow-sm sm:px-5"
      data-testid="review-queue"
    >
      <div className="flex items-center justify-between gap-3 py-3">
        <h2 id="review-queue-heading" className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          <ListChecks aria-hidden="true" className="size-4" />
          Before the next run
        </h2>
        {nothingLeft ? (
          <Badge variant="secondary">Nothing waiting on you</Badge>
        ) : (
          <Badge>{total} item{total === 1 ? "" : "s"}</Badge>
        )}
      </div>

      {!nothingLeft && (
        <ul className="divide-y border-t">
          {run.decision_requests.length > 0 && (
            <Row icon={<CircleDot className="size-3.5" />} title="Decide" count={pending.length} done={pending.length === 0}>
              {pending.length === 0 ? (
                <p className="mt-1 text-sm text-muted-foreground">All {decided} decided. The next run launches with your answers.</p>
              ) : (
                <>
                  {decided > 0 && <p className="mt-0.5 text-xs text-muted-foreground">{decided} of {run.decision_requests.length} decided</p>}
                  <JumpList
                    items={pending}
                    onJump={onOpenDecision}
                    more="more to decide"
                    render={(request) => (
                      <>
                        {firstSentence(request.question)}
                        {request.anchor_node && <span className="ml-1.5 font-mono text-[11px] text-primary">· on {request.anchor_node}</span>}
                      </>
                    )}
                  />
                </>
              )}
            </Row>
          )}

          {receipts.length > 0 && (
            <Row icon={<Bot className="size-3.5" />} title="Check what Sentience answered as you" count={receipts.length}>
              <p className="mt-0.5 text-xs text-muted-foreground">A model of you answered these. If one is wrong, annotate the claim it changed.</p>
              <JumpList<SentienceReceipt>
                items={receipts}
                onJump={(receipt) => receipt.affected_claim_id && onOpenClaim(receipt.affected_claim_id)}
                more="more answers"
                render={(receipt) => (
                  <>
                    <span className="text-foreground">{firstSentence(receipt.question, 90)}</span>
                    <span className="block text-xs">{firstSentence(receipt.resulting_change, 120)}</span>
                  </>
                )}
              />
            </Row>
          )}

          {notes.length > 0 && (
            <Row icon={<FileWarning className="size-3.5" />} title="Read the agent's notes" count={notes.length}>
              <JumpList items={notes} more="more notes" render={(note) => note.text} />
            </Row>
          )}

          {options.length > 0 && (
            <Row icon={<Route className="size-3.5" />} title="Pick the next run" count={options.length}>
              <JumpList
                items={options}
                onJump={() => onOpenNextRun()}
                more="more options"
                render={(option) => (
                  <>
                    <span className="text-foreground">{option.title}</span>
                    {option.recommended && <span className="ml-1.5 text-xs text-primary">recommended</span>}
                    {(option.duration ?? option.duration_minutes) && <span className="ml-1.5 text-xs">· {option.duration ?? `${option.duration_minutes} min`}</span>}
                  </>
                )}
              />
            </Row>
          )}

          {otherWaitingRuns.length > 0 && (
            <Row icon={<CircleDot className="size-3.5" />} title="Other runs waiting on you" count={otherWaitingRuns.length}>
              <JumpList
                items={otherWaitingRuns}
                onJump={(summary) => onOpenRun(summary.run_id)}
                more="more runs"
                render={(summary) => (
                  <>
                    <span className="text-foreground">{summary.title}</span>
                    <span className="ml-1.5 text-xs">· {summary.pending_decision_count} pending</span>
                  </>
                )}
              />
            </Row>
          )}
        </ul>
      )}
    </section>
  );
}
