"use client";

import { useState } from "react";
import { formatCurrency } from "@/lib/format";
import type { BudgetSection, BudgetLine } from "@/lib/budget-page";

export default function BudgetTable({
  section,
  month,
}: Readonly<{
  section: BudgetSection;
  month: string;
}>) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const handleEditClick = (line: BudgetLine) => {
    if (!line.budgetId) return;
    setEditingId(line.budgetId);
    setEditValue(line.planned.toString());
  };

  const handleSave = async (budgetId: string) => {
    const val = parseFloat(editValue);
    if (isNaN(val) || val < 0) return;

    setLoading(true);
    try {
      await fetch("/api/budget", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          budget_id: budgetId,
          month,
          planned: val,
        }),
      });
      window.location.reload();
    } catch {
      // ignore error for now
    } finally {
      setLoading(false);
      setEditingId(null);
    }
  };

  return (
    <div className="rounded-panel border border-panel-border bg-panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-panel-border px-5 py-4">
        <div>
          <h3 className="font-semibold text-foreground">{section.label}</h3>
          <p className="text-xs text-muted">
            Planned: {formatCurrency(section.planned)} · Actual: {formatCurrency(section.actual)}
          </p>
        </div>
        <span
          className={`text-sm font-bold ${
            section.remaining < 0 ? "text-danger" : "text-foreground"
          }`}
        >
          {formatCurrency(section.remaining)} remaining
        </span>
      </div>

      <div className="divide-y divide-panel-border overflow-x-auto">
        {section.lines.map((line) => (
          <div
            key={line.category}
            className="flex items-center justify-between px-5 py-3 text-sm hover:bg-panel-hover"
          >
            <div className="min-w-0 flex-1">
              <span className="font-medium text-foreground">{line.label}</span>
              {!line.budgeted && (
                <span className="ml-2 rounded bg-amber-500/10 px-1.5 py-0.5 text-[0.65rem] text-amber-500">
                  Unbudgeted
                </span>
              )}
            </div>

            <div className="flex items-center gap-6 text-right">
              <div className="w-28">
                {editingId === line.budgetId ? (
                  <div className="flex items-center gap-1 justify-end">
                    <input
                      type="number"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      className="w-20 rounded border border-panel-border bg-background px-2 py-1 text-xs text-foreground"
                      autoFocus
                    />
                    <button
                      onClick={() => line.budgetId && handleSave(line.budgetId)}
                      disabled={loading}
                      className="rounded bg-accent px-2 py-1 text-xs text-white"
                    >
                      Save
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => handleEditClick(line)}
                    className={`text-foreground hover:underline ${!line.budgetId ? "cursor-default" : ""}`}
                  >
                    {formatCurrency(line.planned)}
                  </button>
                )}
              </div>

              <div className="w-24 text-muted">{formatCurrency(line.actual)}</div>

              <div
                className={`w-28 font-medium ${
                  line.remaining < 0 ? "text-danger" : "text-foreground"
                }`}
              >
                {formatCurrency(line.remaining)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
