export interface RecurringStatusInput {
  asOf: string;
  unusualAmountPct: number;
  items: {
    id: string;
    name: string;
    amount: number;
    itemType: "income" | "expense";
    nextDate: string;
  }[];
  transactions: {
    id: string;
    date: string;
    merchant: string;
    amount: number;
  }[];
}

export interface DebtAccount {
  id: string;
  name: string;
  balance: number;
  apr?: number | null;
  minimumPayment?: number | null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const start = Date.UTC(ay ?? 1970, (am ?? 1) - 1, ad ?? 1);
  const end = Date.UTC(by ?? 1970, (bm ?? 1) - 1, bd ?? 1);
  return Math.floor((end - start) / 86_400_000);
}

export function buildRecurringStatuses(input: RecurringStatusInput) {
  return input.items.map((item) => {
    const match = input.transactions.find((transaction) => {
      if (normalize(transaction.merchant) !== normalize(item.name)) return false;
      return Math.abs(daysBetween(item.nextDate, transaction.date)) <= 3;
    });

    if (!match) {
      return {
        ...item,
        status: daysBetween(item.nextDate, input.asOf) > 3 ? "late" as const : "expected" as const,
        transactionIds: [],
        reviewPrompt: null,
      };
    }

    const expected = Math.abs(item.amount);
    const actual = Math.abs(match.amount);
    const deltaPct = expected === 0 ? 0 : Math.abs(actual - expected) / expected;
    const unusual = deltaPct > input.unusualAmountPct;

    return {
      ...item,
      status: unusual ? "unusual_amount" as const : "paid" as const,
      transactionIds: [match.id],
      reviewPrompt: unusual && item.itemType === "expense"
        ? `Review ${item.name}: amount changed from ${round2(expected)} to ${round2(actual)}.`
        : null,
    };
  });
}

export function planDebtPayoff(
  debts: DebtAccount[],
  monthlyPayment: number,
  strategy: "avalanche" | "snowball",
) {
  const order = [...debts].sort((a, b) => {
    if (strategy === "avalanche") {
      return (b.apr ?? 0) - (a.apr ?? 0) || a.balance - b.balance;
    }
    return a.balance - b.balance || (b.apr ?? 0) - (a.apr ?? 0);
  });

  const totalMinimums = debts.reduce((sum, debt) => sum + (debt.minimumPayment ?? 0), 0);
  const extraPayment = Math.max(0, monthlyPayment - totalMinimums);
  let monthCursor = 0;

  const steps = order.map((debt, index) => {
    const directedPayment = (debt.minimumPayment ?? 0) + (index === 0 ? extraPayment : 0);
    const monthlyInterest = Math.max(0, debt.apr ?? 0) / 12;
    const effectivePayment = Math.max(1, directedPayment - debt.balance * monthlyInterest);
    const months = Math.max(1, Math.ceil(debt.balance / effectivePayment));
    monthCursor += months;
    return {
      id: debt.id,
      name: debt.name,
      payoffMonth: monthCursor,
      estimatedInterest: round2(debt.balance * monthlyInterest * months),
    };
  });

  return {
    strategy,
    order,
    steps,
    assumptions: [
      `Uses ${strategy} ordering.`,
      "APR and payoff dates are estimates based on steady monthly payments.",
    ],
  };
}

export interface PlanningDepthAccount {
  name: string | null;
  type: string | null;
  balance: number | null;
  apr?: number | null;
  minimumPayment?: number | null;
}

const LIABILITY_TYPES = new Set(["credit", "loan", "liability", "debt"]);

/**
 * Assembles the dashboard's planning-depth view from data the app already has:
 * an avalanche debt-payoff plan funded by the month's cash surplus, and
 * deterministic sinking-fund suggestions for active goals. Returns null plans
 * when the inputs don't support a meaningful suggestion (no liabilities, no
 * surplus) so the UI can show an honest empty state instead of fabricated math.
 */
export function buildPlanningDepthView(input: {
  accounts: PlanningDepthAccount[];
  monthlyIncome: number;
  monthlySpend: number;
  goals: {
    id: string;
    name: string;
    targetAmount: number;
    currentAmount: number;
    monthsRemaining: number;
  }[];
}) {
  const surplus = round2(input.monthlyIncome - input.monthlySpend);

  const debts: DebtAccount[] = input.accounts
    .filter((account) => LIABILITY_TYPES.has(account.type ?? ""))
    .map((account, index) => ({
      id: `${index}`,
      name: account.name ?? "Debt",
      balance: Math.abs(account.balance ?? 0),
      apr: account.apr ?? null,
      minimumPayment: account.minimumPayment ?? null,
    }))
    .filter((debt) => debt.balance > 0);

  const debtPayoff =
    debts.length > 0 && surplus > 0 ? planDebtPayoff(debts, surplus, "avalanche") : null;

  const sinkingFunds = suggestSinkingFunds({
    monthlyIncome: input.monthlyIncome,
    monthlySpend: input.monthlySpend,
    existingGoalPace: 0,
    goals: input.goals,
  });

  return { surplus, debtPayoff, sinkingFunds };
}

export function suggestSinkingFunds(input: {
  monthlyIncome: number;
  monthlySpend: number;
  existingGoalPace: number;
  goals: {
    id: string;
    name: string;
    targetAmount: number;
    currentAmount: number;
    monthsRemaining: number;
  }[];
}) {
  const surplus = round2(input.monthlyIncome - input.monthlySpend - input.existingGoalPace);
  if (surplus <= 0) return [];

  let remaining = surplus;
  const suggestions: { goalId: string; monthlyContribution: number }[] = [];
  for (const goal of input.goals) {
    if (remaining <= 0) break;
    const needed = Math.max(0, goal.targetAmount - goal.currentAmount);
    const monthlyNeed = round2(needed / Math.max(1, goal.monthsRemaining));
    const contribution = round2(Math.min(monthlyNeed, remaining));
    if (contribution > 0) {
      suggestions.push({ goalId: goal.id, monthlyContribution: contribution });
      remaining = round2(remaining - contribution);
    }
  }

  return suggestions;
}
