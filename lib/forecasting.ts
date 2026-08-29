import { buildPayoffPlan, type PayoffPlan } from "@/lib/debt";
import { financeTotals, type CanonicalFinanceTransaction } from "@/lib/finance-domain";
import { computeRunwayMonths, medianOf } from "@/lib/insights";
import { groupKeyFor } from "@/lib/accounts-page";
import { classifyBalanceSheetAmount } from "@/lib/account-balance";
import { firstSearchParam } from "@/lib/search-params";

/**
 * The dashboard's What-if sandbox math (Phase 0-era, previously inline in
 * WhatIfPanel's useMemo). Extracted so it's unit-testable independent of
 * React and shareable with anything else that wants the same "slide a
 * delta, see the effect" scenario — kept byte-for-byte equivalent to the
 * inline version it replaced (see tests/unit/forecasting.test.ts).
 */
export interface WhatIfDebt {
  name: string;
  balance: number;
  apr: number;
}

export interface WhatIfInput {
  cashBalance: number | null;
  monthlyIncome: number;
  monthlySpend: number;
  monthlyEssentials: number[];
  debts: WhatIfDebt[];
  incomeDelta: number;
  spendDelta: number;
  extraDebt: number;
}

export interface WhatIfProjection {
  surplus: number;
  runwayMonths: number | null;
  plan: PayoffPlan | null;
}

export function computeWhatIfProjection(input: WhatIfInput): WhatIfProjection {
  const surplus = input.monthlyIncome + input.incomeDelta - (input.monthlySpend + input.spendDelta);

  const adjustedEssentials = input.monthlyEssentials.map((amount) =>
    Math.max(0, amount + input.spendDelta),
  );
  const runwayMonths =
    adjustedEssentials.length > 0
      ? computeRunwayMonths({ liquidBalance: input.cashBalance, monthlyEssentials: adjustedEssentials })
      : null;

  const plan =
    input.debts.length > 0
      ? buildPayoffPlan({ debts: input.debts, extraMonthly: input.extraDebt, strategy: "avalanche" })
      : null;

  return { surplus, runwayMonths, plan };
}

/**
 * Multi-year net-worth scenarios (Phase 10). These are the user's own
 * assumptions compounded forward, not a statistical forecast or a promise —
 * every caller-facing surface built on this must say "projection", never
 * "prediction" or a confidence level this function does not compute.
 */
export interface ForecastAssumptions {
  monthlySavings: number; // added to cash each month before any yield
  annualReturnPct: number; // applied to the investment balance only
  annualCashYieldPct: number; // applied to cash
  monthlyDebtPayment: number; // reduces liabilities, floored at 0
  horizonMonths: 12 | 60 | 120;
}

export interface ForecastPoint {
  month: string; // 1-indexed month label ("Month 1", "Month 2", ...)
  conservative: number;
  base: number;
  optimistic: number;
}

interface ForecastState {
  cash: number;
  investments: number;
  liabilities: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function stepMonth(state: ForecastState, assumptions: ForecastAssumptions, annualReturnPct: number): ForecastState {
  const monthlyCashYield = assumptions.annualCashYieldPct / 100 / 12;
  const monthlyReturn = annualReturnPct / 100 / 12;

  const cash = state.cash * (1 + monthlyCashYield) + assumptions.monthlySavings;
  const investments = Math.max(0, state.investments) * (1 + monthlyReturn);
  const liabilities = Math.max(0, state.liabilities - assumptions.monthlyDebtPayment);

  return { cash, investments, liabilities };
}

function netWorthOf(state: ForecastState): number {
  return round2(state.cash + state.investments - state.liabilities);
}

/** Percentage points applied around the base rate — additive, not
 * multiplicative, so conservative <= base <= optimistic holds regardless of
 * whether the entered rate is positive, zero, or negative. */
const SCENARIO_SPREAD_PCT = 2;

/**
 * Three scenarios sharing one set of assumptions, differing only in the
 * investment return rate: conservative (2 points below), base (as entered),
 * optimistic (2 points above). All three use the same savings rate and debt
 * payment — the spread is about market uncertainty, not spending behavior.
 */
export function forecastNetWorth(
  current: { cash: number; investments: number; liabilities: number },
  assumptions: ForecastAssumptions,
): ForecastPoint[] {
  let conservativeState: ForecastState = { ...current };
  let baseState: ForecastState = { ...current };
  let optimisticState: ForecastState = { ...current };

  const points: ForecastPoint[] = [];
  for (let month = 1; month <= assumptions.horizonMonths; month += 1) {
    conservativeState = stepMonth(conservativeState, assumptions, assumptions.annualReturnPct - SCENARIO_SPREAD_PCT);
    baseState = stepMonth(baseState, assumptions, assumptions.annualReturnPct);
    optimisticState = stepMonth(optimisticState, assumptions, assumptions.annualReturnPct + SCENARIO_SPREAD_PCT);

    points.push({
      month: `Month ${month}`,
      conservative: netWorthOf(conservativeState),
      base: netWorthOf(baseState),
      optimistic: netWorthOf(optimisticState),
    });
  }
  return points;
}

export type LifeEventType = "home_purchase" | "child" | "career_change" | "large_expense" | "retirement";

export interface LifeEvent {
  id: string;
  name: string;
  type: LifeEventType;
  monthOffset: number; // 1-indexed month when event occurs
  oneTimeCashImpact?: number; // e.g. -50000 for down payment, positive for windfall
  monthlyIncomeDelta?: number; // delta to monthly savings/income
  monthlyExpenseDelta?: number; // delta to monthly expenses
}

/**
 * Projects multi-year net worth factoring in custom life events at designated months.
 */
export function forecastNetWorthWithLifeEvents(
  current: { cash: number; investments: number; liabilities: number },
  assumptions: ForecastAssumptions,
  events: LifeEvent[] = [],
): ForecastPoint[] {
  let conservativeState: ForecastState = { ...current };
  let baseState: ForecastState = { ...current };
  let optimisticState: ForecastState = { ...current };

  const eventsByMonth = new Map<number, LifeEvent[]>();
  for (const ev of events) {
    const list = eventsByMonth.get(ev.monthOffset) ?? [];
    list.push(ev);
    eventsByMonth.set(ev.monthOffset, list);
  }

  let runningSavings = assumptions.monthlySavings;
  const points: ForecastPoint[] = [];

  for (let month = 1; month <= assumptions.horizonMonths; month += 1) {
    const monthEvents = eventsByMonth.get(month);
    if (monthEvents) {
      for (const ev of monthEvents) {
        if (ev.oneTimeCashImpact) {
          conservativeState.cash += ev.oneTimeCashImpact;
          baseState.cash += ev.oneTimeCashImpact;
          optimisticState.cash += ev.oneTimeCashImpact;
        }
        if (ev.monthlyIncomeDelta) {
          runningSavings += ev.monthlyIncomeDelta;
        }
        if (ev.monthlyExpenseDelta) {
          runningSavings -= ev.monthlyExpenseDelta;
        }
      }
    }

    const currentAssumptions = { ...assumptions, monthlySavings: runningSavings };
    conservativeState = stepMonth(conservativeState, currentAssumptions, assumptions.annualReturnPct - SCENARIO_SPREAD_PCT);
    baseState = stepMonth(baseState, currentAssumptions, assumptions.annualReturnPct);
    optimisticState = stepMonth(optimisticState, currentAssumptions, assumptions.annualReturnPct + SCENARIO_SPREAD_PCT);

    points.push({
      month: `Month ${month}`,
      conservative: netWorthOf(conservativeState),
      base: netWorthOf(baseState),
      optimistic: netWorthOf(optimisticState),
    });
  }
  return points;
}

export interface ForecastAccountRow {
  type: string | null;
  subtype: string | null;
  balance: number;
}

export interface ForecastManualAccountRow {
  accountType: string;
  balance: number;
}

export interface ForecastStartingState {
  cash: number;
  investments: number;
  liabilities: number;
}

function forecastAccountContribution(
  balance: number,
  group: string,
  type: string | null,
  subtype?: string | null,
): ForecastStartingState {
  if (group === "investment") {
    return { cash: 0, investments: balance, liabilities: 0 };
  }

  const liabilityGroup = ["credit", "loan", "liability", "debt"].includes(group);
  if (!liabilityGroup) {
    return { cash: balance, investments: 0, liabilities: 0 };
  }

  const classified = classifyBalanceSheetAmount(balance, type, subtype);
  return classified.kind === "liability"
    ? { cash: 0, investments: 0, liabilities: classified.amount }
    : { cash: classified.amount, investments: 0, liabilities: 0 };
}

/**
 * Splits every account into the three buckets the scenario compounds
 * separately. Reuses accounts-page's own credit/cash/investment/loan
 * classification so the forecast's starting point can never disagree with
 * how the same accounts are grouped on /accounts. Credit and loan balances
 * are stored as the amount owed and are taken as a positive liability
 * regardless of the sign Plaid reports.
 */
export function computeForecastStartingState(
  accounts: ForecastAccountRow[],
  manualAccounts: ForecastManualAccountRow[],
): ForecastStartingState {
  let cash = 0;
  let investments = 0;
  let liabilities = 0;

  for (const a of accounts) {
    const contribution = forecastAccountContribution(
      a.balance,
      groupKeyFor(a.type, a.subtype),
      a.type,
      a.subtype,
    );
    cash += contribution.cash;
    investments += contribution.investments;
    liabilities += contribution.liabilities;
  }
  for (const m of manualAccounts) {
    const contribution = forecastAccountContribution(
      m.balance,
      m.accountType,
      m.accountType,
    );
    cash += contribution.cash;
    investments += contribution.investments;
    liabilities += contribution.liabilities;
  }

  return { cash: round2(cash), investments: round2(investments), liabilities: round2(liabilities) };
}

export interface ForecastDefaults {
  monthlySavings: number;
  monthlyDebtPayment: number;
}

/**
 * Pre-fills two of the four assumptions from actual history rather than an
 * arbitrary guess: monthly savings is the trailing median of (income minus
 * expenses) per month, and the debt payment is the trailing median of
 * LOAN_PAYMENTS transfers — both already excluded from spend everywhere else
 * in the app (see EXCLUDED_PFC in lib/dashboard.ts), so this reuses the same
 * definition of "a card payment is cash movement, not spending" instead of
 * inventing a second one. A user who disagrees can override either value;
 * these are only the starting point.
 */
export function computeForecastDefaults(
  txns: CanonicalFinanceTransaction[],
  months: string[],
): ForecastDefaults {
  const byMonth = new Map<string, CanonicalFinanceTransaction[]>();
  for (const t of txns) {
    const month = t.date.slice(0, 7);
    if (!months.includes(month)) continue;
    const list = byMonth.get(month) ?? [];
    list.push(t);
    byMonth.set(month, list);
  }

  const monthlyNet = months.map((month) => {
    const totals = financeTotals(byMonth.get(month) ?? []);
    return totals.income - totals.expenses;
  });
  const monthlySavings = monthlyNet.length > 0 ? Math.max(0, round2(medianOf(monthlyNet))) : 0;

  const monthlyDebtAmounts = months
    .map((month) =>
      (byMonth.get(month) ?? [])
        .filter((t) => t.groupKey === "LOAN_PAYMENTS")
        .reduce((sum, t) => sum + Math.abs(t.signedAmount), 0),
    )
    .filter((amount) => amount > 0);
  const monthlyDebtPayment = monthlyDebtAmounts.length > 0 ? round2(medianOf(monthlyDebtAmounts)) : 0;

  return { monthlySavings, monthlyDebtPayment };
}

export type ForecastSearchParams = Record<string, string | string[] | undefined>;

const VALID_HORIZONS = [12, 60, 120] as const;

function parseNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Forgiving URL parser (bad or missing values fall back to the computed
 * default, never a crash) so every assumption on the page is a plain GET
 * query param — no client state, no client JS, the whole page is one
 * bookmarkable, back-button-correct URL.
 */
export function parseForecastAssumptions(
  params: ForecastSearchParams,
  defaults: ForecastDefaults,
): ForecastAssumptions {
  const horizonRaw = Number(firstSearchParam(params.horizon));
  const horizonMonths = (VALID_HORIZONS as readonly number[]).includes(horizonRaw)
    ? (horizonRaw as ForecastAssumptions["horizonMonths"])
    : 12;

  return {
    monthlySavings: parseNumber(firstSearchParam(params.monthlySavings), defaults.monthlySavings),
    annualReturnPct: parseNumber(firstSearchParam(params.annualReturnPct), 5),
    annualCashYieldPct: parseNumber(firstSearchParam(params.annualCashYieldPct), 0),
    monthlyDebtPayment: parseNumber(firstSearchParam(params.monthlyDebtPayment), defaults.monthlyDebtPayment),
    horizonMonths,
  };
}

export interface ForecastMilestone {
  id: string;
  name: string;
  targetAmount: number;
  type: "debt" | "emergency" | "networth" | "fire";
  reachedMonth: number | null;
  reachedAmount: number | null;
  description: string;
}

function formatNetWorthMilestoneName(target: number): string {
  const formatted = target >= 1000000 ? `${target / 1000000}M` : `${target / 1000}k`;
  return `$${formatted} Net Worth`;
}

function buildEmergencyMilestones(
  cash: number,
  monthlyExpenses: number,
): ForecastMilestone[] {
  return [3, 6].map((months) => {
    const target = round2(monthlyExpenses * months);
    const achieved = cash >= target;
    return {
      id: `ef-${months}mo`,
      name: `${months}-Month Emergency Fund`,
      targetAmount: target,
      type: "emergency" as const,
      reachedMonth: achieved ? 0 : null,
      reachedAmount: achieved ? cash : null,
      description: `Accumulate ${months} months of basic living expenses ($${target.toLocaleString()}) in liquid cash.`,
    };
  });
}

function checkMilestoneReached(
  m: ForecastMilestone,
  state: ForecastState,
  currentNW: number,
): { reached: boolean; amount: number } {
  if (m.type === "debt" && state.liabilities <= 0) {
    return { reached: true, amount: 0 };
  }
  if (m.type === "emergency" && state.cash >= m.targetAmount) {
    return { reached: true, amount: round2(state.cash) };
  }
  if ((m.type === "networth" || m.type === "fire") && currentNW >= m.targetAmount) {
    return { reached: true, amount: currentNW };
  }
  return { reached: false, amount: 0 };
}

/**
 * Evaluates key financial independence and wealth milestones over the projection horizon.
 */
export function computeForecastMilestones(
  startingState: ForecastStartingState,
  assumptions: ForecastAssumptions,
  monthlyExpenses = 3000,
): ForecastMilestone[] {
  const milestones: ForecastMilestone[] = [];
  const safeMonthlyExpenses = Math.max(100, monthlyExpenses);

  // 1. Debt-Free milestone (if starting with liabilities)
  if (startingState.liabilities > 0) {
    milestones.push({
      id: "debt-free",
      name: "Debt Free (Zero Liabilities)",
      targetAmount: 0,
      type: "debt",
      reachedMonth: null,
      reachedAmount: null,
      description: "Pay off all credit card and loan liabilities in full.",
    });
  }

  // 2 & 3. Emergency Funds (3mo & 6mo)
  milestones.push(...buildEmergencyMilestones(startingState.cash, safeMonthlyExpenses));

  // 4. Net Worth Milestones
  const netWorthTargets = [50000, 100000, 250000, 500000, 1000000];
  const startingNetWorth = startingState.cash + startingState.investments - startingState.liabilities;

  for (const target of netWorthTargets) {
    if (startingNetWorth < target) {
      milestones.push({
        id: `nw-${target}`,
        name: formatNetWorthMilestoneName(target),
        targetAmount: target,
        type: "networth",
        reachedMonth: null,
        reachedAmount: null,
        description: `Total assets minus liabilities reach $${target.toLocaleString()}.`,
      });
    }
  }

  // 5. Financial Independence (FIRE - 4% Safe Withdrawal Rule = 25x Annual Expenses)
  const fireTarget = round2(safeMonthlyExpenses * 12 * 25);
  if (startingNetWorth < fireTarget) {
    milestones.push({
      id: "fire",
      name: "Financial Independence (FIRE)",
      targetAmount: fireTarget,
      type: "fire",
      reachedMonth: null,
      reachedAmount: null,
      description: `25x annual expenses ($${fireTarget.toLocaleString()}), using a 4% withdrawal rate as a rough planning assumption.`,
    });
  }

  // Step through months to compute when each milestone is reached
  let state: ForecastState = { ...startingState };

  for (let month = 1; month <= assumptions.horizonMonths; month++) {
    state = stepMonth(state, assumptions, assumptions.annualReturnPct);
    const currentNW = netWorthOf(state);

    for (const m of milestones) {
      if (m.reachedMonth !== null) continue;
      const status = checkMilestoneReached(m, state, currentNW);
      if (status.reached) {
        m.reachedMonth = month;
        m.reachedAmount = status.amount;
      }
    }
  }

  return milestones;
}
