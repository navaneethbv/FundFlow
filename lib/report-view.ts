import { computePeriodCashFlow, partitionCashFlowByCurrency } from "@/lib/cash-flow";
import { UNKNOWN_CURRENCY } from "@/lib/format";
import { buildReportComparison, buildReportSpendingHabits } from "@/lib/report-analysis";
import { buildReportFacets, getReportComparisonRange } from "@/lib/report-explorer";
import { applyReportSort, summarizeTransactions, type ReportFilters } from "@/lib/reports";
import type { ReportDataResult } from "@/lib/reports-data";

/** Keep currency selection and completeness decisions identical across report panels. */
export function buildReportView(current: ReportDataResult, reference: ReportDataResult | null, filters: ReportFilters, today: string) {
  const byCurrency = partitionCashFlowByCurrency(current.transactions, current.currencyByAccountId);
  const selectedCurrency = filters.currency ?? byCurrency.keys().next().value ?? UNKNOWN_CURRENCY;
  const currencies = [...new Set([...byCurrency.keys(), selectedCurrency])];
  const rows = byCurrency.get(selectedCurrency) ?? [];
  const period = { transactions: rows, startDate: filters.start, endDate: filters.end, currency: selectedCurrency };
  const { comparison, comparisonUnavailable } = reportComparison(current, reference, filters, selectedCurrency, rows);
  const facets = reportViewFacets(current, filters);
  return {
    selectedCurrency, currencies, rows,
    orderedRows: applyReportSort(rows, filters),
    summary: summarizeTransactions(rows),
    periods: computePeriodCashFlow(rows, filters.interval ?? "monthly"),
    facets,
    comparison, comparisonUnavailable,
    habits: current.truncated || selectedCurrency === UNKNOWN_CURRENCY ? null : buildReportSpendingHabits(period, today),
  };
}

function reportViewFacets(current: ReportDataResult, filters: ReportFilters) {
  const facets = buildReportFacets(current.facetTransactions ?? current.transactions, current.accountNames);
  for (const id of filters.accounts) {
    const label = current.accountNames?.get(id);
    if (label && !facets.accounts.some(account => account.value === id)) {
      facets.accounts.push({ value: id, label });
    }
  }
  facets.accounts.sort((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value));
  return facets;
}

function reportComparison(current: ReportDataResult, reference: ReportDataResult | null, filters: ReportFilters,
  currency: string, rows: ReportDataResult["transactions"]) {
  const range = getReportComparisonRange(filters);
  const unavailable = (comparisonUnavailable: string | null) => ({ comparison: null, comparisonUnavailable });
  if (!range) return unavailable(null);
  if (!reference) return unavailable("Comparison data is unavailable. Try again.");
  if (current.truncated || reference.truncated) {
    return unavailable("Comparison is unavailable because a period is incomplete. Narrow the date range.");
  }
  const referenceRows = partitionCashFlowByCurrency(reference.transactions, reference.currencyByAccountId).get(currency);
  if (currency === UNKNOWN_CURRENCY || rows.length === 0 || !referenceRows?.length) {
    return unavailable("No matching transactions in this currency for one of the periods. Missing data is not assumed to be zero.");
  }
  return {
    comparison: buildReportComparison(
      { transactions: rows, startDate: filters.start, endDate: filters.end, currency },
      { transactions: referenceRows, startDate: range.start, endDate: range.end, currency }),
    comparisonUnavailable: null,
  };
}
