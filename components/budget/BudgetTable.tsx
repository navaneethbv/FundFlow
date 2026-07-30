"use client";

import { useState } from "react";
import { formatCurrency } from "@/lib/format";
import type {
  BudgetGroup,
  BudgetLine,
  BudgetSection,
} from "@/lib/budget-page";

export interface BudgetLinePatch {
  planned?: number;
  group?: BudgetGroup;
  rolloverEnabled?: boolean;
  sortOrder?: number;
}

function BudgetRow({
  line,
  currency,
  disabled,
  onUpdate,
}: Readonly<{
  line: BudgetLine;
  currency: string;
  disabled: boolean;
  onUpdate: (line: BudgetLine, patch: BudgetLinePatch) => Promise<void>;
}>) {
  const [planned, setPlanned] = useState(String(line.basePlanned));
  const [sortOrder, setSortOrder] = useState(String(line.sortOrder));

  if (!line.budgetId) {
    return (
      <tr className="border-t border-panel-border">
        <th scope="row" className="px-4 py-3 text-left font-medium">
          {line.label}
          <span className="ml-2 rounded bg-amber-500/10 px-2 py-1 text-xs text-amber-600">
            Unbudgeted
          </span>
        </th>
        <td className="px-4 py-3 text-right">{formatCurrency(0, currency)}</td>
        <td className="px-4 py-3 text-right text-muted">
          {formatCurrency(line.actual, currency)}
        </td>
        <td className="px-4 py-3 text-right font-semibold text-danger">
          {formatCurrency(line.remaining, currency)}
        </td>
        <td className="px-4 py-3 text-muted">Create a budget to edit</td>
      </tr>
    );
  }

  async function savePlanned() {
    const value = Number(planned);
    if (!Number.isFinite(value) || value < 0) {
      setPlanned(String(line.basePlanned));
      return;
    }
    await onUpdate(line, { planned: value });
  }

  async function saveSortOrder() {
    const value = Number(sortOrder);
    if (!Number.isInteger(value) || value < 0) {
      setSortOrder(String(line.sortOrder));
      return;
    }
    await onUpdate(line, { sortOrder: value });
  }

  return (
    <tr className="border-t border-panel-border">
      <th scope="row" className="px-4 py-3 text-left font-medium">
        {line.label}
        {line.rolloverCarry !== 0 && (
          <span className="mt-1 block text-xs font-normal text-muted">
            {formatCurrency(line.rolloverCarry, currency)} carried from last month
          </span>
        )}
      </th>
      <td className="px-4 py-3">
        <div className="flex min-w-40 items-center justify-end gap-2">
          <input
            aria-label={`Planned amount for ${line.label}`}
            type="number"
            min="0"
            step="0.01"
            value={planned}
            onChange={(event) => setPlanned(event.target.value)}
            className="min-h-11 w-24 rounded-field border border-panel-border bg-background px-3 text-right"
          />
          <button
            type="button"
            disabled={disabled}
            onClick={savePlanned}
            className="min-h-11 rounded-field bg-accent px-3 text-xs font-bold text-accent-foreground disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </td>
      <td className="px-4 py-3 text-right text-muted">
        {formatCurrency(line.actual, currency)}
      </td>
      <td
        className={`px-4 py-3 text-right font-semibold ${
          line.remaining < 0 ? "text-danger" : "text-foreground"
        }`}
      >
        {formatCurrency(line.remaining, currency)}
      </td>
      <td className="px-4 py-3">
        <div className="flex min-w-72 items-center gap-3">
          <label className="text-xs text-muted">
            <span className="sr-only">Group for {line.label}</span>
            <select
              value={line.group}
              disabled={disabled}
              onChange={(event) =>
                onUpdate(line, {
                  group: event.target.value as BudgetGroup,
                })
              }
              className="min-h-11 rounded-field border border-panel-border bg-background px-2"
            >
              <option value="income">Income</option>
              <option value="fixed">Fixed</option>
              <option value="flexible">Flexible</option>
              <option value="non_monthly">Non-Monthly</option>
            </select>
          </label>
          <label className="flex min-h-11 items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={line.rolloverEnabled}
              disabled={disabled || line.group === "income"}
              onChange={(event) =>
                onUpdate(line, {
                  rolloverEnabled: event.target.checked,
                })
              }
            />
            Rollover
          </label>
          <label className="flex items-center gap-2 text-xs text-muted">
            Order
            <input
              aria-label={`Sort order for ${line.label}`}
              type="number"
              min="0"
              step="1"
              value={sortOrder}
              onChange={(event) => setSortOrder(event.target.value)}
              onBlur={saveSortOrder}
              className="min-h-11 w-16 rounded-field border border-panel-border bg-background px-2"
            />
          </label>
        </div>
      </td>
    </tr>
  );
}

export default function BudgetTable({
  section,
  currency,
  disabled,
  onUpdate,
}: Readonly<{
  section: BudgetSection;
  currency: string;
  disabled: boolean;
  onUpdate: (line: BudgetLine, patch: BudgetLinePatch) => Promise<void>;
}>) {
  const [showUnbudgeted, setShowUnbudgeted] = useState(false);
  const lines = showUnbudgeted
    ? section.lines
    : section.lines.filter((line) => line.budgeted);

  return (
    <section className="overflow-hidden rounded-card border border-panel-border bg-panel shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div>
          <h2 className="font-semibold">{section.label}</h2>
          <p className="mt-1 text-xs text-muted">
            {formatCurrency(section.planned, currency)} planned,{" "}
            {formatCurrency(section.actual, currency)} actual
          </p>
        </div>
        <p
          className={`text-sm font-bold ${
            section.remaining < 0 ? "text-danger" : "text-foreground"
          }`}
        >
          {formatCurrency(section.remaining, currency)} remaining
        </p>
      </div>
      {lines.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-panel-2 text-xs text-muted">
              <tr>
                <th scope="col" className="px-4 py-3 text-left">Category</th>
                <th scope="col" className="px-4 py-3 text-right">Planned</th>
                <th scope="col" className="px-4 py-3 text-right">Actual</th>
                <th scope="col" className="px-4 py-3 text-right">Remaining</th>
                <th scope="col" className="px-4 py-3 text-left">Plan controls</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <BudgetRow
                  key={[
                    line.budgetId ?? "unbudgeted",
                    line.category,
                    line.basePlanned,
                    line.sortOrder,
                  ].join(":")}
                  line={line}
                  currency={currency}
                  disabled={disabled}
                  onUpdate={onUpdate}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="border-t border-panel-border px-5 py-6 text-sm text-muted">
          No categories in this section yet.
        </p>
      )}
      {section.unbudgetedCount > 0 && (
        <div className="border-t border-panel-border px-5 py-3">
          <button
            type="button"
            onClick={() => setShowUnbudgeted((value) => !value)}
            className="min-h-11 text-sm font-semibold text-accent"
          >
            {showUnbudgeted ? "Hide" : "Show"} {section.unbudgetedCount} unbudgeted
          </button>
        </div>
      )}
    </section>
  );
}
