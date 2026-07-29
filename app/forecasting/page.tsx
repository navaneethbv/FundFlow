import { createClient } from "@/lib/supabase/server";
import AppShell from "@/components/shell/AppShell";
import { forecastNetWorth } from "@/lib/forecasting";
import ForecastChart from "@/components/forecasting/ForecastChart";
import { notFound } from "next/navigation";
import { isFeatureEnabled } from "@/lib/feature-flags";

export const dynamic = "force-dynamic";

export default async function ForecastingPage() {
  if (!isFeatureEnabled("forecastingPage")) {
    notFound();
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return null;

  // Fetch balances
  const { data: accountsRows } = await supabase
    .from("accounts")
    .select("current_balance, type");

  let cash = 0;
  let investments = 0;
  let liabilities = 0;

  for (const a of accountsRows || []) {
    const bal = Math.abs(Number(a.current_balance || 0));
    if (a.type === "depository") cash += bal;
    else if (a.type === "investment") investments += bal;
    else if (a.type === "credit" || a.type === "loan") liabilities += bal;
  }

  const points = forecastNetWorth(
    { cash, investments, liabilities },
    {
      monthlySavings: 1000,
      annualReturnPct: 7,
      annualCashYieldPct: 3,
      monthlyDebtPayment: 300,
      horizonMonths: 60,
    },
    "2026-07",
  );

  return (
    <AppShell active="forecasting" email={user.email}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Net Worth Forecasting</h1>
          <p className="text-sm text-muted">
            Simulate your financial trajectory across conservative, base, and optimistic scenarios
          </p>
        </div>

        <ForecastChart points={points} />
      </div>
    </AppShell>
  );
}
