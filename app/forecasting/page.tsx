import { notFound } from "next/navigation";
import AppShell from "@/components/shell/AppShell";
import PageHeader from "@/components/shell/PageHeader";
import AssumptionsPanel from "@/components/forecasting/AssumptionsPanel";
import MilestonesPanel from "@/components/forecasting/MilestonesPanel";
import Panel from "@/components/ui/Panel";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { formatCurrency } from "@/lib/format";
import { localDateKey } from "@/lib/format-date";
import { computeForecastMilestones, forecastNetWorth, parseForecastAssumptions } from "@/lib/forecasting";
import type { ForecastStartingGaps } from "@/lib/forecasting";
import LifeEventsPanel from "@/components/forecasting/LifeEventsPanel";
import type { LifeEvent } from "@/lib/life-events";
import { loadForecastPageData } from "@/lib/forecasting-data";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export const metadata = {
  title: "Forecasting",
};

function pluralAccounts(count: number): string {
  return count === 1 ? "1 account" : `${count} accounts`;
}

/**
 * Names what the balance sheet left out, so the page can say so rather than
 * projecting from a silently incomplete starting point (a zeroed unknown
 * balance reads as a real $0).
 */
function describeStartingPointGaps(gaps: ForecastStartingGaps): string[] {
  const notes: string[] = [];
  if (gaps.excludedFromNetWorth > 0) {
    notes.push(`${pluralAccounts(gaps.excludedFromNetWorth)} you excluded from net worth`);
  }
  if (gaps.unknownBalance > 0) {
    notes.push(`${pluralAccounts(gaps.unknownBalance)} with no reported balance`);
  }
  if (gaps.foreignCurrencies.length > 0) {
    notes.push(`balances in ${gaps.foreignCurrencies.join(", ")} (no exchange rate)`);
  }
  return notes;
}

export default async function ForecastingPage({ searchParams }: Readonly<PageProps>) {
  if (!isFeatureEnabled("forecastingPage")) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const today = localDateKey();
  const [{ startingState, defaults, monthlyExpenses }, params] = await Promise.all([
    loadForecastPageData(supabase, user.id, today),
    searchParams,
  ]);
  const assumptions = parseForecastAssumptions(params, defaults);
  // Say what the balance sheet left out rather than projecting from a silently
  // incomplete starting point (a zeroed unknown balance reads as a real $0).
  const startingPointNotes = describeStartingPointGaps(startingState.gaps);
  const currentNetWorth = startingState.cash + startingState.investments - startingState.liabilities;
  const points = forecastNetWorth(startingState, assumptions);
  const milestones = computeForecastMilestones(startingState, assumptions, monthlyExpenses);
  const { data: lifeEventRows, error: lifeEventsError } = await supabase
    .from("life_events")
    .select("id, event_type, start_month, amount, duration_months, label")
    .eq("user_id", user.id)
    .order("start_month");
  if (lifeEventsError) throw lifeEventsError;
  const lifeEvents = (lifeEventRows ?? []).map((row) => ({
    id: row.id as string,
    type: row.event_type as LifeEvent["type"],
    startMonth: row.start_month as number,
    amount: Number(row.amount),
    durationMonths: row.duration_months as number | null,
    label: (row.label as string | null) ?? null,
  }));

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
          {startingPointNotes.length > 0 && (
            <p className="mt-2 text-sm text-muted">
              Not counted in this starting point: {startingPointNotes.join("; ")}.
            </p>
          )}
        </Panel>

        <Panel padding="lg">
          <AssumptionsPanel assumptions={assumptions} defaults={defaults} />
        </Panel>

        <LifeEventsPanel
          basePoints={points}
          monthlySavings={assumptions.monthlySavings}
          currentNetWorth={currentNetWorth}
          currency="USD"
          initialEvents={lifeEvents}
        />

        <Panel padding="lg">
          <MilestonesPanel milestones={milestones} horizonMonths={assumptions.horizonMonths} />
        </Panel>

      </div>
    </AppShell>
  );
}
