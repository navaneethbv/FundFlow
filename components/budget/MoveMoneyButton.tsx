"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import Input from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";
import Select from "@/components/ui/Select";
import { formatCurrency } from "@/lib/format";
import type { BudgetLine } from "@/lib/budget-page";

type MoveLine = Pick<BudgetLine, "budgetId" | "label" | "basePlanned">;

/** Parse a user-typed amount; null unless it is positive with at most two decimals. */
export function parseMoveAmount(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const amount = Number(trimmed);
  return amount > 0 ? amount : null;
}

/** Reference adoption 7.1: move planned money between two category budgets. */
export default function MoveMoneyButton({
  month,
  currency,
  lines,
}: Readonly<{ month: string; currency: string; lines: MoveLine[] }>) {
  const router = useRouter();
  const budgeted = lines.filter((line): line is MoveLine & { budgetId: string } => Boolean(line.budgetId));
  const [open, setOpen] = useState(false);
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [amountText, setAmountText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  if (budgeted.length < 2) return null;
  const sources = budgeted.filter((line) => line.basePlanned > 0);
  const source = budgeted.find((line) => line.budgetId === fromId);

  function openDialog() {
    setFromId(sources[0]?.budgetId ?? "");
    setToId("");
    setAmountText("");
    setError(null);
    setOpen(true);
  }

  async function submit(event: React.SyntheticEvent) {
    event.preventDefault();
    setError(null);
    const amount = parseMoveAmount(amountText);
    if (!fromId || !toId || fromId === toId) return setError("Choose two different categories.");
    if (amount === null) return setError("Enter a positive amount with at most two decimals.");
    if (source && amount > source.basePlanned) {
      return setError(`${source.label} has ${formatCurrency(source.basePlanned, currency)} planned.`);
    }
    setSaving(true);
    try {
      const response = await fetch("/api/budget/move", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ month, from_budget_id: fromId, to_budget_id: toId, amount }),
      });
      const json = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(json?.error ?? "Could not move money.");
      const target = budgeted.find((line) => line.budgetId === toId);
      setStatus(`Moved ${formatCurrency(amount, currency)} from ${source?.label ?? "budget"} to ${target?.label ?? "budget"}.`);
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not move money.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button type="button" variant="secondary" onClick={openDialog} disabled={sources.length === 0}>
        Move money
      </Button>
      {status && <output className="sr-only" aria-live="polite">{status}</output>}
      <Modal open={open} onClose={() => setOpen(false)} titleId="move-money-title" placement="sheet" className="max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <h2 id="move-money-title" className="text-lg font-semibold">Move money</h2>
          <p className="text-sm text-muted">Shift planned money between categories for this month. Other months keep their plans.</p>
          <Field label="From" htmlFor="move-money-from">
            <Select id="move-money-from" value={fromId} onChange={(event) => setFromId(event.target.value)}>
              {sources.map((line) => (
                <option key={line.budgetId} value={line.budgetId}>
                  {line.label} ({formatCurrency(line.basePlanned, currency)} planned)
                </option>
              ))}
            </Select>
          </Field>
          <Field label="To" htmlFor="move-money-to">
            <Select id="move-money-to" value={toId} onChange={(event) => setToId(event.target.value)}>
              <option value="">Choose a category</option>
              {budgeted.filter((line) => line.budgetId !== fromId).map((line) => (
                <option key={line.budgetId} value={line.budgetId}>{line.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Amount" htmlFor="move-money-amount">
            <Input id="move-money-amount" inputMode="decimal" value={amountText} onChange={(event) => setAmountText(event.target.value)} placeholder="0.00" />
          </Field>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" loading={saving}>Move</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
