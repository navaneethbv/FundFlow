"use client";

import { useState } from "react";

export default function AddTransactionModal() {
  const [open, setOpen] = useState(false);
  const [merchant, setMerchant] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [kind, setKind] = useState<"debit" | "credit">("debit");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!merchant || !amount) return;

    setLoading(true);
    try {
      await fetch("/api/transactions/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          amount: parseFloat(amount),
          merchant,
          date,
          account: { source: "manual", id: "manual-default" },
        }),
      });
      window.location.reload();
    } catch {
      // ignore
    } finally {
      setLoading(false);
      setOpen(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-field bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent/90"
      >
        + Add Transaction
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-panel border border-panel-border bg-panel p-6 space-y-4">
        <h3 className="text-lg font-bold text-foreground">Add Manual Transaction</h3>
        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="block font-medium text-foreground mb-1">Merchant / Description</label>
            <input
              type="text"
              required
              placeholder="e.g. Local Coffee Shop"
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              className="w-full rounded border border-panel-border bg-background p-2 text-foreground"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-foreground mb-1">Amount ($)</label>
              <input
                type="number"
                step="0.01"
                required
                placeholder="15.50"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full rounded border border-panel-border bg-background p-2 text-foreground"
              />
            </div>

            <div>
              <label className="block font-medium text-foreground mb-1">Flow</label>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as "debit" | "credit")}
                className="w-full rounded border border-panel-border bg-background p-2 text-foreground"
              >
                <option value="debit">Expense (Debit)</option>
                <option value="credit">Income / Refund (Credit)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block font-medium text-foreground mb-1">Date</label>
            <input
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded border border-panel-border bg-background p-2 text-foreground"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded px-3 py-1.5 font-semibold text-muted hover:bg-panel-hover"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="rounded bg-accent px-3 py-1.5 font-semibold text-white hover:bg-accent/90"
            >
              Save Transaction
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
