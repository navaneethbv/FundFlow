"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Panel from "@/components/ui/Panel";
import { formatCurrency } from "@/lib/format";
import type { PrivateLoanView } from "@/lib/private-lending";
import type { PrivateLendingSummary } from "@/lib/private-lending";

export default function PrivateLendingPanel({
  loans,
  summary,
  today,
}: Readonly<{ loans: PrivateLoanView[]; summary: PrivateLendingSummary; today: string }>) {
  const router = useRouter();
  const [direction, setDirection] = useState<"lent" | "borrowed">("lent");
  const [counterparty, setCounterparty] = useState("");
  const [principal, setPrincipal] = useState("");
  const [rate, setRate] = useState("0");
  const [startDate, setStartDate] = useState(today);
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [paymentLoanId, setPaymentLoanId] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(today);
  const [paymentNote, setPaymentNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(body: Record<string, unknown>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/private-lending", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? "Could not save private lending update.");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save private lending update.");
    } finally {
      setBusy(false);
    }
  }

  function createLoan(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void submit({ kind: "loan", direction, counterparty, principal, annualInterestRate: rate, startDate, dueDate: dueDate || null, notes: notes || null });
  }

  function recordPayment(event: FormEvent<HTMLFormElement>, loanId: string): void {
    event.preventDefault();
    void submit({ kind: "payment", loan_id: loanId, amount: paymentAmount, payment_date: paymentDate, note: paymentNote || null });
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Panel title="Receivable" eyebrow="Money lent"><p data-money className="metric-value text-2xl font-bold" style={{ color: "var(--viz-pos)" }}>{formatCurrency(summary.receivable)}</p></Panel>
        <Panel title="Payable" eyebrow="Money borrowed"><p data-money className="metric-value text-2xl font-bold" style={{ color: "var(--viz-neg)" }}>{formatCurrency(summary.payable)}</p></Panel>
        <Panel title="Net-worth effect" eyebrow="Receivable minus payable"><p data-money className="metric-value text-2xl font-bold">{formatCurrency(summary.netWorthAdjustment)}</p></Panel>
      </div>
      <Panel title="Add private loan" eyebrow="Owner-only record">
        <form onSubmit={createLoan} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="grid gap-1 text-sm font-semibold"><span>Direction</span><select value={direction} onChange={(event) => { setDirection(event.target.value as "lent" | "borrowed"); }} className="min-h-11 rounded-field border border-panel-border bg-panel-2 px-3"><option value="lent">I lent money</option><option value="borrowed">I borrowed money</option></select></label>
          <label className="grid gap-1 text-sm font-semibold"><span>Person or counterparty</span><input required value={counterparty} onChange={(event) => { setCounterparty(event.target.value); }} className="min-h-11 rounded-field border border-panel-border bg-panel-2 px-3" maxLength={120} /></label>
          <label className="grid gap-1 text-sm font-semibold"><span>Principal</span><input required type="number" min="0.01" step="0.01" value={principal} onChange={(event) => { setPrincipal(event.target.value); }} className="min-h-11 rounded-field border border-panel-border bg-panel-2 px-3" /></label>
          <label className="grid gap-1 text-sm font-semibold"><span>Annual interest %</span><input type="number" min="0" max="100" step="0.01" value={rate} onChange={(event) => { setRate(event.target.value); }} className="min-h-11 rounded-field border border-panel-border bg-panel-2 px-3" /></label>
          <label className="grid gap-1 text-sm font-semibold"><span>Start date</span><input required type="date" value={startDate} onChange={(event) => { setStartDate(event.target.value); }} className="min-h-11 rounded-field border border-panel-border bg-panel-2 px-3" /></label>
          <label className="grid gap-1 text-sm font-semibold"><span>Due date <span className="font-normal text-muted">optional</span></span><input type="date" value={dueDate} onChange={(event) => { setDueDate(event.target.value); }} className="min-h-11 rounded-field border border-panel-border bg-panel-2 px-3" /></label>
          <label className="grid gap-1 text-sm font-semibold sm:col-span-2"><span>Notes <span className="font-normal text-muted">optional</span></span><input value={notes} onChange={(event) => { setNotes(event.target.value); }} maxLength={1000} className="min-h-11 rounded-field border border-panel-border bg-panel-2 px-3" /></label>
          <div className="sm:col-span-2 lg:col-span-4"><Button type="submit" loading={busy} disabled={busy}>Save private loan</Button></div>
        </form>
      </Panel>
      {loans.length === 0 && <Panel><p className="text-sm text-muted">No private loans recorded yet.</p></Panel>}
      {loans.map((loan) => (
        <Panel key={loan.id} title={`${loan.direction === "lent" ? "Lent to" : "Borrowed from"} ${loan.counterparty}`} eyebrow={`${loan.startDate}${loan.dueDate ? ` · due ${loan.dueDate}` : ""}`}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><p data-money className="metric-value text-2xl font-bold">{formatCurrency(loan.balance.totalOutstanding)}</p><p className="text-xs text-muted">{loan.annualInterestRate.toFixed(2)}% annual interest · {formatCurrency(loan.balance.principalOutstanding)} principal + {formatCurrency(loan.balance.accruedInterest)} accrued</p></div>
            <Button type="button" size="sm" variant="secondary" onClick={() => { setPaymentLoanId(paymentLoanId === loan.id ? null : loan.id); }}>{paymentLoanId === loan.id ? "Close payment" : "Record payment"}</Button>
          </div>
          {paymentLoanId === loan.id && (
            <form onSubmit={(event) => { recordPayment(event, loan.id); }} className="mt-4 grid gap-3 border-t border-panel-border pt-4 sm:grid-cols-3">
              <label className="grid gap-1 text-sm font-semibold"><span>Payment amount</span><input required type="number" min="0.01" step="0.01" value={paymentAmount} onChange={(event) => { setPaymentAmount(event.target.value); }} className="min-h-11 rounded-field border border-panel-border bg-panel-2 px-3" /></label>
              <label className="grid gap-1 text-sm font-semibold"><span>Payment date</span><input required type="date" value={paymentDate} onChange={(event) => { setPaymentDate(event.target.value); }} className="min-h-11 rounded-field border border-panel-border bg-panel-2 px-3" /></label>
              <label className="grid gap-1 text-sm font-semibold"><span>Note <span className="font-normal text-muted">optional</span></span><input value={paymentNote} onChange={(event) => { setPaymentNote(event.target.value); }} maxLength={500} className="min-h-11 rounded-field border border-panel-border bg-panel-2 px-3" /></label>
              <div className="sm:col-span-3"><Button type="submit" loading={busy} disabled={busy}>Save payment</Button></div>
            </form>
          )}
          {loan.payments.length > 0 && <details className="mt-4 border-t border-panel-border pt-3 text-sm"><summary className="cursor-pointer font-semibold text-muted">{loan.payments.length} payment{loan.payments.length === 1 ? "" : "s"}</summary><ul className="mt-2 space-y-1">{loan.payments.map((payment) => <li key={payment.id} className="flex justify-between gap-3"><span>{payment.paymentDate}{payment.note ? ` · ${payment.note}` : ""}</span><span data-money className="font-semibold">{formatCurrency(payment.amount)}</span></li>)}</ul></details>}
        </Panel>
      ))}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}
