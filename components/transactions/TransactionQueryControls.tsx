"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import { Calendar, ChevronDown, Search, X } from "@/components/ui/icons";
import { formatMonth, titleCase } from "@/lib/format";
import {
  hasActiveLedgerFilters,
  ledgerHref,
  type LedgerFilters,
  type LedgerQueryEntry,
  type LedgerQueryPatch,
} from "@/lib/ledger-query";
import type { LedgerFilterOptions } from "@/lib/ledger-projection";

type OpenPanel = "date" | "filters" | null;

const CLEAR_FILTERS: LedgerQueryPatch = {
  q: null,
  month: null,
  accountId: null,
  category: null,
  sub: null,
  merchant: null,
  flow: null,
  accountType: null,
};

const triggerClasses =
  "inline-flex min-h-11 items-center gap-2 rounded-full border border-panel-border bg-panel px-4 text-sm font-semibold text-foreground shadow-sm transition-colors hover:border-accent/40 focus-visible:outline-2";

function filterCount(filters: LedgerFilters): number {
  return [
    filters.accountId,
    filters.category,
    filters.sub,
    filters.merchant,
    filters.flow,
    filters.accountType,
  ].filter(Boolean).length;
}

export default function TransactionQueryControls({
  committed,
  entries,
  options,
}: Readonly<{
  committed: LedgerFilters;
  entries: LedgerQueryEntry[];
  options: LedgerFilterOptions;
}>) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [open, setOpen] = useState<OpenPanel>(null);
  const [search, setSearch] = useState(committed.q);
  const [monthDraft, setMonthDraft] = useState(committed.month);
  const [filterDraft, setFilterDraft] = useState(committed);
  const dateTriggerRef = useRef<HTMLButtonElement>(null);
  const filtersTriggerRef = useRef<HTMLButtonElement>(null);
  const datePanelRef = useRef<HTMLDivElement>(null);
  const filtersPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const panel = open === "date" ? datePanelRef.current : filtersPanelRef.current;
    const firstControl = panel?.querySelector<HTMLInputElement | HTMLSelectElement>("input, select");
    firstControl?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      const trigger = open === "date" ? dateTriggerRef.current : filtersTriggerRef.current;
      setOpen(null);
      trigger?.focus();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  function navigate(patch: LedgerQueryPatch, action: string) {
    setPendingAction(action);
    startTransition(() => {
      router.push(ledgerHref(entries, patch), { scroll: false });
    });
  }

  function close(panel: Exclude<OpenPanel, null>) {
    setOpen(null);
    const trigger = panel === "date" ? dateTriggerRef.current : filtersTriggerRef.current;
    trigger?.focus();
  }

  function openDate() {
    setMonthDraft(committed.month);
    setOpen((current) => (current === "date" ? null : "date"));
  }

  function openFilters() {
    setFilterDraft(committed);
    setOpen((current) => (current === "filters" ? null : "filters"));
  }

  function applyFilters() {
    navigate(
      {
        accountId: filterDraft.accountId,
        category: filterDraft.category,
        sub: filterDraft.category ? filterDraft.sub : null,
        merchant: filterDraft.merchant,
        flow: filterDraft.flow,
        accountType: filterDraft.accountType,
      },
      "filters",
    );
    setOpen(null);
  }

  const categorySubcategories = filterDraft.category
    ? (options.subcategoriesByCategory[filterDraft.category] ?? [])
    : [];
  const activeFilters = filterCount(committed);
  const accountLabel = options.accounts.find((option) => option.value === committed.accountId)?.label;
  const subLabel = committed.sub
    ? Object.values(options.subcategoriesByCategory)
        .flat()
        .find((option) => option.value === committed.sub)?.label
    : undefined;
  const chips: Array<{ key: keyof LedgerFilters; label: string; removeLabel: string }> = [
    committed.q && { key: "q", label: `Search: ${committed.q}`, removeLabel: `Remove search filter ${committed.q}` },
    committed.month && {
      key: "month",
      label: formatMonth(committed.month),
      removeLabel: `Remove date filter ${formatMonth(committed.month)}`,
    },
    committed.accountId && {
      key: "accountId",
      label: accountLabel ?? "Account",
      removeLabel: `Remove account filter ${accountLabel ?? "Account"}`,
    },
    committed.category && {
      key: "category",
      label: titleCase(committed.category),
      removeLabel: `Remove category filter ${titleCase(committed.category)}`,
    },
    committed.sub && {
      key: "sub",
      label: subLabel ?? titleCase(committed.sub),
      removeLabel: `Remove subcategory filter ${subLabel ?? titleCase(committed.sub)}`,
    },
    committed.merchant && {
      key: "merchant",
      label: committed.merchant,
      removeLabel: `Remove merchant filter ${committed.merchant}`,
    },
    committed.flow && {
      key: "flow",
      label: committed.flow === "in" ? "Money in" : "Money out",
      removeLabel: `Remove ${committed.flow === "in" ? "money in" : "money out"} filter`,
    },
    committed.accountType && {
      key: "accountType",
      label: titleCase(committed.accountType),
      removeLabel: `Remove account type filter ${titleCase(committed.accountType)}`,
    },
  ].filter((chip): chip is { key: keyof LedgerFilters; label: string; removeLabel: string } => Boolean(chip));

  function removeChip(key: keyof LedgerFilters) {
    const patch: LedgerQueryPatch = { [key]: null };
    if (key === "category") patch.sub = null;
    navigate(patch, `remove-${key}`);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="flex min-w-64 flex-1 items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            navigate({ q: search.trim() || null }, "search");
          }}
        >
          <div className="relative flex-1">
            <Search aria-hidden className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted" />
            <Input
              type="search"
              aria-label="Search transactions"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search transactions"
              className="pl-9"
            />
          </div>
          <Button type="submit" variant="secondary" loading={isPending && pendingAction === "search"}>
            Search
          </Button>
        </form>

        <div className="relative">
          {open === "date" && (
            <button type="button" aria-hidden tabIndex={-1} onClick={() => close("date")} className="fixed inset-0 z-30 cursor-default" />
          )}
          <button
            ref={dateTriggerRef}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={open === "date"}
            onClick={openDate}
            className={triggerClasses}
          >
            <Calendar aria-hidden className="h-4 w-4" />
            {committed.month ? `Date: ${formatMonth(committed.month)}` : "Date"}
            <ChevronDown aria-hidden className="h-4 w-4" />
          </button>
          {open === "date" && (
            <div ref={datePanelRef} role="dialog" aria-label="Date filter" className="absolute right-0 z-40 mt-2 w-72 space-y-4 rounded-card border border-panel-border bg-panel p-4 shadow-float">
              <label className="block text-xs font-semibold text-muted">
                Month
                <Input aria-label="Month" type="month" value={monthDraft} onChange={(event) => setMonthDraft(event.target.value)} className="mt-1" />
              </label>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => close("date")}>Cancel</Button>
                <Button
                  onClick={() => {
                    navigate({ month: monthDraft }, "date");
                    setOpen(null);
                  }}
                  loading={isPending && pendingAction === "date"}
                >
                  Apply
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="relative">
          {open === "filters" && (
            <button type="button" aria-hidden tabIndex={-1} onClick={() => close("filters")} className="fixed inset-0 z-30 cursor-default" />
          )}
          <button
            ref={filtersTriggerRef}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={open === "filters"}
            onClick={openFilters}
            className={triggerClasses}
          >
            Filters{activeFilters > 0 ? ` (${activeFilters})` : ""}
            <ChevronDown aria-hidden className="h-4 w-4" />
          </button>
          {open === "filters" && (
            <div ref={filtersPanelRef} role="dialog" aria-label="Transaction filters" className="absolute right-0 z-40 mt-2 w-[min(24rem,calc(100vw-2rem))] space-y-4 rounded-card border border-panel-border bg-panel p-4 shadow-float">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-semibold text-muted">
                  Account
                  <Select aria-label="Account" value={filterDraft.accountId} onChange={(event) => setFilterDraft((value) => ({ ...value, accountId: event.target.value }))} className="mt-1">
                    <option value="">All accounts</option>
                    {options.accounts.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </Select>
                </label>
                <label className="text-xs font-semibold text-muted">
                  Category
                  <Select aria-label="Category" value={filterDraft.category} onChange={(event) => setFilterDraft((value) => ({ ...value, category: event.target.value, sub: "" }))} className="mt-1">
                    <option value="">All categories</option>
                    {options.categories.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </Select>
                </label>
                <label className="text-xs font-semibold text-muted">
                  Subcategory
                  <Select aria-label="Subcategory" disabled={!filterDraft.category} value={filterDraft.sub} onChange={(event) => setFilterDraft((value) => ({ ...value, sub: event.target.value }))} className="mt-1">
                    <option value="">All subcategories</option>
                    {categorySubcategories.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </Select>
                </label>
                <label className="text-xs font-semibold text-muted">
                  Merchant
                  <Input aria-label="Merchant" list="transaction-merchant-options" value={filterDraft.merchant} onChange={(event) => setFilterDraft((value) => ({ ...value, merchant: event.target.value }))} className="mt-1" placeholder="Any merchant" />
                  <datalist id="transaction-merchant-options">
                    {options.merchants.map((option) => <option key={option} value={option} />)}
                  </datalist>
                </label>
                <label className="text-xs font-semibold text-muted">
                  Money direction
                  <Select aria-label="Money direction" value={filterDraft.flow} onChange={(event) => setFilterDraft((value) => ({ ...value, flow: event.target.value as LedgerFilters["flow"] }))} className="mt-1">
                    <option value="">Money in and out</option>
                    <option value="in">Money in</option>
                    <option value="out">Money out</option>
                  </Select>
                </label>
                <label className="text-xs font-semibold text-muted">
                  Account type
                  <Select aria-label="Account type" value={filterDraft.accountType} onChange={(event) => setFilterDraft((value) => ({ ...value, accountType: event.target.value as LedgerFilters["accountType"] }))} className="mt-1">
                    <option value="">All account types</option>
                    <option value="depository">Depository</option>
                    <option value="credit">Credit</option>
                  </Select>
                </label>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => close("filters")}>Cancel</Button>
                <Button onClick={applyFilters} loading={isPending && pendingAction === "filters"}>Apply</Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" aria-label="Applied filters">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              aria-label={chip.removeLabel}
              disabled={isPending}
              onClick={() => removeChip(chip.key)}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-panel-border bg-panel-2 px-3 text-xs font-semibold text-foreground hover:border-accent/40 focus-visible:outline-2 disabled:opacity-50"
            >
              {chip.label}
              <X aria-hidden className="h-3.5 w-3.5" />
            </button>
          ))}
          {hasActiveLedgerFilters(committed) && (
            <Button variant="ghost" onClick={() => navigate(CLEAR_FILTERS, "clear")} loading={isPending && pendingAction === "clear"}>
              Clear filters
            </Button>
          )}
        </div>
      )}
      {isPending && <span className="sr-only" role="status">Updating transactions</span>}
    </div>
  );
}
