"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ReviewItemActions } from "@/components/transactions/ReviewPairList";
import { formatCurrency } from "@/lib/format";
import Button from "@/components/ui/Button";

interface TransferPair {
  subject_id: string;
  out_id: string;
  in_id: string;
  amount: number;
  out_date: string | null;
  in_date: string | null;
  out_account_name?: string;
  in_account_name?: string;
  out_merchant?: string;
  in_merchant?: string;
}

/**
 * Surfaces detected inter-account transfer pairs (same amount, opposite sign,
 * different accounts, close in time) as a compact review drawer that can be
 * expanded without pushing the transaction ledger off screen.
 */
export default function TransferReview() {
  const router = useRouter();
  const [pairs, setPairs] = useState<TransferPair[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/transactions/transfers")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("load failed"))))
      .then((json) => {
        if (active) setPairs((json.pairs ?? []) as TransferPair[]);
      })
      .catch(() => {
        if (active) setError("Could not load transfer suggestions.");
      })
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
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save decision.");
    } finally {
      setBusyId(null);
    }
  }

  if (!loaded || pairs.length === 0) return null;

  return (
    <div className="rounded-card border border-panel-border bg-panel p-4 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
            {pairs.length}
          </span>
          <span className="text-sm font-semibold">
            Potential transfer{pairs.length === 1 ? "" : "s"} detected
          </span>
          <span className="hidden text-xs text-muted sm:inline">
            (link them so both sides net out of expenses and income)
          </span>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setExpanded((prev) => !prev)}
        >
          {expanded ? "Hide review" : `Review (${pairs.length})`}
        </Button>
      </div>

      {error && <p className="mt-2 text-xs text-danger">{error}</p>}

      {expanded && (
        <div className="mt-4 space-y-3 border-t border-panel-border pt-4">
          {pairs.map((pair) => (
            <div
              key={pair.subject_id}
              className="flex flex-col gap-3 rounded-field bg-panel-2 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="text-xs">
                <div className="flex items-center gap-2 font-medium">
                  <span className="text-foreground">{pair.out_account_name || "Account A"}</span>
                  <span className="text-muted">→</span>
                  <span className="text-foreground">{pair.in_account_name || "Account B"}</span>
                  <span className="font-semibold text-foreground">
                    {formatCurrency(pair.amount)}
                  </span>
                </div>
                <div className="mt-1 text-muted">
                  Left {pair.out_date || "unknown date"} ({pair.out_merchant || "Outflow"}) · Arrived{" "}
                  {pair.in_date || "unknown date"} ({pair.in_merchant || "Inflow"})
                </div>
              </div>
              <ReviewItemActions
                id={pair.subject_id}
                busyId={busyId}
                confirmLabel="Link transfer"
                onConfirm={() => {
                  void decide(pair, "confirmed");
                }}
                onDismiss={() => {
                  void decide(pair, "dismissed");
                }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
