"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import Panel from "@/components/ui/Panel";
import { formatCurrency } from "@/lib/format";

interface RefundPair {
  subject_id: string;
  charge_id: string;
  refund_id: string;
  merchant: string;
  charge_date: string | null;
  refund_date: string | null;
  amount: number;
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
    <Panel title="Refund review" eyebrow="Possible refund pairs">
      <div className="space-y-2 text-sm">
        {pairs.map((pair) => (
          <div
            key={pair.subject_id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-field bg-panel-2 p-3"
          >
            <span>
              <span className="block font-semibold">{pair.merchant}</span>
              <span className="block text-xs text-muted">
                Charged {pair.charge_date}, refunded {pair.refund_date} · {formatCurrency(pair.amount)}
              </span>
            </span>
            <span className="flex gap-2">
              <Button
                size="sm"
                onClick={() => decide(pair, "confirmed")}
                loading={busyId === pair.subject_id}
              >
                Link
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => decide(pair, "dismissed")}
                loading={busyId === pair.subject_id}
              >
                Dismiss
              </Button>
            </span>
          </div>
        ))}
      </div>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </Panel>
  );
}
