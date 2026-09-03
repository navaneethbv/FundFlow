"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import Input from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";
import Select from "@/components/ui/Select";
import { Calendar } from "@/components/ui/icons";
import { localDateKey } from "@/lib/format-date";
import type { AddTransactionAccountOption } from "@/components/transactions/AddTransactionModal";

export interface ScheduledEntry {
  id: string;
  kind: "debit" | "credit";
  amount: number;
  merchant: string;
  date: string;
  category: string | null;
  notes: string | null;
  accountId: string | null;
  manualAccountId: string | null;
  status: string;
}

interface FormState {
  kind: "debit" | "credit";
  amount: string;
  merchant: string;
  date: string;
  accountKey: string;
  category: string;
  notes: string;
}

function submitLabel(submitting: boolean, editing: unknown): string {
  if (submitting) return "Saving…";
  return editing ? "Save" : "Schedule";
}

function emptyForm(accounts: AddTransactionAccountOption[]): FormState {
  return {
    kind: "debit",
    amount: "",
    merchant: "",
    date: localDateKey(),
    accountKey: accounts[0] ? `${accounts[0].source}:${accounts[0].id}` : "",
    category: "",
    notes: "",
  };
}

function formFromEntry(entry: ScheduledEntry, accounts: AddTransactionAccountOption[]): FormState {
  let accountKey = "";
  if (entry.accountId) {
    accountKey = `plaid:${entry.accountId}`;
  } else if (entry.manualAccountId) {
    accountKey = `manual:${entry.manualAccountId}`;
  } else if (accounts[0]) {
    accountKey = `${accounts[0].source}:${accounts[0].id}`;
  }

  return {
    kind: entry.kind,
    amount: String(entry.amount),
    merchant: entry.merchant,
    date: entry.date,
    accountKey,
    category: entry.category ?? "",
    notes: entry.notes ?? "",
  };
}

function accountRef(accountKey: string): { source: "plaid" | "manual"; id: string } | null {
  const [source, id] = accountKey.split(":");
  if ((source === "plaid" || source === "manual") && id) return { source, id };
  return null;
}

function formatDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Create/edit/cancel for one-off scheduled (future-dated) transactions, beside
 * the Add transaction modal. Entries project into the cash-flow forecast and
 * bill calendar today and materialize in the ledger when the daily sync
 * promotes them on their date.
 */
export default function ScheduledTransactionsSection({
  accounts,
  categories = [],
}: Readonly<{
  accounts: AddTransactionAccountOption[];
  categories?: string[];
}>) {
  const router = useRouter();
  const [entries, setEntries] = useState<ScheduledEntry[] | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ScheduledEntry | null>(null);
  const [form, setForm] = useState<FormState>(() => emptyForm(accounts));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const reload = useCallback(async () => {
    try {
      const response = await fetch("/api/scheduled-transactions");
      const payload = (await response.json().catch(() => null)) as
        | { scheduled?: ScheduledEntry[] }
        | null;
      setEntries(payload?.scheduled ?? []);
    } catch {
      setEntries([]);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/scheduled-transactions")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("load failed"))))
      .then((payload) => {
        if (cancelled) return;
        setEntries(((payload ?? {}) as { scheduled?: ScheduledEntry[] }).scheduled ?? []);
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm(accounts));
    setError(null);
    setOpen(true);
  }

  function openEdit(entry: ScheduledEntry) {
    setEditing(entry);
    setForm(formFromEntry(entry, accounts));
    setError(null);
    setOpen(true);
  }

  async function submit(event: React.SyntheticEvent) {
    event.preventDefault();
    setError(null);
    const account = accountRef(form.accountKey);
    if (!account) {
      setError("Choose an account.");
      return;
    }
    setSubmitting(true);
    try {
      const body = {
        kind: form.kind,
        amount: Number(form.amount),
        merchant: form.merchant,
        date: form.date,
        account,
        category: form.category || null,
        notes: form.notes || null,
      };
      const response = await fetch("/api/scheduled-transactions", {
        method: editing ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(editing ? { ...body, id: editing.id } : body),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Could not save the scheduled transaction.");
        return;
      }
      setOpen(false);
      await reload();
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  async function cancel(id: string) {
    setSubmitting(true);
    try {
      await fetch("/api/scheduled-transactions", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      await reload();
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  const sorted = (entries ?? []).toSorted((a, b) => a.date.localeCompare(b.date));

  return (
    <section aria-label="Scheduled transactions" className="mb-4">
      <div className="flex items-center gap-2">
        <Button variant="secondary" onClick={openCreate}>
          <Calendar aria-hidden className="h-4 w-4" />
          Schedule
        </Button>
        {entries !== null && entries.length > 0 && (
          <span className="text-sm text-muted">
            {entries.length} upcoming
          </span>
        )}
      </div>

      {sorted.length > 0 && (
        <ul className="mt-2 divide-y divide-panel-border rounded-field border border-panel-border">
          {sorted.map((entry) => (
            <li key={entry.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0 text-sm">
                <span className="font-semibold">{entry.merchant}</span>{" "}
                <span className="text-muted">
                  {formatDate(entry.date)} · {entry.kind === "debit" ? "out" : "in"}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span data-money className="money text-sm">
                  {entry.kind === "debit" ? "" : "-"}
                  {entry.amount.toFixed(2)}
                </span>
                <Button variant="ghost" size="sm" onClick={() => openEdit(entry)}>
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={submitting}
                  onClick={() => void cancel(entry.id)}
                >
                  Cancel
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal open={open} onClose={() => setOpen(false)} placement="sheet" titleId="schedule-txn-title">
        <h2 id="schedule-txn-title" className="text-lg font-bold">
          {editing ? "Edit scheduled transaction" : "Schedule a transaction"}
        </h2>
        <p className="mt-1 text-sm text-muted">
          It appears in your forecast and bill calendar now, and in the ledger on its date.
        </p>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <div className="flex gap-2">
            <Button
              type="button"
              variant={form.kind === "debit" ? "primary" : "secondary"}
              onClick={() => setForm({ ...form, kind: "debit" })}
            >
              Debit (money out)
            </Button>
            <Button
              type="button"
              variant={form.kind === "credit" ? "primary" : "secondary"}
              onClick={() => setForm({ ...form, kind: "credit" })}
            >
              Credit (money in)
            </Button>
          </div>
          <Field label="Amount" htmlFor="schedule-txn-amount">
            <Input
              id="schedule-txn-amount"
              type="number"
              step="any"
              min="0"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              required
            />
          </Field>
          <Field label="Merchant" htmlFor="schedule-txn-merchant">
            <Input
              id="schedule-txn-merchant"
              value={form.merchant}
              onChange={(e) => setForm({ ...form, merchant: e.target.value })}
              required
              maxLength={120}
            />
          </Field>
          <Field label="Date" htmlFor="schedule-txn-date">
            <Input
              id="schedule-txn-date"
              type="date"
              value={form.date}
              min={localDateKey()}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              required
            />
          </Field>
          <Field label="Account" htmlFor="schedule-txn-account">
            <Select
              id="schedule-txn-account"
              value={form.accountKey}
              onChange={(e) => setForm({ ...form, accountKey: e.target.value })}
            >
              {accounts.map((a) => (
                <option key={`${a.source}:${a.id}`} value={`${a.source}:${a.id}`}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Category (optional)" htmlFor="schedule-txn-category">
            <Input
              id="schedule-txn-category"
              list="schedule-txn-categories"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            />
            <datalist id="schedule-txn-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <Field label="Notes (optional)" htmlFor="schedule-txn-notes">
            <Input
              id="schedule-txn-notes"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              maxLength={500}
            />
          </Field>
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitLabel(submitting, editing)}
            </Button>
          </div>
        </form>
      </Modal>
    </section>
  );
}
