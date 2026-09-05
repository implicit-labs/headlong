import { Check, MessageSquareText, SendHorizontal, Sparkles, X } from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { useState } from "react";

import { AnnotationForm } from "~/components/review-annotation-form";
import type { ArtifactPassageSelection } from "~/components/review-artifact";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import type { AnnotationCategory, AnnotationLedgerEvent, ChatMessage, ClaimTrace, DecisionRequest, ReasoningAddress, ReasoningAnnotation, ReviewChatLog } from "~/lib/types";

type SidebarTab = "reasoning" | "chat" | "decisions";

function messageTime(ts: string | null): string {
  if (!ts) return "";
  const date = new Date(ts);
  return Number.isNaN(date.getTime())
    ? ts
    : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function ChatBubble({ message, mine }: { message: ChatMessage; mine: boolean }) {
  return (
    <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
      <div className={cn(
        "max-w-[88%] rounded-xl px-3 py-2 text-sm",
        mine ? "bg-primary text-primary-foreground" : "border bg-background"
      )}>
        <p className="whitespace-pre-wrap break-words">{message.content}</p>
        <p className={cn("mt-1 text-[10px]", mine ? "text-primary-foreground/65" : "text-muted-foreground")}>
          {messageTime(message.ts)}
        </p>
      </div>
    </div>
  );
}

export function ReviewContextSidebar({
  open,
  onClose,
  selections,
  traces,
  annotations,
  decisionRequests,
  selectedDecisionIds,
  onToggleDecision,
  decisionsContent,
  chat,
  chatPending,
  onSendChat,
  onAnnotateClaim,
  replacementHref,
}: {
  open: boolean;
  onClose: () => void;
  selections: ArtifactPassageSelection[];
  traces: ClaimTrace[];
  annotations: AnnotationLedgerEvent[];
  decisionRequests: DecisionRequest[];
  selectedDecisionIds: Set<string>;
  onToggleDecision: (requestId: string) => void;
  decisionsContent: ReactNode;
  chat?: ReviewChatLog;
  chatPending: boolean;
  onSendChat: (question: string) => Promise<void>;
  onAnnotateClaim: (claimId: string, input: { category: AnnotationCategory; note: string }) => Promise<void>;
  replacementHref: (address: ReasoningAddress) => string;
}) {
  const [tab, setTab] = useState<SidebarTab>("reasoning");
  const [draft, setDraft] = useState("");
  if (!open) return null;

  const claimIds = new Set(selections.flatMap((selection) => selection.claimIds));
  const selectedTraces = traces.filter((trace) => claimIds.has(trace.claim_id));
  const selectionCount = selections.length + selectedDecisionIds.size;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const question = draft.trim();
    if (!question || chatPending || !chat?.chat_ready || selectionCount === 0) return;
    await onSendChat(question);
    setDraft("");
  };

  return (
    <aside className="fixed inset-x-0 bottom-0 z-40 flex max-h-[82dvh] flex-col rounded-t-2xl border bg-background shadow-2xl lg:sticky lg:top-36 lg:z-0 lg:max-h-[calc(100dvh-10rem)] lg:w-[25rem] lg:shrink-0 lg:rounded-2xl">
      <header className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Review context</p>
          <p className="mt-1 text-sm font-medium">
            {selectionCount ? `${selectionCount} selected` : "Select a passage"}
          </p>
        </div>
        <Button type="button" variant="ghost" size="icon" className="size-11" aria-label="Close review sidebar" onClick={onClose}>
          <X aria-hidden="true" />
        </Button>
      </header>

      <div className="grid grid-cols-3 border-b p-1" role="tablist" aria-label="Review context views">
        {([
          ["reasoning", "Reasoning"],
          ["chat", "Chat"],
          ["decisions", "Decisions"],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={cn("min-h-10 rounded-lg px-2 text-xs font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring", tab === value && "bg-muted text-foreground")}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
        {tab === "reasoning" && (
          <div className="space-y-5">
            {selections.length === 0 ? (
              <div className="rounded-xl border border-dashed p-5 text-center">
                <Sparkles className="mx-auto size-5 text-muted-foreground" />
                <p className="mt-2 text-sm font-medium">Turn on the decision lens, then click a passage.</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Shift-click adds more passages.</p>
              </div>
            ) : selections.map((selection, index) => {
              const passageTraces = traces.filter((trace) => selection.claimIds.includes(trace.claim_id));
              return (
                <section key={selection.id} className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">Passage {index + 1}</Badge>
                    <span className="text-xs text-muted-foreground">{passageTraces.length ? `${passageTraces.length} linked claim${passageTraces.length === 1 ? "" : "s"}` : "No reasoning recorded"}</span>
                  </div>
                  <blockquote className="border-l-2 pl-3 text-sm leading-relaxed text-muted-foreground">
                    {selection.excerpt.length > 420 ? `${selection.excerpt.slice(0, 420)}…` : selection.excerpt}
                  </blockquote>
                  {passageTraces.map((trace) => (
                    <article key={trace.claim_id} className="rounded-xl border bg-card p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{trace.evidence_class}</Badge>
                        <span className="font-mono text-[10px] text-muted-foreground">{trace.claim_id}</span>
                      </div>
                      <p className="mt-3 text-sm font-medium leading-relaxed">{trace.claim_text}</p>
                      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{trace.reason}</p>
                      {trace.sources.length > 0 && (
                        <details className="mt-3">
                          <summary className="cursor-pointer text-xs font-semibold">{trace.sources.length} source{trace.sources.length === 1 ? "" : "s"}</summary>
                          <div className="mt-2 space-y-2">
                            {trace.sources.map((source, sourceIndex) => (
                              <div key={`${source.ref}-${sourceIndex}`} className="rounded-lg bg-muted p-3 text-xs leading-relaxed">
                                <p className="font-semibold">{source.label}</p>
                                <p className="mt-1 text-muted-foreground">{source.excerpt}</p>
                                <p className="mt-2 break-all font-mono text-[10px] text-muted-foreground">{source.ref}</p>
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                      {trace.uncertainty && <p className="mt-3 rounded-lg bg-amber-500/10 p-3 text-xs leading-relaxed">Uncertainty: {trace.uncertainty}</p>}
                      {(() => {
                        const notes = annotations.filter((event): event is ReasoningAnnotation => event.type === "annotation" && event.target_type === "claim" && event.target_id === trace.claim_id);
                        const addresses = new Map(annotations.filter((event): event is ReasoningAddress => event.type === "addressed").map((address) => [address.annotation_id, address]));
                        return notes.length ? <div className="mt-3 space-y-2">{notes.map((note) => {
                          const address = addresses.get(note.annotation_id);
                          return <div key={note.annotation_id} className="rounded-lg border p-3 text-xs leading-relaxed"><div className="flex items-center justify-between gap-2"><span className="font-semibold">{note.category.replaceAll("_", " ")}</span>{address && <Badge variant="secondary">Addressed</Badge>}</div><p className="mt-1 text-muted-foreground">{note.note}</p>{address && <a className="mt-2 block break-all font-medium underline underline-offset-4" href={replacementHref(address)}>Replacement: {address.replacement_claim_id}</a>}</div>;
                        })}</div> : null;
                      })()}
                      <details className="mt-3 border-t pt-3">
                        <summary className="cursor-pointer text-xs font-semibold">Annotate this reasoning</summary>
                        <div className="mt-3"><AnnotationForm onSubmit={(input) => onAnnotateClaim(trace.claim_id, input)} /></div>
                      </details>
                    </article>
                  ))}
                </section>
              );
            })}
            {selectedTraces.length === 0 && selections.length > 0 && (
              <p className="rounded-lg bg-muted p-3 text-xs leading-relaxed text-muted-foreground">These passages are still valid chat context, but this run did not attach a claim-level provenance record to them.</p>
            )}
          </div>
        )}

        {tab === "chat" && (
          <div className="flex min-h-[22rem] flex-col">
            {!chat?.chat_ready && (
              <div className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs leading-relaxed">
                This agent is asleep. Headlong cannot replay messages sent before it wakes, so chat is disabled until the agent is running.
              </div>
            )}
            <div className="flex flex-1 flex-col gap-2">
              {(chat?.messages ?? []).length === 0 ? (
                <div className="my-auto py-8 text-center text-sm text-muted-foreground">
                  <MessageSquareText className="mx-auto mb-2 size-5" />
                  Ask about the selected passages or decisions.
                </div>
              ) : (chat?.messages ?? []).map((message, index) => (
                <ChatBubble key={message.step_id ?? index} message={message} mine={message.from === chat?.sender} />
              ))}
            </div>
          </div>
        )}

        {tab === "decisions" && (
          <div className="space-y-4">
            {decisionRequests.map((request) => {
              const selected = selectedDecisionIds.has(request.decision_request_id);
              return (
                <button
                  key={request.decision_request_id}
                  type="button"
                  aria-pressed={selected}
                  className={cn("flex min-h-11 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring", selected && "border-primary bg-primary/5")}
                  onClick={() => onToggleDecision(request.decision_request_id)}
                >
                  <span className={cn("flex size-5 shrink-0 items-center justify-center rounded border", selected && "border-primary bg-primary text-primary-foreground")}>
                    {selected && <Check aria-hidden="true" className="size-3.5" />}
                  </span>
                  <span>{request.question}</span>
                </button>
              );
            })}
            {decisionsContent}
          </div>
        )}
      </div>

      {tab === "chat" && (
        <form className="border-t bg-background p-3 pb-[max(.75rem,env(safe-area-inset-bottom))]" onSubmit={submit}>
          <label className="sr-only" htmlFor="review-chat-question">Ask about selected context</label>
          <textarea
            id="review-chat-question"
            className="min-h-20 w-full resize-none rounded-xl border bg-background px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={selectionCount ? "Ask why, compare tradeoffs, or challenge the evidence…" : "Select context first…"}
            disabled={!chat?.chat_ready || selectionCount === 0 || chatPending}
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="text-[11px] leading-tight text-muted-foreground">Chat is discussion, not authorization to act.</p>
            <Button type="submit" size="sm" disabled={!draft.trim() || !chat?.chat_ready || selectionCount === 0 || chatPending}>
              <SendHorizontal aria-hidden="true" className="size-3.5" />
              {chatPending ? "Sending…" : "Ask"}
            </Button>
          </div>
        </form>
      )}
    </aside>
  );
}
