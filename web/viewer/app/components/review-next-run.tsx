import { ArrowRight, Clock3 } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import type { NextStepOption } from "~/lib/types";

export function NextRunCard({ options }: { options: NextStepOption[] }) {
  const sorted = [...options].sort(
    (left, right) => Number(Boolean(right.recommended)) - Number(Boolean(left.recommended))
  );
  const next = sorted[0];

  return (
    <aside className="rounded-xl border bg-card p-4 shadow-sm sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Next run
        </p>
        {next?.recommended && <Badge variant="secondary">Recommended</Badge>}
      </div>
      {!next ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No next run proposed.
        </p>
      ) : (
        <div className="mt-3 space-y-4">
          <div>
            <h2 className="font-semibold text-balance">{next.title}</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {next.scope}
            </p>
          </div>
          {(next.duration_minutes || next.duration) && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock3 aria-hidden="true" className="size-4" />
              {next.duration ?? `${next.duration_minutes} minutes`}
            </p>
          )}
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="font-medium">Expected artifact</dt>
              <dd className="mt-1 text-muted-foreground">{next.expected_artifact}</dd>
            </div>
            <div>
              <dt className="font-medium">Stopping rule</dt>
              <dd className="mt-1 text-muted-foreground">{next.stopping_rule}</dd>
            </div>
          </dl>
          {sorted.length > 1 && (
            <details className="rounded-lg border p-3">
              <summary className="cursor-pointer text-sm font-medium">
                {sorted.length - 1} other option{sorted.length === 2 ? "" : "s"}
              </summary>
              <ul className="mt-3 space-y-3">
                {sorted.slice(1).map((option, index) => (
                  <li key={option.option_id ?? `${option.title}-${index}`} className="text-sm">
                    <p className="flex items-center gap-2 font-medium">
                      <ArrowRight aria-hidden="true" className="size-3.5" />
                      {option.title}
                    </p>
                    <p className="mt-1 pl-5 text-muted-foreground">{option.scope}</p>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </aside>
  );
}
