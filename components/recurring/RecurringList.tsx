"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatCurrency, formatDay } from "@/lib/format";
import type { RecurringOccurrence } from "@/lib/recurring-page";
import type { RecurringStreamRow } from "@/lib/recurring-data";

const STATUS_LABEL: Record<RecurringOccurrence["status"], string> = {
  upcoming: "Upcoming",
  overdue: "Overdue",
  complete: "Paid",
};

const STATUS_TONE: Record<RecurringOccurrence["status"], string> = {
  upcoming: "text-muted",
  overdue: "text-danger",
  complete: "text-success",
};

/**
 * Whether a blurred amount field should trigger the `correct_amount` PATCH.
 * `initial` is the value the field was seeded with (the stream's existing
 * `userAmount`, or "" when there is none) — an untouched field, or one
 * cleared back to empty, must never write a permanent override for a value
 * the user never actually typed.
 */
export function shouldSubmitAmountCorrection(amount: string, initial: string): boolean {
  return amount.trim() !== "" && amount !== initial;
}

function OccurrenceRow({ occurrence, currency }: Readonly<{ occurrence: RecurringOccurrence; currency: string }>) {
  return (
    <li className="flex items-center justify-between gap-4 border-t border-panel-border py-3 first:border-t-0">
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">{occurrence.merchant}</span>
        <span className="text-xs text-muted">
          {formatDay(occurrence.dueDate)} · {occurrence.frequency}
          {occurrence.account ? ` · ${occurrence.account}` : ""}
        </span>
      </span>
      <span className="flex items-center gap-3">
        <span className={`text-xs font-semibold ${STATUS_TONE[occurrence.status]}`}>
          {STATUS_LABEL[occurrence.status]}
        </span>
        <span className={`metric-value text-sm ${occurrence.isIncome ? "text-success" : ""}`}>
          {occurrence.isIncome ? "+" : ""}
          {formatCurrency(occurrence.amount, currency)}
        </span>
      </span>
    </li>
  );
}

function ManageRow({
  stream,
  onReview,
  onDismiss,
  onRestore,
  onCorrectAmount,
  pending,
}: Readonly<{
  stream: RecurringStreamRow;
  onReview: (id: string) => void;
  onDismiss: (id: string) => void;
  onRestore: (id: string) => void;
  onCorrectAmount: (id: string, amount: number) => void;
  pending: boolean;
}>) {
  const initialAmount = stream.userAmount != null ? String(stream.userAmount) : "";
  const [amount, setAmount] = useState(initialAmount);
  const needsReview = stream.status === "MATURE" && !stream.dismissedAt && !stream.reviewedAt;

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-t border-panel-border py-3 first:border-t-0">
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">{stream.merchantName ?? stream.description ?? "Unknown"}</span>
        <span className="text-xs text-muted">
          {stream.accountName ?? "Unlinked account"}
          {stream.dismissedAt ? " · Not recurring" : ""}
        </span>
      </span>
      {stream.isOwn ? (
        <span className="flex items-center gap-2">
          <input
            aria-label={`Expected amount for ${stream.merchantName ?? "this stream"}`}
            type="number"
            min="0"
            step="0.01"
            value={amount}
            placeholder={stream.averageAmount != null ? String(stream.averageAmount) : undefined}
            onChange={(event) => setAmount(event.target.value)}
            onBlur={() => {
              if (!shouldSubmitAmountCorrection(amount, initialAmount)) return;
              const value = Number(amount);
              if (Number.isFinite(value) && value >= 0) onCorrectAmount(stream.id, value);
            }}
            disabled={pending}
            className="min-h-11 w-24 rounded-field border border-panel-border bg-background px-3 text-right"
          />
          {needsReview && (
            <>
              <button
                type="button"
                disabled={pending}
                onClick={() => onReview(stream.id)}
                className="min-h-11 rounded-field bg-accent px-3 text-sm font-semibold text-accent-foreground"
              >
                Confirm
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => onDismiss(stream.id)}
                className="min-h-11 rounded-field border border-panel-border px-3 text-sm font-semibold"
              >
                Not recurring
              </button>
            </>
          )}
          {stream.dismissedAt && (
            <button
              type="button"
              disabled={pending}
              onClick={() => onRestore(stream.id)}
              className="min-h-11 rounded-field border border-panel-border px-3 text-sm font-semibold"
            >
              Restore
            </button>
          )}
        </span>
      ) : (
        <span className="text-xs text-muted">Shared · view only</span>
      )}
    </li>
  );
}

export default function RecurringList({
  occurrences,
  streams,
  currency,
}: Readonly<{
  occurrences: RecurringOccurrence[];
  streams: RecurringStreamRow[];
  currency: string;
}>) {
  const [tab, setTab] = useState<"upcoming" | "complete" | "manage">("upcoming");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function patchStream(streamId: string, action: string, amount?: number) {
    setError(null);
    try {
      const response = await fetch("/api/recurring", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stream_id: streamId, action, amount }),
      });
      if (!response.ok) {
        setError("That update didn't save. Try again.");
        return;
      }
      // Server props (needsReview/dismissedAt/amount) only change on the
      // next render from the server, so a successful mutation needs an
      // explicit refresh or the Confirm/Dismiss/Restore buttons and the
      // corrected amount appear unchanged until a manual reload.
      router.refresh();
    } catch {
      setError("That update didn't save. Try again.");
    }
  }

  function handle(streamId: string, action: string, amount?: number) {
    startTransition(async () => {
      await patchStream(streamId, action, amount);
    });
  }

  const upcoming = occurrences.filter((occurrence) => occurrence.status !== "complete");
  const complete = occurrences.filter((occurrence) => occurrence.status === "complete");

  return (
    <div>
      <div className="mb-4 flex gap-1 text-xs font-semibold" role="tablist">
        {(
          [
            { key: "upcoming", label: `Upcoming (${upcoming.length})` },
            { key: "complete", label: `Complete (${complete.length})` },
            { key: "manage", label: `All (${streams.length})` },
          ] as const
        ).map((option) => (
          <button
            key={option.key}
            type="button"
            role="tab"
            aria-selected={tab === option.key}
            onClick={() => setTab(option.key)}
            className={
              tab === option.key
                ? "min-h-11 rounded-field bg-accent-soft px-3 text-accent"
                : "min-h-11 rounded-field px-3 text-muted hover:bg-panel-hover hover:text-foreground"
            }
          >
            {option.label}
          </button>
        ))}
      </div>
      {error && <p className="mb-3 text-sm font-semibold text-danger">{error}</p>}
      {tab === "upcoming" && (
        <ul>
          {upcoming.length === 0 ? (
            <p className="py-6 text-sm text-muted">Nothing upcoming this month.</p>
          ) : (
            upcoming.map((occurrence, index) => (
              <OccurrenceRow key={`${occurrence.sourceId}-${occurrence.dueDate}-${index}`} occurrence={occurrence} currency={currency} />
            ))
          )}
        </ul>
      )}
      {tab === "complete" && (
        <ul>
          {complete.length === 0 ? (
            <p className="py-6 text-sm text-muted">Nothing paid yet this month.</p>
          ) : (
            complete.map((occurrence, index) => (
              <OccurrenceRow key={`${occurrence.sourceId}-${occurrence.dueDate}-${index}`} occurrence={occurrence} currency={currency} />
            ))
          )}
        </ul>
      )}
      {tab === "manage" && (
        <ul>
          {streams.length === 0 ? (
            <p className="py-6 text-sm text-muted">No recurring streams detected yet.</p>
          ) : (
            streams.map((stream) => (
              <ManageRow
                key={stream.id}
                stream={stream}
                pending={isPending}
                onReview={(id) => handle(id, "review")}
                onDismiss={(id) => handle(id, "dismiss")}
                onRestore={(id) => handle(id, "restore")}
                onCorrectAmount={(id, amount) => handle(id, "correct_amount", amount)}
              />
            ))
          )}
        </ul>
      )}
    </div>
  );
}
