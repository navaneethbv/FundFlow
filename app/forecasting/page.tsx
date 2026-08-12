import { notFound } from "next/navigation";
import AppShell from "@/components/shell/AppShell";
import PageHeader from "@/components/shell/PageHeader";
import AssumptionsPanel from "@/components/forecasting/AssumptionsPanel";
import ForecastChart from "@/components/forecasting/ForecastChart";
import Panel from "@/components/ui/Panel";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { formatCurrency } from "@/lib/format";
import { localDateKey } from "@/lib/format-date";
import { forecastNetWorth, parseForecastAssumptions } from "@/lib/forecasting";
import { loadForecastPageData } from "@/lib/forecasting-data";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ForecastingPage({ searchParams }: Readonly<PageProps>) {
  if (!isFeatureEnabled("forecastingPage")) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const today = localDateKey();
  const [{ startingState, defaults }, params] = await Promise.all([
    loadForecastPageData(supabase, user.id, today),
    searchParams,
  ]);
  const assumptions = parseForecastAssumptions(params, defaults);
  const currentNetWorth = startingState.cash + startingState.investments - startingState.liabilities;
  const points = forecastNetWorth(startingState, assumptions);
  const ending = points.at(-1)!;

  return (
    <AppShell active="forecasting" email={user.email}>
      <div className="space-y-6">
        <PageHeader title="Forecasting" />
        <p className="text-sm text-muted">
          A projection, not a prediction — three scenarios compounding your own assumptions forward.
          Nothing here is a guarantee or a statistical forecast.
        </p>

        <Panel padding="lg">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Starting point</h2>
          <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted">Cash</dt>
              <dd className="metric-value text-lg font-bold">{formatCurrency(startingState.cash)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Investments</dt>
              <dd className="metric-value text-lg font-bold">{formatCurrency(startingState.investments)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Liabilities</dt>
              <dd className="metric-value text-lg font-bold">{formatCurrency(startingState.liabilities)}</dd>
            </div>
          </dl>
          <p className="mt-3 text-sm text-muted">
            Net worth today: {" "}<span className="money font-semibold text-foreground">{formatCurrency(currentNetWorth)}</span>
          </p>
        </Panel>

        <Panel padding="lg">
          <AssumptionsPanel assumptions={assumptions} defaults={defaults} />
        </Panel>

        <Panel padding="lg">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted">
            Net worth projection
          </h2>
          <p className="mb-4 text-sm text-muted">
            In {assumptions.horizonMonths} months, base case:{" "}
            <span className="money font-semibold text-foreground">{formatCurrency(ending.base)}</span> (
            <span className="money">{formatCurrency(ending.conservative)}</span> to{" "}
            <span className="money">{formatCurrency(ending.optimistic)}</span>)
          </p>
          <ForecastChart points={points} currentNetWorth={currentNetWorth} />
        </Panel>
      </div>
    </AppShell>
  );
}
