import Link from "next/link";
import { notFound } from "next/navigation";
import AppShell from "@/components/shell/AppShell";
import PageHeader from "@/components/shell/PageHeader";
import BudgetPlanner from "@/components/budget/BudgetPlanner";
import Panel from "@/components/ui/Panel";
import SegmentedControl from "@/components/ui/SegmentedControl";
import {
  parseBudgetHorizon,
  parseBudgetMonth,
  type BudgetHorizon,
  type BudgetSummaryTab,
} from "@/lib/budget-page";
import { loadBudgetData } from "@/lib/budget-data";
import {
  serializeFinancialScope,
} from "@/lib/financial-scope";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { UNKNOWN_CURRENCY, formatMonth } from "@/lib/format";
import { localMonthKey } from "@/lib/format-date";
import { firstSearchParam } from "@/lib/search-params";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    month?: string | string[];
    scope?: string | string[];
    horizon?: string | string[];
    currency?: string | string[];
    summary?: string | string[];
  }>;
}

const HORIZON_LABELS = {
  monthly: "Month",
  yearly: "Year",
  decade: "Decade",
} as const;

function shiftMonth(month: string, delta: number): string {
  const [year, oneBasedMonth] = month.split("-").map(Number);
  const total = year! * 12 + oneBasedMonth! - 1 + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

function shiftHorizon(month: string, delta: number, horizon: BudgetHorizon): string {
  const step = horizon === "decade" ? delta * 120 : horizon === "yearly" ? delta * 12 : delta;
  return shiftMonth(month, step);
}

function summaryTab(value: string | undefined): BudgetSummaryTab {
  return value === "income" || value === "expenses" ? value : "summary";
}

function budgetHref(input: {
  month: string;
  horizon: BudgetHorizon;
  scope?: string;
  currency?: string;
  summary?: BudgetSummaryTab;
}): string {
  const params = new URLSearchParams({
    month: input.month,
    horizon: input.horizon,
  });
  if (input.scope) params.set("scope", input.scope);
  if (input.currency) params.set("currency", input.currency);
  if (input.summary && input.summary !== "summary") {
    params.set("summary", input.summary);
  }
  return `/budget?${params.toString()}`;
}

export const metadata = {
  title: "Budget",
};

export default async function BudgetPage({
  searchParams,
}: Readonly<PageProps>) {
  if (!isFeatureEnabled("budgetPage")) notFound();

  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const currentMonth = localMonthKey();
  const month = parseBudgetMonth(firstSearchParam(params.month), currentMonth);
  const horizon = parseBudgetHorizon(firstSearchParam(params.horizon));
  const activeSummary = summaryTab(firstSearchParam(params.summary));
  const loaded = await loadBudgetData(supabase, {
    userId: user.id,
    anchorMonth: month,
    horizon,
    rawScope: params.scope,
    requestedCurrency: params.currency,
  });
  const scope = serializeFinancialScope(loaded.scope);
  const currency = loaded.selectedCurrency ?? UNKNOWN_CURRENCY;
  const baseLink = {
    month,
    horizon,
    scope,
    currency: loaded.selectedCurrency ?? undefined,
  };
  const summaryLinks = {
    summary: budgetHref({ ...baseLink, summary: "summary" }),
    income: budgetHref({ ...baseLink, summary: "income" }),
    expenses: budgetHref({ ...baseLink, summary: "expenses" }),
  };

  return (
    <AppShell active="budget" email={user.email}>
      <PageHeader
        title="Budget"
        actions={
          <SegmentedControl
            ariaLabel="Horizon"
            items={(["monthly", "yearly", "decade"] as const).map((value) => ({
              label: HORIZON_LABELS[value],
              href: budgetHref({ ...baseLink, horizon: value }),
              active: value === horizon,
            }))}
          />
        }
      />

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Link
          href={budgetHref({
            ...baseLink,
            month: shiftHorizon(month, -1, horizon),
          })}
          className="inline-flex min-h-11 items-center rounded-field border border-panel-border bg-panel px-4 text-sm font-semibold"
          aria-label={`Previous ${HORIZON_LABELS[horizon].toLowerCase()}`}
        >
          Previous
        </Link>
        <span
          className="px-3 text-base font-bold text-foreground"
          aria-live="polite"
          data-testid="budget-active-period"
        >
          {horizon === "yearly"
            ? month.slice(0, 4)
            : horizon === "decade"
              ? `${month.slice(0, 4)} – ${Number(month.slice(0, 4)) + 9}`
              : formatMonth(month)}
        </span>
        <Link
          href={budgetHref({
            ...baseLink,
            month: shiftHorizon(month, 1, horizon),
          })}
          className="inline-flex min-h-11 items-center rounded-field border border-panel-border bg-panel px-4 text-sm font-semibold"
          aria-label={`Next ${HORIZON_LABELS[horizon].toLowerCase()}`}
        >
          Next
        </Link>
        <SegmentedControl
          ariaLabel="Financial scope"
          items={[
            {
              label: "Mine",
              href: budgetHref({ ...baseLink, scope: undefined }),
              active: loaded.scope.kind === "mine",
            },
            ...(loaded.visibleHouseholdIds[0]
              ? [
                  {
                    label: "Household",
                    href: budgetHref({ ...baseLink, scope: loaded.visibleHouseholdIds[0] }),
                    active: loaded.scope.kind === "household",
                  },
                ]
              : []),
          ]}
        />
        {loaded.currencies.length > 1 && (
          <SegmentedControl
            ariaLabel="Currency"
            items={loaded.currencies.map((value) => ({
              label: value,
              href: budgetHref({ ...baseLink, currency: value }),
              active: value === loaded.selectedCurrency,
            }))}
          />
        )}
      </div>

      <div className="mt-6 space-y-4">
        {loaded.truncated && (
          <Panel tone="warning">
            <p className="text-sm font-semibold">
              This view reached the bounded transaction limit.
            </p>
            <p className="mt-1 text-sm text-muted">
              Shorten the horizon before relying on complete totals.
            </p>
          </Panel>
        )}
        {loaded.stale && (
          <Panel tone="warning">
            <p className="text-sm font-semibold">
              Budget actuals may be stale.
            </p>
            <p className="mt-1 text-sm text-muted">
              Refresh connected accounts before relying on the latest month.
            </p>
          </Panel>
        )}
        {loaded.currencies.length > 1 && (
          <Panel tone="accent">
            <p className="text-sm font-semibold">
              Totals are separated by currency.
            </p>
            <p className="mt-1 text-sm text-muted">
              FundFlow does not invent exchange rates for Budget actuals.
            </p>
          </Panel>
        )}
        <BudgetPlanner
          // Keying by the month, scope, and currency forces a remount when
          // the user navigates between months, so the optimistic edit state
          // always shows the month the PUT request is actually writing to.
          key={`${month}-${scope ?? "mine"}-${currency}`}
          initialView={loaded.view}
          proposals={loaded.proposals}
          month={month}
          currency={currency}
          summaryTab={activeSummary}
          summaryLinks={summaryLinks}
        />
      </div>
    </AppShell>
  );
}
