import Link from "next/link";
import { notFound } from "next/navigation";
import AppShell from "@/components/shell/AppShell";
import BudgetPlanner from "@/components/budget/BudgetPlanner";
import type { BudgetSummaryTab } from "@/components/budget/BudgetSummary";
import Panel from "@/components/ui/Panel";
import {
  parseBudgetHorizon,
  parseBudgetMonth,
  type BudgetHorizon,
} from "@/lib/budget-page";
import { loadBudgetData } from "@/lib/budget-data";
import {
  serializeFinancialScope,
} from "@/lib/financial-scope";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { formatMonth, UNKNOWN_CURRENCY } from "@/lib/format";
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

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function shiftMonth(month: string, delta: number): string {
  const [year, oneBasedMonth] = month.split("-").map(Number);
  const total = year! * 12 + oneBasedMonth! - 1 + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
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

  const currentMonth = new Date().toISOString().slice(0, 7);
  const month = parseBudgetMonth(first(params.month), currentMonth);
  const horizon = parseBudgetHorizon(first(params.horizon));
  const activeSummary = summaryTab(first(params.summary));
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
      <header className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="eyebrow">{formatMonth(month)}</p>
          <h1 className="display mt-2 text-3xl sm:text-4xl">Budget</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            Plan each category, compare it with canonical transaction
            actuals, and carry selected envelopes between months.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(["monthly", "yearly", "decade"] as const).map((value) => (
            <Link
              key={value}
              href={budgetHref({ ...baseLink, horizon: value })}
              aria-current={value === horizon ? "page" : undefined}
              className={`inline-flex min-h-11 items-center rounded-field px-4 text-sm font-semibold capitalize ${
                value === horizon
                  ? "bg-accent text-accent-foreground"
                  : "border border-panel-border bg-panel text-muted"
              }`}
            >
              {value === "monthly" ? "Month" : value === "yearly" ? "Year" : "Decade"}
            </Link>
          ))}
        </div>
      </header>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Link
          href={budgetHref({
            ...baseLink,
            month: shiftMonth(month, -1),
          })}
          className="inline-flex min-h-11 items-center rounded-field border border-panel-border bg-panel px-4 text-sm font-semibold"
        >
          Previous
        </Link>
        <Link
          href={budgetHref({
            ...baseLink,
            month: shiftMonth(month, 1),
          })}
          className="inline-flex min-h-11 items-center rounded-field border border-panel-border bg-panel px-4 text-sm font-semibold"
        >
          Next
        </Link>
        <Link
          href={budgetHref({ ...baseLink, scope: undefined })}
          aria-current={loaded.scope.kind === "mine" ? "page" : undefined}
          className="inline-flex min-h-11 items-center rounded-field border border-panel-border bg-panel px-4 text-sm font-semibold"
        >
          Mine
        </Link>
        {loaded.visibleHouseholdIds[0] && (
          <Link
            href={budgetHref({
              ...baseLink,
              scope: loaded.visibleHouseholdIds[0],
            })}
            aria-current={loaded.scope.kind === "household" ? "page" : undefined}
            className="inline-flex min-h-11 items-center rounded-field border border-panel-border bg-panel px-4 text-sm font-semibold"
          >
            Household
          </Link>
        )}
        {loaded.currencies.map((value) => (
          <Link
            key={value}
            href={budgetHref({ ...baseLink, currency: value })}
            aria-current={value === loaded.selectedCurrency ? "page" : undefined}
            className="inline-flex min-h-11 items-center rounded-field border border-panel-border bg-panel px-4 text-sm font-semibold"
          >
            {value}
          </Link>
        ))}
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
