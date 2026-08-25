"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { InstitutionAvatar, MerchantAvatar } from "@/components/ui/Avatar";
import CategoryChip from "@/components/ui/CategoryChip";
import { CheckCircle2 } from "@/components/ui/icons";
import Tabs from "@/components/ui/Tabs";
import { daysUntil, formatDueAnnotation } from "@/lib/format-date";
import { formatCurrency, formatDay, titleCase } from "@/lib/format";
import type { RecurringOccurrence } from "@/lib/recurring-page";
import type { ManualRecurringItemRow, RecurringStreamRow } from "@/lib/recurring-data";

export type RecurringTab = "upcoming" | "complete" | "manage";

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

/**
 * The per-row `⋯` menu on an Upcoming/Complete table row — Monarch surfaces
 * Confirm/Not recurring/Restore and the amount correction directly on the
 * occurrence row rather than only in a separate management list. A shared,
 * non-owned Plaid stream renders read-only text instead of a menu (the
 * caller can only mutate their own streams — see `stream.isOwn` below); a
 * manual item's row gets an Enabled toggle + Delete instead.
 */
function OccurrenceRowMenu({
  occurrence,
  stream,
  manualItem,
  pending,
  onReview,
  onDismiss,
  onRestore,
  onCorrectAmount,
  onToggleManualEnabled,
  onDeleteManualItem,
}: Readonly<{
  occurrence: RecurringOccurrence;
  stream: RecurringStreamRow | undefined;
  manualItem: ManualRecurringItemRow | undefined;
  pending: boolean;
  onReview: (id: string) => void;
  onDismiss: (id: string) => void;
  onRestore: (id: string) => void;
  onCorrectAmount: (id: string, amount: number) => void;
  onToggleManualEnabled: (id: string, enabled: boolean) => void;
  onDeleteManualItem: (id: string) => void;
}>) {
  const [open, setOpen] = useState(false);
  const initialAmount = stream?.userAmount != null ? String(stream.userAmount) : "";
  const [amount, setAmount] = useState(initialAmount);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (occurrence.source === "plaid" && stream?.isOwn !== true) {
    return <span className="text-xs text-muted">Shared · view only</span>;
  }
  if (occurrence.source === "manual" && !manualItem) return null;

  const needsReview =
    stream?.status === "MATURE" && !stream.dismissedAt && !stream.reviewedAt;

  return (
    <div className="relative inline-block">
      {open && (
        <button
          type="button"
          aria-hidden
          tabIndex={-1}
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 cursor-default"
        />
      )}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`More options for ${occurrence.merchant}`}
        className="inline-flex h-11 w-11 items-center justify-center rounded-full text-muted hover:bg-panel-hover hover:text-foreground focus-visible:outline-2"
      >
        <span aria-hidden className="text-lg leading-none">⋯</span>
      </button>
      {open && (
        <div
          role="menu"
          aria-label={`Options for ${occurrence.merchant}`}
          className="absolute right-0 z-40 mt-2 w-64 space-y-3 rounded-card border border-panel-border bg-panel p-3 shadow-float"
        >
          {occurrence.source === "plaid" && stream && (
            <>
              <label className="block text-xs font-semibold text-muted">
                Expected amount{" "}
                <input
                  aria-label={`Expected amount for ${occurrence.merchant}`}
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
                  className="mt-1 min-h-11 w-full rounded-field border border-panel-border bg-panel-2 px-2 text-right text-sm text-foreground"
                />
              </label>
              {needsReview && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      onReview(stream.id);
                      setOpen(false);
                    }}
                    className="min-h-11 flex-1 rounded-field bg-accent px-3 text-sm font-semibold text-accent-foreground"
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      onDismiss(stream.id);
                      setOpen(false);
                    }}
                    className="min-h-11 flex-1 rounded-field border border-panel-border px-3 text-sm font-semibold"
                  >
                    Not recurring
                  </button>
                </div>
              )}
              {stream.dismissedAt && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    onRestore(stream.id);
                    setOpen(false);
                  }}
                  className="min-h-11 w-full rounded-field border border-panel-border px-3 text-sm font-semibold"
                >
                  Restore
                </button>
              )}
            </>
          )}
          {occurrence.source === "manual" && manualItem && (
            <>
              <label className="flex min-h-11 items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={manualItem.enabled}
                  disabled={pending}
                  onChange={(event) => onToggleManualEnabled(manualItem.id, event.target.checked)}
                />
                {" "}Enabled
              </label>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  onDeleteManualItem(manualItem.id);
                  setOpen(false);
                }}
                className="min-h-11 w-full rounded-field border border-panel-border px-3 text-sm font-semibold"
              >
                Delete
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function OccurrenceTableRow({
  occurrence,
  currency,
  today,
  stream,
  manualItem,
  pending,
  onReview,
  onDismiss,
  onRestore,
  onCorrectAmount,
  onToggleManualEnabled,
  onDeleteManualItem,
}: Readonly<{
  occurrence: RecurringOccurrence;
  currency: string;
  today: string;
  stream: RecurringStreamRow | undefined;
  manualItem: ManualRecurringItemRow | undefined;
  pending: boolean;
  onReview: (id: string) => void;
  onDismiss: (id: string) => void;
  onRestore: (id: string) => void;
  onCorrectAmount: (id: string, amount: number) => void;
  onToggleManualEnabled: (id: string, enabled: boolean) => void;
  onDeleteManualItem: (id: string) => void;
}>) {
  return (
    <tr className="border-t border-panel-border">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <MerchantAvatar name={occurrence.merchant} size={32} className="shrink-0" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold">{occurrence.merchant}</span>
            <span className="text-xs text-muted">{occurrence.frequency}</span>
          </span>
        </div>
      </td>
      <td className="px-4 py-3 text-sm whitespace-nowrap">
        {formatDay(occurrence.dueDate)}
        {occurrence.status === "overdue" && (
          <span className="ml-1.5 text-xs font-semibold text-accent">
            ({formatDueAnnotation(daysUntil(occurrence.dueDate, today))})
          </span>
        )}
      </td>
      <td className="px-4 py-3">
        {occurrence.account ? (
          <div className="flex items-center gap-2">
            <InstitutionAvatar name={occurrence.account} size={24} className="shrink-0" />
            <span className="truncate text-sm">{occurrence.account}</span>
          </div>
        ) : (
          <span className="text-sm text-muted">—</span>
        )}
      </td>
      <td className="px-4 py-3">
        {occurrence.category ? (
          <CategoryChip label={titleCase(occurrence.category)} />
        ) : (
          <span className="text-sm text-muted">—</span>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        <span className="inline-flex items-center justify-end gap-1.5">
          {occurrence.status === "complete" && (
            <CheckCircle2 aria-hidden className="h-4 w-4 text-success" />
          )}
          <span data-money className={`metric-value text-sm ${occurrence.isIncome ? "text-success" : ""}`}>
            {occurrence.isIncome ? "+" : ""}
            {formatCurrency(occurrence.amount, currency)}
          </span>
        </span>
      </td>
      <td className="px-2 py-3 text-right">
        <OccurrenceRowMenu
          occurrence={occurrence}
          stream={stream}
          manualItem={manualItem}
          pending={pending}
          onReview={onReview}
          onDismiss={onDismiss}
          onRestore={onRestore}
          onCorrectAmount={onCorrectAmount}
          onToggleManualEnabled={onToggleManualEnabled}
          onDeleteManualItem={onDeleteManualItem}
        />
      </td>
    </tr>
  );
}

/**
 * Upcoming/Complete render as real tables (merchant, date, payment account,
 * category, amount, actions) with a grey total band row, replacing the old
 * plain `<ul>` list — matching Monarch's occurrence tables.
 */
function OccurrenceTable({
  occurrences,
  currency,
  today,
  totalLabel,
  emptyLabel,
  streamById,
  manualById,
  pending,
  onReview,
  onDismiss,
  onRestore,
  onCorrectAmount,
  onToggleManualEnabled,
  onDeleteManualItem,
}: Readonly<{
  occurrences: RecurringOccurrence[];
  currency: string;
  today: string;
  totalLabel: string;
  emptyLabel: string;
  streamById: Map<string, RecurringStreamRow>;
  manualById: Map<string, ManualRecurringItemRow>;
  pending: boolean;
  onReview: (id: string) => void;
  onDismiss: (id: string) => void;
  onRestore: (id: string) => void;
  onCorrectAmount: (id: string, amount: number) => void;
  onToggleManualEnabled: (id: string, enabled: boolean) => void;
  onDeleteManualItem: (id: string) => void;
}>) {
  if (occurrences.length === 0) {
    return <p className="py-6 text-sm text-muted">{emptyLabel}</p>;
  }

  const total = occurrences.reduce((sum, occurrence) => sum + occurrence.amount, 0);

  return (
    // `relative` is load-bearing, not decoration. The Actions column header is
    // an `sr-only` span, which Tailwind implements as `position: absolute`. A
    // static scroll container is not a containing block, so that span was
    // positioned against the viewport instead and escaped the clip entirely —
    // sitting at x=1013 on a 390px phone and giving the whole *page* 623px of
    // horizontal scroll while the table itself scrolled correctly.
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="bg-panel-2 text-xs text-muted">
          <tr>
            <th scope="col" className="px-4 py-3 text-left">Merchant</th>
            <th scope="col" className="px-4 py-3 text-left">Date</th>
            <th scope="col" className="px-4 py-3 text-left">Payment Account</th>
            <th scope="col" className="px-4 py-3 text-left">Category</th>
            <th scope="col" className="px-4 py-3 text-right">Amount</th>
            <th scope="col" className="px-2 py-3 text-right">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {occurrences.map((occurrence, index) => (
            <OccurrenceTableRow
              key={`${occurrence.sourceId}-${occurrence.dueDate}-${index}`}
              occurrence={occurrence}
              currency={currency}
              today={today}
              stream={occurrence.source === "plaid" ? streamById.get(occurrence.sourceId) : undefined}
              manualItem={occurrence.source === "manual" ? manualById.get(occurrence.sourceId) : undefined}
              pending={pending}
              onReview={onReview}
              onDismiss={onDismiss}
              onRestore={onRestore}
              onCorrectAmount={onCorrectAmount}
              onToggleManualEnabled={onToggleManualEnabled}
              onDeleteManualItem={onDeleteManualItem}
            />
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-panel-border bg-panel-2 font-semibold">
            <td className="px-4 py-3" colSpan={4}>
              {totalLabel} Total
            </td>
            <td data-money className="px-4 py-3 text-right">
              {formatCurrency(total, currency)}
            </td>
            <td className="px-2 py-3" />
          </tr>
        </tfoot>
      </table>
    </div>
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
  today,
  tab,
  links,
}: Readonly<{
  occurrences: RecurringOccurrence[];
  streams: RecurringStreamRow[];
  manualItems: ManualRecurringItemRow[];
  currency: string;
  today: string;
  tab: RecurringTab;
  links: Record<RecurringTab, string>;
}>) {
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

  const streamById = new Map(streams.map((stream) => [stream.id, stream]));
  const manualById = new Map(manualItems.map((item) => [item.id, item]));
  const upcoming = occurrences.filter((occurrence) => occurrence.status !== "complete");
  const complete = occurrences.filter((occurrence) => occurrence.status === "complete");

  const tableProps = {
    currency,
    today,
    streamById,
    manualById,
    pending: isPending,
    onReview: (id: string) => handle(id, "review"),
    onDismiss: (id: string) => handle(id, "dismiss"),
    onRestore: (id: string) => handle(id, "restore"),
    onCorrectAmount: (id: string, amount: number) => handle(id, "correct_amount", amount),
    onToggleManualEnabled: handleManualToggle,
    onDeleteManualItem: handleManualDelete,
  };

  return (
    <div>
      <Tabs
        items={[
          { label: `Upcoming (${upcoming.length})`, href: links.upcoming, active: tab === "upcoming" },
          { label: `Complete (${complete.length})`, href: links.complete, active: tab === "complete" },
          { label: `Manage (${streams.length})`, href: links.manage, active: tab === "manage" },
        ]}
      />
      {error && <p className="mt-3 text-sm font-semibold text-danger">{error}</p>}
      <div className="pt-4">
        {tab === "upcoming" && (
          <OccurrenceTable
            occurrences={upcoming}
            totalLabel="Upcoming"
            emptyLabel="Nothing upcoming this month."
            {...tableProps}
          />
        )}
        {tab === "complete" && (
          <OccurrenceTable
            occurrences={complete}
            totalLabel="Complete"
            emptyLabel="Nothing paid yet this month."
            {...tableProps}
          />
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
    </div>
  );
}
