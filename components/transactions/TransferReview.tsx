"use client";

import { useEffect, useState } from "react";
import { ReviewCard, ReviewItemActions } from "@/components/transactions/ReviewPairList";
import { formatCurrency } from "@/lib/format";

interface TransferPair {
  subject_id: string;
  out_id: string;
  in_id: string;
  amount: number;
  out_date: string | null;
  in_date: string | null;
}

/**
 * Surfaces detected inter-account transfer pairs (same amount, opposite sign,
 * different accounts, close in time) and lets the user link them (so both
 * sides net out of spend/income/cash-flow) or dismiss. Decisions persist in
 * transaction_review_decisions, so a re-sync never resurfaces a dismissed
 * pair. Renders nothing when there is nothing to review.
 */
export default function TransferReview() {
  const [pairs, setPairs] = useState<TransferPair[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/transactions/transfers")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("load failed"))))
      .then((json) => {
        if (active) setPairs((json.pairs ?? []) as TransferPair[]);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  async function decide(pair: TransferPair, decision: "confirmed" | "dismissed") {
    setError(null);
    setBusyId(pair.subject_id);
    try {
      const res = await fetch("/api/transactions/transfers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          subject_id: pair.subject_id,
          decision,
          out_id: pair.out_id,
          in_id: pair.in_id,
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
    <ReviewCard title="Transfer review" eyebrow="Possible transfers" error={error}>
      {pairs.map((pair) => (
        <div
          key={pair.subject_id}
          className="flex flex-wrap items-center justify-between gap-3 rounded-field bg-panel-2 p-3"
        >
          <span>
            <span className="block font-semibold">Transfer between your accounts</span>
            <span className="block text-xs text-muted">
              Left {pair.out_date}, arrived {pair.in_date} · {formatCurrency(pair.amount)}
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
      ))}
    </ReviewCard>
  );
}
