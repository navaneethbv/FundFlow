import AppShell from "@/components/shell/AppShell";
import GoalsManager from "@/components/goals/GoalsManager";
import { getDashboardData } from "@/lib/dashboard";
import { getGoals } from "@/lib/goals";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function GoalsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [goals, data] = await Promise.all([
    getGoals(supabase),
    getDashboardData(supabase),
  ]);
  const monthlyNet = data.currentMonthIncome - data.currentMonthExpenses;

  return (
    <AppShell active="goals" email={user?.email}>
      <div>
        <p className="eyebrow">Planning</p>
        <h1 className="display mt-2 text-3xl sm:text-4xl">Goals</h1>
        <p className="mt-2 text-sm text-muted">
          Set savings targets and record contributions as you go.
        </p>
      </div>
      <GoalsManager initialGoals={goals} monthlyNet={monthlyNet} />
    </AppShell>
  );
}
