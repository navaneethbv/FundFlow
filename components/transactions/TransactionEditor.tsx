"use client";

import { useEffect, useState } from "react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Input, { fieldClasses } from "@/components/ui/Input";
import { cn } from "@/lib/cn";
import { formatCurrency, titleCase } from "@/lib/format";

export interface EditorSplit {
  category: string;
  amount: number;
}

interface TransactionEditorProps {
  transaction: { id: string; merchant: string; amount: number; currency: string };
  note: string | null;
  tags: string[];
  splits: EditorSplit[];
  categories: string[];
}

interface SplitRow {
  category: string;
  amount: string;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Per-row notes/tags/splits editor for the ledger. The row stays server-
 * rendered; this renders a small trigger (with an indicator when annotations or
 * splits exist) plus a modal that saves through /api/transactions/annotate.
 * Splits must sum to the transaction amount (enforced client-side and by a DB
 * trigger); leaving them empty removes them.
 */
export default function TransactionEditor({
  transaction,
  note: initialNote,
  tags: initialTags,
  splits: initialSplits,
  categories,
}: TransactionEditorProps) {
  const target = round2(Math.abs(transaction.amount));

  const [saved, setSaved] = useState({
    note: initialNote ?? "",
    tags: initialTags,
    splits: initialSplits,
  });
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(saved.note);
  const [tagText, setTagText] = useState(saved.tags.join(", "));
  const [rows, setRows] = useState<SplitRow[]>(
    saved.splits.map((s) => ({ category: s.category, amount: String(s.amount) })),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function openEditor() {
    setNote(saved.note);
    setTagText(saved.tags.join(", "));
    setRows(saved.splits.map((s) => ({ category: s.category, amount: String(s.amount) })));
    setError(null);
    setOpen(true);
  }

  const parsedTags = tagText
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const activeRows = rows.filter((r) => r.category.trim() && r.amount.trim());
  const splitTotal = round2(activeRows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0));
  const splitsBalanced = activeRows.length === 0 || Math.abs(splitTotal - target) < 0.01;
  const hasAnnotations = saved.note.length > 0 || saved.tags.length > 0 || saved.splits.length > 0;

  async function save() {
    setError(null);
    if (activeRows.length > 0 && !splitsBalanced) {
      setError(`Splits must total ${formatCurrency(target, transaction.currency)}.`);
      return;
    }
    setSaving(true);
    try {
      const splitPayload = activeRows.map((r) => ({
        category: r.category.trim(),
        amount: round2(Number(r.amount)),
      }));
      const res = await fetch("/api/transactions/annotate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          transaction_id: transaction.id,
          note,
          tags: parsedTags,
          splits: splitPayload,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? "Could not save.");
      }
      setSaved({ note: note.trim(), tags: parsedTags, splits: splitPayload });
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openEditor}
        className={cn(
          "rounded-field px-2 py-1 text-xs font-medium transition-colors",
          hasAnnotations
            ? "text-accent hover:bg-panel-hover"
            : "text-muted hover:bg-panel-hover hover:text-foreground",
        )}
        aria-label={hasAnnotations ? "Edit notes and splits" : "Add notes or splits"}
      >
        {hasAnnotations ? "Edit" : "Add"}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-panel-border bg-panel p-5 shadow-pop sm:rounded-2xl">
            <div className="mb-4">
              <p className="text-xs uppercase tracking-wider text-muted">
                {transaction.amount < 0 ? "Money in" : "Money out"} ·{" "}
                {formatCurrency(target, transaction.currency)}
              </p>
              <h2 className="text-lg font-semibold">{transaction.merchant}</h2>
            </div>

            <label className="mb-1 block text-sm font-medium" htmlFor={`note-${transaction.id}`}>
              Note
            </label>
            <textarea
              id={`note-${transaction.id}`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              rows={2}
              placeholder="Add a note"
              className={cn(fieldClasses, "mb-4 resize-y")}
            />

            <label className="mb-1 block text-sm font-medium" htmlFor={`tags-${transaction.id}`}>
              Tags <span className="font-normal text-muted">(comma separated)</span>
            </label>
            <Input
              id={`tags-${transaction.id}`}
              value={tagText}
              onChange={(e) => setTagText(e.target.value)}
              placeholder="reimbursable, vacation"
              className="mb-2"
            />
            {parsedTags.length > 0 && (
              <div className="mb-4 flex flex-wrap gap-1.5">
                {parsedTags.map((t) => (
                  <Badge key={t}>{t}</Badge>
                ))}
              </div>
            )}

            <div className="mb-2 mt-4 flex items-center justify-between">
              <span className="text-sm font-medium">Split by category</span>
              {activeRows.length > 0 && (
                <span
                  className={cn(
                    "text-xs font-semibold",
                    splitsBalanced ? "text-muted" : "text-danger",
                  )}
                >
                  {formatCurrency(splitTotal, transaction.currency)} / {formatCurrency(target, transaction.currency)}
                </span>
              )}
            </div>
            <datalist id={`cats-${transaction.id}`}>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {titleCase(c)}
                </option>
              ))}
            </datalist>
            <div className="space-y-2">
              {rows.map((row, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    list={`cats-${transaction.id}`}
                    value={row.category}
                    onChange={(e) =>
                      setRows((cur) => cur.map((r, j) => (j === i ? { ...r, category: e.target.value } : r)))
                    }
                    placeholder="Category"
                    className={cn(fieldClasses, "flex-1")}
                  />
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    value={row.amount}
                    onChange={(e) =>
                      setRows((cur) => cur.map((r, j) => (j === i ? { ...r, amount: e.target.value } : r)))
                    }
                    placeholder="0.00"
                    className={cn(fieldClasses, "w-24 tabular-nums")}
                  />
                  <button
                    type="button"
                    onClick={() => setRows((cur) => cur.filter((_, j) => j !== i))}
                    className="rounded-field px-2 text-muted hover:bg-panel-hover hover:text-danger"
                    aria-label="Remove split"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-3">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setRows((cur) => [...cur, { category: "", amount: "" }])}
              >
                Add split
              </Button>
              {rows.length > 0 && (
                <button
                  type="button"
                  onClick={() => setRows([])}
                  className="text-xs text-muted hover:text-foreground"
                >
                  Clear splits
                </button>
              )}
            </div>

            {error && <p className="mt-4 text-sm text-danger">{error}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={save} loading={saving} disabled={activeRows.length > 0 && !splitsBalanced}>
                Save
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
