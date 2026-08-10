import type { BudgetEnvelope, EnvelopeStatus } from "@/lib/planning";

export type DashboardBudgetGroupKey = "fixed" | "flexible" | "non_monthly";

export interface DashboardBudgetGroup {
  key: DashboardBudgetGroupKey;
  label: string;
  monthlyLimit: number;
  spent: number;
  remaining: number;
  status: EnvelopeStatus;
}

const GROUPS: Array<{ key: DashboardBudgetGroupKey; label: string }> = [
  { key: "fixed", label: "Fixed" },
  { key: "flexible", label: "Flexible" },
  { key: "non_monthly", label: "Non-monthly" },
];

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function expenseGroup(value: string): DashboardBudgetGroupKey | null {
  if (value === "income") return null;
  if (value === "fixed" || value === "non_monthly") return value;
  return "flexible";
}

function worseStatus(
  current: EnvelopeStatus,
  next: EnvelopeStatus,
): EnvelopeStatus {
  const rank: Record<EnvelopeStatus, number> = {
    "on-track": 0,
    "at-risk": 1,
    over: 2,
  };
  return rank[next] > rank[current] ? next : current;
}

export function buildDashboardBudgetGroups(
  budgets: Array<{ category: string; groupName: string }>,
  envelopes: BudgetEnvelope[],
): DashboardBudgetGroup[] {
  const groupByCategory = new Map(
    budgets.map((budget) => [budget.category, expenseGroup(budget.groupName)]),
  );
  const rows = new Map<DashboardBudgetGroupKey, DashboardBudgetGroup>();
  for (const { key, label } of GROUPS) {
    rows.set(key, {
      key,
      label,
      monthlyLimit: 0,
      spent: 0,
      remaining: 0,
      status: "on-track",
    });
  }

  for (const envelope of envelopes) {
    const key = groupByCategory.has(envelope.category)
      ? groupByCategory.get(envelope.category)!
      : "flexible";
    if (key === null) continue;
    const row = rows.get(key)!;
    row.monthlyLimit = round2(row.monthlyLimit + envelope.monthlyLimit);
    row.spent = round2(row.spent + envelope.spent);
    row.remaining = round2(row.monthlyLimit - row.spent);
    row.status = worseStatus(row.status, envelope.status);
  }

  return GROUPS.map(({ key }) => rows.get(key)!).filter(
    (group) => group.monthlyLimit !== 0 || group.spent !== 0,
  );
}
