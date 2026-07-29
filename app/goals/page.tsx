import { createClient } from "@/lib/supabase/server";
import AppShell from "@/components/shell/AppShell";
import { computeFundedGoals } from "@/lib/goals-v2";
import GoalCard from "@/components/goals/GoalCard";
import GoalWizard from "@/components/goals/GoalWizard";
import GoalsManager from "@/components/goals/GoalsManager";
import type { Goal } from "@/lib/goals";

export const dynamic = "force-dynamic";

export default async function GoalsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return null;

  // Fetch Goals
  const { data: goalsRows } = await supabase
    .from("goals")
    .select("id, name, target_amount, saved_amount, target_date, goal_type, image_slug, monthly_contribution, spending_reduces");

  const legacyGoals: Goal[] = (goalsRows || []).map((g) => ({
    id: g.id as string,
    name: g.name as string,
    target_amount: Number(g.target_amount),
    saved_amount: Number(g.saved_amount),
    target_date: g.target_date as string | null,
  }));

  const goals = (goalsRows || []).map((g) => ({
    id: g.id as string,
    name: g.name as string,
    target_amount: Number(g.target_amount),
    saved_amount: Number(g.saved_amount),
    target_date: g.target_date as string | null,
    goal_type: (g.goal_type as "save_up" | "pay_down") || "save_up",
    image_slug: g.image_slug as string | null,
    monthly_contribution: g.monthly_contribution ? Number(g.monthly_contribution) : null,
    spending_reduces: Boolean(g.spending_reduces),
  }));

  // Fetch Linked Accounts
  const { data: linksRows } = await supabase
    .from("goal_accounts")
    .select("goal_id, account_id, allocated_amount, use_entire_balance");

  const links = (linksRows || []).map((l) => ({
    goal_id: l.goal_id as string,
    account_id: l.account_id as string,
    allocated_amount: l.allocated_amount ? Number(l.allocated_amount) : null,
    use_entire_balance: Boolean(l.use_entire_balance),
  }));

  // Fetch Account Balances
  const { data: accountsRows } = await supabase
    .from("accounts")
    .select("id, current_balance, type");

  const accounts = (accountsRows || []).map((a) => ({
    id: a.id as string,
    current_balance: a.current_balance ? Number(a.current_balance) : 0,
    type: a.type as string | null,
  }));

  const fundedGoals = computeFundedGoals(goals, links, accounts);

  return (
    <AppShell active="goals" email={user.email}>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Goals</h1>
            <p className="text-sm text-muted">
              Track savings targets, debt payoff plans, and account-linked funding progress
            </p>
          </div>
          <GoalWizard />
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {fundedGoals.length === 0 ? (
            <div className="col-span-full rounded-panel border border-panel-border bg-panel p-8 text-center text-sm text-muted">
              No financial goals set yet. Click &quot;Create New Goal&quot; to get started.
            </div>
          ) : (
            fundedGoals.map((goal) => <GoalCard key={goal.id} goal={goal} />)
          )}
        </div>

        <div className="pt-6">
          <GoalsManager initialGoals={legacyGoals} monthlyNet={0} />
        </div>
      </div>
    </AppShell>
  );
}
