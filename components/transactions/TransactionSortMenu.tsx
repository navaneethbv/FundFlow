"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";
import { ChevronDown } from "@/components/ui/icons";
import {
  ledgerHref,
  type LedgerQueryEntry,
  type LedgerSortDirection,
  type LedgerSortField,
} from "@/lib/ledger-query";

const FIELD_LABELS: Record<LedgerSortField, string> = {
  date: "Date",
  amount: "Amount",
  merchant: "Merchant",
  category: "Category",
  account: "Account",
};

function directionLabel(field: LedgerSortField, direction: LedgerSortDirection): string {
  if (field === "date") return direction === "desc" ? "newest first" : "oldest first";
  if (field === "amount") return direction === "desc" ? "high to low" : "low to high";
  return direction === "asc" ? "A to Z" : "Z to A";
}

export default function TransactionSortMenu({
  field,
  direction,
  entries,
}: Readonly<{
  field: LedgerSortField;
  direction: LedgerSortDirection;
  entries: LedgerQueryEntry[];
}>) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draftField, setDraftField] = useState(field);
  const [draftDirection, setDraftDirection] = useState(direction);
  const [isPending, startTransition] = useTransition();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLSelectElement>("select")?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function toggle() {
    if (!open) {
      setDraftField(field);
      setDraftDirection(direction);
    }
    setOpen((value) => !value);
  }

  function apply() {
    startTransition(() => {
      router.push(
        ledgerHref(entries, { sort: draftField, direction: draftDirection }),
        { scroll: false },
      );
    });
    setOpen(false);
  }

  return (
    <div className="relative">
      {open && (
        <button type="button" aria-hidden tabIndex={-1} onClick={close} className="fixed inset-0 z-30 cursor-default" />
      )}
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
        disabled={isPending}
        className="relative z-40 inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full border border-panel-border bg-panel px-3.5 text-sm font-semibold text-foreground shadow-sm transition-colors hover:border-accent/40 focus-visible:outline-2 disabled:opacity-50"
      >
        Sort: {FIELD_LABELS[field]}, {directionLabel(field, direction)}
        <ChevronDown aria-hidden className="h-4 w-4" />
      </button>
      {open && (
        <dialog open ref={panelRef} aria-label="Sort transactions" className="absolute left-auto right-0 top-auto z-40 m-0 mt-2 w-72 space-y-4 rounded-card border border-panel-border bg-panel p-4 text-foreground shadow-float">
          <label className="block text-xs font-semibold text-muted">
            Sort by
            <Select aria-label="Sort by" value={draftField} onChange={(event) => setDraftField(event.target.value as LedgerSortField)} className="mt-1">
              {Object.entries(FIELD_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </label>
          <label className="block text-xs font-semibold text-muted">
            Direction
            <Select aria-label="Direction" value={draftDirection} onChange={(event) => setDraftDirection(event.target.value as LedgerSortDirection)} className="mt-1">
              <option value="asc">{directionLabel(draftField, "asc")}</option>
              <option value="desc">{directionLabel(draftField, "desc")}</option>
            </Select>
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button onClick={apply} loading={isPending}>Apply</Button>
          </div>
        </dialog>
      )}
      {isPending && <output className="sr-only">Updating transaction sorting</output>}
    </div>
  );
}
