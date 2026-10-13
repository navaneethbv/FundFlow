import { financeTotals, type CanonicalFinanceTransaction } from "@/lib/finance-domain";
import { subcategoryLabel } from "@/lib/drilldown";
import { titleCase } from "@/lib/format";
import { isIsoDate } from "@/lib/reports";

export interface ReportAnalysisRange {
  startDate: string;
  endDate: string;
}

/**
 * A complete, already-filtered single-currency projection. Canonical rows do
 * not carry currency: the loader must partition them before calling this API
 * and must withhold incomplete/truncated or unavailable currency partitions.
 */
export interface ReportAnalysisPeriod extends ReportAnalysisRange {
  transactions: CanonicalFinanceTransaction[];
  currency: string;
}

export interface ReportMetricComparison {
  current: number;
  reference: number;
  change: number;
  /** Signed change / absolute reference; null when reference is zero. */
  percentageChange: number | null;
}

export interface ReportCategoryVariance extends ReportMetricComparison {
  key: string;
  label: string;
  groupKey: string;
  groupLabel: string;
}

export interface ReportComparisonResult {
  currentRange: ReportAnalysisRange;
  referenceRange: ReportAnalysisRange;
  currency: string;
  currentCount: number;
  referenceCount: number;
  income: ReportMetricComparison;
  spending: ReportMetricComparison;
  net: ReportMetricComparison;
  categories: ReportCategoryVariance[];
}

export interface ReportSpendingHabitsResult {
  range: ReportAnalysisRange;
  throughDate: string | null;
  currency: string;
  transactionCount: number;
  elapsedDays: number;
  totalSpending: number;
  dailyAverage: number | null;
  /** Days without a positive canonical expense; refunds do not erase activity. */
  noSpendDays: number;
  weekdays: { weekday: number; label: string; spending: number }[];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100 || 0;
}

function rangeFor(period: ReportAnalysisRange): ReportAnalysisRange {
  if (!isIsoDate(period.startDate) || !isIsoDate(period.endDate) || period.startDate > period.endDate) {
    throw new RangeError("Report analysis requires a valid inclusive date range.");
  }
  return { startDate: period.startDate, endDate: period.endDate };
}

function rowsInRange(period: ReportAnalysisPeriod, endDate: string): CanonicalFinanceTransaction[] {
  return period.transactions.filter((row) => row.date >= period.startDate && row.date <= endDate);
}

function compareMetric(current: number, reference: number): ReportMetricComparison {
  current = round2(current);
  reference = round2(reference);
  const change = round2(current - reference);
  return {
    current,
    reference,
    change,
    percentageChange: reference === 0 ? null : round2(change / Math.abs(reference) * 100),
  };
}

function categoryTotals(rows: CanonicalFinanceTransaction[]) {
  const totals = new Map<string, { row: CanonicalFinanceTransaction; amount: number }>();
  for (const row of rows) {
    if (row.flow !== "expense") continue;
    const previous = totals.get(row.categoryKey);
    totals.set(row.categoryKey, { row, amount: (previous?.amount ?? 0) + row.signedAmount });
  }
  return totals;
}

/** Compare caller-selected periods (previous period or previous year) without FX. */
export function buildReportComparison(
  current: ReportAnalysisPeriod,
  reference: ReportAnalysisPeriod,
): ReportComparisonResult | null {
  const currentRange = rangeFor(current);
  const referenceRange = rangeFor(reference);
  if (current.currency !== reference.currency) return null;
  const currentRows = rowsInRange(current, current.endDate);
  const referenceRows = rowsInRange(reference, reference.endDate);
  const currentTotals = financeTotals(currentRows);
  const referenceTotals = financeTotals(referenceRows);
  const currentCategories = categoryTotals(currentRows);
  const referenceCategories = categoryTotals(referenceRows);
  const keys = new Set([...currentCategories.keys(), ...referenceCategories.keys()]);
  const categories = [...keys].map((key): ReportCategoryVariance => {
    const currentEntry = currentCategories.get(key);
    const referenceEntry = referenceCategories.get(key);
    // Every key came from at least one map. Prefer current category metadata.
    const { row } = (currentEntry ?? referenceEntry)!;
    return {
      key,
      label: key ? subcategoryLabel(row.groupKey, key) : "Uncategorized",
      groupKey: row.groupKey,
      groupLabel: row.groupKey ? titleCase(row.groupKey) : "Uncategorized",
      ...compareMetric(round2(currentEntry?.amount ?? 0), round2(referenceEntry?.amount ?? 0)),
    };
  }).sort((a, b) => Math.abs(b.change) - Math.abs(a.change) || a.key.localeCompare(b.key));
  return {
    currentRange,
    referenceRange,
    currency: current.currency,
    currentCount: currentTotals.count,
    referenceCount: referenceTotals.count,
    income: compareMetric(currentTotals.income, referenceTotals.income),
    spending: compareMetric(currentTotals.expenses, referenceTotals.expenses),
    net: compareMetric(currentTotals.net, referenceTotals.net),
    categories,
  };
}

/** Calendar keys become UTC boundaries only for day arithmetic and weekday lookup. */
function calendarDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

/** Today must be the viewer's server-resolved calendar key, never the system clock. */
export function buildReportSpendingHabits(
  period: ReportAnalysisPeriod,
  today: string,
): ReportSpendingHabitsResult {
  const range = rangeFor(period);
  if (!isIsoDate(today)) throw new RangeError("Spending habits require a valid viewer date.");
  const endDate = period.endDate < today ? period.endDate : today;
  const elapsedDays = endDate < period.startDate
    ? 0
    : Math.round((calendarDate(endDate).getTime() - calendarDate(period.startDate).getTime()) / 86_400_000) + 1;
  const rows = rowsInRange(period, endDate);
  const spendDays = new Set<string>();
  const weekdayTotals = [0, 0, 0, 0, 0, 0, 0];
  for (const row of rows) {
    if (row.flow !== "expense") continue;
    weekdayTotals[(calendarDate(row.date).getUTCDay() + 6) % 7] += row.signedAmount;
    if (row.signedAmount > 0) spendDays.add(row.date);
  }
  const totalSpending = round2(financeTotals(rows).expenses);
  return {
    range,
    throughDate: elapsedDays > 0 ? endDate : null,
    currency: period.currency,
    transactionCount: rows.length,
    elapsedDays,
    totalSpending,
    dailyAverage: elapsedDays > 0 ? round2(totalSpending / elapsedDays) : null,
    noSpendDays: elapsedDays - spendDays.size,
    weekdays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((label, index) => ({
      weekday: (index + 1) % 7,
      label,
      spending: round2(weekdayTotals[index]),
    })),
  };
}
