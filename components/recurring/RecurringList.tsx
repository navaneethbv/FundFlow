"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatCurrency, formatDay } from "@/lib/format";
import type { RecurringOccurrence } from "@/lib/recurring-page";
import type { ManualRecurringItemRow, RecurringStreamRow } from "@/lib/recurring-data";

const MANUAL_FREQUENCY_OPTIONS = [
  { value: "weekly", label: "Every week" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "monthly", label: "Every month" },
  { value: "quarterly", label: "Every quarter" },
  { value: "yearly", label: "Every year" },
] as const;

type ManualFrequency = (typeof MANUAL_FREQUENCY_OPTIONS)[number]["value"];

function manualFrequencyLabel(frequency: string): string {
  return MANUAL_FREQUENCY_OPTIONS.find((option) => option.value === frequency)?.label ?? frequency;
}

/**
 * The exact `POST /api/recurring/manual` body shape for a new manual item,
 * translating the add-form's camelCase state into the route's expected
 * snake_case fields (see app/api/recurring/manual/route.ts's `parseCreate`).
 */
export function manualItemCreatePayload(input: {
  name: string;
  amount: number;
  frequency: ManualFrequency;
  nextDate: string;
  itemType: "income" | "expense";
}): { name: string; amount: number; frequency: ManualFrequency; next_date: string; item_type: "income" | "expense"; category: null } {
  return {
    name: input.name,
    amount: input.amount,
    frequency: input.frequency,
    next_date: input.nextDate,
    item_type: input.itemType,
    category: null,
  };
}

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

function ManualItemRow({
  item,
  currency,
  onToggleEnabled,
  onDelete,
  pending,
}: Readonly<{
  item: ManualRecurringItemRow;
  currency: string;
  onToggleEnabled: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  pending: boolean;
}>) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-t border-panel-border py-3 first:border-t-0">
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">{item.name}</span>
        <span className="text-xs text-muted">
          {formatDay(item.nextDate)} · {manualFrequencyLabel(item.frequency)} ·{" "}
          {item.itemType === "income" ? "+" : ""}
          {formatCurrency(item.amount, currency)}
        </span>
      </span>
      <span className="flex items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs font-semibold text-muted">
          <input
            type="checkbox"
            checked={item.enabled}
            disabled={pending}
            onChange={(event) => onToggleEnabled(item.id, event.target.checked)}
          />
          <span>Enabled</span>
        </label>
        <button
          type="button"
          disabled={pending}
          onClick={() => onDelete(item.id)}
          className="min-h-11 rounded-field border border-panel-border px-3 text-sm font-semibold"
        >
          Delete
        </button>
      </span>
    </li>
  );
}

function AddManualItemForm({
  onAdd,
  pending,
}: Readonly<{
  onAdd: (input: {
    name: string;
    amount: number;
    frequency: ManualFrequency;
    nextDate: string;
    itemType: "income" | "expense";
  }) => void;
  pending: boolean;
}>) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [frequency, setFrequency] = useState<ManualFrequency>("monthly");
  const [nextDate, setNextDate] = useState("");
  const [itemType, setItemType] = useState<"income" | "expense">("expense");
  const [formError, setFormError] = useState<string | null>(null);

  function handleSubmit(event: React.SyntheticEvent) {
    event.preventDefault();
    setFormError(null);
    const parsedAmount = Number(amount);
    if (!name.trim()) {
      setFormError("Enter a name.");
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setFormError("Enter an amount greater than 0.");
      return;
    }
    if (!nextDate) {
      setFormError("Pick a next due date.");
      return;
    }
    onAdd({ name: name.trim(), amount: parsedAmount, frequency, nextDate, itemType });
    setName("");
    setAmount("");
    setNextDate("");
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 flex flex-wrap items-end gap-2">
      <input
        aria-label="Manual item name"
        type="text"
        placeholder="Name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        disabled={pending}
        className="min-h-11 min-w-0 flex-1 rounded-field border border-panel-border bg-background px-3"
      />
      <input
        aria-label="Manual item amount"
        type="number"
        min="0"
        step="0.01"
        placeholder="Amount"
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        disabled={pending}
        className="min-h-11 w-24 rounded-field border border-panel-border bg-background px-3 text-right"
      />
      <select
        aria-label="Manual item frequency"
        value={frequency}
        onChange={(event) => setFrequency(event.target.value as ManualFrequency)}
        disabled={pending}
        className="min-h-11 rounded-field border border-panel-border bg-background px-3"
      >
        {MANUAL_FREQUENCY_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <input
        aria-label="Manual item next due date"
        type="date"
        value={nextDate}
        onChange={(event) => setNextDate(event.target.value)}
        disabled={pending}
        className="min-h-11 rounded-field border border-panel-border bg-background px-3"
      />
      <select
        aria-label="Manual item type"
        value={itemType}
        onChange={(event) => setItemType(event.target.value as "income" | "expense")}
        disabled={pending}
        className="min-h-11 rounded-field border border-panel-border bg-background px-3"
      >
        <option value="expense">Expense</option>
        <option value="income">Income</option>
      </select>
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 rounded-field bg-accent px-3 text-sm font-semibold text-accent-foreground"
      >
        Add
      </button>
      {formError && <p className="w-full text-xs font-semibold text-danger">{formError}</p>}
    </form>
  );
}

export default function RecurringList({
  occurrences,
  streams,
  manualItems,
  currency,
}: Readonly<{
  occurrences: RecurringOccurrence[];
  streams: RecurringStreamRow[];
  manualItems: ManualRecurringItemRow[];
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

  async function mutateManualItem(request: () => Promise<Response>) {
    setError(null);
    try {
      const response = await request();
      if (!response.ok) {
        setError("That update didn't save. Try again.");
        return;
      }
      router.refresh();
    } catch {
      setError("That update didn't save. Try again.");
    }
  }

  function handleManualToggle(id: string, enabled: boolean) {
    startTransition(async () => {
      await mutateManualItem(() =>
        fetch("/api/recurring/manual", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, enabled }),
        }),
      );
    });
  }

  function handleManualDelete(id: string) {
    startTransition(async () => {
      await mutateManualItem(() =>
        fetch("/api/recurring/manual", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        }),
      );
    });
  }

  function handleManualAdd(input: {
    name: string;
    amount: number;
    frequency: ManualFrequency;
    nextDate: string;
    itemType: "income" | "expense";
  }) {
    startTransition(async () => {
      await mutateManualItem(() =>
        fetch("/api/recurring/manual", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(manualItemCreatePayload(input)),
        }),
      );
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
        <>
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
          <div className="mt-6 border-t border-panel-border pt-4">
            <h3 className="text-sm font-semibold">Manual items</h3>
            <ul>
              {manualItems.length === 0 ? (
                <p className="py-3 text-sm text-muted">No manual items yet.</p>
              ) : (
                manualItems.map((item) => (
                  <ManualItemRow
                    key={item.id}
                    item={item}
                    currency={currency}
                    pending={isPending}
                    onToggleEnabled={handleManualToggle}
                    onDelete={handleManualDelete}
                  />
                ))
              )}
            </ul>
            <AddManualItemForm pending={isPending} onAdd={handleManualAdd} />
          </div>
        </>
      )}
    </div>
  );
}
