import AppShell from "@/components/shell/AppShell";
import PageHeader from "@/components/shell/PageHeader";
import GoalsManager from "@/components/goals/GoalsManager";
import GoalAllocationPanel from "@/components/goals/GoalAllocationPanel";
import GoalCard from "@/components/goals/GoalCard";
import GoalCardMenu from "@/components/goals/GoalCardMenu";
import GoalWizard, { type WizardAccount } from "@/components/goals/GoalWizard";
import EmptyState from "@/components/ui/EmptyState";
import Panel from "@/components/ui/Panel";
import Tabs from "@/components/ui/Tabs";
import { Target } from "@/components/ui/icons";
import { getDashboardData } from "@/lib/dashboard";
import { getGoals } from "@/lib/goals";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { loadGoalsPageData } from "@/lib/goals-data";
import { isLiabilityAccount, type GoalType } from "@/lib/goals-v2";
import { formatCurrency } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ tab?: string | string[] }>;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const TABS: Array<{ key: GoalType; label: string }> = [
  { key: "save_up", label: "Save up" },
  { key: "pay_down", label: "Pay down" },
];

export default async function GoalsPage({ searchParams }: Readonly<PageProps>) {
  const params = await searchParams;
  const goalsV2Enabled = isFeatureEnabled("goalsV2");
  const tab: GoalType = first(params.tab) === "pay_down" ? "pay_down" : "save_up";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [goals, data, { data: householdRows }, funded] = await Promise.all([
    getGoals(supabase),
    getDashboardData(supabase),
    supabase.from("households").select("id").limit(1),
    // Phase 7 reads two tables that only exist once the goals_v2 migration is
    // applied. With the flag off the page renders exactly as it did before,
    // rather than 500ing an already-released page on a deployment that has not
    // run the migration yet.
    user && goalsV2Enabled
      ? loadGoalsPageData(supabase, user.id)
      : Promise.resolve(null),
  ]);
  const monthlyNet = data.currentMonthIncome - data.currentMonthExpenses;
  const householdId = (householdRows?.[0]?.id as string | undefined) ?? null;

  const fundedGoals = funded?.goals ?? [];
  const visible = fundedGoals.filter((goal) => goal.goal_type === tab);
  const currency = "USD";

  const wizardAccounts: WizardAccount[] = (funded?.accounts ?? []).map(
    (account) => ({
      id: account.id,
      name: funded?.accountNames.get(account.id) ?? "Account",
      currentBalance: account.current_balance,
      type: account.type,
    }),
  );
  // The Pay down tab offers the liability accounts that are not already funding
  // a goal, so the user starts from what they owe rather than a blank form.
  const linkedAccountIds = new Set(
    [...(funded?.linksByGoal.values() ?? [])].flat().map((link) => link.account_id),
  );
  const unlinkedLiabilities = wizardAccounts.filter(
    (account) =>
      isLiabilityAccount(account.type) && !linkedAccountIds.has(account.id),
  );

  return (
    <AppShell active="goals" email={user?.email}>
      <PageHeader
        title="Goals"
        actions={goalsV2Enabled ? <GoalWizard accounts={wizardAccounts} defaultGoalType={tab} /> : undefined}
      />

      {goalsV2Enabled && (
        <>
          <Tabs
            items={TABS.map((entry) => ({
              label: entry.label,
              href: `/goals?tab=${entry.key}`,
              active: tab === entry.key,
            }))}
          />

          {visible.length === 0 ? (
        <EmptyState
          icon={<Target aria-hidden className="h-5 w-5" />}
          title={tab === "pay_down" ? "No payoff goals yet" : "Plan for your future"}
          description={
            tab === "pay_down"
              ? "Turn a credit card or loan balance into a goal and watch it close."
              : "Pick a template to set your first savings target."
          }
          action={<GoalWizard accounts={wizardAccounts} defaultGoalType={tab} />}
        />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              currency={currency}
              menu={<GoalCardMenu goal={goal} householdId={householdId} />}
              action={
                <GoalAllocationPanel
                  goalId={goal.id}
                  accounts={wizardAccounts}
                  linkedAccountIds={(funded?.linksByGoal.get(goal.id) ?? []).map(
                    (link) => link.account_id,
                  )}
                />
              }
            />
          ))}
        </div>
      )}

      {tab === "pay_down" && (
        <Panel eyebrow="Available" title="Liability accounts without a goal">
          {unlinkedLiabilities.length === 0 ? (
            <p className="text-sm text-muted">
              None of your liability accounts are included.
            </p>
          ) : (
            <ul className="space-y-2">
              {unlinkedLiabilities.map((account) => (
                <li
                  key={account.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-t border-panel-border pt-2 first:border-t-0 first:pt-0"
                >
                  <span className="text-sm font-semibold">{account.name}</span>
                  <span className="tabular-nums text-sm text-muted">
                    {formatCurrency(account.currentBalance ?? 0, currency)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

        </>
      )}

      {/* v2 cards are the single source of truth for edit/contribute/
          household-visibility (via each card's `⋯` menu) once goalsV2 is
          on — GoalsManager's flat list only remains as the whole page for a
          deployment that has the flag off. */}
      {!goalsV2Enabled && (
        <GoalsManager
          initialGoals={goals}
          monthlyNet={monthlyNet}
          householdId={householdId}
        />
      )}
    </AppShell>
  );
}
