import { useId, useState } from "react";

import { Button } from "~/components/ui/button";
import type { AnnotationCategory } from "~/lib/types";

const CATEGORIES: Array<{ value: AnnotationCategory; label: string }> = [
  { value: "wrong_fact", label: "Wrong fact" },
  {
    value: "weak_or_missing_evidence",
    label: "Weak or missing evidence",
  },
  { value: "overconfident_inference", label: "Overconfident inference" },
  { value: "ignored_counterevidence", label: "Ignored counterevidence" },
  {
    value: "wrong_tradeoff_or_value_judgment",
    label: "Wrong tradeoff or value judgment",
  },
  { value: "exceeded_authorized_scope", label: "Exceeded authorized scope" },
  { value: "unclear_or_too_much_text", label: "Unclear or too much text" },
  { value: "other", label: "Other" },
];

export function AnnotationForm({
  onSubmit,
  disabled = false,
}: {
  onSubmit: (input: {
    category: AnnotationCategory;
    note: string;
  }) => Promise<void> | void;
  disabled?: boolean;
}) {
  const categoryId = useId();
  const noteId = useId();
  const [category, setCategory] = useState<AnnotationCategory>(
    "weak_or_missing_evidence"
  );
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  return (
    <form
      className="space-y-3 rounded-lg border bg-muted/30 p-3"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!note.trim() || submitting) return;
        setSubmitting(true);
        try {
          await onSubmit({ category, note: note.trim() });
          setNote("");
        } catch {
          // The owner reports mutation failures; keep the form populated.
        } finally {
          setSubmitting(false);
        }
      }}
    >
      <div>
        <label className="text-sm font-medium" htmlFor={categoryId}>
          What needs correction?
        </label>
        <select
          id={categoryId}
          className="mt-1 min-h-11 w-full rounded-md border bg-background px-3 text-base sm:text-sm"
          value={category}
          onChange={(event) =>
            setCategory(event.target.value as AnnotationCategory)
          }
          disabled={disabled || submitting}
        >
          {CATEGORIES.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="text-sm font-medium" htmlFor={noteId}>
          Note
        </label>
        <textarea
          id={noteId}
          className="mt-1 min-h-24 w-full resize-y rounded-md border bg-background px-3 py-2 text-base sm:text-sm"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Name the reasoning error and what should change."
          disabled={disabled || submitting}
          required
        />
      </div>
      <Button
        type="submit"
        variant="outline"
        className="min-h-11 w-full sm:w-auto"
        disabled={disabled || submitting || !note.trim()}
      >
        {submitting ? "Saving…" : "Add reasoning note"}
      </Button>
    </form>
  );
}

export function annotationCategoryLabel(category: AnnotationCategory): string {
  return CATEGORIES.find((item) => item.value === category)?.label ?? category;
}
