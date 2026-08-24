"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import Input from "@/components/ui/Input";
import Panel from "@/components/ui/Panel";
import Select from "@/components/ui/Select";
import { formatCurrency } from "@/lib/format";
import {
  computeSinkingFunds,
  type SinkingFundCadence,
} from "@/lib/insights";

export interface SinkingFundRow {
  id: string;
  name: string;
  target_amount: number;
  due_date: string;
  cadence: SinkingFundCadence;
  custom_interval_months: number | null;
  cycle_anchor_date: string;
}

const CADENCE_LABELS: Record<SinkingFundCadence, string> = {
  one_time: "One time",
  annual: "Every year",
  semiannual: "Every 6 months",
  quarterly: "Every 3 months",
  custom: "Custom interval",
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function planFor(fund: SinkingFundRow) {
  return computeSinkingFunds({
    funds: [{
      name: fund.name,
      targetAmount: Number(fund.target_amount),
      dueDate: fund.due_date,
      cadence: fund.cadence,
      customIntervalMonths: fund.custom_interval_months,
      cycleAnchorDate: fund.cycle_anchor_date,
    }],
    asOf: today(),
  }).items[0]!;
}

export default function SinkingFundsSection({
  initialFunds,
}: Readonly<{
  initialFunds: SinkingFundRow[];
}>) {
  const [funds, setFunds] = useState(initialFunds);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [cadence, setCadence] = useState<SinkingFundCadence>("one_time");
  const [customInterval, setCustomInterval] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function resetForm() {
    setEditingId(null);
    setName("");
    setAmount("");
    setDueDate("");
    setCadence("one_time");
    setCustomInterval("");
  }

  function startEdit(fund: SinkingFundRow) {
    setEditingId(fund.id);
    setName(fund.name);
    setAmount(String(fund.target_amount));
    setDueDate(fund.cycle_anchor_date);
    setCadence(fund.cadence);
    setCustomInterval(
      fund.custom_interval_months === null
        ? ""
        : String(fund.custom_interval_months),
    );
    setError(null);
  }

  async function submit(event: React.SyntheticEvent) {
    event.preventDefault();
    setError(null);
    const targetAmount = Number(amount);
    const customIntervalMonths = cadence === "custom"
      ? Number(customInterval)
      : null;
    if (
      !name.trim() ||
      !Number.isFinite(targetAmount) ||
      targetAmount <= 0 ||
      !dueDate ||
      (cadence === "custom" &&
        (customIntervalMonths === null ||
          !Number.isInteger(customIntervalMonths) ||
          customIntervalMonths < 1 ||
          customIntervalMonths > 120))
    ) {
      setError("Enter a name, positive amount, valid due date, and cadence.");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(
        editingId ? `/api/sinking-funds/${editingId}` : "/api/sinking-funds",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            targetAmount,
            dueDate,
            cadence,
            customIntervalMonths,
          }),
        },
      );
      const result = await response.json() as {
        fund?: SinkingFundRow;
        error?: string;
      };
      if (!response.ok || !result.fund) {
        setError(result.error ?? "Could not save the sinking fund.");
        return;
      }
      setFunds((rows) => editingId
        ? rows.map((row) => row.id === editingId ? result.fund! : row)
        : [...rows, result.fund!]);
      resetForm();
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    const response = await fetch(`/api/sinking-funds/${id}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({})) as { error?: string };
      setError(result.error ?? "Could not remove the sinking fund.");
      return;
    }
    setFunds((rows) => rows.filter((row) => row.id !== id));
    if (editingId === id) resetForm();
  }

  return (
    <Panel title="Sinking funds" eyebrow="Planned irregular expenses">
      <p className="mb-4 text-sm text-muted">
        Smooth known expenses into a monthly set-aside. Recurring funds advance
        to their next cycle without losing the original calendar anchor.
      </p>

      {funds.length > 0 && (
        <ul className="mb-5 grid gap-2 text-sm md:grid-cols-2">
          {funds.map((fund) => {
            const plan = planFor(fund);
            return (
              <li key={fund.id} className="rounded-field border border-panel-border bg-panel-2 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{fund.name}</p>
                    <p className="mt-1 text-xs text-muted">
                      {CADENCE_LABELS[fund.cadence]}
                      {fund.cadence === "custom" && ` (${fund.custom_interval_months} months)`}
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      Next due <span className="font-mono">{plan.dueDate}</span>,{" "}
                      <span data-money>{formatCurrency(plan.monthlySetAside)}</span> monthly
                    </p>
                  </div>
                  <p data-money className="shrink-0 font-semibold">
                    {formatCurrency(Number(fund.target_amount))}
                  </p>
                </div>
                <div className="mt-2 flex justify-end gap-1">
                  <Button onClick={() => startEdit(fund)} variant="ghost" size="sm">
                    Edit
                  </Button>
                  <Button onClick={() => void remove(fund.id)} variant="ghost" size="sm">
                    Remove
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <form onSubmit={submit} className="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Field label="Name" htmlFor="sinking-fund-name">
          <Input
            id="sinking-fund-name"
            maxLength={120}
            placeholder="Car insurance"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="Amount" htmlFor="sinking-fund-amount">
          <Input
            id="sinking-fund-amount"
            type="number"
            min="0.01"
            step="0.01"
            placeholder="600"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </Field>
        <Field label="Due date" htmlFor="sinking-fund-due-date">
          <Input
            id="sinking-fund-due-date"
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
          />
        </Field>
        <Field label="Cadence" htmlFor="sinking-fund-cadence">
          <Select
            id="sinking-fund-cadence"
            value={cadence}
            onChange={(event) => setCadence(event.target.value as SinkingFundCadence)}
          >
            {Object.entries(CADENCE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </Select>
        </Field>
        {cadence === "custom" && (
          <Field label="Months per cycle" htmlFor="sinking-fund-custom-interval">
            <Input
              id="sinking-fund-custom-interval"
              type="number"
              min="1"
              max="120"
              step="1"
              value={customInterval}
              onChange={(event) => setCustomInterval(event.target.value)}
            />
          </Field>
        )}
        <div className="flex gap-2 sm:col-span-2 xl:col-span-full">
          <Button type="submit" size="md" disabled={saving}>
            {editingId ? "Save changes" : "Add fund"}
          </Button>
          {editingId && (
            <Button type="button" size="md" variant="ghost" onClick={resetForm}>
              Cancel
            </Button>
          )}
        </div>
      </form>

      {error && <output className="mt-3 block text-sm text-red-600">{error}</output>}
    </Panel>
  );
}
