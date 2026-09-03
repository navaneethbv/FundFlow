"use client";

import { useState } from "react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Input, { fieldClasses } from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";
import TransactionOverrideControl, {
  type TransactionOverride,
} from "@/components/transactions/TransactionOverrideControl";
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
  /** Raw provider primary category (immutable fact shown to the user). */
  providerCategory?: string | null;
  /** Current transaction-level classification override, when one exists. */
  override?: TransactionOverride | null;
  /** Reconcile cleared flag; omitted where the surface doesn't track it. */
  cleared?: boolean;
  /**
   * Distinguishes the mobile and desktop copies of the same row. The ledger
   * renders both for responsive layout, so without a prefix the two copies
   * emit identical `note-<id>`/`tags-<id>`/`cats-<id>` ids and a label can
   * bind to the hidden copy.
   */
  idPrefix?: string;
}

interface SplitRow {
  id: string;
  category: string;
  amount: string;
}

function toSplitRow(split: { category: string; amount: number }): SplitRow {
  return { id: crypto.randomUUID(), category: split.category, amount: String(split.amount) };
}

const round2 = (value: number) => Math.round(value * 100) / 100;

function TransactionSplitSection({
  rows,
  target,
  currency,
  categories,
  inputId,
  updateRow,
  removeRow,
  setRows,
  applySplitPreset,
  splitTotal,
  splitsBalanced,
  activeRows,
}: Readonly<{
  rows: SplitRow[];
  target: number;
  currency: string;
  categories: string[];
  inputId: (suffix: string) => string;
  updateRow: (id: string, patch: Partial<Omit<SplitRow, "id">>) => void;
  removeRow: (id: string) => void;
  setRows: React.Dispatch<React.SetStateAction<SplitRow[]>>;
  applySplitPreset: (parts: number) => void;
  splitTotal: number;
  splitsBalanced: boolean;
  activeRows: SplitRow[];
}>) {
  let splitBarColor = "bg-accent";
  if (splitTotal > target) splitBarColor = "bg-danger";
  if (splitsBalanced) splitBarColor = "bg-success";

  return (
    <>
      <div className="mb-2 mt-4 flex items-center justify-between">
        <span className="text-sm font-medium">Split by category</span>
        {activeRows.length > 0 && (
          <span
            className={cn(
              "text-xs font-semibold",
              splitsBalanced ? "text-muted" : "text-danger",
            )}
          >
            {formatCurrency(splitTotal, currency)} / {formatCurrency(target, currency)}
          </span>
        )}
      </div>
      {activeRows.length > 0 && (
        <div className="mb-3 space-y-1">
          <div className="flex justify-between text-xs font-semibold">
            <span>Allocated: {formatCurrency(splitTotal, currency)}</span>
            <span className={splitsBalanced ? "text-success" : "text-warning font-bold"}>
              {splitsBalanced
                ? "Balanced"
                : `Remaining: ${formatCurrency(round2(target - splitTotal), currency)}`}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-panel-2">
            <div
              className={cn(
                "h-full transition-all duration-200",
                splitBarColor,
              )}
              style={{ width: `${Math.min(100, (splitTotal / target) * 100)}%` }}
            />
          </div>
        </div>
      )}
      <datalist id={inputId("cats")}>
        {categories.map((c) => (
          <option key={c} value={c}>
            {titleCase(c)}
          </option>
        ))}
      </datalist>
      <div className="space-y-2">
        {rows.map((row, index) => {
          const categoryId = `${inputId("split-category")}-${row.id}`;
          const amountId = `${inputId("split-amount")}-${row.id}`;
          return (
            <div key={row.id} className="flex gap-2">
              <label className="sr-only" htmlFor={categoryId}>
                Category for split {index + 1}
              </label>
              <input
                id={categoryId}
                list={inputId("cats")}
                value={row.category}
                onChange={(e) => {
                  updateRow(row.id, { category: e.target.value });
                }}
                placeholder="Category"
                className={cn(fieldClasses, "flex-1")}
              />
              <label className="sr-only" htmlFor={amountId}>
                Amount for split {index + 1}
              </label>
              <input
                id={amountId}
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={row.amount}
                onChange={(e) => {
                  updateRow(row.id, { amount: e.target.value });
                }}
                placeholder="0.00"
                className={cn(fieldClasses, "w-24 tabular-nums")}
              />
              <button
                type="button"
                onClick={() => {
                  removeRow(row.id);
                }}
                className="rounded-field px-2 text-muted hover:bg-panel-hover hover:text-danger"
                aria-label={`Remove split ${index + 1}`}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              const unallocated = round2(Math.max(0, target - splitTotal));
              setRows((cur) => [
                ...cur,
                {
                  id: crypto.randomUUID(),
                  category: "",
                  amount: unallocated > 0 ? String(unallocated) : "",
                },
              ]);
            }}
          >
            Add split
          </Button>
          {rows.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setRows([]);
              }}
              className="text-xs text-muted hover:text-foreground"
            >
              Clear splits
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-muted">Presets:</span>
          <button
            type="button"
            onClick={() => {
              applySplitPreset(2);
            }}
            className="rounded-field bg-panel-2 px-2 py-0.5 font-medium hover:bg-panel-hover"
          >
            50/50
          </button>
          <button
            type="button"
            onClick={() => {
              applySplitPreset(3);
            }}
            className="rounded-field bg-panel-2 px-2 py-0.5 font-medium hover:bg-panel-hover"
          >
            1/3
          </button>
          <button
            type="button"
            onClick={() => {
              applySplitPreset(4);
            }}
            className="rounded-field bg-panel-2 px-2 py-0.5 font-medium hover:bg-panel-hover"
          >
            1/4
          </button>
        </div>
      </div>
    </>
  );
}

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
  providerCategory = null,
  override = null,
  cleared: initialCleared,
  idPrefix = "",
}: Readonly<TransactionEditorProps>) {
  const target = round2(Math.abs(transaction.amount));
  const inputId = (suffix: string) => `${idPrefix}${suffix}-${transaction.id}`;

  const [saved, setSaved] = useState({
    note: initialNote ?? "",
    tags: initialTags,
    splits: initialSplits,
  });
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(saved.note);
  const [tagText, setTagText] = useState(saved.tags.join(", "));
  const [cleared, setCleared] = useState(initialCleared ?? false);
  const [rows, setRows] = useState<SplitRow[]>(() => saved.splits.map(toSplitRow));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openEditor() {
    setNote(saved.note);
    setTagText(saved.tags.join(", "));
    setRows(saved.splits.map(toSplitRow));
    setError(null);
    setOpen(true);
  }

  function updateRow(id: string, patch: Partial<Omit<SplitRow, "id">>) {
    setRows((cur) => cur.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function removeRow(id: string) {
    setRows((cur) => cur.filter((r) => r.id !== id));
  }

  const parsedTags = tagText
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const activeRows = rows.filter((r) => r.category.trim() && r.amount.trim());
  const splitTotal = round2(activeRows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0));
  const splitsBalanced = activeRows.length === 0 || Math.abs(splitTotal - target) < 0.01;
  const hasAnnotations = saved.note.length > 0 || saved.tags.length > 0 || saved.splits.length > 0;

  function applySplitPreset(parts: number) {
    if (parts <= 0) return;
    const perPart = round2(target / parts);
    const remainder = round2(target - perPart * (parts - 1));
    const newRows = Array.from({ length: parts }, (_, i) => ({
      id: crypto.randomUUID(),
      category: rows[i]?.category || "",
      amount: String(i === parts - 1 ? remainder : perPart),
    }));
    setRows(newRows);
  }

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
          ...(initialCleared !== undefined ? { cleared } : {}),
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
          "inline-flex min-h-11 min-w-11 items-center justify-center rounded-field px-2 py-1 text-xs font-medium transition-colors sm:min-h-0 sm:min-w-0",
          hasAnnotations
            ? "text-accent hover:bg-panel-hover"
            : "text-muted hover:bg-panel-hover hover:text-foreground",
        )}
        aria-label={hasAnnotations ? "Edit notes and splits" : "Add notes or splits"}
      >
        {hasAnnotations ? "Edit" : "Add"}
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        placement="sheet"
        titleId={`${idPrefix}title-${transaction.id}`}
        className="max-h-[90vh] max-w-lg overflow-y-auto"
      >
            <div className="mb-4">
              <p className="text-xs uppercase tracking-wider text-muted">
                {transaction.amount < 0 ? "Money in" : "Money out"} ·{" "}
                {formatCurrency(target, transaction.currency)}
              </p>
              <h2 id={`${idPrefix}title-${transaction.id}`} className="text-lg font-semibold">{transaction.merchant}</h2>
            </div>

            <label className="mb-1 block text-sm font-medium" htmlFor={inputId("note")}>
              Note
            </label>
            <textarea
              id={inputId("note")}
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
              }}
              maxLength={500}
              rows={2}
              placeholder="Add a note"
              className={cn(fieldClasses, "mb-4 resize-y")}
            />

            <label className="mb-1 block text-sm font-medium" htmlFor={inputId("tags")}>
              Tags <span className="font-normal text-muted">(comma separated)</span>
            </label>
            <Input
              id={inputId("tags")}
              value={tagText}
              onChange={(e) => {
                setTagText(e.target.value);
              }}
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

            {initialCleared !== undefined && (
              <label className="mb-4 flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={cleared}
                  onChange={(e) => setCleared(e.target.checked)}
                />
                <span>Cleared (reconciled against the bank)</span>
              </label>
            )}

            <TransactionSplitSection
              rows={rows}
              target={target}
              currency={transaction.currency}
              categories={categories}
              inputId={inputId}
              updateRow={updateRow}
              removeRow={removeRow}
              setRows={setRows}
              applySplitPreset={applySplitPreset}
              splitTotal={splitTotal}
              splitsBalanced={splitsBalanced}
              activeRows={activeRows}
            />

            <TransactionOverrideControl
              transactionId={transaction.id}
              providerCategory={providerCategory}
              initialOverride={{
                displayCategory: override?.displayCategory ?? null,
                cashFlowClassification: override?.cashFlowClassification ?? null,
              }}
              categories={categories}
            />

            {error && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setOpen(false);
                }}
              >
                Cancel
              </Button>
              <Button type="button" onClick={save} loading={saving} disabled={activeRows.length > 0 && !splitsBalanced}>
                Save
              </Button>
            </div>
      </Modal>
    </>
  );
}
