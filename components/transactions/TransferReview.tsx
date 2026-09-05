"use client";

import { useEffect, useRef, useState } from "react";
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

export function getTransferSelectionState(
  pairs: ReadonlyArray<Pick<TransferPair, "subject_id">>,
  selectedIds: ReadonlySet<string>,
) {
  const selectedCount = pairs.reduce(
    (count, pair) => count + (selectedIds.has(pair.subject_id) ? 1 : 0),
    0,
  );
  return {
    selectedCount,
    allSelected: pairs.length > 0 && selectedCount === pairs.length,
    indeterminate: selectedCount > 0 && selectedCount < pairs.length,
  };
}

export function toggleTransferSelection(
  selectedIds: ReadonlySet<string>,
  subjectId: string,
): Set<string> {
  const next = new Set(selectedIds);
  if (next.has(subjectId)) next.delete(subjectId);
  else next.add(subjectId);
  return next;
}

export function selectAllTransferSuggestions(
  pairs: ReadonlyArray<Pick<TransferPair, "subject_id">>,
  selectAll: boolean,
): Set<string> {
  return selectAll ? new Set(pairs.map((pair) => pair.subject_id)) : new Set();
}

export function areTransferReviewActionsDisabled(busyIds: ReadonlySet<string>): boolean {
  return busyIds.size > 0;
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
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const selectionState = getTransferSelectionState(pairs, selectedIds);
  const actionsDisabled = areTransferReviewActionsDisabled(busyIds);

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

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = selectionState.indeterminate;
    }
  }, [selectionState.indeterminate]);

  function removePairs(subjectIds: ReadonlySet<string>) {
    setPairs((current) => current.filter((row) => !subjectIds.has(row.subject_id)));
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const subjectId of subjectIds) next.delete(subjectId);
      return next;
    });
  }

  function setBusy(subjectIds: ReadonlySet<string>, busy: boolean) {
    setBusyIds((current) => {
      const next = new Set(current);
      for (const subjectId of subjectIds) {
        if (busy) next.add(subjectId);
        else next.delete(subjectId);
      }
      return next;
    });
  }

  async function submitDecision(pair: TransferPair, decision: "confirmed" | "dismissed") {
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
      const message = json.error ?? "Could not save decision.";
      throw new Error(
        res.status === 429
          ? "Too many individual link requests. Select the remaining transfers and use Link selected."
          : message,
      );
    }
  }

  async function decide(pair: TransferPair, decision: "confirmed" | "dismissed") {
    setError(null);
    const subjectIds = new Set([pair.subject_id]);
    setBusy(subjectIds, true);
    try {
      await submitDecision(pair, decision);
      removePairs(subjectIds);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save decision.");
    } finally {
      setBusy(subjectIds, false);
    }
  }

  async function linkSelected() {
    const selectedPairs = pairs.filter((pair) => selectedIds.has(pair.subject_id));
    if (selectedPairs.length === 0) return;

    const subjectIds = new Set(selectedPairs.map((pair) => pair.subject_id));
    setError(null);
    setBulkBusy(true);
    setBusy(subjectIds, true);
    try {
      const res = await fetch("/api/transactions/transfers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          decision: "confirmed",
          transfers: selectedPairs.map((pair) => ({
            subject_id: pair.subject_id,
            out_id: pair.out_id,
            in_id: pair.in_id,
          })),
        }),
      });
      const json = await res.json().catch(() => null) as {
        linked?: unknown;
        failures?: unknown;
        error?: unknown;
      } | null;
      if (!res.ok) {
        throw new Error(
          res.status === 429
            ? "Bulk linking is temporarily limited. Try again later."
            : typeof json?.error === "string"
              ? json.error
              : "Could not link selected transfers.",
        );
      }

      const linkedIds = Array.isArray(json?.linked)
        ? json.linked.filter(
          (subjectId): subjectId is string =>
            typeof subjectId === "string" && subjectIds.has(subjectId),
        )
        : [];
      const failureCount = Array.isArray(json?.failures) ? json.failures.length : 0;
      removePairs(new Set(linkedIds));
      if (failureCount > 0) {
        setError(
          `${linkedIds.length} transfer${linkedIds.length === 1 ? "" : "s"} linked. ` +
          `${failureCount} could not be linked. Review the remaining rows and try again.`,
        );
      }
      if (linkedIds.length > 0) router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not link selected transfers.");
    } finally {
      setBusy(subjectIds, false);
      setBulkBusy(false);
    }
  }

  const { selectedCount, allSelected } = selectionState;

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
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-panel-border pb-3">
            <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-xs font-medium text-muted">
              <input
                ref={selectAllRef}
                type="checkbox"
                checked={allSelected}
                disabled={actionsDisabled}
                onChange={() => {
                  setSelectedIds(selectAllTransferSuggestions(pairs, !allSelected));
                }}
                className="h-4 w-4 accent-accent"
                aria-label="Select all transfer suggestions"
              />
              Select all
            </label>
            <Button
              size="sm"
              onClick={() => {
                void linkSelected();
              }}
              disabled={selectedCount === 0 || actionsDisabled}
              loading={bulkBusy}
            >
              {allSelected ? `Link all transfers (${selectedCount})` : `Link selected (${selectedCount})`}
            </Button>
          </div>
          {pairs.map((pair) => (
            <div
              key={pair.subject_id}
              className="flex flex-col gap-3 rounded-field bg-panel-2 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-start gap-3">
                <input
                  type="checkbox"
                  checked={selectedIds.has(pair.subject_id)}
                  disabled={actionsDisabled}
                  onChange={() => {
                    setSelectedIds((current) => toggleTransferSelection(current, pair.subject_id));
                  }}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
                  aria-label={`Select transfer from ${pair.out_account_name || "Account A"} to ${pair.in_account_name || "Account B"}`}
                />
                <div className="min-w-0 text-xs">
                  <div className="flex flex-wrap items-center gap-2 font-medium">
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
              </div>
              <ReviewItemActions
                id={pair.subject_id}
                busyId={busyIds.has(pair.subject_id) ? pair.subject_id : null}
                confirmLabel="Link transfer"
                disabled={actionsDisabled}
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
