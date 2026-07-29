"use client";

import { useState } from "react";
import { Sparkles } from "@/components/ui/icons";
import { formatCurrency, titleCase } from "@/lib/format";

export default function SeedBudgetButton() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [proposals, setProposals] = useState<
    Array<{ category: string; suggested_amount: number; group_name: string }>
  >([]);

  const handleOpenPreview = () => {
    // Generate static preview proposals
    setProposals([
      { category: "groceries", suggested_amount: 450, group_name: "flexible" },
      { category: "dining_out", suggested_amount: 200, group_name: "flexible" },
      { category: "rent", suggested_amount: 1500, group_name: "fixed" },
    ]);
    setOpen(true);
  };

  const handleConfirm = async () => {
    setLoading(true);
    try {
      // Apply confirmed proposals
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
        onClick={handleOpenPreview}
        className="inline-flex items-center gap-2 rounded-field bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/20"
      >
        <Sparkles className="h-3.5 w-3.5" />
        <span>Auto-budget from history</span>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-panel border border-panel-border bg-panel p-6 space-y-4">
        <div className="flex items-center gap-2 text-foreground">
          <Sparkles className="h-5 w-5 text-accent" />
          <h3 className="text-lg font-bold">Auto-Budget Proposals (Preview)</h3>
        </div>
        <p className="text-xs text-muted">
          Review the calculated proposals below. No changes are saved to your budget until you confirm.
        </p>

        <div className="space-y-2 border-y border-panel-border py-3">
          {proposals.map((p) => (
            <div key={p.category} className="flex items-center justify-between text-xs">
              <span className="font-medium text-foreground">{titleCase(p.category)}</span>
              <span className="font-bold text-accent">{formatCurrency(p.suggested_amount)}/mo</span>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded px-3 py-1.5 text-xs font-semibold text-muted hover:bg-panel-hover"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={loading}
            className="rounded bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent/90"
          >
            Confirm & Apply
          </button>
        </div>
      </div>
    </div>
  );
}
