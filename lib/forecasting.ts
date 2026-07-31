import { buildPayoffPlan, type PayoffPlan } from "@/lib/debt";
import { financeTotals, type CanonicalFinanceTransaction } from "@/lib/finance-domain";
import { computeRunwayMonths, medianOf } from "@/lib/insights";
import { groupKeyFor } from "@/lib/accounts-page";

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
    const group = groupKeyFor(a.type, a.subtype);
    if (group === "investment") investments += a.balance;
    else if (group === "credit" || group === "loan") liabilities += Math.abs(a.balance);
    else cash += a.balance;
  }
  for (const m of manualAccounts) {
    if (m.accountType === "investment") investments += m.balance;
    else if (m.accountType === "liability" || m.accountType === "debt") liabilities += Math.abs(m.balance);
    else cash += m.balance;
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

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

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
  const horizonRaw = Number(first(params.horizon));
  const horizonMonths = (VALID_HORIZONS as readonly number[]).includes(horizonRaw)
    ? (horizonRaw as ForecastAssumptions["horizonMonths"])
    : 12;

  return {
    monthlySavings: parseNumber(first(params.monthlySavings), defaults.monthlySavings),
    annualReturnPct: parseNumber(first(params.annualReturnPct), 5),
    annualCashYieldPct: parseNumber(first(params.annualCashYieldPct), 0),
    monthlyDebtPayment: parseNumber(first(params.monthlyDebtPayment), defaults.monthlyDebtPayment),
    horizonMonths,
  };
}
