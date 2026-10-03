import { assessBudgetAllocation, type BudgetAllocation } from "@/lib/budget-allocation";
import type { BudgetGroup, BudgetSeedProposal } from "@/lib/budget-page";

/**
 * Reference adoption 7.3: the guided first budget. It walks the existing
 * trailing-average proposals group by group, then reviews the result against
 * planned income before saving through the same POST /api/budget contract.
 */
export type SetupStep = "income" | "fixed" | "flexible" | "review";
export const SETUP_STEPS: readonly SetupStep[] = ["income", "fixed", "flexible", "review"];

export interface SetupRow extends BudgetSeedProposal {
  included: boolean;
  amountText: string;
}

export interface SetupItem {
  category: string;
  monthly_limit: number;
  group_name: BudgetGroup;
  rollover_enabled: boolean;
  sort_order: number;
}

export function initialSetupRows(proposals: readonly BudgetSeedProposal[]): SetupRow[] {
  return proposals.map((proposal) => ({ ...proposal, included: true, amountText: String(proposal.suggested_amount) }));
}

/** Non-monthly proposals are reviewed with the flexible step. */
export function rowsForStep(rows: readonly SetupRow[], step: SetupStep): SetupRow[] {
  if (step === "review") return rows.filter((row) => row.included);
  if (step === "flexible") return rows.filter((row) => row.group_name === "flexible" || row.group_name === "non_monthly");
  return rows.filter((row) => row.group_name === step);
}

function parsedAmount(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  return Number(trimmed);
}

export function buildSetupItems(rows: readonly SetupRow[]): { items: SetupItem[] } | { error: string } {
  const selected = rows.filter((row) => row.included);
  if (selected.length === 0) return { error: "Select at least one category." };
  const items: SetupItem[] = [];
  for (const row of selected) {
    const amount = parsedAmount(row.amountText);
    if (amount === null) return { error: `Enter a valid amount for ${row.category}.` };
    items.push({
      category: row.category,
      monthly_limit: amount,
      group_name: row.group_name,
      rollover_enabled: row.rollover_enabled,
      sort_order: row.sort_order,
    });
  }
  return { items };
}

export function summarizeSetup(rows: readonly SetupRow[]): BudgetAllocation {
  let income = 0;
  let expenses = 0;
  for (const row of rows) {
    if (!row.included) continue;
    const amount = parsedAmount(row.amountText) ?? 0;
    if (row.group_name === "income") income += amount;
    else expenses += amount;
  }
  return assessBudgetAllocation({ incomePlanned: income, expensesPlanned: expenses, contributionsPlanned: 0 });
}
