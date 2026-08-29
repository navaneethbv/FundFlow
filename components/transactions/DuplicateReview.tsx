"use client";

import { useEffect, useRef, useState } from "react";
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

/** How many full review forms render at once. One pair at a time keeps the
 *  ledger reachable even with dozens of candidates; the rest stay in state. */
const VISIBLE_PAIR_COUNT = 1;

/**
 * Duplicate review, rendered as progressive disclosure.
 *
 * A stack of dozens of full forms pushed the transaction ledger below the
 * fold, so only one candidate pair renders at a time. The header states how
 * many candidates remain, the status region announces the result of every
 * decision, and focus moves to the next candidate (or a completion message)
 * so the review can be driven entirely by keyboard. Nothing is discarded: the
 * pair list stays in state, one pair is just visible at a time.
 */
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
  const [status, setStatus] = useState<string | null>(null);
  const [focusVersion, setFocusVersion] = useState(0);
  const activeFieldsetRef = useRef<HTMLFieldSetElement>(null);

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

  // Move focus to the next candidate after a decision lands, or to the status
  // region when the queue empties. `focusVersion` bumps only on a decision, so
  // the first render never steals focus from the page.
  useEffect(() => {
    if (focusVersion === 0) return;
    if (pairs.length === 0) return;
    activeFieldsetRef.current?.querySelector<HTMLElement>("input[type=radio]")?.focus();
  }, [focusVersion, pairs]);

  const visiblePairs = pairs.slice(0, VISIBLE_PAIR_COUNT);
  const candidatesRemaining = pairs.length;
  const candidateNoun = candidatesRemaining === 1 ? "candidate" : "candidates";

  async function decide(pair: DuplicatePair, decision: "confirmed" | "dismissed") {
    const keptId = keepBySubject[pair.subjectId];
    if (decision === "confirmed" && !keptId) return;
    const kept = keptId === pair.second.id ? pair.second : pair.first;
    const excluded = kept.id === pair.first.id ? pair.second : pair.first;
    setError(null);
    setStatus(null);
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
      const remaining = candidatesRemaining - 1;
      if (remaining === 0) {
        setStatus("All duplicate candidates reviewed.");
      } else {
        const noun = remaining === 1 ? "candidate" : "candidates";
        const verb = decision === "confirmed" ? "Confirmed" : "Dismissed";
        setStatus(`${verb}. ${remaining} ${noun} remaining.`);
      }
      setFocusVersion((version) => version + 1);
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : "Could not save duplicate decision.");
    } finally {
      setBusyId(null);
    }
  }

  async function undo(link: ConfirmedDuplicate) {
    setError(null);
    setStatus(null);
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
        setFocusVersion((version) => version + 1);
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted">
            {pairs.length === 0
              ? "No duplicate candidates to review."
              : `${candidatesRemaining} duplicate ${candidateNoun} to review`}
          </p>
          <span
            data-duplicate-status
            role="status"
            aria-live="polite"
            className="text-xs font-semibold text-muted"
          >
            {status ?? ""}
          </span>
        </div>

        {visiblePairs.map((pair) => (
          <fieldset
            key={pair.subjectId}
            ref={activeFieldsetRef}
            data-duplicate-pair={pair.subjectId}
            className="rounded-field border border-panel-border bg-panel-2 p-3"
          >
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

        {confirmed.length > 0 && (
          <details className="rounded-field border border-panel-border bg-panel-2 p-3 text-sm">
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-muted">
              {confirmed.length} resolved duplicate{confirmed.length === 1 ? "" : "s"}
            </summary>
            <div className="mt-2 space-y-2">
              {confirmed.map((link) => (
                <div key={link.subjectId} className="flex flex-wrap items-center justify-between gap-3 rounded-field border border-panel-border bg-panel p-3 text-sm">
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
          </details>
        )}
      </div>
      {error && <output className="mt-3 block text-sm text-danger">{error}</output>}
    </Panel>
  );
}
