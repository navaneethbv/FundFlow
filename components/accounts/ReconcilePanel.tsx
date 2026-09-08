"use client";

import { useRef, useState } from "react";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import Input from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";
import Select from "@/components/ui/Select";
import { computeReconciliation, type ReconcileTransaction } from "@/lib/reconcile";
import { localDateKey } from "@/lib/format-date";
import { formatCurrency } from "@/lib/format";

export interface ReconcileAccountOption { ref: string; name: string }
interface PreviewResponse {
  needsOpeningBalance: boolean;
  account: { name: string };
  openingBalance: number;
  openingDate: string;
  statementDate: string;
  direction: 1 | -1;
  revision: string;
  transactions: ReconcileTransaction[];
}

export default function ReconcilePanel({ accounts }: Readonly<{ accounts: ReconcileAccountOption[] }>) {
  const [open, setOpen] = useState(false);
  const [accountRef, setAccountRef] = useState(accounts[0]?.ref ?? "");
  const [statementDate, setStatementDate] = useState(localDateKey());
  const [statementBalance, setStatementBalance] = useState("");
  const [openingDate, setOpeningDate] = useState("");
  const [openingBalance, setOpeningBalance] = useState("");
  const [needsOpening, setNeedsOpening] = useState(false);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [clearedIds, setClearedIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [createAdjustment, setCreateAdjustment] = useState(false);
  const requestId = useRef("");
  const generation = useRef(0);

  function invalidate() {
    generation.current += 1;
    setPreview(null);
    setCreateAdjustment(false);
    setError(null);
    setSaved(null);
  }
  function changeSelection(next: Set<string>) {
    setClearedIds(next);
    requestId.current = crypto.randomUUID();
  }
  async function loadPreview() {
    const current = ++generation.current;
    setPreview(null);
    setError(null);
    setSaved(null);
    setBusy(true);
    setCreateAdjustment(false);
    try {
      const params = new URLSearchParams({ account: accountRef, statement_date: statementDate });
      if (openingDate && openingBalance !== "") {
        params.set("opening_date", openingDate);
        params.set("opening_balance", openingBalance);
      }
      const response = await fetch(`/api/accounts/reconcile?${params}`);
      const data = await response.json();
      if (current !== generation.current) return;
      if (!response.ok) throw new Error(data.error ?? "Could not load the statement.");
      setNeedsOpening(data.needsOpeningBalance);
      if (!data.needsOpeningBalance) {
        setPreview(data);
        changeSelection(new Set(data.transactions.filter((row: ReconcileTransaction) => row.cleared).map((row: ReconcileTransaction) => row.id)));
      }
    } catch (cause) {
      if (current === generation.current) setError(cause instanceof Error ? cause.message : "Could not load the statement.");
    } finally { setBusy(false); }
  }
  const validBalance = statementBalance !== "" && Number.isFinite(Number(statementBalance));
  const totals = preview && validBalance ? computeReconciliation({
    bookBalance: preview.openingBalance, statementBalance: Number(statementBalance),
    statementDate, direction: preview.direction,
    transactions: preview.transactions.map(row => ({ ...row, cleared: clearedIds.has(row.id) })),
  }) : null;

  async function save() {
    if (!preview || !totals) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/accounts/reconcile", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ account: accountRef, statement_date: statementDate,
          statement_balance: Number(statementBalance), opening_date: openingDate || null,
          opening_balance: openingBalance === "" ? null : Number(openingBalance),
          cleared_ids: [...clearedIds], revision: preview.revision, request_id: requestId.current,
          create_adjustment: createAdjustment && !totals.balanced,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 409) setPreview(null);
        throw new Error(data.error ?? "Could not save the statement. You can retry this save safely.");
      }
      setSaved(`Statement reconciled.${data.adjustment_amount ? ` Adjustment recorded: ${formatCurrency(Math.abs(data.adjustment_amount))}.` : ""}`);
      setPreview(null);
      setNeedsOpening(false);
      setOpeningDate("");
      setOpeningBalance("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save. Retry this save safely."); }
    finally { setBusy(false); }
  }
  function close() {
    if (busy) return;
    invalidate();
    setOpen(false);
  }

  return <>
    <Button variant="secondary" onClick={() => setOpen(true)}>Reconcile an account</Button>
    <Modal open={open} onClose={close} placement="sheet" titleId="reconcile-title" className="max-w-3xl">
      <h2 id="reconcile-title" className="text-lg font-bold">Reconcile an account</h2>
      <p className="mt-2 text-sm text-muted">Match the transactions on your statement. The opening balance plus cleared activity should equal its ending balance.</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="Account" htmlFor="reconcile-account">
          <Select id="reconcile-account" value={accountRef} disabled={busy} onChange={e => {
            invalidate(); setAccountRef(e.target.value); setNeedsOpening(false); setOpeningDate(""); setOpeningBalance(""); setStatementBalance("");
          }}>{accounts.map(account => <option key={account.ref} value={account.ref}>{account.name}</option>)}</Select>
        </Field></div>
        <Field label="Statement date" htmlFor="reconcile-date">
          <Input id="reconcile-date" type="date" value={statementDate} disabled={busy} onChange={e => { invalidate(); setStatementDate(e.target.value); }} />
        </Field>
        <Field label="Statement ending balance" htmlFor="reconcile-balance">
          <Input id="reconcile-balance" type="number" step="0.01" value={statementBalance} disabled={busy} onChange={e => { setStatementBalance(e.target.value); requestId.current = crypto.randomUUID(); }} />
        </Field>
      </div>
      {needsOpening && <fieldset className="mt-4 rounded-card border border-panel-border p-4">
        <legend className="px-1 font-semibold">First statement: opening balance</legend>
        <p className="mb-3 text-sm text-muted">Enter the balance at the end of the day before this statement period. Use the previous statement&apos;s ending balance, not today&apos;s bank balance.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Opening balance date" htmlFor="reconcile-opening-date"><Input id="reconcile-opening-date" type="date" value={openingDate} disabled={busy} onChange={e => { invalidate(); setOpeningDate(e.target.value); }} /></Field>
          <Field label="Opening balance" htmlFor="reconcile-opening-balance"><Input id="reconcile-opening-balance" type="number" step="0.01" value={openingBalance} disabled={busy} onChange={e => { invalidate(); setOpeningBalance(e.target.value); }} /></Field>
        </div>
      </fieldset>}
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
      {saved && <p role="status" className="mt-3 text-sm">{saved}</p>}
      <Button className="mt-4" variant="secondary" disabled={busy || !accountRef || !statementDate || (needsOpening && (!openingDate || openingBalance === ""))} loading={busy} onClick={() => void loadPreview()}>{preview ? "Reload" : "Load transactions"}</Button>
      {preview && <>
        <p className="my-3 text-sm">Opening cleared balance: {formatCurrency(preview.openingBalance)} as of {preview.openingDate}. Older outstanding entries carry forward.</p>
        <ul className="max-h-72 divide-y divide-panel-border overflow-y-auto rounded-card border border-panel-border">
          {preview.transactions.map(row => <li key={row.id} className="flex items-start justify-between gap-3 p-3 text-sm">
            <label className="flex min-w-0 items-start gap-3"><input type="checkbox" checked={clearedIds.has(row.id)} disabled={busy} onChange={() => {
              const next = new Set(clearedIds); if (next.has(row.id)) next.delete(row.id); else next.add(row.id); changeSelection(next);
            }} /><span className="min-w-0 break-words">{row.merchant}<span className="block text-xs text-muted">{row.date}</span></span></label>
            <span data-money className="money shrink-0">{formatCurrency(row.amount)}</span>
          </li>)}
          {preview.transactions.length === 0 && <li className="p-4 text-sm text-muted">No outstanding or new transactions in this period.</li>}
        </ul>
        {totals && <div className="mt-4 space-y-2 text-sm" aria-live="polite">
          <p>Cleared: {formatCurrency(totals.clearedTotal)} ({totals.clearedCount}) · Outstanding: {formatCurrency(totals.outstandingTotal)} ({totals.outstandingCount})</p>
          <p className="font-semibold">Difference from statement: {formatCurrency(totals.difference)}</p>
          {!totals.balanced && <label className="flex items-start gap-2"><input type="checkbox" disabled={busy} checked={createAdjustment} onChange={e => { setCreateAdjustment(e.target.checked); requestId.current = crypto.randomUUID(); }} /><span>Record an explicit balance adjustment of {formatCurrency(Math.abs(totals.difference))}. Only do this after reviewing missing or incorrect entries.</span></label>}
        </div>}
        <div className="mt-5 flex justify-end gap-3"><Button variant="ghost" disabled={busy} onClick={close}>Close</Button><Button disabled={busy || !totals || (!totals.balanced && !createAdjustment)} loading={busy} onClick={() => void save()}>Save reconciliation</Button></div>
      </>}
    </Modal>
  </>;
}
