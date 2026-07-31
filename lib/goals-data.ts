import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeFundedGoals,
  type AccountBalanceRow,
  type FundedGoal,
  type GoalAccountRow,
  type GoalProgressEventRow,
  type GoalV2Row,
} from "@/lib/goals-v2";

/**
 * Everything the Goals page needs, in one owner-scoped read.
 *
 * Every query filters `user_id` explicitly. RLS would cover the cookie-bound
 * client on its own, but `goals` is also readable by household members through
 * `goals_select_household`, and a shared goal is not the caller's to fund or
 * edit — so the page deliberately loads only what the caller owns.
 */

const DEPENDENCY_LIMIT = 5_000;

export interface GoalsPageData {
  goals: FundedGoal[];
  accounts: AccountBalanceRow[];
  accountNames: Map<string, string>;
  linksByGoal: Map<string, GoalAccountRow[]>;
}

function assertGoalsQuery(
  table: string,
  result: { error: { code?: string } | null },
): void {
  if (!result.error) return;
  const code = result.error.code ? `:${result.error.code}` : "";
  throw new Error(`goals_query_failed:${table}${code}`);
}

export async function loadGoalsPageData(
  supabase: SupabaseClient,
  userId: string,
  today = new Date(),
): Promise<GoalsPageData> {
  const [goalsResult, linksResult, eventsResult, accountsResult] =
    await Promise.all([
      supabase
        .from("goals")
        .select(
          "id,name,target_amount,saved_amount,target_date,household_id,goal_type,image_slug,monthly_contribution,spending_reduces,starting_balance,target_balance",
        )
        .eq("user_id", userId)
        .order("created_at")
        .limit(DEPENDENCY_LIMIT),
      supabase
        .from("goal_accounts")
        .select("goal_id,account_id,allocated_amount,use_entire_balance")
        .eq("user_id", userId)
        .limit(DEPENDENCY_LIMIT),
      supabase
        .from("goal_progress_events")
        .select("goal_id,event_date,amount")
        .eq("user_id", userId)
        .order("event_date")
        .limit(DEPENDENCY_LIMIT),
      supabase
        .from("accounts")
        .select("id,name,current_balance,type")
        .eq("user_id", userId)
        .order("name")
        .limit(DEPENDENCY_LIMIT),
    ]);

  assertGoalsQuery("goals", goalsResult);
  assertGoalsQuery("goal_accounts", linksResult);
  assertGoalsQuery("goal_progress_events", eventsResult);
  assertGoalsQuery("accounts", accountsResult);

  const rawAccounts = (accountsResult.data ?? []) as Array<{
    id: string;
    name: string | null;
    current_balance: number | string | null;
    type: string | null;
  }>;
  const accounts: AccountBalanceRow[] = rawAccounts.map((row) => ({
    id: row.id,
    // Postgres numeric arrives as a string through PostgREST; Number() here
    // keeps every downstream comparison numeric instead of lexicographic.
    current_balance:
      row.current_balance === null ? null : Number(row.current_balance),
    type: row.type,
  }));

  const links = ((linksResult.data ?? []) as Array<{
    goal_id: string;
    account_id: string;
    allocated_amount: number | string | null;
    use_entire_balance: boolean;
  }>).map<GoalAccountRow>((row) => ({
    goal_id: row.goal_id,
    account_id: row.account_id,
    allocated_amount:
      row.allocated_amount === null ? null : Number(row.allocated_amount),
    use_entire_balance: row.use_entire_balance,
  }));

  const events = ((eventsResult.data ?? []) as Array<{
    goal_id: string;
    event_date: string;
    amount: number | string;
  }>).map<GoalProgressEventRow>((row) => ({
    goal_id: row.goal_id,
    event_date: row.event_date,
    amount: Number(row.amount),
  }));

  const goals = ((goalsResult.data ?? []) as Array<Record<string, unknown>>).map(
    (row): GoalV2Row => ({
      id: row.id as string,
      name: row.name as string,
      target_amount: Number(row.target_amount ?? 0),
      saved_amount: Number(row.saved_amount ?? 0),
      target_date: (row.target_date as string | null) ?? null,
      household_id: (row.household_id as string | null) ?? null,
      goal_type: row.goal_type === "pay_down" ? "pay_down" : "save_up",
      image_slug: (row.image_slug as string | null) ?? null,
      monthly_contribution:
        row.monthly_contribution === null || row.monthly_contribution === undefined
          ? null
          : Number(row.monthly_contribution),
      spending_reduces: Boolean(row.spending_reduces),
      starting_balance:
        row.starting_balance === null || row.starting_balance === undefined
          ? null
          : Number(row.starting_balance),
      target_balance:
        row.target_balance === null || row.target_balance === undefined
          ? null
          : Number(row.target_balance),
    }),
  );

  const linksByGoal = new Map<string, GoalAccountRow[]>();
  for (const link of links) {
    const existing = linksByGoal.get(link.goal_id) ?? [];
    existing.push(link);
    linksByGoal.set(link.goal_id, existing);
  }

  return {
    goals: computeFundedGoals(goals, links, accounts, events, today),
    accounts,
    accountNames: new Map(rawAccounts.map((row) => [row.id, row.name ?? "Account"])),
    linksByGoal,
  };
}
