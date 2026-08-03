import Link from "next/link";
import { notFound } from "next/navigation";
import AppShell from "@/components/shell/AppShell";
import PageHeader from "@/components/shell/PageHeader";
import BreakdownBars from "@/components/cash-flow/BreakdownBars";
import CashFlowControls, {
  type CashFlowControlValues,
} from "@/components/cash-flow/CashFlowControls";
import CashFlowSummary from "@/components/cash-flow/CashFlowSummary";
import PeriodBars from "@/components/cash-flow/PeriodBars";
import EmptyState from "@/components/ui/EmptyState";
import Panel from "@/components/ui/Panel";
import { LineChart } from "@/components/ui/icons";
import {
  breakdownBy,
  computePeriodCashFlow,
  filterCashFlowPeriod,
  partitionCashFlowByCurrency,
  type BreakdownDimension,
  type CashFlowPeriod,
} from "@/lib/cash-flow";
import { loadCashFlowData } from "@/lib/cash-flow-data";
import {
  parseFinancialScope,
  serializeFinancialScope,
} from "@/lib/financial-scope";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { UNKNOWN_CURRENCY } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    period?: string | string[];
    range?: string | string[];
    selected?: string | string[];
    dimension?: string | string[];
    scope?: string | string[];
    currency?: string | string[];
  }>;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function validPeriod(value: string | undefined): CashFlowPeriod {
  return value === "quarterly" || value === "yearly" ? value : "monthly";
}

function validRange(value: string | undefined): 6 | 12 | 24 {
  if (value === "6" || value === "24") return Number(value) as 6 | 24;
  return 12;
}

function validDimension(
  value: string | undefined,
): BreakdownDimension {
  return value === "group" || value === "merchant"
    ? value
    : "category";
}

function periodLink(
  key: string,
  current: CashFlowControlValues,
): string {
  const params = new URLSearchParams({
    period: current.period,
    range: current.range,
    selected: key,
    dimension: current.dimension,
  });
  if (current.scope) params.set("scope", current.scope);
  if (current.currency) params.set("currency", current.currency);
  return `/cash-flow?${params.toString()}`;
}

export default async function CashFlowPage({
  searchParams,
}: Readonly<PageProps>) {
  if (!isFeatureEnabled("cashFlowPage")) notFound();

  const params = await searchParams;
  const period = validPeriod(first(params.period));
  const rangeMonths = validRange(first(params.range));
  const dimension = validDimension(first(params.dimension));
  const anchorMonth = new Date().toISOString().slice(0, 7);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: householdRows, error: householdError } = await supabase
    .from("households")
    .select("id");
  if (householdError) throw householdError;
  const visibleHouseholdIds = (householdRows ?? []).map(
    (row) => row.id as string,
  );
  const scope = parseFinancialScope({
    raw: params.scope,
    ownerUserId: user.id,
    visibleHouseholdIds,
  });

  const loaded = await loadCashFlowData(supabase, {
    scope,
    anchorMonth,
    rangeMonths,
  });
  const byCurrency = partitionCashFlowByCurrency(
    loaded.transactions,
    loaded.currencyByAccountId,
  );
  const currencies = [...byCurrency.keys()];
  const requestedCurrency = first(params.currency);
  const selectedCurrency =
    requestedCurrency && byCurrency.has(requestedCurrency)
      ? requestedCurrency
      : currencies[0];
  const selectedCurrencyRows = selectedCurrency
    ? (byCurrency.get(selectedCurrency) ?? [])
    : [];
  const periods = computePeriodCashFlow(selectedCurrencyRows, period);
  const requestedPeriod = first(params.selected);
  const selectedPeriod =
    periods.find((row) => row.key === requestedPeriod) ??
    periods.at(-1) ??
    null;
  const selectedRows = selectedPeriod
    ? filterCashFlowPeriod(
        selectedCurrencyRows,
        period,
        selectedPeriod.key,
      )
    : [];
  const scopeParam = serializeFinancialScope(scope);
  const current: CashFlowControlValues = {
    period,
    range: String(rangeMonths) as "6" | "12" | "24",
    selected: selectedPeriod?.key,
    dimension,
    scope: scopeParam,
    currency: selectedCurrency,
  };
  const incomeBreakdown = breakdownBy(
    selectedRows,
    dimension,
    "income",
  );
  const expenseBreakdown = breakdownBy(
    selectedRows,
    dimension,
    "expense",
  );

  return (
    <AppShell active="cashflow" email={user.email}>
      <PageHeader title="Cash Flow" />

      {loaded.truncated && (
        <Panel tone="warning">
          <p className="text-sm font-semibold">
            Some transactions are not shown because this view reached its
            bounded row limit.
          </p>
          <p className="mt-1 text-sm text-muted">
            Shorten the date window for complete period totals.
          </p>
        </Panel>
      )}

      {loaded.stale && (
        <Panel tone="warning">
          <p className="text-sm font-semibold">
            Cash Flow data may be stale.
          </p>
          <p className="mt-1 text-sm text-muted">
            Refresh connected accounts before relying on the latest
            period.
          </p>
        </Panel>
      )}

      {currencies.length > 1 && (
        <Panel tone="accent">
          <p className="text-sm font-semibold">
            Totals are separated by currency because FundFlow does not
            guess exchange rates.
          </p>
        </Panel>
      )}

      {loaded.transactions.length === 0 ? (
        <EmptyState
          icon={<LineChart aria-hidden className="h-5 w-5" />}
          title="No cash flow yet"
          description="Transactions will appear here once an account has imported money in or money out."
          action={
            <Link
              href="/transactions"
              className="inline-flex min-h-11 items-center rounded-field bg-accent px-4 py-2 text-sm font-bold text-accent-foreground focus-visible:outline-2"
            >
              View transactions
            </Link>
          }
        />
      ) : (
        <>
          <CashFlowControls
            current={current}
            periods={periods}
            currencies={currencies}
            householdId={visibleHouseholdIds[0]}
          />

          <CashFlowSummary
            period={selectedPeriod}
            currency={selectedCurrency ?? UNKNOWN_CURRENCY}
          />

          <Panel
            eyebrow="Trend"
            title="Income, expenses, and net savings"
          >
            <PeriodBars
              periods={periods}
              currency={selectedCurrency ?? UNKNOWN_CURRENCY}
              links={periods.map((row) => periodLink(row.key, current))}
            />
          </Panel>

          <div className="grid gap-5 xl:grid-cols-2">
            <Panel
              eyebrow={dimension}
              title={`Income in ${selectedPeriod?.label ?? "this period"}`}
            >
              <BreakdownBars
                title="Income"
                rows={incomeBreakdown}
                currency={selectedCurrency ?? UNKNOWN_CURRENCY}
                dimension={dimension}
              />
            </Panel>
            <Panel
              eyebrow={dimension}
              title={`Expenses in ${selectedPeriod?.label ?? "this period"}`}
            >
              <BreakdownBars
                title="Expenses"
                rows={expenseBreakdown}
                currency={selectedCurrency ?? UNKNOWN_CURRENCY}
                dimension={dimension}
              />
            </Panel>
          </div>
        </>
      )}
    </AppShell>
  );
}
