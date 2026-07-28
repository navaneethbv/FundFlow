/**
 * Pure debt-payoff planning: avalanche/snowball monthly simulation over
 * credit-card and loan balances. No I/O — APRs are user-entered (Plaid's
 * transactions product doesn't provide them) and balances come from data
 * the caller already has. All money values are rounded to cents.
 */

export interface DebtInput {
  name: string;
  balance: number;
  /** Annual percentage rate, e.g. 22 for 22%. */
  apr: number;
  /** Fixed monthly minimum; defaults to max($25, 2% of starting balance). */
  minPayment?: number;
}

export interface PayoffPlanInput {
  debts: DebtInput[];
  /** Extra budget beyond the minimums, aimed at the focus debt. */
  extraMonthly: number;
  /** avalanche = highest APR first; snowball = smallest balance first. */
  strategy: "avalanche" | "snowball";
}

export interface DebtPayoff {
  name: string;
  /** 1-based month in which this debt reaches zero. */
  payoffMonth: number;
  interestPaid: number;
}

export interface PayoffPlan {
  /** Months until every debt is cleared. */
  months: number;
  totalInterest: number;
  /** Focus order chosen by the strategy. */
  order: string[];
  debts: DebtPayoff[];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Simulation cap: a plan that hasn't cleared in 50 years never will. */
const MAX_MONTHS = 600;

/**
 * Simulates month-by-month payoff. The monthly budget is fixed at
 * (sum of minimum payments + extraMonthly); when a debt clears, its
 * payment automatically rolls into the next debt in focus order.
 * Returns null when the debts list is empty or the budget can never
 * outrun the interest.
 */
export function buildPayoffPlan(input: PayoffPlanInput): PayoffPlan | null {
  if (input.debts.length === 0) return null;

  const order = [...input.debts].sort((a, b) =>
    input.strategy === "avalanche" ? b.apr - a.apr : a.balance - b.balance,
  );

  const state = order.map((debt) => ({
    name: debt.name,
    balance: round2(debt.balance),
    monthlyRate: debt.apr / 100 / 12,
    minPayment: round2(debt.minPayment ?? Math.max(25, debt.balance * 0.02)),
    interestPaid: 0,
    payoffMonth: 0,
  }));

  const budget = round2(
    state.reduce((sum, debt) => sum + debt.minPayment, 0) + input.extraMonthly,
  );

  // Fast fail: if the first month's interest already swallows the whole
  // budget, balances only ever grow.
  const firstMonthInterest = round2(
    state.reduce((sum, debt) => sum + debt.balance * debt.monthlyRate, 0),
  );
  if (budget <= firstMonthInterest) return null;

  for (let month = 1; month <= MAX_MONTHS; month++) {
    for (const debt of state) {
      if (debt.balance <= 0) continue;
      const interest = round2(debt.balance * debt.monthlyRate);
      debt.balance = round2(debt.balance + interest);
      debt.interestPaid = round2(debt.interestPaid + interest);
    }

    // Minimum payments first, then everything left cascades to the focus
    // debt (state is already in focus order).
    let available = budget;
    for (const debt of state) {
      if (debt.balance <= 0) continue;
      const payment = Math.min(debt.minPayment, debt.balance, available);
      debt.balance = round2(debt.balance - payment);
      available = round2(available - payment);
      if (debt.balance <= 0) debt.payoffMonth = month;
    }
    for (const debt of state) {
      if (available <= 0) break;
      if (debt.balance <= 0) continue;
      const payment = Math.min(debt.balance, available);
      debt.balance = round2(debt.balance - payment);
      available = round2(available - payment);
      if (debt.balance <= 0) debt.payoffMonth = month;
    }

    if (state.every((debt) => debt.balance <= 0)) {
      return {
        months: month,
        totalInterest: round2(
          state.reduce((sum, debt) => sum + debt.interestPaid, 0),
        ),
        order: order.map((debt) => debt.name),
        debts: state.map((debt) => ({
          name: debt.name,
          payoffMonth: debt.payoffMonth,
          interestPaid: debt.interestPaid,
        })),
      };
    }
  }

  return null;
}
