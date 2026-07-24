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

  const [goals, data, { data: householdRows }] = await Promise.all([
    getGoals(supabase),
    getDashboardData(supabase),
    supabase.from("households").select("id").limit(1),
  ]);
  const monthlyNet = data.currentMonthIncome - data.currentMonthExpenses;
  const householdId = (householdRows?.[0]?.id as string | undefined) ?? null;

  return (
    <AppShell active="goals" email={user?.email}>
      <div>
        <p className="eyebrow">Planning</p>
        <h1 className="display mt-2 text-3xl sm:text-4xl">Goals</h1>
        <p className="mt-2 text-sm text-muted">
          Set savings targets and record contributions as you go.
        </p>
      </div>
      <GoalsManager
        initialGoals={goals}
        monthlyNet={monthlyNet}
        householdId={householdId}
      />
    </AppShell>
  );
}
