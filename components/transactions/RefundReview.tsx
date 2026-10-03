"use client";

import { useEffect, useState } from "react";
import { ReviewCard, ReviewItemActions } from "@/components/transactions/ReviewPairList";
import { formatCurrency } from "@/lib/format";
import type { SuggestionEvidence } from "@/lib/transaction-quality";

interface RefundPair {
  subject_id: string;
  charge_id: string;
  refund_id: string;
  merchant: string;
  charge_date: string | null;
  refund_date: string | null;
  amount: number;
  evidence?: SuggestionEvidence;
}

/**
 * Surfaces detected refund pairs (same merchant, opposite sign, close in time)
 * and lets the user link them (so they net out) or dismiss. Decisions persist
 * in transaction_review_decisions, so a re-sync never resurfaces a dismissed
 * pair. Renders nothing when there is nothing to review.
 */
export default function RefundReview() {
  const [pairs, setPairs] = useState<RefundPair[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/transactions/refunds")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("load failed"))))
      .then((json) => {
        if (active) setPairs((json.pairs ?? []) as RefundPair[]);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  async function decide(pair: RefundPair, decision: "confirmed" | "dismissed") {
    setError(null);
    setBusyId(pair.subject_id);
    try {
      const res = await fetch("/api/transactions/refunds", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          subject_id: pair.subject_id,
          decision,
          charge_id: pair.charge_id,
          refund_id: pair.refund_id,
          amount: pair.amount,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? "Could not save decision.");
      }
      setPairs((current) => current.filter((row) => row.subject_id !== pair.subject_id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save decision.");
    } finally {
      setBusyId(null);
    }
  }

  if (!loaded || pairs.length === 0) return null;

  return (
    <ReviewCard title="Refund review" eyebrow="Possible refund pairs" error={error}>
      {pairs.map((pair) => (
        <div key={pair.subject_id} className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-field bg-panel-2 p-3">
            <span>
              <span className="block font-semibold">{pair.merchant}</span>
              <span data-money className="block text-xs text-muted">
                Charged {pair.charge_date}, refunded {pair.refund_date} · {formatCurrency(pair.amount)}
              </span>
            </span>
            <ReviewItemActions
              id={pair.subject_id}
              busyId={busyId}
              confirmLabel="Link"
              onConfirm={() => {
                void decide(pair, "confirmed");
              }}
              onDismiss={() => {
                void decide(pair, "dismissed");
              }}
            />
          </div>
          {pair.evidence && (
            <details className="rounded-field border border-panel-border bg-panel p-3 text-xs">
              <summary className="cursor-pointer font-semibold text-muted">Why this was suggested</summary>
              <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                <div><dt className="text-muted">Amount</dt><dd>{pair.evidence.amountAgreement}</dd></div>
                <div><dt className="text-muted">Date distance</dt><dd>{pair.evidence.dateDistanceDays} day{pair.evidence.dateDistanceDays === 1 ? "" : "s"}</dd></div>
                <div><dt className="text-muted">Counterparty</dt><dd>{pair.evidence.counterpartyAgreement}</dd></div>
                <div><dt className="text-muted">Strategy</dt><dd>{pair.evidence.strategy}</dd></div>
              </dl>
            </details>
          )}
        </div>
      ))}
    </ReviewCard>
  );
}
