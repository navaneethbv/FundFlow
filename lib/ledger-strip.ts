import type { SupabaseClient } from "@supabase/supabase-js";

export interface LedgerStripAccount {
  id: string;
  name: string | null;
  mask: string | null;
  current_balance: number | null;
  iso_currency_code: string | null;
  type: string | null;
  user_id?: string | null;
}
export interface LedgerStripTransaction {
  id: string;
  date: string;
  amount: number;
  merchant_name: string | null;
  name: string | null;
}

export interface LedgerTick {
  id: string;
  date: string;
  label: string;
  amount: number;
  runningBalance: number;
  major: boolean;
}

/**
 * A tick is *eligible* for a permanent label only if it's an inflow, or an
 * outflow of at least this much; eligibility still competes for the scarce
 * slots in `LEDGER_LABEL_SLOT_BUDGETS`. This keeps a small everyday outflow
 * from consuming a slot a larger move should have had. Deliberately separate
 * from `SpendingAnomalyInput.largeTransactionThreshold` in lib/planning.ts —
 * "worth a permanent label on a register" and "anomalous spending" are
 * different questions with no reason to share a threshold.
 */
const MAJOR_TICK_THRESHOLD = 100;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Picks the account the strip reconstructs a running balance for.
 *
 * Ownership fails **closed**: personal scope without a known `ownerUserId`
 * matches nothing rather than falling through to whatever account is first.
 * `household` is the only way to span owners, and it has to be passed
 * deliberately — `getDashboardData` drops its `user_id` filter in that scope,
 * so an accidentally-empty id must never be what widens the match.
 */
export function pickAnchorAccount(
  accounts: readonly LedgerStripAccount[],
  options?: Readonly<{
    ownerUserId?: string;
    selectedAccountId?: string;
    household?: boolean;
  }>,
): LedgerStripAccount | null {
  const requireOwner = !options?.household;
  const ownerUserId = options?.ownerUserId;
  if (requireOwner && !ownerUserId) {
    return null;
  }

  // The running balance walks Plaid's sign convention against a depository
  // balance, so a credit or loan account would read inverted. Selecting one
  // yields no anchor, and the widget hides itself rather than lying.
  const isAnchorable = (account: LedgerStripAccount): boolean =>
    account.type === "depository" &&
    account.current_balance !== null &&
    (!requireOwner || account.user_id === ownerUserId);

  if (options?.selectedAccountId) {
    const selected = accounts.find((account) => account.id === options.selectedAccountId);
    return selected && isAnchorable(selected) ? selected : null;
  }

  return accounts.find(isAnchorable) ?? null;
}

/**
 * Walks a single account's transactions in chronological order, converting
 * each from Plaid's sign convention (positive = out, negative = in) to a
 * signed ledger delta, and reconstructs the running balance that ends at
 * `currentBalance` — the same figure `AccountSummary.current_balance`
 * reports.
 */
export function buildLedgerStripTicks(
  transactions: readonly LedgerStripTransaction[],
  currentBalance: number,
  options: Readonly<{ majorThreshold?: number }> = {},
): LedgerTick[] {
  if (transactions.length === 0) {
    return [];
  }

  const majorThreshold = options.majorThreshold ?? MAJOR_TICK_THRESHOLD;
  const sorted = [...transactions].sort(
    (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
  );
  const netDelta = sorted.reduce((sum, transaction) => sum - transaction.amount, 0);
  let balance = round2(currentBalance - netDelta);

  return sorted.map((transaction) => {
    const delta = -transaction.amount;
    balance = round2(balance + delta);
    return {
      id: transaction.id,
      date: transaction.date,
      label: transaction.merchant_name ?? transaction.name ?? "Transaction",
      amount: delta,
      runningBalance: balance,
      major: delta > 0 || Math.abs(delta) >= majorThreshold,
    };
  });
}

/** Breakpoint tier a label becomes visible at: 1 always, 2 at `md`, 3 at `lg`. */
export type LedgerLabelTier = 1 | 2 | 3;

/** Which of the two stacked label rows on one side of the axis a label sits in. */
export type LedgerLabelBand = 0 | 1;

export interface LedgerDayLabel {
  merchant: string;
  /** Signed delta: positive for the day's largest inflow, negative for its largest outflow. */
  amount: number;
  tier: LedgerLabelTier;
  band: LedgerLabelBand;
}

export interface LedgerDayColumn {
  date: string;
  dayOfMonth: number;
  grossIn: number;
  grossOut: number;
  net: number;
  transactionCount: number;
  endOfDayBalance: number;
  inflowLabel: LedgerDayLabel | null;
  outflowLabel: LedgerDayLabel | null;
}

/**
 * Cumulative label-slot maxima per breakpoint tier, counting both sides of the
 * axis. These are budgets, not targets: a tightly clustered month may expose
 * fewer once the separation rule is applied.
 *
 * This is the second of two independent gates. `MAJOR_TICK_THRESHOLD` first
 * decides which ticks are even worth labelling; this budget then bounds how
 * many of those survive into the rail. The threshold alone could not: a
 * dollar figure has no relationship to available width, so on a busy month
 * it would admit *more* labels into the same fixed-width rail, not fewer.
 */
export const LEDGER_LABEL_SLOT_BUDGETS: Record<LedgerLabelTier, number> = {
  1: 4,
  2: 8,
  3: 12,
};

/**
 * Fixed rendered label width, and the single source of truth for it.
 *
 * Three things depend on this number: the day-gap maths below, the label box
 * itself, and the rail's edge inset (half this, so a label centred on the
 * first or last day of the month still lands inside the card). `LedgerStrip`
 * publishes it as a CSS custom property and derives the other two with
 * `calc()`, so the value cannot drift out of step and silently clip.
 */
export const LEDGER_LABEL_WIDTH_PX = 72;

/** Conservative rail widths per tier, used to convert label width into calendar days. */
const MIN_AXIS_WIDTH_PX: Record<LedgerLabelTier, number> = {
  1: 208,
  2: 448,
  3: 496,
};

/**
 * Minimum calendar-day separation two labels on the same side and band need so
 * their boxes cannot touch at `tier`'s narrowest supported rail.
 */
export function ledgerLabelMinDayGap(tier: LedgerLabelTier, daysInMonth: number): number {
  const span = Math.max(daysInMonth - 1, 1);
  return Math.ceil((LEDGER_LABEL_WIDTH_PX / MIN_AXIS_WIDTH_PX[tier]) * span);
}

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Days in `month`, computed from integer parts so a local time zone cannot shift it. */
export function ledgerDaysInMonth(month: string): number {
  if (!MONTH_PATTERN.test(month)) {
    throw new RangeError("ledger_strip_invalid_month");
  }
  const [year, monthNum] = month.split("-").map(Number);
  return new Date(Date.UTC(year!, monthNum!, 0)).getUTCDate();
}

interface LabelCandidate {
  side: "in" | "out";
  dayOfMonth: number;
  date: string;
  merchant: string;
  amount: number;
}

interface DayAccumulator {
  date: string;
  grossIn: number;
  grossOut: number;
  transactionCount: number;
  endOfDayBalance: number;
  largestIn: LabelCandidate | null;
  largestOut: LabelCandidate | null;
}

/** Deterministic order: biggest first, then date, side, and merchant to break ties. */
function compareCandidates(a: LabelCandidate, b: LabelCandidate): number {
  return (
    Math.abs(b.amount) - Math.abs(a.amount) ||
    a.date.localeCompare(b.date) ||
    a.side.localeCompare(b.side) ||
    a.merchant.localeCompare(b.merchant)
  );
}

function candidateForTick(tick: LedgerTick, inflow: boolean): LabelCandidate | null {
  if (!tick.major) return null;
  return {
    side: inflow ? "in" : "out",
    dayOfMonth: Number(tick.date.slice(8, 10)),
    date: tick.date,
    merchant: tick.label,
    amount: tick.amount,
  };
}

function beatsLargest(
  candidate: LabelCandidate,
  current: LabelCandidate | null,
): boolean {
  return current === null || Math.abs(candidate.amount) > Math.abs(current.amount);
}

function updateDayAccumulator(
  previous: DayAccumulator,
  tick: LedgerTick,
): DayAccumulator {
  const inflow = tick.amount > 0;
  const candidate = candidateForTick(tick, inflow);
  const largestIn =
    candidate?.side === "in" && beatsLargest(candidate, previous.largestIn)
      ? candidate
      : previous.largestIn;
  const largestOut =
    candidate?.side === "out" && beatsLargest(candidate, previous.largestOut)
      ? candidate
      : previous.largestOut;

  return {
    ...previous,
    grossIn: inflow ? round2(previous.grossIn + tick.amount) : previous.grossIn,
    grossOut: inflow ? previous.grossOut : round2(previous.grossOut - tick.amount),
    transactionCount: previous.transactionCount + 1,
    endOfDayBalance: tick.runningBalance,
    largestIn,
    largestOut,
  };
}

const candidateKey = (candidate: LabelCandidate) => `${candidate.side}:${candidate.date}`;

/**
 * Decides which candidates can afford a permanent label, and at which
 * breakpoint each one starts showing.
 *
 * Gaps shrink as the rail widens, so a label admitted at a lower tier stays
 * clear at every wider breakpoint. That is what makes one pass per tier
 * sufficient rather than needing to re-check earlier tiers.
 */
function assignLabelSlots(
  candidates: readonly LabelCandidate[],
  totalDays: number,
): Map<string, LedgerDayLabel> {
  const ranked = candidates.toSorted(compareCandidates);

  // The month's biggest move on each side always earns a label, so the shape
  // of the month survives even when the budget is tight.
  const forced = (["in", "out"] as const)
    .map((side) => ranked.find((candidate) => candidate.side === side))
    .filter((candidate) => candidate !== undefined);
  const queue = [...forced, ...ranked.filter((candidate) => !forced.includes(candidate))];

  const placements = new Map<string, LedgerDayLabel>();
  const placed: Array<{ side: "in" | "out"; band: LedgerLabelBand; dayOfMonth: number }> = [];

  const place = (candidate: LabelCandidate, tier: LedgerLabelTier): void => {
    const gap = ledgerLabelMinDayGap(tier, totalDays);
    const freeBand = ([0, 1] as const).find(
      (band) =>
        !placed.some(
          (other) =>
            other.side === candidate.side &&
            other.band === band &&
            Math.abs(other.dayOfMonth - candidate.dayOfMonth) < gap,
        ),
    );
    if (freeBand === undefined) return;

    placed.push({ side: candidate.side, band: freeBand, dayOfMonth: candidate.dayOfMonth });
    placements.set(candidateKey(candidate), {
      merchant: candidate.merchant,
      amount: candidate.amount,
      tier,
      band: freeBand,
    });
  };

  for (const tier of [1, 2, 3] as const) {
    for (const candidate of queue) {
      if (placed.length >= LEDGER_LABEL_SLOT_BUDGETS[tier]) break;
      if (placements.has(candidateKey(candidate))) continue;
      place(candidate, tier);
    }
  }

  return placements;
}

/**
 * Collapses ticks into one column per active calendar day and decides which
 * columns can afford a permanent label.
 *
 * Two independent caps make the strip safe at any transaction volume: marks
 * are bounded by days in the month, and labels by `LEDGER_LABEL_SLOT_BUDGETS`
 * plus a separation rule. Neither depends on how many transactions arrive.
 */
export function buildLedgerStripDays(
  ticks: readonly LedgerTick[],
  month: string,
): LedgerDayColumn[] {
  const totalDays = ledgerDaysInMonth(month);

  // Sorting a copy keeps the caller's array untouched and makes the
  // end-of-day balance deterministic for direct callers.
  const inMonth = ticks
    .filter((tick) => tick.date.slice(0, 7) === month)
    .toSorted((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  const byDate = new Map<string, DayAccumulator>();
  for (const tick of inMonth) {
    const previous = byDate.get(tick.date) ?? {
      date: tick.date,
      grossIn: 0,
      grossOut: 0,
      transactionCount: 0,
      endOfDayBalance: tick.runningBalance,
      largestIn: null,
      largestOut: null,
    };
    // `inMonth` is sorted, so the last write for a date is that date's close.
    byDate.set(tick.date, updateDayAccumulator(previous, tick));
  }

  const days = [...byDate.values()].toSorted((a, b) => a.date.localeCompare(b.date));

  const placements = assignLabelSlots(
    days.flatMap((day) => [day.largestIn, day.largestOut].filter((c) => c !== null)),
    totalDays,
  );

  return days.map((day) => ({
    date: day.date,
    dayOfMonth: Number(day.date.slice(8, 10)),
    grossIn: day.grossIn,
    grossOut: day.grossOut,
    net: round2(day.grossIn - day.grossOut),
    transactionCount: day.transactionCount,
    endOfDayBalance: day.endOfDayBalance,
    inflowLabel: day.largestIn ? (placements.get(candidateKey(day.largestIn)) ?? null) : null,
    outflowLabel: day.largestOut ? (placements.get(candidateKey(day.largestOut)) ?? null) : null,
  }));
}

function getMonthEndDate(month: string, today: string): string {
  if (today.startsWith(month)) {
    return today;
  }
  const [yearStr, monthStr] = month.split("-");
  const year = Number(yearStr);
  const monthNum = Number(monthStr);
  const lastDay = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
  return `${month}-${String(lastDay).padStart(2, "0")}`;
}

/** PostgREST caps a response at `db.max_rows` (1000 by default), so every
 *  read here pages rather than trusting a single request to be complete. */
const PAGE_SIZE = 1000;

async function fetchAllRows<T>(
  runPage: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await runPage(offset, offset + PAGE_SIZE - 1);
    if (error) {
      throw error;
    }
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) {
      return rows;
    }
  }
}

/**
 * Net of everything that landed after `afterDate` through `today`, in Plaid's
 * sign convention. Only `amount` is selected, so re-anchoring a past month
 * stays cheap even over a long tail.
 */
async function sumAmountsAfter(
  supabase: SupabaseClient,
  accountId: string,
  afterDate: string,
  today: string,
): Promise<number> {
  const rows = await fetchAllRows<{ amount: number }>((from, to) =>
    supabase
      .from("transactions")
      .select("amount")
      .eq("account_id", accountId)
      .gt("date", afterDate)
      .lte("date", today)
      .order("date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );
  return rows.reduce((sum, row) => sum + row.amount, 0);
}

export async function loadLedgerStripTicks(
  supabase: SupabaseClient,
  options: Readonly<{
    accountId: string;
    month: string;
    today: string;
    currentBalance: number;
  }>,
): Promise<LedgerTick[]> {
  const endDate = getMonthEndDate(options.month, options.today);
  // `endDate < today` means the month has closed, so the anchor needs the
  // net of everything booked after it. Fetched alongside the month itself
  // rather than after it: the tail only depends on the month end and today,
  // so waiting on the month read first just adds a serial round-trip.
  const tailNeeded = endDate < options.today;

  const [transactions, tailSum] = await Promise.all([
    fetchAllRows<LedgerStripTransaction>((from, to) =>
      supabase
        .from("transactions")
        .select("id, date, amount, merchant_name, name")
        .eq("account_id", options.accountId)
        .gte("date", `${options.month}-01`)
        .lte("date", endDate)
        .order("date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    ),
    tailNeeded
      ? sumAmountsAfter(supabase, options.accountId, endDate, options.today)
      : Promise.resolve(0),
  ]);

  // `currentBalance` is today's balance, and `buildLedgerStripTicks` walks
  // backwards from it. For a month that has already closed, that walk has to
  // start from the balance as of month end, or every figure in the strip is
  // off by the net of everything booked since. balance(end) =
  // balance(today) + sum(amount after end), because positive amount = money out.
  const anchorBalance = tailNeeded
    ? round2(options.currentBalance + tailSum)
    : options.currentBalance;

  return buildLedgerStripTicks(transactions, anchorBalance);
}
