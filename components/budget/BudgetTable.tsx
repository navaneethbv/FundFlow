"use client";

import { useEffect, useRef, useState } from "react";
import Badge from "@/components/ui/Badge";
import CategoryChip from "@/components/ui/CategoryChip";
import ProgressBar from "@/components/ui/ProgressBar";
import { Eye, EyeOff } from "@/components/ui/icons";
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

export type PlannedAmountValidation =
  | { ok: true; value: number; changed: boolean }
  | { ok: false };

/**
 * The quiet inline Planned input auto-saves on blur rather than behind an
 * explicit Save button, so every blur — including just tabbing through
 * without editing — must not fire a network request, and an unparseable or
 * negative value must revert rather than silently save. `changed: false`
 * distinguishes an untouched blur from a real mutation.
 */
export function validatePlannedAmount(
  input: string,
  currentBasePlanned: number,
): PlannedAmountValidation {
  const trimmed = input.trim();
  if (trimmed === "") return { ok: true, value: 0, changed: currentBasePlanned !== 0 };
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric) || numeric < 0) return { ok: false };
  const rounded = Math.round(numeric * 100) / 100;
  return { ok: true, value: rounded, changed: rounded !== currentBasePlanned };
}

/**
 * Row-level menu for group reassignment, rollover toggle, and sort order.
 *
 * Placed here in `BudgetTable.tsx` because it is internal to the table's
 * row lifecycle (shares `onUpdate` and `BudgetLinePatch`), not a reusable
 * application menu. Kept custom rather than generic `DropdownButton`
 * because the panel contains a `<select>`, a `<input type="checkbox">`, and
 * a `<input type="number">` rather than a list of click targets —
 * forcing an ill-fitting shape onto the shared primitive.
 */
function RowMenu({
  line,
  disabled,
  onUpdate,
}: Readonly<{
  line: BudgetLine;
  disabled: boolean;
  onUpdate: (line: BudgetLine, patch: BudgetLinePatch) => Promise<void>;
}>) {
  const [open, setOpen] = useState(false);
  const [sortOrder, setSortOrder] = useState(String(line.sortOrder));
  const triggerRef = useRef<HTMLButtonElement>(null);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  async function saveSortOrder() {
    // An empty field parses to 0, which would silently overwrite a real order
    // with zero; treat it as an invalid edit and revert to the stored value.
    if (sortOrder.trim() === "") {
      setSortOrder(String(line.sortOrder));
      return;
    }
    const value = Number(sortOrder);
    if (!Number.isInteger(value) || value < 0) {
      setSortOrder(String(line.sortOrder));
      return;
    }
    await onUpdate(line, { sortOrder: value });
  }

  return (
    <div className="relative inline-block">
      {open && (
        <button
          type="button"
          aria-hidden
          tabIndex={-1}
          onClick={close}
          className="fixed inset-0 z-30 cursor-default"
        />
      )}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={`More options for ${line.label}`}
        className="inline-flex h-11 w-11 items-center justify-center rounded-full text-muted hover:bg-panel-hover hover:text-foreground focus-visible:outline-2"
      >
        <span aria-hidden className="text-lg leading-none">⋯</span>
      </button>
      {open && (
        <div
          aria-label={`Plan controls for ${line.label}`}
          className="absolute right-0 z-40 mt-2 w-64 space-y-3 rounded-card border border-panel-border bg-panel p-3 shadow-float"
        >
          <label className="block text-xs font-semibold text-muted">
            Group
            {/* Per-row accessible names, matching the Sort order input below.
                Without them every open row menu exposes a control called just
                "Group" / "Rollover unused budget". Each name still contains its
                visible label text, so WCAG 2.5.3 holds. */}
            <select
              aria-label={`Group for ${line.label}`}
              value={line.group}
              disabled={disabled}
              onChange={(event) =>
                onUpdate(line, { group: event.target.value as BudgetGroup })
              }
              className="mt-1 min-h-11 w-full rounded-field border border-panel-border bg-panel-2 px-2 text-sm text-foreground"
            >
              <option value="income">Income</option>
              <option value="fixed">Fixed</option>
              <option value="flexible">Flexible</option>
              <option value="non_monthly">Non-Monthly</option>
            </select>
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm text-foreground">
            <input
              aria-label={`Rollover unused budget for ${line.label}`}
              type="checkbox"
              checked={line.rolloverEnabled}
              disabled={disabled || line.group === "income"}
              onChange={(event) =>
                onUpdate(line, { rolloverEnabled: event.target.checked })
              }
            />
            {" "}Rollover unused budget
          </label>
          <label className="block text-xs font-semibold text-muted">
            <span className="block">Sort order</span>
            <input
              aria-label={`Sort order for ${line.label}`}
              type="number"
              min="0"
              step="1"
              value={sortOrder}
              onChange={(event) => setSortOrder(event.target.value)}
              onBlur={saveSortOrder}
              className="mt-1 min-h-11 w-full rounded-field border border-panel-border bg-panel-2 px-2 text-sm text-foreground"
            />
          </label>
        </div>
      )}
    </div>
  );
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

  if (!line.budgetId) {
    return (
      <tr className="border-t border-panel-border">
        <th scope="row" className="px-4 py-3 text-left font-medium">
          <div className="flex items-center gap-2">
            <CategoryChip label={line.label} />
            <Badge tone="warning">Unbudgeted</Badge>
          </div>
        </th>
        <td className="px-4 py-3 text-right">{formatCurrency(0, currency)}</td>
        <td className="px-4 py-3 text-right text-muted">
          {formatCurrency(line.actual, currency)}
        </td>
        <td className="px-4 py-3 text-right">
          <Badge tone="danger" data-money style={{ color: "var(--viz-neg)" }}>
            {formatCurrency(line.remaining, currency)}
          </Badge>
        </td>
        <td className="px-4 py-3 text-xs text-muted">Create a budget to edit</td>
      </tr>
    );
  }

  async function savePlanned() {
    const result = validatePlannedAmount(planned, line.basePlanned);
    if (!result.ok) {
      setPlanned(String(line.basePlanned));
      return;
    }
    if (!result.changed) return;
    await onUpdate(line, { planned: result.value });
  }

  const pct = line.planned > 0 ? Math.round((line.actual / line.planned) * 100) : 0;
  const over = line.remaining < 0;

  return (
    <tr className="border-t border-panel-border">
      <th scope="row" className="px-4 py-3 text-left align-top font-medium">
        <CategoryChip label={line.label} />
        {line.rolloverCarry !== 0 && (
          <span className="mt-1 block text-xs font-normal text-muted">
            {formatCurrency(line.rolloverCarry, currency)} carried from last month
          </span>
        )}
        <ProgressBar
          className="mt-2 max-w-40"
          size="sm"
          percent={pct}
          tone={over ? "danger" : "success"}
          ariaLabel={`${line.label} spent`}
        />
      </th>
      <td className="px-4 py-3 text-right align-top">
        {/* Quiet inline input, auto-saves on blur — no separate Save
            button. Optimistic update + rollback still happens in the
            parent's onUpdate, same as before. */}
        <input
          aria-label={`Planned amount for ${line.label}`}
          type="number"
          min="0"
          step="0.01"
          value={planned}
          disabled={disabled}
          onChange={(event) => setPlanned(event.target.value)}
          onBlur={savePlanned}
          className="min-h-11 w-24 rounded-field border border-transparent bg-transparent px-2 text-right transition-colors hover:border-panel-border focus:border-accent focus:bg-panel-2 focus:outline-none"
        />
      </td>
      <td className="px-4 py-3 text-right align-top text-muted">
        {formatCurrency(line.actual, currency)}
      </td>
      <td className="px-4 py-3 text-right align-top">
        {over ? (
          <Badge tone="danger" data-money style={{ color: "var(--viz-neg)" }}>
            {formatCurrency(line.remaining, currency)}
          </Badge>
        ) : (
          <span data-money className="font-semibold" style={{ color: "var(--viz-pos)" }}>
            {formatCurrency(line.remaining, currency)}
          </span>
        )}
      </td>
      <td className="px-2 py-3 text-right align-top">
        <RowMenu line={line} disabled={disabled} onUpdate={onUpdate} />
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
        <h2 className="font-semibold">{section.label}</h2>
        <div className="flex items-center gap-4 text-right text-xs text-muted">
          <span data-money>{formatCurrency(section.planned, currency)} planned</span>
          <span data-money>{formatCurrency(section.actual, currency)} actual</span>
          <span
            data-money
            className="text-sm font-bold"
            style={{ color: section.remaining >= 0 ? "var(--viz-pos)" : "var(--viz-neg)" }}
          >
            {formatCurrency(section.remaining, currency)} remaining
          </span>
        </div>
      </div>
      {lines.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-panel-2 text-xs text-muted">
              <tr>
                <th scope="col" className="px-4 py-3 text-left">Category</th>
                <th scope="col" className="px-4 py-3 text-right">Planned</th>
                <th scope="col" className="px-4 py-3 text-right">Actual</th>
                <th scope="col" className="px-4 py-3 text-right">Remaining</th>
                <th scope="col" aria-label="Plan controls" className="px-2 py-3 text-right" />
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
            className="inline-flex min-h-11 items-center gap-2 rounded-field px-2 -mx-2 text-sm font-semibold text-accent hover:bg-panel-hover focus-visible:outline-2"
          >
            {showUnbudgeted ? (
              <EyeOff aria-hidden className="h-4 w-4" />
            ) : (
              <Eye aria-hidden className="h-4 w-4" />
            )}
            {showUnbudgeted ? "Hide" : "Show"} {section.unbudgetedCount} unbudgeted
          </button>
        </div>
      )}
    </section>
  );
}
