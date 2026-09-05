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

  return (
    <article className="rounded-xl border bg-card p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Decision requested
          </p>
          <h3 className="mt-1 text-base font-semibold text-balance">
            {request.question}
          </h3>
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

      <div className="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Authorized scope
        </p>
        <p className="mt-1 text-sm font-medium leading-relaxed">
          {request.authorized_scope}
        </p>
      </div>

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
            <legend className="text-sm font-medium">Your answer</legend>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {ANSWERS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={cn(
                    "min-h-14 rounded-lg border px-3 py-2 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                    answer === option.value &&
                      "border-primary bg-primary/5 ring-1 ring-primary"
                  )}
                  aria-pressed={answer === option.value}
                  onClick={() => setAnswer(option.value)}
                >
                  <span className="block text-sm font-medium">{option.label}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {option.description}
                  </span>
                </button>
              ))}
            </div>
          </fieldset>

          <div>
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
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
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
          </div>
        </form>
      )}
    </article>
  );
}
