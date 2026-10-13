import type { CanonicalFinanceTransaction } from "@/lib/finance-domain";
import { isIsoDate, reportFiltersToSearchParams, type ReportFilters } from "@/lib/reports";
import { titleCase } from "@/lib/format";

export interface ReportDateRange { start: string; end: string }
export type ReportPreset = "this_month" | "last_month" | "last_30_days" | "last_90_days" | "year_to_date" | "prior_year";
export interface ReportFacet { value: string; label: string }
export interface ReportFacets { accounts: ReportFacet[]; categories: ReportFacet[]; merchants: ReportFacet[] }

/** A report navigation always resets table pagination and retains other filters. */
export function reportHref(filters: ReportFilters, patch: Partial<ReportFilters> = {}): string {
  return `/reports?${reportFiltersToSearchParams({ ...filters, ...patch }).toString()}`;
}

const DAY_MS = 86_400_000;
const utcDate = (key: string): Date => new Date(`${key}T00:00:00Z`);
// These are explicit UTC calendar boundaries, never a conversion of viewer time.
const dateKey = (date: Date): string => date.toISOString().slice(0, 10);
const addDays = (date: Date, days: number): Date => new Date(date.getTime() + days * DAY_MS);

function validRange(range: ReportDateRange): boolean {
  return isIsoDate(range.start) && isIsoDate(range.end) && range.start <= range.end;
}

function rangeFromDates(start: Date, end: Date): ReportDateRange | null {
  const range = { start: dateKey(start), end: dateKey(end) };
  return validRange(range) ? range : null;
}

function addMonths(firstDay: Date, months: number): Date {
  const result = new Date(firstDay);
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}

/** Pure presets anchored to resolveViewerToday's date, never the server clock. */
export function getReportPresetRange(preset: ReportPreset, today: string): ReportDateRange | null {
  if (!isIsoDate(today)) return null;
  const anchor = utcDate(today);
  const monthStart = utcDate(`${today.slice(0, 7)}-01`);
  switch (preset) {
    case "this_month": return rangeFromDates(monthStart, addDays(addMonths(monthStart, 1), -1));
    case "last_month": return rangeFromDates(addMonths(monthStart, -1), addDays(monthStart, -1));
    case "last_30_days": return rangeFromDates(addDays(anchor, -29), anchor);
    case "last_90_days": return rangeFromDates(addDays(anchor, -89), anchor);
    case "year_to_date": return { start: `${today.slice(0, 4)}-01-01`, end: today };
    case "prior_year": {
      const yearStart = utcDate(`${today.slice(0, 4)}-01-01`);
      return rangeFromDates(addMonths(yearStart, -12), addDays(yearStart, -1));
    }
  }
}

/**
 * Whole calendar-month spans move by their month count (a February stays a
 * February). Other ranges move by their inclusive day count, without overlap.
 */
export function getAdjacentReportRange(range: ReportDateRange, direction: "previous" | "next"): ReportDateRange | null {
  if (!validRange(range)) return null;
  const start = utcDate(range.start);
  const end = utcDate(range.end);
  const endExclusive = addDays(end, 1);
  const sign = direction === "previous" ? -1 : 1;
  if (start.getUTCDate() === 1 && endExclusive.getUTCDate() === 1) {
    const months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth() + 1;
    return rangeFromDates(addMonths(start, sign * months), addDays(addMonths(endExclusive, sign * months), -1));
  }
  const days = (end.getTime() - start.getTime()) / DAY_MS + 1;
  return rangeFromDates(addDays(start, sign * days), addDays(end, sign * days));
}

function priorYearDate(key: string): Date {
  const original = utcDate(key);
  const start = new Date(original);
  start.setUTCDate(1);
  start.setUTCFullYear(start.getUTCFullYear() - 1);
  const lastDay = addDays(addMonths(start, 1), -1).getUTCDate();
  start.setUTCDate(Math.min(original.getUTCDate(), lastDay));
  return start;
}

/**
 * Inclusive reference dates for the page's second canonical load. The caller
 * must retain the same scope, pending, account, category, merchant and currency
 * settings. Previous-period uses adjacent calendar spans; previous-year clamps
 * Feb 29 to Feb 28. Disabled/invalid/out-of-bounds comparisons return null.
 */
export function getReportComparisonRange(filters: ReportFilters): ReportDateRange | null {
  if (!validRange(filters) || !filters.comparison || filters.comparison === "none") return null;
  if (filters.comparison === "previous_period") return getAdjacentReportRange(filters, "previous");
  return rangeFromDates(priorYearDate(filters.start), priorYearDate(filters.end));
}

/** Facets only from caller-supplied, owner-visible canonical rows; no reads. */
export function buildReportFacets(rows: readonly CanonicalFinanceTransaction[], accountLabels: ReadonlyMap<string, string> = new Map()): ReportFacets {
  const accounts = new Map<string, ReportFacet>();
  const categories = new Map<string, ReportFacet>();
  const merchants = new Map<string, ReportFacet>();
  const add = (map: Map<string, ReportFacet>, value: string, label: string): void => {
    const trimmed = value.trim();
    if (trimmed && !map.has(trimmed.toLowerCase())) map.set(trimmed.toLowerCase(), { value: trimmed, label });
  };
  for (const row of rows) {
    const account = row.accountId ?? row.manualAccountId;
    if (account) add(accounts, account, accountLabels.get(account) || account);
    add(categories, row.categoryKey, row.categoryKey.trim().toUpperCase() === "UNCATEGORIZED" ? "Unknown" : titleCase(row.categoryKey));
    add(merchants, row.merchant, row.merchant.trim());
  }
  const sorted = (map: Map<string, ReportFacet>): ReportFacet[] => [...map.values()].sort((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value));
  return { accounts: sorted(accounts), categories: sorted(categories), merchants: sorted(merchants) };
}
