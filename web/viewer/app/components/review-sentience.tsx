import { ArrowUpRight } from "lucide-react";

import type { SentienceReceipt } from "~/lib/types";

function firstSentence(text: string, max = 120): string {
  const cut = text.split(/(?<=[.?!])\s/)[0] ?? text;
  return cut.length > max ? `${cut.slice(0, max - 1)}…` : cut;
}

/** A model of the operator answered on their behalf. Show what it was asked and
 *  what changed because of the answer; the claim it touched is one click away. */
export function SentienceAnswers({ receipts, onOpenClaim }: { receipts: SentienceReceipt[]; onOpenClaim: (claimId: string) => void }) {
  if (!receipts.length) return null;
  return (
    <ul className="divide-y border-y" data-testid="sentience-answers">
      {receipts.map((receipt) => {
        const body = (
          <>
            <span className="block text-[15px] leading-snug">{firstSentence(receipt.question)}</span>
            <span className="mt-1 block text-sm leading-relaxed text-muted-foreground"><span className="text-primary">→ </span>{firstSentence(receipt.resulting_change, 200)}</span>
          </>
        );
        return (
          <li key={receipt.receipt_id}>
            {receipt.affected_claim_id ? (
              <button type="button" className="group flex w-full items-start gap-2 py-3 text-left outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onOpenClaim(receipt.affected_claim_id!)}>
                <span className="min-w-0 flex-1">{body}</span>
                <ArrowUpRight aria-hidden="true" className="mt-1 size-4 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />
              </button>
            ) : <div className="py-3">{body}</div>}
          </li>
        );
      })}
    </ul>
  );
}
