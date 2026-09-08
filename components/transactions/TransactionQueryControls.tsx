"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import PopoverBackdrop from "@/components/ui/PopoverBackdrop";
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
  review: null,
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

function filterChips(committed: LedgerFilters, options: LedgerFilterOptions) {
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

  return chips;
}

function ReviewViews({ current, count, pending, navigate }: Readonly<{
  current: LedgerFilters["review"];
  count?: number | null;
  pending: boolean;
  navigate: (patch: LedgerQueryPatch, action: string) => void;
}>) {
  const views = [
    { value: "all", id: "all", label: "All" },
    { value: "needs_review", id: "needs-review", label: "Needs review" },
    { value: "reviewed", id: "reviewed", label: "Reviewed" },
  ] as const;
  const suffix = count === 1 ? "" : "s";
  const summary = count === 0 ? "You're all caught up across all accounts." : `${count?.toLocaleString()} transaction${suffix} need review across all dates and accounts.`;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-panel-border pb-3">
      <nav aria-label="Transaction review views" className="inline-flex rounded-full border border-panel-border bg-panel-2 p-1 text-xs font-semibold shadow-sm">
        {views.map((view) => (
          <button key={view.value} type="button" id={`review-view-${view.id}`} aria-current={current === view.value ? "page" : undefined}
            disabled={pending} onClick={() => navigate({ review: view.value === "all" ? null : view.value }, `view-${view.id}`)}
            className={`rounded-full px-3 py-1.5 transition-colors ${current === view.value ? "bg-panel text-foreground shadow-sm" : "text-muted hover:text-foreground"}`}>
            {view.label}
          </button>
        ))}
      </nav>
      {typeof count === "number" && <p className="text-xs text-muted" aria-label="Global review queue count">{summary}</p>}
    </div>
  );
}

export default function TransactionQueryControls({
  committed,
  entries,
  options,
  reviewEnabled = false,
  needsReviewGlobalCount,
}: Readonly<{
  committed: LedgerFilters;
  entries: LedgerQueryEntry[];
  options: LedgerFilterOptions;
  reviewEnabled?: boolean;
  needsReviewGlobalCount?: number | null;
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
  const datePanelRef = useRef<HTMLDialogElement>(null);
  const filtersPanelRef = useRef<HTMLDialogElement>(null);

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
  const chips = filterChips(committed, options);

  function removeChip(key: keyof LedgerFilters) {
    const patch: LedgerQueryPatch = { [key]: null };
    if (key === "category") patch.sub = null;
    navigate(patch, `remove-${key}`);
  }


  return (
    <div className="space-y-3">
      {reviewEnabled && (
        <ReviewViews current={committed.review} count={needsReviewGlobalCount} pending={isPending} navigate={navigate} />
      )}

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
          {open === "date" && <PopoverBackdrop onClose={() => close("date")} />}
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
            <dialog open ref={datePanelRef} aria-label="Date filter" className="absolute left-auto right-0 top-auto z-40 m-0 mt-2 w-72 space-y-4 rounded-card border border-panel-border bg-panel p-4 text-foreground shadow-float">
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
            </dialog>
          )}
        </div>

        <div className="relative">
          {open === "filters" && <PopoverBackdrop onClose={() => close("filters")} />}
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
            <dialog open ref={filtersPanelRef} aria-label="Transaction filters" className="absolute left-auto right-0 top-auto z-40 m-0 mt-2 w-[min(24rem,calc(100vw-2rem))] space-y-4 rounded-card border border-panel-border bg-panel p-4 text-foreground shadow-float">
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
            </dialog>
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
      {isPending && <output className="sr-only">Updating transactions</output>}
    </div>
  );
}
