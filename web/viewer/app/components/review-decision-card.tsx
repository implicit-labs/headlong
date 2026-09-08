import { useId, useState } from "react";

import { AnnotationForm } from "~/components/review-annotation-form";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import type {
  AnnotationCategory,
  DecisionAnswer,
  DecisionRequest,
  HumanDecision,
} from "~/lib/types";

const ANSWERS: Array<{
  value: DecisionAnswer;
  label: string;
  description: string;
}> = [
  { value: "yes", label: "Yes", description: "Authorize this scope" },
  { value: "no", label: "No", description: "Do not proceed" },
  { value: "hold", label: "Hold", description: "Pause for now" },
  {
    value: "need_more_evidence",
    label: "Need more evidence",
    description: "Return with stronger support",
  },
];

export function decisionAnswerLabel(answer: DecisionAnswer): string {
  return ANSWERS.find((option) => option.value === answer)?.label ?? answer;
}

function firstSentence(text: string, max = 110): string {
  const cut = text.split(/(?<=[.?!])\s/)[0] ?? text;
  return cut.length > max ? `${cut.slice(0, max - 1)}…` : cut;
}

export function DecisionCard({
  request,
  latestDecision,
  onSubmit,
  onAnnotate,
}: {
  request: DecisionRequest;
  latestDecision?: HumanDecision;
  onSubmit: (input: {
    decision_request_id: string;
    answer: DecisionAnswer;
    rationale: string;
    supersedes?: string | null;
  }) => Promise<void> | void;
  onAnnotate?: (input: {
    decisionId: string;
    category: AnnotationCategory;
    note: string;
  }) => Promise<void> | void;
}) {
  const rationaleId = useId();
  const [editing, setEditing] = useState(!latestDecision);
  const [answer, setAnswer] = useState<DecisionAnswer | null>(null);
  const [rationale, setRationale] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);

  return (
    <article className="rounded-xl border bg-card p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Decision requested
          </p>
          <h3 className="mt-1 text-lg font-semibold leading-snug text-balance">
            {request.headline ?? firstSentence(request.question)}
          </h3>
          {request.summary && <p className="mt-1.5 max-w-[52ch] text-sm leading-relaxed text-muted-foreground">{request.summary}</p>}
        </div>
        {latestDecision && (
          <Badge variant="secondary">
            {decisionAnswerLabel(latestDecision.answer)}
          </Badge>
        )}
      </div>

      {request.context && (
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {request.context}
        </p>
      )}

      {/* The scope is legally load-bearing and must be seen before submitting;
          it is not what a reader needs first. Collapsed by default, forced open
          the moment an answer is chosen. */}
      <details
        className="mt-4 rounded-lg border border-primary/20 bg-primary/5"
        open={scopeOpen || answer !== null}
        onToggle={(event) => setScopeOpen((event.currentTarget as HTMLDetailsElement).open)}
      >
        <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {request.headline ? "Full request and exact scope" : "Exact authorized scope"}
          {request.anchor_node && <span className="ml-2 normal-case tracking-normal text-primary">· on {request.anchor_node}</span>}
        </summary>
        {request.headline && <p className="px-3 pb-2 text-sm leading-relaxed text-muted-foreground">{request.question}</p>}
        <p className="px-3 pb-3 text-sm font-medium leading-relaxed">
          {request.authorized_scope}
        </p>
      </details>

      {latestDecision && !editing && (
        <div className="mt-4 space-y-3">
          <div>
            <p className="text-sm font-medium">Rationale</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {latestDecision.rationale}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 w-full sm:w-auto"
            onClick={() => setEditing(true)}
          >
            Change decision
          </Button>
          {onAnnotate && (
            <details className="rounded-lg border p-3">
              <summary className="cursor-pointer text-sm font-medium">
                Annotate this decision
              </summary>
              <div className="mt-3">
                <AnnotationForm
                  onSubmit={({ category, note }) =>
                    onAnnotate({
                      decisionId: latestDecision.decision_id,
                      category,
                      note,
                    })
                  }
                />
              </div>
            </details>
          )}
        </div>
      )}

      {editing && (
        <form
          className="mt-4 space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!answer || !rationale.trim() || submitting) return;
            setSubmitting(true);
            try {
              await onSubmit({
                decision_request_id: request.decision_request_id,
                answer,
                rationale: rationale.trim(),
                supersedes: latestDecision?.decision_id ?? null,
              });
              setAnswer(null);
              setRationale("");
              setEditing(false);
            } catch {
              // The owner reports mutation failures; keep the draft intact.
            } finally {
              setSubmitting(false);
            }
          }}
        >
          {latestDecision && (
            <p className="text-xs text-muted-foreground">
              Your new answer will supersede decision {latestDecision.decision_id}.
            </p>
          )}
          <fieldset disabled={submitting}>
            <legend className="sr-only">Your answer</legend>
            <div className="flex flex-wrap gap-2">
              {ANSWERS.map((option, index) => (
                <button
                  key={option.value}
                  type="button"
                  title={option.description}
                  className={cn(
                    "min-h-10 rounded-md border px-3.5 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                    index === 0 && answer === null && "border-foreground bg-foreground text-background hover:bg-foreground/90",
                    answer === option.value && "border-primary bg-primary/10 ring-1 ring-primary"
                  )}
                  aria-pressed={answer === option.value}
                  onClick={() => setAnswer(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>

          {answer !== null && <div>
            <label className="text-sm font-medium" htmlFor={rationaleId}>
              Rationale
            </label>
            <textarea
              id={rationaleId}
              className="mt-1 min-h-24 w-full resize-y rounded-md border bg-background px-3 py-2 text-base sm:text-sm"
              placeholder="Why is this the right call within the stated scope?"
              value={rationale}
              onChange={(event) => setRationale(event.target.value)}
              disabled={submitting}
              required
            />
          </div>}

          {answer !== null && <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {latestDecision && (
              <Button
                type="button"
                variant="ghost"
                className="min-h-11"
                onClick={() => setEditing(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
            )}
            <Button
              type="submit"
              className="min-h-11"
              disabled={!answer || !rationale.trim() || submitting}
            >
              {submitting ? "Recording…" : "Record decision"}
            </Button>
          </div>}
        </form>
      )}
    </article>
  );
}
