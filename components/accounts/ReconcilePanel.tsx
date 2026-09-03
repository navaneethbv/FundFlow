"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import Input from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";
import Select from "@/components/ui/Select";
import { computeReconciliation, type ReconcileTransaction } from "@/lib/reconcile";
import { localDateKey } from "@/lib/format-date";

export interface ReconcileAccountOption {
  ref: string; // "plaid:<id>" | "manual:<id>"
  name: string;
}

interface PreviewResponse {
  account: { ref: string; name: string };
  bookBalance: number;
  direction: 1 | -1;
  sinceDate: string;
  statementDate: string;
  transactions: ReconcileTransaction[];
  totals: {
    clearedTotal: number;
    outstandingTotal: number;
    difference: number;
    clearedCount: number;
    outstandingCount: number;
    balanced: boolean;
  };
}

const money = (value: number) =>
  value.toLocaleString("en-US", { style: "currency", currency: "USD" });

/**
 * Per-account statement reconcile: enter the statement's ending balance and
 * date, toggle transactions cleared, and see cleared / outstanding / the
 * difference. Saving persists cleared flags, records the statement, and —
 * when the difference is nonzero — offers a manual balance-adjustment entry
 * (the bank is right; the ledger gets an audited correction).
 */
export default function ReconcilePanel({
  accounts,
}: Readonly<{ accounts: ReconcileAccountOption[] }>) {
  const [open, setOpen] = useState(false);
  const [accountRef, setAccountRef] = useState(accounts[0]?.ref ?? "");
  const [statementBalance, setStatementBalance] = useState("");
  const [statementDate, setStatementDate] = useState(localDateKey());
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [clearedIds, setClearedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  async function loadPreview() {
    if (!accountRef) return;
    setError(null);
    setSaved(null);
    setLoading(true);
    try {
      const params = new URLSearchParams({ account: accountRef, statement_date: statementDate });
      const res = await fetch(`/api/accounts/reconcile?${params.toString()}`);
      const json = (await res.json().catch(() => null)) as
        | (PreviewResponse & { error?: string })
        | null;
      if (!res.ok || !json) {
        setError(json?.error ?? "Could not load the account for reconciliation.");
        return;
      }
      setPreview(json);
      setClearedIds(new Set(json.transactions.filter((t) => t.cleared).map((t) => t.id)));
    } finally {
      setLoading(false);
    }
  }

  function toggle(id: string) {
    setClearedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save(withAdjustment: boolean) {
    if (!preview) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/accounts/reconcile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          account: accountRef,
          statement_date: statementDate,
          statement_balance: Number(statementBalance),
          cleared_ids: [...clearedIds],
          ...(withAdjustment ? { adjustment_note: "Balance adjustment" } : {}),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        difference?: number;
        adjustment_amount?: number;
      };
      if (!res.ok) {
        setError(json.error ?? "Could not save the reconciliation.");
        return;
      }
      setSaved(
        `Reconciled. Difference ${money(json.difference ?? 0)}` +
          (json.adjustment_amount
            ? ` · adjustment entry of ${money(Math.abs(json.adjustment_amount))} recorded`
            : ""),
      );
      setPreview(null);
    } finally {
      setSaving(false);
    }
  }

  const balance = Number(statementBalance);
  const balanceValid = preview !== null && statementBalance !== "" && Number.isFinite(balance);
  const live = (() => {
    if (!preview || !balanceValid) return null;
    // Same computation the server persists, run live as the user toggles rows.
    const totals = computeReconciliation({
      direction: preview.direction,
      bookBalance: preview.bookBalance,
      statementBalance: balance,
      statementDate,
      transactions: preview.transactions.map((t) => ({
        ...t,
        cleared: clearedIds.has(t.id),
      })),
    });
    return { totals };
  })();

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)} disabled={accounts.length === 0}>
        Reconcile an account
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} placement="sheet" titleId="reconcile-title">
        <h2 id="reconcile-title" className="text-lg font-bold">
          Reconcile an account
        </h2>
        <p className="mt-1 text-sm text-muted">
          Enter the ending balance from your bank statement, mark its transactions cleared,
          and save. A nonzero difference means something is missing, duplicated, or mis-dated.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Field label="Account" htmlFor="reconcile-account">
            <Select
              id="reconcile-account"
              value={accountRef}
              onChange={(e) => {
                setAccountRef(e.target.value);
                setPreview(null);
              }}
            >
              {accounts.map((a) => (
                <option key={a.ref} value={a.ref}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Statement date" htmlFor="reconcile-date">
            <Input
              id="reconcile-date"
              type="date"
              value={statementDate}
              onChange={(e) => setStatementDate(e.target.value)}
            />
          </Field>
          <Field label="Statement ending balance" htmlFor="reconcile-balance">
            <Input
              id="reconcile-balance"
              type="number"
              step="0.01"
              value={statementBalance}
              onChange={(e) => setStatementBalance(e.target.value)}
            />
          </Field>
        </div>

        <div className="mt-3">
          <Button variant="secondary" onClick={() => void loadPreview()} loading={loading}>
            {preview ? "Reload" : "Load transactions"}
          </Button>
        </div>

        {preview && (
          <>
            <ul className="mt-4 max-h-72 divide-y divide-panel-border overflow-y-auto rounded-field border border-panel-border">
              {preview.transactions.map((txn) => (
                <li key={txn.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <label className="flex min-w-0 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={clearedIds.has(txn.id)}
                      onChange={() => toggle(txn.id)}
                    />
                    <span className="min-w-0 truncate">
                      {txn.merchant} <span className="text-muted">{txn.date}</span>
                    </span>
                  </label>
                  <span data-money className="money shrink-0">
                    {money(txn.amount)}
                  </span>
                </li>
              ))}
              {preview.transactions.length === 0 && (
                <li className="px-3 py-4 text-sm text-muted">No transactions in this period.</li>
              )}
            </ul>

            {live && (
              <div className="mt-3 space-y-1 text-sm">
                <p>
                  Cleared: <span data-money className="money">{money(live.totals.clearedTotal)}</span>{" "}
                  ({live.totals.clearedCount})
                  {" · "}Outstanding:{" "}
                  <span data-money className="money">{money(live.totals.outstandingTotal)}</span>{" "}
                  ({live.totals.outstandingCount})
                </p>
                <p className={live.totals.balanced ? "text-muted" : "font-semibold text-warning"}>
                  Difference from statement:{" "}
                  <span data-money className="money">{money(live.totals.difference)}</span>
                </p>
                {!live.totals.balanced && (
                  <p className="text-xs text-muted">
                    Saving records a manual balance-adjustment entry of{" "}
                    {money(Math.abs(live.totals.difference))} so the ledger matches the bank.
                  </p>
                )}
              </div>
            )}

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Close
              </Button>
              <Button
                onClick={() => void save(false)}
                disabled={saving || !balanceValid}
                loading={saving}
              >
                Save reconciliation
              </Button>
            </div>
          </>
        )}

        {saved && <output className="mt-3 block text-sm text-muted">{saved}</output>}
        {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
      </Modal>
    </>
  );
}
