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

/** Projection horizon: no payment schedule extends beyond 50 years. */
const MAX_MONTHS = 600;

type DebtState = {
  name: string;
  balance: number;
  monthlyRate: number;
  minPayment: number;
  interestPaid: number;
  payoffMonth: number;
};

function applyInterest(state: DebtState[]): void {
  for (const debt of state) {
    if (debt.balance <= 0) continue;
    const interest = round2(debt.balance * debt.monthlyRate);
    debt.balance = round2(debt.balance + interest);
    debt.interestPaid = round2(debt.interestPaid + interest);
  }
}

function applyMinimumPayments(state: DebtState[], budget: number, month: number): number {
  let available = budget;
  for (const debt of state) {
    if (debt.balance <= 0) continue;
    const payment = Math.min(debt.minPayment, debt.balance, available);
    debt.balance = round2(debt.balance - payment);
    available = round2(available - payment);
    if (debt.balance <= 0) debt.payoffMonth = month;
  }
  return available;
}

function applyExtraPayments(state: DebtState[], initialAvailable: number, month: number): void {
  let available = initialAvailable;
  for (const debt of state) {
    if (available <= 0) break;
    if (debt.balance <= 0) continue;
    const payment = Math.min(debt.balance, available);
    debt.balance = round2(debt.balance - payment);
    available = round2(available - payment);
    if (debt.balance <= 0) debt.payoffMonth = month;
  }
}

function completedPlan(state: DebtState[], order: DebtInput[]): PayoffPlan {
  return {
    months: state.reduce((latest, debt) => Math.max(latest, debt.payoffMonth), 0),
    totalInterest: round2(state.reduce((sum, debt) => sum + debt.interestPaid, 0)),
    order: order.map((debt) => debt.name),
    debts: state.map((debt) => ({
      name: debt.name,
      payoffMonth: debt.payoffMonth,
      interestPaid: debt.interestPaid,
    })),
  };
}

/**
 * Simulates month-by-month payoff. The monthly budget is fixed at
 * (sum of minimum payments + extraMonthly); when a debt clears, its
 * payment automatically rolls into the next debt in focus order.
 * Returns null for empty/invalid input or when payoff is outside the
 * 600-month horizon or safe cent precision.
 */
export interface DebtScheduleRow {
  month: number;
  openingBalance: number;
  interest: number;
  payment: number;
  closingBalance: number;
}
export interface ScheduledPayoffPlan extends PayoffPlan { schedule: DebtScheduleRow[] }

export function buildPayoffSchedule(input: PayoffPlanInput): ScheduledPayoffPlan | null {
  if (input.debts.length === 0) return null;
  const valid = (value: number) => Number.isFinite(value) && value >= 0 && Number.isSafeInteger(Math.round(value * 100));
  if (!valid(input.extraMonthly) || input.debts.some(debt => !valid(debt.balance) || !valid(debt.apr) || (debt.minPayment !== undefined && !valid(debt.minPayment)))) return null;

  const order = [...input.debts].sort((a, b) =>
    input.strategy === "avalanche" ? b.apr - a.apr : a.balance - b.balance,
  );

  const state: DebtState[] = order.map((debt) => ({
    name: debt.name,
    balance: round2(debt.balance),
    monthlyRate: debt.apr / 100 / 12,
    minPayment: round2(debt.minPayment ?? Math.max(25, debt.balance * 0.02)),
    interestPaid: 0,
    payoffMonth: 0,
  }));

  const schedule: DebtScheduleRow[] = [];
  if (state.every((debt) => debt.balance <= 0)) return { ...completedPlan(state, order), schedule };
  const budget = round2(
    state.reduce((sum, debt) => sum + debt.minPayment, 0) + input.extraMonthly,
  );

  // Equality with initial interest can still converge as priority payments
  // shift balances between rates. Only a zero budget is an immediate failure.
  if (budget <= 0) return null;

  for (let month = 1; month <= MAX_MONTHS; month++) {
    const openingBalance = round2(state.reduce((sum, debt) => sum + debt.balance, 0));
    applyInterest(state);
    const afterInterest = round2(state.reduce((sum, debt) => sum + debt.balance, 0));
    const accruedInterest = round2(state.reduce((sum, debt) => sum + debt.interestPaid, 0));
    // Stop before runaway capitalization loses cent precision.
    if (!Number.isSafeInteger(Math.round(afterInterest * 100)) || !Number.isSafeInteger(Math.round(accruedInterest * 100))) return null;

    // Minimum payments first, then everything left cascades to the focus
    // debt (state is already in focus order).
    const available = applyMinimumPayments(state, budget, month);
    applyExtraPayments(state, available, month);

    const closingBalance = round2(state.reduce((sum, debt) => sum + debt.balance, 0));
    schedule.push({ month, openingBalance, interest: round2(afterInterest - openingBalance), payment: round2(afterInterest - closingBalance), closingBalance });
    if (state.every((debt) => debt.balance <= 0)) {
      return { ...completedPlan(state, order), months: month, schedule };
    }
  }

  return null;
}

/** Compatibility wrapper: existing callers retain the exact plan shape. */
export function buildPayoffPlan(input: PayoffPlanInput): PayoffPlan | null {
  const result = buildPayoffSchedule(input);
  if (!result) return null;
  return { months: result.months, totalInterest: result.totalInterest, order: result.order, debts: result.debts };
}
