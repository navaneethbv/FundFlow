import { createClient } from "@/lib/supabase/server";
import AppShell from "@/components/shell/AppShell";
import { buildBudgetPage, getMonthEndDate, type BudgetHorizon } from "@/lib/budget-page";
import { loadCanonicalProjection } from "@/lib/finance-query";
import { parseFinancialScope } from "@/lib/financial-scope";
import BudgetSummary from "@/components/budget/BudgetSummary";
import BudgetTable from "@/components/budget/BudgetTable";
import SeedBudgetButton from "@/components/budget/SeedBudgetButton";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isFeatureEnabled } from "@/lib/feature-flags";

export default async function BudgetPage(
  props: Readonly<{
    searchParams: Promise<{ month?: string; scope?: string; horizon?: string }>;
  }>,
) {
  if (!isFeatureEnabled("budgetPage")) {
    notFound();
  }

  const searchParams = await props.searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return null;

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const selectedMonth = searchParams.month || currentMonth;
  const horizon: BudgetHorizon = (searchParams.horizon as BudgetHorizon) || "monthly";

  const scope = parseFinancialScope({
    raw: searchParams.scope,
    ownerUserId: user.id,
    visibleHouseholdIds: [],
  });

  // Fetch budgets
  const { data: budgetsRows } = await supabase
    .from("budgets")
    .select("id, category, monthly_limit, group_name, rollover_enabled");

  const budgets = (budgetsRows || []).map((b) => ({
    id: b.id as string,
    category: b.category as string,
    monthly_limit: Number(b.monthly_limit),
    group_name: (b.group_name as string) || "flexible",
    rollover_enabled: Boolean(b.rollover_enabled),
  }));

  // Fetch budget periods
  const { data: periodsRows } = await supabase
    .from("budget_periods")
    .select("budget_id, month, planned");

  const periods = (periodsRows || []).map((p) => ({
    budget_id: p.budget_id as string,
    month: p.month as string,
    planned: Number(p.planned),
  }));

  // Robust month-end date calculation for queries
  const startDate = `${selectedMonth}-01`;
  const endDate = getMonthEndDate(selectedMonth);

  const { transactions: canonicalTxns } = await loadCanonicalProjection(supabase, {
    scope,
    window: { start: startDate, endExclusive: endDate },
  });

  const budgetData = buildBudgetPage({
    month: selectedMonth,
    horizon,
    budgets,
    periods,
    txns: canonicalTxns,
  });

  return (
    <AppShell active="budget" email={user.email}>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Budget</h1>
            <p className="text-sm text-muted">
              Plan and track your spending envelopes for {selectedMonth} ({horizon} view)
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center rounded-field border border-panel-border bg-panel p-1 text-xs">
              <Link
                href={`/budget?month=${selectedMonth}&horizon=monthly`}
                className={`rounded px-2.5 py-1 font-semibold ${
                  horizon === "monthly" ? "bg-accent text-white" : "text-muted hover:text-foreground"
                }`}
              >
                Month
              </Link>
              <Link
                href={`/budget?month=${selectedMonth}&horizon=yearly`}
                className={`rounded px-2.5 py-1 font-semibold ${
                  horizon === "yearly" ? "bg-accent text-white" : "text-muted hover:text-foreground"
                }`}
              >
                Year
              </Link>
              <Link
                href={`/budget?month=${selectedMonth}&horizon=decade`}
                className={`rounded px-2.5 py-1 font-semibold ${
                  horizon === "decade" ? "bg-accent text-white" : "text-muted hover:text-foreground"
                }`}
              >
                Decade
              </Link>
            </div>

            <SeedBudgetButton />
          </div>
        </div>

        <BudgetSummary data={budgetData} />

        <div className="space-y-6">
          {budgetData.sections.map((section) => (
            <BudgetTable key={section.key} section={section} month={selectedMonth} />
          ))}
        </div>
      </div>
    </AppShell>
  );
}
