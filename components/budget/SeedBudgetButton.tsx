"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "@/components/ui/icons";
import { formatCurrency, titleCase } from "@/lib/format";
import type {
  BudgetGroup,
  BudgetSeedProposal,
} from "@/lib/budget-page";

interface EditableProposal extends BudgetSeedProposal {
  included: boolean;
  /**
   * The amount as typed, kept as a string so a partial decimal (e.g. "12.")
   * or a trailing zero ("0.50") survives the controlled edit instead of being
   * coerced to a number and back on every keystroke.
   */
  suggested_amount_text: string;
}

export default function SeedBudgetButton({
  proposals,
  month,
  currency,
}: Readonly<{
  proposals: BudgetSeedProposal[];
  month: string;
  currency: string;
}>) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<EditableProposal[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const firstControl = dialog?.querySelector<HTMLElement>(
      "button, input, select",
    );
    firstControl?.focus();
  }, [open]);

  function openPreview() {
    setRows(
      proposals.map((proposal) => ({
        ...proposal,
        included: true,
        suggested_amount_text: String(proposal.suggested_amount),
      })),
    );
    setError(null);
    setOpen(true);
  }

  function update(index: number, patch: Partial<EditableProposal>) {
    setRows((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row,
      ),
    );
  }

  function handleDialogKeyDown(event: React.KeyboardEvent<HTMLDialogElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key !== "Tab") return;
    const controls = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled])',
    );
    if (!controls || controls.length === 0) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function confirm() {
    const selected = rows.filter((row) => row.included);
    if (selected.length === 0) {
      setError("Select at least one proposal.");
      return;
    }
    const invalidAmount = selected.some((row) => {
      const value = Number(row.suggested_amount_text);
      return !Number.isFinite(value) || value < 0;
    });
    if (invalidAmount) {
      setError("Every selected monthly amount must be a valid non-negative number.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/budget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month,
          items: selected.map((row) => ({
            category: row.category,
            // Parse the typed string now: an empty or non-numeric amount is
            // an invalid edit, so stop instead of silently sending 0.
            monthly_limit: Number(row.suggested_amount_text),
            group_name: row.group_name,
            rollover_enabled: row.rollover_enabled,
            sort_order: row.sort_order,
          })),
        }),
      });
      if (!response.ok) throw new Error("proposal_save_failed");
      setOpen(false);
      router.refresh();
    } catch {
      setError("The proposals could not be saved. Review them and try again.");
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={openPreview}
        disabled={proposals.length === 0}
        className="inline-flex min-h-11 items-center gap-2 rounded-field bg-accent-soft px-4 text-sm font-semibold text-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Sparkles aria-hidden className="h-4 w-4" />
        Create from history
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <dialog
        open
        ref={dialogRef}
        aria-modal="true"
        aria-labelledby="budget-proposal-title"
        onKeyDown={handleDialogKeyDown}
        className="relative m-0 max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-card border border-panel-border bg-panel p-5 shadow-float sm:p-6"
      >
        <div className="flex items-start gap-3">
          <Sparkles aria-hidden className="mt-1 h-5 w-5 text-accent" />
          <div>
            <h2 id="budget-proposal-title" className="text-xl font-bold">
              Review Budget proposals
            </h2>
            <p className="mt-1 text-sm text-muted">
              Nothing is saved until you confirm the selected rows.
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-3">
          {rows.map((row, index) => (
            <fieldset
              key={row.category}
              className="rounded-field border border-panel-border p-4"
            >
              <legend className="px-1 font-semibold">
                {titleCase(row.category)}
              </legend>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={row.included}
                    onChange={(event) =>
                      update(index, { included: event.target.checked })
                    }
                  />
                  {" "}Include
                </label>
                <label className="text-xs text-muted">
                  Monthly amount{" "}
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={row.suggested_amount_text}
                    onChange={(event) =>
                      update(index, {
                        suggested_amount_text: event.target.value,
                      })
                    }
                    className="mt-1 min-h-11 w-full rounded-field border border-panel-border bg-background px-3 text-foreground"
                  />
                </label>
                <label className="text-xs text-muted">
                  Group{" "}
                  <select
                    value={row.group_name}
                    onChange={(event) =>
                      update(index, {
                        group_name: event.target.value as BudgetGroup,
                      })
                    }
                    className="mt-1 min-h-11 w-full rounded-field border border-panel-border bg-background px-3 text-foreground"
                  >
                    <option value="income">Income</option>
                    <option value="fixed">Fixed</option>
                    <option value="flexible">Flexible</option>
                    <option value="non_monthly">Non-Monthly</option>
                  </select>
                </label>
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={row.rollover_enabled}
                    onChange={(event) =>
                      update(index, {
                        rollover_enabled: event.target.checked,
                      })
                    }
                  />
                  {" "}Rollover
                </label>
              </div>
              <p className="mt-2 text-xs text-muted">
                {formatCurrency(row.suggested_amount, currency)} per month.{" "}
                {row.reason}
              </p>
            </fieldset>
          ))}
        </div>

        {error && (
          <p role="alert" className="mt-4 text-sm font-semibold text-danger">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="min-h-11 rounded-field px-4 text-sm font-semibold text-muted hover:bg-panel-hover"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={loading}
            className="min-h-11 rounded-field bg-accent px-4 text-sm font-bold text-accent-foreground disabled:opacity-50"
          >
            {loading ? "Saving..." : "Confirm proposals"}
          </button>
        </div>
      </dialog>
    </div>
  );
}
