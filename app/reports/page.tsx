import Link from "next/link";
import { notFound } from "next/navigation";
import AppShell from "@/components/shell/AppShell";
import PageHeader from "@/components/shell/PageHeader";
import BreakdownBars from "@/components/cash-flow/BreakdownBars";
import PeriodBars from "@/components/cash-flow/PeriodBars";
import SankeyChart from "@/components/charts/SankeyChart";
import ReportControls, { reportHref, TAB_LABELS } from "@/components/reports/ReportControls";
import ReportRightRail from "@/components/reports/ReportRightRail";
import ReportSummaryPanel from "@/components/reports/ReportSummaryPanel";
import ReportTransactions from "@/components/reports/ReportTransactions";
import SavedReportsSection from "@/components/reports/SavedReportsSection";
import ExportReportButton from "@/components/review/ExportReportButton";
import EmptyState from "@/components/ui/EmptyState";
import Panel from "@/components/ui/Panel";
import Tabs from "@/components/ui/Tabs";
import { LineChart } from "@/components/ui/icons";
import {
  breakdownBy,
  computePeriodCashFlow,
  partitionCashFlowByCurrency,
} from "@/lib/cash-flow";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { serializeFinancialScope } from "@/lib/financial-scope";
import { UNKNOWN_CURRENCY } from "@/lib/format";
import {
  applyReportSort,
  buildCashFlowSankeyData,
  defaultReportFilters,
  reportFiltersFromSearchParams,
  reportFiltersToSearchParams,
  summarizeTransactions,
  type ReportFilters,
  type ReportTab,
} from "@/lib/reports";
import {
  loadReportData,
  loadSavedReports,
  resolveReportScope,
} from "@/lib/reports-data";
import { createClient } from "@/lib/supabase/server";
import { firstSearchParam } from "@/lib/search-params";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function parsePage(value: string | undefined): number {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

const TAB_HEADINGS = {
  cash_flow: "Where the money went",
  spending: "Spending breakdown",
  income: "Income breakdown",
} as const;

function ReportChart({
  filters,
  periods,
  sankey,
  rows,
  currency,
}: Readonly<{
  filters: ReportFilters;
  periods: ReturnType<typeof computePeriodCashFlow>;
  sankey: ReturnType<typeof buildCashFlowSankeyData>;
  rows: Parameters<typeof breakdownBy>[0];
  currency: string;
}>) {
  if (filters.mode === "trends") {
    return <PeriodBars periods={periods} currency={currency} />;
  }
  if (filters.tab === "cash_flow") {
    return (
      <SankeyChart
        nodes={sankey.nodes}
        links={sankey.links}
        title={`Cash flow ${filters.start} to ${filters.end}`}
        currency={currency}
      />
    );
  }
  return (
    <BreakdownBars
      title={filters.tab === "income" ? "Income" : "Expenses"}
      rows={breakdownBy(rows, filters.dimension, filters.tab === "income" ? "income" : "expense")}
      currency={currency}
      dimension={filters.dimension}
    />
  );
}

export const metadata = {
  title: "Reports",
};

export default async function ReportsPage({ searchParams }: Readonly<PageProps>) {
  if (!isFeatureEnabled("reportsPage")) notFound();

  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { scope, visibleHouseholdIds } = await resolveReportScope(
    supabase,
    user.id,
    params.scope,
  );
  const anchorMonth = new Date().toISOString().slice(0, 7);
  const filters: ReportFilters = {
    ...reportFiltersFromSearchParams(params, defaultReportFilters(anchorMonth)),
    scope: serializeFinancialScope(scope) ?? null,
  };

  const [loaded, savedReports] = await Promise.all([
    loadReportData(supabase, { scope, filters }),
    loadSavedReports(supabase, user.id),
  ]);

  const byCurrency = partitionCashFlowByCurrency(
    loaded.transactions,
    loaded.currencyByAccountId,
  );
  const currencies = [...byCurrency.keys()];
  const requestedCurrency = firstSearchParam(params.currency);
  const selectedCurrency =
    requestedCurrency && byCurrency.has(requestedCurrency)
      ? requestedCurrency
      : currencies[0];
  const rows = selectedCurrency ? (byCurrency.get(selectedCurrency) ?? []) : [];
  const currencyLabel = selectedCurrency ?? UNKNOWN_CURRENCY;

  // Row order is a view property, not a data one: the summary, sankey, and
  // periods are computed from the filtered set and must not change when only
  // the sort changes. Sorting happens here, after projection and filtering and
  // before pagination, so the table's page boundaries never overlap.
  const orderedRows = applyReportSort(rows, filters);

  const summary = summarizeTransactions(rows);
  const sankey = buildCashFlowSankeyData(rows);
  const periods = computePeriodCashFlow(rows, "monthly");
  const page = parsePage(firstSearchParam(params.page));

  const exportParams = reportFiltersToSearchParams(filters);
  if (selectedCurrency) exportParams.set("currency", selectedCurrency);
  const hrefForPage = (next: number): string => {
    const withPage = reportFiltersToSearchParams(filters);
    if (selectedCurrency) withPage.set("currency", selectedCurrency);
    withPage.set("page", String(next));
    return `/reports?${withPage.toString()}`;
  };

  return (
    <AppShell active="reports" email={user.email}>
      <PageHeader
        title="Reports"
        description="Custom multidimensional analysis across dates, categories, and merchants. For periodic cash flow trends, see Cash Flow."
      />

      <Tabs
        items={(Object.keys(TAB_LABELS) as ReportTab[]).map((tab) => ({
          label: TAB_LABELS[tab],
          href: reportHref(filters, { tab }),
          active: filters.tab === tab,
        }))}
      />

      {loaded.truncated && (
        <Panel tone="warning">
          <p className="text-sm font-semibold">
            Some transactions are not shown because this range reached its
            bounded row limit.
          </p>
          <p className="mt-1 text-sm text-muted">
            Narrow the date range for complete totals — the CSV export is
            bounded the same way.
          </p>
        </Panel>
      )}

      {currencies.length > 1 && (
        <Panel tone="accent">
          <p className="text-sm font-semibold">
            Totals are separated by currency because FundFlow does not guess
            exchange rates.
          </p>
          <div className="mt-3 flex flex-wrap gap-1">
            {currencies.map((currency) => {
              const href = reportFiltersToSearchParams(filters);
              href.set("currency", currency);
              return (
                <Link
                  key={currency}
                  href={`/reports?${href.toString()}`}
                  aria-current={currency === selectedCurrency ? "page" : undefined}
                  className="inline-flex min-h-11 items-center rounded-field px-3 py-2 text-sm font-semibold text-accent hover:bg-panel-hover focus-visible:outline-2"
                >
                  {currency}
                </Link>
              );
            })}
          </div>
        </Panel>
      )}

      <ReportControls
        filters={filters}
        householdId={visibleHouseholdIds[0]}
      />

      {loaded.transactions.length === 0 ? (
        <EmptyState
          icon={<LineChart aria-hidden className="h-5 w-5" />}
          title="Nothing in this range"
          description="Widen the date range, or clear the account, merchant, and category filters."
          action={
            <Link
              href={reportHref(defaultReportFilters(anchorMonth))}
              className="inline-flex min-h-11 items-center rounded-field bg-accent px-4 py-2 text-sm font-bold text-accent-foreground focus-visible:outline-2"
            >
              Reset to this month
            </Link>
          }
        />
      ) : (
        <>
          <ReportSummaryPanel summary={summary} currency={currencyLabel} />

          <Panel
            eyebrow={filters.mode === "trends" ? "Trends" : filters.dimension}
            title={TAB_HEADINGS[filters.tab]}
            padding="none"
            className="reports-chart-panel"
          >
            <div className="reports-chart-content">
              <ReportChart
                filters={filters}
                periods={periods}
                sankey={sankey}
                rows={rows}
                currency={currencyLabel}
              />
            </div>
          </Panel>

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
            <Panel
              eyebrow="Rows"
              title="Transactions in this report"
              className="min-w-0"
              action={
                <div className="flex flex-wrap gap-2">
                  <ExportReportButton label="Download weekly PDF report" />
                  <Link
                    href="/wrapped"
                    className="inline-flex min-h-11 items-center rounded-field border border-panel-border bg-panel px-3 py-2 text-sm font-semibold hover:bg-panel-2 focus-visible:outline-2"
                  >
                    Year in Money
                  </Link>
                </div>
              }
            >
              <ReportTransactions
                transactions={orderedRows}
                currency={currencyLabel}
                page={page}
                hrefForPage={hrefForPage}
                groupByDate={filters.sort === "date"}
              />
            </Panel>
            <ReportRightRail
              summary={summary}
              currency={currencyLabel}
              exportHref={`/api/export/report-csv?${exportParams.toString()}`}
            />
          </div>
        </>
      )}

      <SavedReportsSection reports={savedReports} currentFilters={filters} />
    </AppShell>
  );
}
