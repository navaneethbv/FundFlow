"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import Panel from "@/components/ui/Panel";
import { formatCurrency } from "@/lib/format";
import type {
  DuplicatePair,
  DuplicateTransaction,
} from "@/lib/transaction-quality";

interface ConfirmedDuplicate {
  subjectId: string;
  kept: DuplicateTransaction | null;
  excluded: DuplicateTransaction | null;
}

export default function DuplicateReview({
  initialPairs,
  initialConfirmed,
}: Readonly<{
  initialPairs?: DuplicatePair[];
  initialConfirmed?: ConfirmedDuplicate[];
}>) {
  const [pairs, setPairs] = useState(initialPairs ?? []);
  const [confirmed, setConfirmed] = useState(initialConfirmed ?? []);
  const [loaded, setLoaded] = useState(initialPairs !== undefined || initialConfirmed !== undefined);
  const [keepBySubject, setKeepBySubject] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialPairs !== undefined || initialConfirmed !== undefined) return;
    let active = true;
    fetch("/api/transactions/duplicates")
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("load failed")))
      .then((payload) => {
        if (!active) return;
        setPairs((payload.pairs ?? []) as DuplicatePair[]);
        setConfirmed((payload.confirmed ?? []) as ConfirmedDuplicate[]);
      })
      .catch(() => {
        if (active) setError("Could not load duplicate review.");
      })
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [initialConfirmed, initialPairs]);

  async function decide(pair: DuplicatePair, decision: "confirmed" | "dismissed") {
    const keptId = keepBySubject[pair.subjectId];
    if (decision === "confirmed" && !keptId) return;
    const kept = keptId === pair.second.id ? pair.second : pair.first;
    const excluded = kept.id === pair.first.id ? pair.second : pair.first;
    setError(null);
    setBusyId(pair.subjectId);
    try {
      const response = await fetch("/api/transactions/duplicates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          subjectId: pair.subjectId,
          keptTransactionId: kept.id,
          excludedTransactionId: excluded.id,
          decision,
        }),
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? "Could not save duplicate decision.");
      setPairs((rows) => rows.filter((row) => row.subjectId !== pair.subjectId));
      if (decision === "confirmed") {
        setConfirmed((rows) => [{ subjectId: pair.subjectId, kept, excluded }, ...rows]);
      }
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : "Could not save duplicate decision.");
    } finally {
      setBusyId(null);
    }
  }

  async function undo(link: ConfirmedDuplicate) {
    setError(null);
    setBusyId(link.subjectId);
    try {
      const response = await fetch(
        `/api/transactions/duplicates/${encodeURIComponent(link.subjectId)}`,
        { method: "DELETE" },
      );
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? "Could not undo duplicate link.");
      setConfirmed((rows) => rows.filter((row) => row.subjectId !== link.subjectId));
      if (link.kept && link.excluded) {
        setPairs((rows) => [{
          subjectId: link.subjectId,
          first: link.kept!,
          second: link.excluded!,
          dateDistanceDays: 0,
        }, ...rows]);
      }
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : "Could not undo duplicate link.");
    } finally {
      setBusyId(null);
    }
  }

  if (!loaded || (pairs.length === 0 && confirmed.length === 0 && !error)) return null;

  return (
    <Panel title="Duplicate review" eyebrow="Cross-account matches">
      <div className="space-y-4">
        {pairs.map((pair) => (
          <fieldset key={pair.subjectId} className="rounded-field border border-panel-border bg-panel-2 p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-muted">
              Choose the transaction to keep
            </legend>
            <div className="grid gap-2 md:grid-cols-2">
              {[pair.first, pair.second].map((transaction) => (
                <label key={transaction.id} className="flex min-h-11 cursor-pointer gap-3 rounded-field border border-panel-border bg-panel p-3 text-sm">
                  <input
                    type="radio"
                    aria-label={`Keep ${transaction.merchant} from ${transaction.accountName}`}
                    name={`keep-${pair.subjectId}`}
                    value={transaction.id}
                    checked={keepBySubject[pair.subjectId] === transaction.id}
                    onChange={() => setKeepBySubject((value) => ({ ...value, [pair.subjectId]: transaction.id }))}
                  />
                  <span>
                    <span className="block font-semibold">{transaction.merchant}</span>
                    <span className="block text-xs text-muted">
                      {transaction.accountName} · {transaction.date} · {formatCurrency(transaction.amount)}
                    </span>
                    <span className="mt-1 block text-xs font-semibold text-accent">Keep this transaction</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <Button
                size="sm"
                variant="secondary"
                loading={busyId === pair.subjectId}
                onClick={() => void decide(pair, "dismissed")}
              >
                Dismiss
              </Button>
              <Button
                size="sm"
                disabled={!keepBySubject[pair.subjectId]}
                loading={busyId === pair.subjectId}
                onClick={() => void decide(pair, "confirmed")}
              >
                Confirm duplicate
              </Button>
            </div>
          </fieldset>
        ))}

        {confirmed.map((link) => (
          <div key={link.subjectId} className="flex flex-wrap items-center justify-between gap-3 rounded-field border border-panel-border bg-panel-2 p-3 text-sm">
            <span>
              <span className="block font-semibold">Excluded duplicate</span>
              <span className="block text-xs text-muted">
                {link.excluded?.merchant ?? "Transaction"} remains visible but is excluded from totals.
              </span>
            </span>
            <Button
              size="sm"
              variant="secondary"
              loading={busyId === link.subjectId}
              onClick={() => void undo(link)}
            >
              Undo
            </Button>
          </div>
        ))}
      </div>
      {error && <output className="mt-3 block text-sm text-danger">{error}</output>}
    </Panel>
  );
}
