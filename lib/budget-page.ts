import { CanonicalFinanceTransaction } from "./finance-domain";
import { titleCase } from "./format";
import type { FinanceWindow } from "./finance-query";

export interface BudgetLine {
  budgetId: string | null;
  category: string;
  label: string;
  planned: number;
  actual: number;
  remaining: number;
  budgeted: boolean;
}

export interface BudgetSection {
  key: "income" | "fixed" | "flexible" | "non_monthly";
  label: string;
  planned: number;
  actual: number;
  remaining: number;
  lines: BudgetLine[];
  unbudgetedCount: number;
}

export type BudgetHorizon = "monthly" | "yearly" | "decade";

export interface BudgetPageData {
  month: string;
  horizon: BudgetHorizon;
  sections: BudgetSection[];
  totalIncome: { planned: number; actual: number };
  totalExpenses: { planned: number; actual: number; remaining: number };
  contributions: { goals: { name: string; planned: number; actual: number }[] };
  leftToBudget: number;
  sinkingFundsTotal: number;
}

export interface BudgetSeedProposal {
  category: string;
  group_name: "income" | "fixed" | "flexible" | "non_monthly";
  suggested_amount: number;
  confidence: "high" | "medium" | "low";
  reason: string;
}

export function parseBudgetHorizon(value: unknown): BudgetHorizon {
  if (value === "yearly" || value === "decade") return value;
  return "monthly";
}

/** "2026-07" + delta months, pure string math. */
function addMonths(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const total = (y || 2026) * 12 + ((m || 1) - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

export function budgetWindow(
  anchorMonth: string,
  horizon: BudgetHorizon,
): FinanceWindow {
  const [y] = anchorMonth.split("-").map(Number);
  const year = y || 2026;

  if (horizon === "yearly") {
    return {
      start: `${year}-01-01`,
      endExclusive: `${year + 1}-01-01`,
    };
  }

  if (horizon === "decade") {
    const decadeStart = Math.floor(year / 10) * 10;
    return {
      start: `${decadeStart}-01-01`,
      endExclusive: `${decadeStart + 10}-01-01`,
    };
  }

  return {
    start: `${anchorMonth}-01`,
    endExclusive: `${addMonths(anchorMonth, 1)}-01`,
  };
}

export function getMonthEndDate(monthStr: string): string {
  const [y, m] = monthStr.split("-").map(Number);
  const isLeap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const daysInMonth = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const lastDay = daysInMonth[(m || 1) - 1] || 31;
  return `${monthStr}-${String(lastDay).padStart(2, "0")}`;
}

export function buildBudgetPage(input: {
  month: string;
  horizon?: BudgetHorizon;
  budgets: {
    id: string;
    category: string;
    monthly_limit: number;
    group_name?: string;
    rollover_enabled?: boolean;
  }[];
  periods?: { budget_id: string; month: string; planned: number }[];
  txns: CanonicalFinanceTransaction[];
  goalContributions?: { name: string; planned: number; actual: number }[];
}): BudgetPageData {
  const { month, horizon = "monthly", budgets, periods = [], txns, goalContributions = [] } = input;
  const window = budgetWindow(month, horizon);

  const budgetMap = new Map<
    string,
    {
      id: string;
      monthly_limit: number;
      group_name: "income" | "fixed" | "flexible" | "non_monthly";
    }
  >();

  for (const b of budgets) {
    const grp = (b.group_name as "income" | "fixed" | "flexible" | "non_monthly") || "flexible";
    budgetMap.set(b.category.toLowerCase(), {
      id: b.id,
      monthly_limit: Number(b.monthly_limit),
      group_name: grp,
    });
  }

  // Build month-specific period limits
  const periodPlannedMap = new Map<string, number>();
  for (const p of periods) {
    if (horizon === "monthly") {
      if (p.month.slice(0, 7) === month) {
        periodPlannedMap.set(p.budget_id, Number(p.planned));
      }
    } else {
      if (p.month >= window.start && p.month < window.endExclusive) {
        const key = `${p.budget_id}|${p.month.slice(0, 7)}`;
        periodPlannedMap.set(key, Number(p.planned));
      }
    }
  }

  const actualSpendMap = new Map<string, number>();
  const actualIncomeMap = new Map<string, number>();

  for (const t of txns) {
    if (t.date < window.start || t.date >= window.endExclusive) continue;
    const catKey = (t.categoryKey || "Uncategorized").toLowerCase();
    if (t.flow === "income") {
      actualIncomeMap.set(catKey, (actualIncomeMap.get(catKey) || 0) + Math.abs(t.signedAmount));
    } else if (t.flow === "expense") {
      actualSpendMap.set(catKey, (actualSpendMap.get(catKey) || 0) + Math.abs(t.signedAmount));
    }
  }

  const sectionLines: Record<string, BudgetLine[]> = {
    income: [],
    fixed: [],
    flexible: [],
    non_monthly: [],
  };

  const processedCats = new Set<string>();

  // Determine months in window for planned aggregation
  let monthCount = 1;
  if (horizon === "yearly") monthCount = 12;
  if (horizon === "decade") monthCount = 120;

  for (const b of budgets) {
    const catLower = b.category.toLowerCase();
    processedCats.add(catLower);

    const grp = (b.group_name as "income" | "fixed" | "flexible" | "non_monthly") || "flexible";

    let plannedSum = 0;
    if (horizon === "monthly") {
      const pVal = periodPlannedMap.get(b.id);
      plannedSum = pVal !== undefined ? pVal : Number(b.monthly_limit);
    } else {
      const startYM = window.start.slice(0, 7);
      for (let m = 0; m < monthCount; m++) {
        const ym = addMonths(startYM, m);
        const pVal = periodPlannedMap.get(`${b.id}|${ym}`);
        plannedSum += pVal !== undefined ? pVal : Number(b.monthly_limit);
      }
    }

    const actual = grp === "income" ? actualIncomeMap.get(catLower) || 0 : actualSpendMap.get(catLower) || 0;
    const remaining = grp === "income" ? actual - plannedSum : plannedSum - actual;

    sectionLines[grp]?.push({
      budgetId: b.id,
      category: b.category,
      label: titleCase(b.category),
      planned: Math.round(plannedSum * 100) / 100,
      actual: Math.round(actual * 100) / 100,
      remaining: Math.round(remaining * 100) / 100,
      budgeted: true,
    });
  }

  // Handle unbudgeted spending categories
  for (const [catLower, actual] of actualSpendMap.entries()) {
    if (processedCats.has(catLower)) continue;

    sectionLines.flexible.push({
      budgetId: null,
      category: catLower,
      label: titleCase(catLower),
      planned: 0,
      actual: Math.round(actual * 100) / 100,
      remaining: -Math.round(actual * 100) / 100,
      budgeted: false,
    });
  }

  const sectionLabels: Record<string, string> = {
    income: "Income",
    fixed: "Fixed Expenses",
    flexible: "Flexible Expenses",
    non_monthly: "Non-Monthly Expenses",
  };

  const sections: BudgetSection[] = (["income", "fixed", "flexible", "non_monthly"] as const).map(
    (key) => {
      const lines = sectionLines[key] || [];
      const plannedSum = lines.reduce((acc, l) => acc + l.planned, 0);
      const actualSum = lines.reduce((acc, l) => acc + l.actual, 0);
      const remainingSum = key === "income" ? actualSum - plannedSum : plannedSum - actualSum;
      const unbudgetedCount = lines.filter((l) => !l.budgeted).length;

      return {
        key,
        label: sectionLabels[key],
        planned: Math.round(plannedSum * 100) / 100,
        actual: Math.round(actualSum * 100) / 100,
        remaining: Math.round(remainingSum * 100) / 100,
        lines,
        unbudgetedCount,
      };
    },
  );

  const incomeSec = sections.find((s) => s.key === "income")!;
  const fixedSec = sections.find((s) => s.key === "fixed")!;
  const flexSec = sections.find((s) => s.key === "flexible")!;
  const nonMonthlySec = sections.find((s) => s.key === "non_monthly")!;

  const totalIncome = { planned: incomeSec.planned, actual: incomeSec.actual };
  const totalExpensesPlanned = fixedSec.planned + flexSec.planned + nonMonthlySec.planned;
  const totalExpensesActual = fixedSec.actual + flexSec.actual + nonMonthlySec.actual;

  const totalExpenses = {
    planned: Math.round(totalExpensesPlanned * 100) / 100,
    actual: Math.round(totalExpensesActual * 100) / 100,
    remaining: Math.round((totalExpensesPlanned - totalExpensesActual) * 100) / 100,
  };

  const contributionsPlanned = goalContributions.reduce((acc, g) => acc + g.planned, 0);
  const leftToBudget = Math.round((totalIncome.planned - totalExpenses.planned - contributionsPlanned) * 100) / 100;

  const sinkingFundsTotal = sectionLines.non_monthly.reduce(
    (acc, line) => acc + Math.max(0, line.remaining),
    0,
  );

  return {
    month,
    horizon,
    sections,
    totalIncome,
    totalExpenses,
    contributions: { goals: goalContributions },
    leftToBudget,
    sinkingFundsTotal: Math.round(sinkingFundsTotal * 100) / 100,
  };
}

export function proposeBudgetFromHistory(input: {
  txnsLast3Months: CanonicalFinanceTransaction[];
  recurringTransactionIds?: Set<string>;
}): BudgetSeedProposal[] {
  const { txnsLast3Months, recurringTransactionIds = new Set() } = input;

  const catTotals = new Map<string, { income: number; expense: number; count: number; recurringCount: number }>();

  for (const t of txnsLast3Months) {
    const cat = (t.categoryKey || "Uncategorized").toLowerCase();
    const entry = catTotals.get(cat) || { income: 0, expense: 0, count: 0, recurringCount: 0 };

    if (t.flow === "income") entry.income += Math.abs(t.signedAmount);
    if (t.flow === "expense") entry.expense += Math.abs(t.signedAmount);
    entry.count += 1;

    if (recurringTransactionIds.has(t.id)) entry.recurringCount += 1;
    catTotals.set(cat, entry);
  }

  const proposals: BudgetSeedProposal[] = [];

  for (const [cat, data] of catTotals.entries()) {
    if (data.income > data.expense) {
      const avg = Math.round((data.income / 3) * 100) / 100;
      proposals.push({
        category: cat,
        group_name: "income",
        suggested_amount: avg,
        confidence: data.count >= 3 ? "high" : "medium",
        reason: "Based on 3-month average income",
      });
    } else {
      const avg = Math.round((data.expense / 3) * 100) / 100;
      const isFixed = data.recurringCount > 0 && data.recurringCount / data.count >= 0.5;

      proposals.push({
        category: cat,
        group_name: isFixed ? "fixed" : "flexible",
        suggested_amount: avg,
        confidence: data.count >= 3 ? "high" : "medium",
        reason: isFixed ? "Identified as recurring fixed expense" : "Based on 3-month average spending",
      });
    }
  }

  return proposals;
}
