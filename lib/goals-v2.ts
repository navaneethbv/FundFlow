export interface GoalV2Row {
  id: string;
  name: string;
  target_amount: number;
  saved_amount: number;
  target_date: string | null;
  goal_type: "save_up" | "pay_down";
  image_slug?: string | null;
  monthly_contribution?: number | null;
  spending_reduces?: boolean;
}

export interface GoalAccountRow {
  goal_id: string;
  account_id: string;
  allocated_amount: number | null;
  use_entire_balance: boolean;
}

export interface FundedGoal extends GoalV2Row {
  funded_amount: number;
  est_monthly: number | null;
  badge: "on-track" | "at-risk" | "completed" | "behind";
}

export function computeFundedGoals(
  goals: GoalV2Row[],
  links: GoalAccountRow[],
  accounts: { id: string; current_balance: number | null; type: string | null }[],
  today: Date = new Date(),
): FundedGoal[] {
  const accountMap = new Map<string, number>();
  for (const a of accounts) {
    accountMap.set(a.id, Math.max(0, Number(a.current_balance || 0)));
  }

  const goalLinkMap = new Map<string, GoalAccountRow[]>();
  for (const l of links) {
    const arr = goalLinkMap.get(l.goal_id) || [];
    arr.push(l);
    goalLinkMap.set(l.goal_id, arr);
  }

  return goals.map((g) => {
    let funded = Number(g.saved_amount || 0);

    const goalLinks = goalLinkMap.get(g.id) || [];
    for (const l of goalLinks) {
      const bal = accountMap.get(l.account_id) || 0;
      if (l.use_entire_balance) {
        funded += bal;
      } else if (l.allocated_amount) {
        funded += Math.min(bal, Number(l.allocated_amount));
      }
    }

    const target = Number(g.target_amount || 0);
    const isCompleted = target > 0 && funded >= target;

    let est_monthly: number | null = null;
    let badge: "on-track" | "at-risk" | "completed" | "behind" = "on-track";

    if (isCompleted) {
      badge = "completed";
    } else if (g.target_date) {
      const targetDate = new Date(g.target_date);
      const monthsLeft = Math.max(1, (targetDate.getFullYear() - today.getFullYear()) * 12 + (targetDate.getMonth() - today.getMonth()));
      const remaining = Math.max(0, target - funded);
      est_monthly = Math.round((remaining / monthsLeft) * 100) / 100;

      if (g.monthly_contribution && Number(g.monthly_contribution) < est_monthly) {
        badge = "at-risk";
      }
    }

    return {
      ...g,
      funded_amount: Math.round(funded * 100) / 100,
      est_monthly,
      badge,
    };
  });
}
