import type { Goal } from "@/lib/goals";

/**
 * Phase 7 funded goals. Pure: no Supabase, no clock — `today` is always passed
 * in, so every figure here is reproducible from its input.
 *
 * A goal's progress now has three possible sources, and the failure mode is
 * counting the same money twice:
 *
 *   * `saved_amount` — progress the user typed in by hand (the pre-Phase-7
 *     model, preserved rather than migrated away).
 *   * account allocations — a live claim on a real balance, capped at what the
 *     account actually holds so a stale allocation cannot overstate funding.
 *   * `goal_progress_events` — a dated, signed ledger.
 *
 * Save-up goals add all three. **Pay-down goals use the balance delta alone**
 * (`starting_balance` minus what the linked liabilities still owe), because a
 * payment both moves the balance and may have been recorded as an event, so
 * adding the ledger on top would count it twice.
 */

export type GoalType = "save_up" | "pay_down";
export type GoalBadge = "on-track" | "at-risk" | "completed" | "behind";

export interface GoalV2Row extends Goal {
  goal_type: GoalType;
  image_slug: string | null;
  monthly_contribution: number | null;
  spending_reduces: boolean;
  starting_balance: number | null;
  target_balance: number | null;
}

export interface GoalAccountRow {
  goal_id: string;
  account_id: string;
  allocated_amount: number | null;
  use_entire_balance: boolean;
}

export interface GoalProgressEventRow {
  goal_id: string;
  event_date: string;
  amount: number;
}

export interface AccountBalanceRow {
  id: string;
  current_balance: number | null;
  type: string | null;
}

export interface FundedGoal extends GoalV2Row {
  /** Manual progress plus valid account allocations and events. */
  funded_amount: number;
  /** Remaining divided by months to target; null without a target date. */
  est_monthly: number | null;
  badge: GoalBadge;
  progressPct: number;
  remainingAmount: number;
  /** What the linked accounts contribute (save-up only). */
  allocatedFromAccounts: number;
  eventTotal: number;
  /** Raw balance of every linked account, for the goal card. */
  linkedAccountBalance: number;
  /** Net ledger movement per month over the trailing window. */
  trailingMonthlyPace: number;
}

/** Months of ledger history the at-risk comparison looks at. */
export const TRAILING_PACE_MONTHS = 3;

/** Types whose `current_balance` is an amount owed, not an amount held. */
export const LIABILITY_ACCOUNT_TYPES = new Set([
  "credit",
  "loan",
  "liability",
  "debt",
]);

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Balances can be null or negative; neither can fund anything. */
function fundableBalance(balance: number | null): number {
  return Math.max(0, balance ?? 0);
}

/**
 * How much progress the goal needs in total. A save-up goal counts up to
 * `target_amount`; a pay-down goal honors the payoff amount the user entered
 * (`target_amount`), or falls back to the balance it has to close
 * (`starting_balance` minus `target_balance`) for pay-all-off goals and rows
 * created before the entered amount was respected.
 */
export function goalTargetAmount(goal: GoalV2Row): number {
  if (goal.goal_type === "pay_down") {
    if (goal.target_amount > 0) return Math.max(0, round2(goal.target_amount));
    return Math.max(
      0,
      round2((goal.starting_balance ?? 0) - (goal.target_balance ?? 0)),
    );
  }
  return Math.max(0, goal.target_amount);
}

function parseDate(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year!, (month ?? 1) - 1, day ?? 1));
}

function monthSpan(from: Date, to: Date): number {
  const months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth());
  return months + (to.getUTCDate() >= from.getUTCDate() ? 0 : -1);
}

/** First day of the month `monthsBack` before `date`, as `YYYY-MM-DD`. */
function monthStartBefore(date: Date, monthsBack: number): string {
  const total =
    date.getUTCFullYear() * 12 + date.getUTCMonth() - monthsBack;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

/**
 * What the linked accounts contribute to a save-up goal. A fixed allocation is
 * capped at the account's real balance; an entire-balance claim is the balance.
 * Duplicate (goal, account) pairs collapse — the unique constraint makes them
 * unreachable, but a duplicate must never inflate funding if one appears.
 */
function allocationTotal(
  links: GoalAccountRow[],
  balances: Map<string, AccountBalanceRow>,
): number {
  const seen = new Set<string>();
  let total = 0;
  for (const link of links) {
    if (seen.has(link.account_id)) continue;
    const account = balances.get(link.account_id);
    // An allocation whose account is gone from the balance set contributes
    // nothing; guessing would be worse than reporting less.
    if (!account) continue;
    seen.add(link.account_id);

    const available = fundableBalance(account.current_balance);
    total += link.use_entire_balance
      ? available
      : Math.min(link.allocated_amount ?? 0, available);
  }
  return round2(total);
}

/** Raw balance of each distinct linked account, whatever its sign convention. */
function linkedBalanceTotal(
  links: GoalAccountRow[],
  balances: Map<string, AccountBalanceRow>,
): { total: number; linkedCount: number } {
  const seen = new Set<string>();
  let total = 0;
  for (const link of links) {
    if (seen.has(link.account_id)) continue;
    const account = balances.get(link.account_id);
    if (!account) continue;
    seen.add(link.account_id);
    total += account.current_balance ?? 0;
  }
  return { total: round2(total), linkedCount: seen.size };
}

function badgeFor(
  remaining: number,
  target: number,
  targetDate: string | null,
  today: Date,
  requiredPace: number | null,
  expectedPace: number | null,
): GoalBadge {
  if (target <= 0 || remaining <= 0) return "completed";
  if (targetDate && parseDate(targetDate) < today) return "behind";
  // No plan and no ledger yet: there is nothing to judge a pace against, and
  // flagging a goal created moments ago would be noise, not information.
  if (requiredPace === null || expectedPace === null) return "on-track";
  return expectedPace + 0.01 < requiredPace ? "at-risk" : "on-track";
}

export function computeFundedGoals(
  goals: GoalV2Row[],
  links: GoalAccountRow[],
  accounts: AccountBalanceRow[],
  events: GoalProgressEventRow[],
  today: Date,
): FundedGoal[] {
  const balances = new Map(accounts.map((account) => [account.id, account]));
  const linksByGoal = new Map<string, GoalAccountRow[]>();
  for (const link of links) {
    const existing = linksByGoal.get(link.goal_id) ?? [];
    existing.push(link);
    linksByGoal.set(link.goal_id, existing);
  }
  const eventsByGoal = new Map<string, GoalProgressEventRow[]>();
  for (const item of events) {
    const existing = eventsByGoal.get(item.goal_id) ?? [];
    existing.push(item);
    eventsByGoal.set(item.goal_id, existing);
  }

  const paceWindowStart = monthStartBefore(today, TRAILING_PACE_MONTHS - 1);

  const funded = goals.map((goal): FundedGoal => {
    const goalLinks = linksByGoal.get(goal.id) ?? [];
    const goalEvents = eventsByGoal.get(goal.id) ?? [];
    const target = goalTargetAmount(goal);
    const { total: linkedAccountBalance, linkedCount } = linkedBalanceTotal(
      goalLinks,
      balances,
    );

    const eventTotal = round2(
      goalEvents.reduce((sum, item) => sum + item.amount, 0),
    );

    let allocatedFromAccounts = 0;
    let fundedAmount: number;
    if (goal.goal_type === "pay_down") {
      // With nothing linked there is no balance to measure against, so report
      // no progress rather than reading "baseline minus zero" as fully paid.
      // The delta is capped at the target: when the user asked to pay off a
      // specific amount, going past it is complete, not extra progress.
      fundedAmount =
        linkedCount === 0
          ? 0
          : Math.min(
              target,
              Math.max(
                0,
                round2((goal.starting_balance ?? 0) - linkedAccountBalance),
              ),
            );
    } else {
      allocatedFromAccounts = allocationTotal(goalLinks, balances);
      fundedAmount = round2(
        Math.max(0, goal.saved_amount) + allocatedFromAccounts + eventTotal,
      );
    }

    const remainingAmount = Math.max(0, round2(target - fundedAmount));
    const progressPct =
      target <= 0
        ? 100
        : Math.max(0, Math.min(100, Math.round((fundedAmount / target) * 100)));

    let estMonthly: number | null = null;
    if (goal.target_date) {
      // A date that has already passed leaves one month at most, so the whole
      // remainder is owed now rather than divided by a negative span.
      const months = Math.max(1, monthSpan(today, parseDate(goal.target_date)));
      estMonthly = round2(remainingAmount / months);
    }

    const inWindow = goalEvents.filter(
      (item) => item.event_date >= paceWindowStart,
    );
    const trailingMonthlyPace = round2(
      inWindow.reduce((sum, item) => sum + item.amount, 0) /
        TRAILING_PACE_MONTHS,
    );
    // The ledger is the truth once any of it exists; the planned contribution
    // only stands in before the first event lands.
    const expectedPace =
      goalEvents.length > 0 ? trailingMonthlyPace : goal.monthly_contribution;

    return {
      ...goal,
      funded_amount: fundedAmount,
      est_monthly: estMonthly,
      badge: badgeFor(
        remainingAmount,
        target,
        goal.target_date,
        today,
        estMonthly,
        expectedPace,
      ),
      progressPct,
      remainingAmount,
      allocatedFromAccounts,
      eventTotal,
      linkedAccountBalance,
      trailingMonthlyPace,
    };
  });

  // Unfinished first, then soonest deadline, then name — same ordering the
  // pre-Phase-7 `goalSummary` used, so the page's reading order is unchanged.
  return funded.sort((a, b) => {
    const rank = (goal: FundedGoal) => (goal.badge === "completed" ? 1 : 0);
    const rankDiff = rank(a) - rank(b);
    if (rankDiff !== 0) return rankDiff;
    if (a.target_date && b.target_date) {
      return a.target_date.localeCompare(b.target_date) || a.name.localeCompare(b.name);
    }
    if (a.target_date) return -1;
    if (b.target_date) return 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * The cross-row allocation rules, mirrored from the `set_goal_allocation`
 * function in 20260730200000_goals_v2.sql so the route can report a specific
 * error before a round trip and so the rules are unit-tested here. The database
 * function remains the enforcement point — it holds a row lock, which this
 * cannot.
 *
 * Return values are the function's own error codes, so one message table serves
 * both paths.
 */
export type AllocationError =
  | "allocation_mode_conflict"
  | "allocation_amount_required"
  | "account_already_fully_allocated"
  | "account_has_fixed_allocations"
  | "allocation_exceeds_balance";

export interface AllocationCheckInput {
  /** Allocations against this account belonging to *other* goals. */
  existing: GoalAccountRow[];
  accountBalance: number | null;
  allocatedAmount: number | null;
  useEntireBalance: boolean;
}

export function validateAllocation(
  input: AllocationCheckInput,
): AllocationError | null {
  const { existing, accountBalance, allocatedAmount, useEntireBalance } = input;

  if (useEntireBalance && allocatedAmount !== null) {
    return "allocation_mode_conflict";
  }
  if (!useEntireBalance && (allocatedAmount === null || allocatedAmount <= 0)) {
    return "allocation_amount_required";
  }

  const otherFixed = existing
    .filter((link) => !link.use_entire_balance)
    .reduce((sum, link) => sum + (link.allocated_amount ?? 0), 0);
  const otherEntire = existing.some((link) => link.use_entire_balance);

  if (otherEntire) return "account_already_fully_allocated";
  if (useEntireBalance && otherFixed > 0) return "account_has_fixed_allocations";
  if (
    !useEntireBalance &&
    round2(otherFixed + allocatedAmount!) > fundableBalance(accountBalance)
  ) {
    return "allocation_exceeds_balance";
  }
  return null;
}

/** Human-readable messages for the codes above, shared by route and UI. */
export const ALLOCATION_ERROR_MESSAGES: Record<AllocationError, string> = {
  allocation_mode_conflict:
    "Choose either a fixed amount or the account's entire balance, not both.",
  allocation_amount_required: "Enter an amount above zero to allocate.",
  account_already_fully_allocated:
    "Another goal already claims this account's entire balance.",
  account_has_fixed_allocations:
    "This account already has fixed allocations, so its whole balance is not free.",
  allocation_exceeds_balance:
    "That would allocate more than this account currently holds.",
};

export function isLiabilityAccount(type: string | null): boolean {
  return LIABILITY_ACCOUNT_TYPES.has((type ?? "").trim().toLowerCase());
}

export interface GoalContributionLine {
  goalId: string;
  name: string;
  planned: number;
  actual: number;
}

/**
 * What the Budget page shows under "Contributions" for one month, and what it
 * subtracts from Left to Budget.
 *
 * **Actual comes from the event ledger only.** A balance moving is not a
 * contribution: an account can rise because a paycheque landed, because a
 * transfer arrived, or because a refund cleared, and counting any of that as
 * money the user deliberately put toward a goal would quietly inflate the
 * budget's actuals. Allocations against a balance fund the *goal* (see
 * `computeFundedGoals`); only a recorded event counts as a contribution *this
 * month*.
 *
 * Goals with no planned contribution and no activity this month are omitted, so
 * the section lists what the user is actually doing rather than every goal.
 */
export function goalContributionsForMonth(
  goals: Pick<GoalV2Row, "id" | "name" | "monthly_contribution">[],
  events: GoalProgressEventRow[],
  month: string,
): GoalContributionLine[] {
  const actualByGoal = new Map<string, number>();
  for (const item of events) {
    if (!item.event_date.startsWith(month)) continue;
    actualByGoal.set(
      item.goal_id,
      (actualByGoal.get(item.goal_id) ?? 0) + item.amount,
    );
  }

  return goals
    .map((goal) => ({
      goalId: goal.id,
      name: goal.name,
      planned: Math.max(0, round2(goal.monthly_contribution ?? 0)),
      actual: round2(actualByGoal.get(goal.id) ?? 0),
    }))
    .filter((line) => line.planned > 0 || line.actual !== 0)
    .sort(
      (a, b) => b.planned - a.planned || a.name.localeCompare(b.name),
    );
}
