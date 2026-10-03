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

export interface MonteCarloPoint {
  month: string;
  p10: number;
  p50: number;
  p90: number;
}

export interface MonteCarloOptions {
  /** Annualized standard deviation entered by the user, in percentage points. */
  annualVolatilityPct: number;
  /** A fixed seed keeps the same assumptions reproducible across renders. */
  seed: number;
  trials?: number;
}

export function parseMonteCarloOptions(params: ForecastSearchParams): MonteCarloOptions {
  const volatility = Number(firstSearchParam(params.volatilityPct));
  const seed = Number(firstSearchParam(params.seed));
  return {
    annualVolatilityPct: Number.isFinite(volatility) ? Math.max(0, Math.min(100, volatility)) : 12,
    seed: Number.isFinite(seed) ? Math.trunc(seed) : 20261003,
  };
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

  const actualDebtPayment = Math.max(0, Math.min(state.liabilities, assumptions.monthlyDebtPayment));
  const cash = state.cash * (1 + monthlyCashYield) + assumptions.monthlySavings - actualDebtPayment;
  const investments = Math.max(0, state.investments) * (1 + monthlyReturn);
  const liabilities = Math.max(0, state.liabilities - actualDebtPayment);

  return { cash, investments, liabilities };
}

function netWorthOf(state: ForecastState): number {
  return round2(state.cash + state.investments - state.liabilities);
}

/** Percentage points applied around the base rate — additive, not
 * multiplicative, so conservative <= base <= optimistic holds regardless of
 * whether the entered rate is positive, zero, or negative. */
export const SCENARIO_SPREAD_PCT = 2;
export const FIRE_WITHDRAWAL_RATE = 0.04;

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

function seededRandom(seed: number): () => number {
  let state = (Math.trunc(seed) >>> 0) || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

function normalSample(random: () => number): number {
  const u1 = Math.max(Number.MIN_VALUE, random());
  const u2 = random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower] ?? 0;
  const weight = position - lower;
  return (sorted[lower] ?? 0) + ((sorted[upper] ?? 0) - (sorted[lower] ?? 0)) * weight;
}

/**
 * Runs a seeded Monte Carlo projection using only the return and volatility
 * the user supplied. This is deliberately separate from the default three
 * deterministic scenarios: a percentile band is labelled a projection, not a
 * confidence interval or a prediction.
 */
export function monteCarloProjection(
  current: ForecastStartingState,
  assumptions: ForecastAssumptions,
  options: MonteCarloOptions,
): MonteCarloPoint[] {
  const trials = Math.max(1, Math.min(2_000, Math.trunc(options.trials ?? 500)));
  const annualVolatility = Math.max(0, options.annualVolatilityPct) / 100;
  const annualizedMonthlyShock = annualVolatility * Math.sqrt(12);
  const random = seededRandom(options.seed);
  const paths = Array.from({ length: trials }, () => ({ ...current }));
  const points: MonteCarloPoint[] = [];

  for (let month = 1; month <= assumptions.horizonMonths; month += 1) {
    const values: number[] = [];
    for (const path of paths) {
      const sampledAnnualReturn = assumptions.annualReturnPct +
        normalSample(random) * annualizedMonthlyShock * 100;
      const next = stepMonth(path, assumptions, sampledAnnualReturn);
      path.cash = next.cash;
      path.investments = next.investments;
      path.liabilities = next.liabilities;
      values.push(netWorthOf(path));
    }
    values.sort((a, b) => a - b);
    points.push({
      month: `Month ${month}`,
      p10: round2(percentile(values, 0.1)),
      p50: round2(percentile(values, 0.5)),
      p90: round2(percentile(values, 0.9)),
    });
  }
  return points;
}

export interface EarmarkedGoalRow {
  id: string;
  name: string;
  imageSlug: string | null;
  savedAmount: number;
  spendingReduces: boolean;
  targetAmount: number;
}

export interface EarmarkedGoalLink {
  goalId: string;
  accountId: string;
  allocatedAmount: number | null;
  useEntireBalance: boolean;
}

export interface EarmarkedGoalEvent {
  goalId: string;
  amount: number;
}

export interface EarmarkedCapital {
  total: number;
  emergency: number;
  sinking: number;
}

export interface EarmarkedAccountBalance {
  id: string;
  balance: number | null;
}

function earmarkedKind(goal: EarmarkedGoalRow): "emergency" | "sinking" | null {
  if (goal.imageSlug === "emergency-fund" || /emergency/i.test(goal.name)) return "emergency";
  if (goal.spendingReduces || /sinking/i.test(goal.name)) return "sinking";
  return null;
}

/**
 * Computes funded emergency and sinking-style goal balances without treating
 * an unspent future target as cash. Account allocations are capped at the
 * current account balance and duplicate links cannot inflate the result.
 */
export function computeEarmarkedCapital(
  goals: readonly EarmarkedGoalRow[],
  links: readonly EarmarkedGoalLink[],
  accounts: readonly EarmarkedAccountBalance[],
  events: readonly EarmarkedGoalEvent[] = [],
): EarmarkedCapital {
  const balances = new Map(accounts.map((account) => [account.id, Math.max(0, account.balance ?? 0)]));
  const eventsByGoal = new Map<string, number>();
  for (const event of events) {
    eventsByGoal.set(event.goalId, (eventsByGoal.get(event.goalId) ?? 0) + event.amount);
  }
  const linksByGoal = new Map<string, EarmarkedGoalLink[]>();
  for (const link of links) {
    const existing = linksByGoal.get(link.goalId) ?? [];
    existing.push(link);
    linksByGoal.set(link.goalId, existing);
  }

  let emergency = 0;
  let sinking = 0;
  for (const goal of goals) {
    const kind = earmarkedKind(goal);
    if (!kind || goal.targetAmount <= 0) continue;
    const seenAccounts = new Set<string>();
    const allocated = (linksByGoal.get(goal.id) ?? []).reduce((sum, link) => {
      if (seenAccounts.has(link.accountId)) return sum;
      seenAccounts.add(link.accountId);
      const balance = balances.get(link.accountId);
      if (balance === undefined) return sum;
      return sum + (link.useEntireBalance
        ? balance
        : Math.min(Math.max(0, link.allocatedAmount ?? 0), balance));
    }, 0);
    const funded = Math.min(
      Math.max(0, goal.targetAmount),
      Math.max(0, goal.savedAmount) + allocated + (eventsByGoal.get(goal.id) ?? 0),
    );
    if (kind === "emergency") emergency += funded;
    else sinking += funded;
  }
  return { total: round2(emergency + sinking), emergency: round2(emergency), sinking: round2(sinking) };
}

export interface ForecastAccountRow {
  type: string | null;
  subtype: string | null;
  /** Null when the provider has not reported a balance; never coerced to 0. */
  balance: number | null;
  isoCurrencyCode?: string | null;
  /** False when the user excluded the account from net worth. */
  includeInNetWorth?: boolean;
}

export interface ForecastManualAccountRow {
  accountType: string;
  balance: number | null;
  includeInNetWorth?: boolean;
}

export interface ForecastStartingState {
  cash: number;
  investments: number;
  liabilities: number;
}

/**
 * What the starting point had to leave out, so the page can say so instead of
 * quietly projecting from an incomplete balance sheet.
 */
export interface ForecastStartingGaps {
  /** Accounts the user excluded from net worth (intentional, not a gap). */
  excludedFromNetWorth: number;
  /** Accounts whose balance the provider has not reported. */
  unknownBalance: number;
  /** Currency codes skipped because the projection has no FX rate. */
  foreignCurrencies: string[];
}

export interface ForecastStartingSummary extends ForecastStartingState {
  gaps: ForecastStartingGaps;
}

/**
 * The projection compounds a single currency. Everything the app renders goes
 * through `formatCurrency`, which is USD, so a foreign-currency balance summed
 * in as if it were dollars would be wrong by the exchange rate.
 */
export const FORECAST_BASE_CURRENCY = "USD";

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
): ForecastStartingSummary {
  let cash = 0;
  let investments = 0;
  let liabilities = 0;
  let excludedFromNetWorth = 0;
  let unknownBalance = 0;
  const foreignCurrencies = new Set<string>();

  for (const a of accounts) {
    if (a.includeInNetWorth === false) {
      excludedFromNetWorth += 1;
      continue;
    }
    const currency = a.isoCurrencyCode?.toUpperCase();
    if (currency && currency !== FORECAST_BASE_CURRENCY) {
      foreignCurrencies.add(currency);
      continue;
    }
    if (a.balance === null || a.balance === undefined || !Number.isFinite(a.balance)) {
      unknownBalance += 1;
      continue;
    }
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
    if (m.includeInNetWorth === false) {
      excludedFromNetWorth += 1;
      continue;
    }
    if (m.balance === null || m.balance === undefined || !Number.isFinite(m.balance)) {
      unknownBalance += 1;
      continue;
    }
    const contribution = forecastAccountContribution(
      m.balance,
      m.accountType,
      m.accountType,
    );
    cash += contribution.cash;
    investments += contribution.investments;
    liabilities += contribution.liabilities;
  }

  return {
    cash: round2(cash),
    investments: round2(investments),
    liabilities: round2(liabilities),
    gaps: {
      excludedFromNetWorth,
      unknownBalance,
      foreignCurrencies: [...foreignCurrencies].sort((a, b) => a.localeCompare(b)),
    },
  };
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
  // Do not clamp negative savings to zero: spending deficits are real
  const monthlySavings = monthlyNet.length > 0 ? round2(medianOf(monthlyNet)) : 0;

  // A loan payment lands twice in the canonical projection: money out of the
  // funding account and money in to the loan account. Summing both legs by
  // absolute value doubles the payment, so only the outflow leg counts here
  // (Plaid's convention, which this codebase follows end to end: positive is
  // money out).
  const monthlyDebtAmounts = months
    .map((month) =>
      (byMonth.get(month) ?? [])
        .filter((t) => t.groupKey === "LOAN_PAYMENTS" && t.signedAmount > 0)
        .reduce((sum, t) => sum + t.signedAmount, 0),
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
  earmarkedCapital: number,
): { reached: boolean; amount: number } {
  if (m.type === "debt" && state.liabilities <= 0) {
    return { reached: true, amount: 0 };
  }
  if (m.type === "emergency" && state.cash >= m.targetAmount) {
    return { reached: true, amount: round2(state.cash) };
  }
  if (m.type === "networth" && currentNW >= m.targetAmount) {
    return { reached: true, amount: currentNW };
  }
  if (m.type === "fire" && currentNW - earmarkedCapital >= m.targetAmount) {
    return { reached: true, amount: Math.max(0, currentNW - earmarkedCapital) };
  }
  return { reached: false, amount: 0 };
}

/** The debt-free, emergency-fund, net-worth and FIRE targets worth tracking. */
function buildMilestoneTargets(
  startingState: ForecastStartingState,
  safeMonthlyExpenses: number | null,
  earmarkedCapital: number,
): ForecastMilestone[] {
  const startingNetWorth =
    startingState.cash + startingState.investments - startingState.liabilities;

  const debtFree: ForecastMilestone[] =
    startingState.liabilities > 0
      ? [{
          id: "debt-free",
          name: "Debt Free (Zero Liabilities)",
          targetAmount: 0,
          type: "debt",
          reachedMonth: null,
          reachedAmount: null,
          description: "Pay off all credit card and loan liabilities in full.",
        }]
      : [];

  const emergency =
    safeMonthlyExpenses !== null
      ? buildEmergencyMilestones(startingState.cash, safeMonthlyExpenses)
      : [];

  const netWorth = NET_WORTH_MILESTONE_TARGETS
    .filter((target) => startingNetWorth < target)
    .map<ForecastMilestone>((target) => ({
      id: `nw-${target}`,
      name: formatNetWorthMilestoneName(target),
      targetAmount: target,
      type: "networth",
      reachedMonth: null,
      reachedAmount: null,
      description: `Total assets minus liabilities reach $${target.toLocaleString()}.`,
    }));

  // Financial independence: the 4% safe-withdrawal rule, i.e. 25x annual spend.
  const fireTarget =
      safeMonthlyExpenses !== null ? round2(safeMonthlyExpenses * 12 / FIRE_WITHDRAWAL_RATE) : null;
  const fire: ForecastMilestone[] =
    fireTarget !== null && startingNetWorth - earmarkedCapital < fireTarget
      ? [{
          id: "fire",
          name: "Financial Independence (FIRE)",
          targetAmount: fireTarget,
          type: "fire",
          reachedMonth: null,
          reachedAmount: null,
              description: `25x annual expenses ($${fireTarget.toLocaleString()}), using a 4% withdrawal rate as a rough planning assumption after earmarked goal balances.`,
        }]
      : [];

  return [...debtFree, ...emergency, ...netWorth, ...fire];
}

const NET_WORTH_MILESTONE_TARGETS = [50000, 100000, 250000, 500000, 1000000] as const;

/**
 * Steps the projection forward month by month and stamps each milestone with
 * the first month it is reached. Returns new milestone objects rather than
 * mutating the ones handed in.
 */
function resolveMilestoneMonths(
  milestones: readonly ForecastMilestone[],
  startingState: ForecastStartingState,
  assumptions: ForecastAssumptions,
  earmarkedCapital: number,
): ForecastMilestone[] {
  const resolved = milestones.map((milestone) => ({ ...milestone }));
  let state: ForecastState = { ...startingState };

  for (let month = 1; month <= assumptions.horizonMonths; month++) {
    state = stepMonth(state, assumptions, assumptions.annualReturnPct);
    const currentNetWorth = netWorthOf(state);

    for (const milestone of resolved) {
      if (milestone.reachedMonth !== null) continue;
      const status = checkMilestoneReached(milestone, state, currentNetWorth, earmarkedCapital);
      if (status.reached) {
        milestone.reachedMonth = month;
        milestone.reachedAmount = status.amount;
      }
    }
  }

  return resolved;
}

/**
 * Evaluates key financial independence and wealth milestones over the projection horizon.
 */
export function computeForecastMilestones(
  startingState: ForecastStartingState,
  assumptions: ForecastAssumptions,
  monthlyExpenses = 0,
  earmarkedCapital = 0,
): ForecastMilestone[] {
  // A near-zero expense figure would make the emergency-fund and FIRE targets
  // meaninglessly small, so the floor keeps them honest.
  const safeMonthlyExpenses = monthlyExpenses > 0 ? Math.max(100, monthlyExpenses) : null;
  const milestones = buildMilestoneTargets(startingState, safeMonthlyExpenses, Math.max(0, earmarkedCapital));
  return resolveMilestoneMonths(milestones, startingState, assumptions, Math.max(0, earmarkedCapital));
}
