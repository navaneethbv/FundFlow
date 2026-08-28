import { describe, it, expect } from "vitest";
import {
  pickAnchorAccount,
  buildLedgerStripTicks,
  buildLedgerStripDays,
  ledgerLabelMinDayGap,
  loadLedgerStripTicks,
  LEDGER_LABEL_SLOT_BUDGETS,
  type LedgerDayColumn,
  type LedgerStripAccount,
  type LedgerStripTransaction,
  type LedgerTick,
} from "@/lib/ledger-strip";

function stripTick(partial: Partial<LedgerTick> = {}): LedgerTick {
  return {
    id: "tick-1",
    date: "2026-08-01",
    label: "Corner Grocer",
    amount: -50,
    runningBalance: 1000,
    major: false,
    ...partial,
  };
}

/** Every label slot across both sides of the axis, flattened. */
function labelSlots(columns: readonly LedgerDayColumn[]) {
  return columns.flatMap((column) =>
    [
      column.inflowLabel
        ? { ...column.inflowLabel, side: "in" as const, day: column.dayOfMonth }
        : null,
      column.outflowLabel
        ? { ...column.outflowLabel, side: "out" as const, day: column.dayOfMonth }
        : null,
    ].filter((slot) => slot !== null),
  );
}

function account(partial: Partial<LedgerStripAccount> = {}): LedgerStripAccount {
  return {
    id: "acct-1",
    name: "Demo Checking",
    mask: "0001",
    current_balance: 4820.55,
    iso_currency_code: "USD",
    type: "depository",
    ...partial,
  };
}

function transaction(partial: Partial<LedgerStripTransaction> = {}): LedgerStripTransaction {
  return {
    id: "txn-1",
    date: "2026-08-01",
    amount: 10,
    merchant_name: "Corner Grocer",
    name: null,
    ...partial,
  };
}

describe("pickAnchorAccount", () => {
  // Household scope is the one that deliberately spans owners, so it is what
  // these selection-logic cases use to isolate themselves from ownership.
  const anyOwner = { household: true } as const;

  it("returns the first depository account with a balance", () => {
    const accounts = [
      account({ id: "credit-1", type: "credit", current_balance: -500 }),
      account({ id: "checking-1", type: "depository", current_balance: 1000 }),
    ];
    expect(pickAnchorAccount(accounts, anyOwner)?.id).toBe("checking-1");
  });

  it("returns null for empty array", () => {
    expect(pickAnchorAccount([], anyOwner)).toBeNull();
  });

  it("returns null when no depository account exists", () => {
    const accounts = [account({ type: "credit" }), account({ type: "loan" })];
    expect(pickAnchorAccount(accounts, anyOwner)).toBeNull();
  });

  it("skips a depository account with no balance on record", () => {
    const accounts = [
      account({ id: "checking-1", type: "depository", current_balance: null }),
      account({ id: "checking-2", type: "depository", current_balance: 250 }),
    ];
    expect(pickAnchorAccount(accounts, anyOwner)?.id).toBe("checking-2");
  });

  it("selects the requested selectedAccountId when valid and has balance", () => {
    const accounts = [
      account({ id: "checking-1", type: "depository", current_balance: 1000 }),
      account({ id: "savings-1", type: "depository", current_balance: 5000 }),
    ];
    expect(pickAnchorAccount(accounts, { ...anyOwner, selectedAccountId: "savings-1" })?.id).toBe(
      "savings-1",
    );
  });

  it("fails closed when selectedAccountId belongs to a different ownerUserId", () => {
    const accounts = [
      account({ id: "savings-1", type: "depository", user_id: "user-b", current_balance: 5000 }),
    ];
    expect(
      pickAnchorAccount(accounts, { ownerUserId: "user-a", selectedAccountId: "savings-1" }),
    ).toBeNull();
  });

  it("enforces ownerUserId matching for default depository account", () => {
    const accounts = [
      account({ id: "checking-1", type: "depository", user_id: "user-b", current_balance: 1000 }),
      account({ id: "checking-2", type: "depository", user_id: "user-a", current_balance: 2000 }),
    ];
    expect(pickAnchorAccount(accounts, { ownerUserId: "user-a" })?.id).toBe("checking-2");
  });

  it("fails closed in personal scope when no ownerUserId is known", () => {
    const accounts = [
      account({ id: "checking-1", type: "depository", user_id: "user-b", current_balance: 1000 }),
    ];
    // `userId={user?.id ?? ""}` upstream means an empty string is reachable.
    expect(pickAnchorAccount(accounts, { ownerUserId: "" })).toBeNull();
    expect(pickAnchorAccount(accounts)).toBeNull();
  });

  it("fails closed when an unowned account is selected by id in personal scope", () => {
    const accounts = [
      account({ id: "savings-1", type: "depository", user_id: null, current_balance: 5000 }),
    ];
    expect(
      pickAnchorAccount(accounts, { ownerUserId: "user-a", selectedAccountId: "savings-1" }),
    ).toBeNull();
  });

  it("returns null when the selected account is not a depository", () => {
    const accounts = [
      account({ id: "card-1", type: "credit", user_id: "user-a", current_balance: -500 }),
      account({ id: "checking-1", type: "depository", user_id: "user-a", current_balance: 1000 }),
    ];
    // Anchoring a credit line would read inverted, and silently falling back to
    // a different account would be worse, so the widget gets nothing.
    expect(
      pickAnchorAccount(accounts, { ownerUserId: "user-a", selectedAccountId: "card-1" }),
    ).toBeNull();
  });

  it("spans owners only when household scope is passed", () => {
    const accounts = [
      account({ id: "checking-1", type: "depository", user_id: "user-b", current_balance: 1000 }),
    ];
    expect(pickAnchorAccount(accounts, { ownerUserId: "user-a", household: true })?.id).toBe(
      "checking-1",
    );
  });
});
describe("buildLedgerStripTicks", () => {
  it("returns an empty array for no transactions", () => {
    expect(buildLedgerStripTicks([], 100)).toEqual([]);
  });

  it("handles zero amount transaction (delta = 0) as minor tick", () => {
    const ticks = buildLedgerStripTicks([transaction({ amount: 0 })], 100);
    expect(ticks[0]!.amount).toBe(-0);
    expect(ticks[0]!.major).toBe(false);
  });

  it("ends on the current balance", () => {
    const ticks = buildLedgerStripTicks(
      [
        transaction({ id: "1", date: "2026-08-01", amount: 1650 }),
        transaction({ id: "2", date: "2026-08-16", amount: -2450 }),
      ],
      4820.55,
    );
    expect(ticks[ticks.length - 1]!.runningBalance).toBe(4820.55);
  });

  it("sorts by date then id, oldest first", () => {
    const ticks = buildLedgerStripTicks(
      [
        transaction({ id: "b", date: "2026-08-16", amount: -2450 }),
        transaction({ id: "a", date: "2026-08-01", amount: 1650 }),
      ],
      100,
    );
    expect(ticks.map((tick) => tick.id)).toEqual(["a", "b"]);
  });

  it("converts a positive Plaid amount (money out) to a negative ledger delta", () => {
    const ticks = buildLedgerStripTicks([transaction({ amount: 64.18 })], 100);
    expect(ticks[0]!.amount).toBe(-64.18);
  });

  it("converts a negative Plaid amount (money in) to a positive ledger delta", () => {
    const ticks = buildLedgerStripTicks([transaction({ amount: -2450 })], 100);
    expect(ticks[0]!.amount).toBe(2450);
  });

  it("marks any inflow as major regardless of size", () => {
    const ticks = buildLedgerStripTicks([transaction({ amount: -5 })], 100);
    expect(ticks[0]!.major).toBe(true);
  });

  it("marks an outflow at or above the threshold as major", () => {
    const ticks = buildLedgerStripTicks([transaction({ amount: 100 })], 100);
    expect(ticks[0]!.major).toBe(true);
  });

  it("marks a small outflow below the threshold as minor", () => {
    const ticks = buildLedgerStripTicks([transaction({ amount: 6.75 })], 100);
    expect(ticks[0]!.major).toBe(false);
  });

  it("falls back to the transaction name when merchant_name is null", () => {
    const ticks = buildLedgerStripTicks(
      [transaction({ merchant_name: null, name: "ACME PAYROLL DEP" })],
      100,
    );
    expect(ticks[0]!.label).toBe("ACME PAYROLL DEP");
  });

  it("falls back to 'Transaction' when both merchant_name and name are null", () => {
    const ticks = buildLedgerStripTicks(
      [transaction({ merchant_name: null, name: null })],
      100,
    );
    expect(ticks[0]!.label).toBe("Transaction");
  });

  it("respects a custom majorThreshold option", () => {
    const ticks = buildLedgerStripTicks(
      [transaction({ amount: 50 })],
      100,
      { majorThreshold: 25 },
    );
    expect(ticks[0]!.major).toBe(true);
  });

  it("sorts deterministically when date and id are identical", () => {
    const ticks = buildLedgerStripTicks(
      [
        transaction({ id: "same", date: "2026-08-01" }),
        transaction({ id: "same", date: "2026-08-01" }),
      ],
      100,
    );
    expect(ticks).toHaveLength(2);
  });
});

describe("loadLedgerStripTicks", () => {
  type Row = Record<string, unknown>;
  interface QueryBuilder {
    eq: (column: string, value: string) => QueryBuilder;
    gte: (column: string, value: string) => QueryBuilder;
    gt: (column: string, value: string) => QueryBuilder;
    lte: (column: string, value: string) => QueryBuilder;
    order: (column: string, options?: { ascending: boolean }) => QueryBuilder;
    range: (from: number, to: number) => Promise<{ data: Row[] | null; error: Error | null }>;
  }

  interface Captured {
    monthWindow: [string, string] | null;
    tailWindow: [string, string] | null;
  }

  /**
   * Minimal PostgREST double. The two reads are told apart by their column
   * list: the month read selects the full tick shape, the balance-tail read
   * selects only `amount`. `.range()` slices, so pagination is exercised for
   * real rather than assumed.
   */
  function mockSupabase(
    spec: Readonly<{ month?: Row[]; tail?: Row[]; nullData?: boolean; error?: Error }>,
  ): { client: never; captured: Captured } {
    const captured: Captured = { monthWindow: null, tailWindow: null };

    const build = (rows: Row[], isTail: boolean): QueryBuilder => {
      let lower = "";
      const builder: QueryBuilder = {
        eq: () => builder,
        gte: (_column, value) => {
          lower = value;
          return builder;
        },
        gt: (_column, value) => {
          lower = value;
          return builder;
        },
        lte: (_column, value) => {
          if (isTail) {
            captured.tailWindow = [lower, value];
          } else {
            captured.monthWindow = [lower, value];
          }
          return builder;
        },
        order: () => builder,
        range: (from, to) =>
          Promise.resolve(
            spec.error
              ? { data: null, error: spec.error }
              : { data: spec.nullData ? null : rows.slice(from, to + 1), error: null },
          ),
      };
      return builder;
    };

    const client = {
      from: () => ({
        select: (columns: string) => {
          const isTail = columns === "amount";
          return build(isTail ? (spec.tail ?? []) : (spec.month ?? []), isTail);
        },
      }),
    };
    return { client: client as never, captured };
  }

  it("loads transactions for the month and calculates running balance", async () => {
    const { client } = mockSupabase({
      month: [
        { id: "1", date: "2026-06-05", amount: 50, merchant_name: "June Shop", name: null },
        { id: "2", date: "2026-06-20", amount: 20, merchant_name: "June Coffee", name: null },
      ],
    });

    const ticks = await loadLedgerStripTicks(client, {
      accountId: "acct-1",
      month: "2026-06",
      today: "2026-07-20",
      currentBalance: 500,
    });

    expect(ticks).toHaveLength(2);
    expect(ticks[0]!.id).toBe("1");
    expect(ticks[0]!.runningBalance).toBe(520);
    expect(ticks[1]!.runningBalance).toBe(500);
  });

  it("anchors a closed month to its month-end balance, not today's", async () => {
    // July closed with one $50 outflow; $300 has gone out since. Today's
    // balance is 500, so July must close at 800 rather than 500.
    const { client, captured } = mockSupabase({
      month: [{ id: "j1", date: "2026-07-15", amount: 50, merchant_name: "July Shop", name: null }],
      tail: [{ amount: 300 }],
    });

    const ticks = await loadLedgerStripTicks(client, {
      accountId: "acct-1",
      month: "2026-07",
      today: "2026-08-24",
      currentBalance: 500,
    });

    expect(captured.monthWindow).toEqual(["2026-07-01", "2026-07-31"]);
    expect(captured.tailWindow).toEqual(["2026-07-31", "2026-08-24"]);
    expect(ticks.at(-1)!.runningBalance).toBe(800);
  });

  it("skips the balance-tail read for the current month", async () => {
    const { client, captured } = mockSupabase({
      month: [{ id: "a1", date: "2026-08-10", amount: 40, merchant_name: "Aug Shop", name: null }],
    });

    const ticks = await loadLedgerStripTicks(client, {
      accountId: "acct-1",
      month: "2026-08",
      today: "2026-08-24",
      currentBalance: 500,
    });

    expect(captured.monthWindow).toEqual(["2026-08-01", "2026-08-24"]);
    expect(captured.tailWindow).toBeNull();
    expect(ticks.at(-1)!.runningBalance).toBe(500);
  });

  it("pages past PostgREST's 1000-row response cap before calculating balances", async () => {
    const month: Row[] = Array.from({ length: 1001 }, (_, index) => ({
      id: `june-${String(index).padStart(4, "0")}`,
      date: "2026-06-15",
      amount: index === 1000 ? 50 : 0,
      merchant_name: "June Shop",
      name: null,
    }));
    const { client } = mockSupabase({ month });

    const ticks = await loadLedgerStripTicks(client, {
      accountId: "acct-1",
      month: "2026-06",
      today: "2026-06-30",
      currentBalance: 500,
    });

    expect(ticks).toHaveLength(1001);
    expect(ticks.at(-1)!.runningBalance).toBe(500);
  });

  it("handles null data from supabase query without throwing", async () => {
    const { client } = mockSupabase({ nullData: true });

    const ticks = await loadLedgerStripTicks(client, {
      accountId: "acct-1",
      month: "2026-06",
      today: "2026-07-20",
      currentBalance: 500,
    });

    expect(ticks).toEqual([]);
  });

  it("throws when supabase query errors", async () => {
    const { client } = mockSupabase({ error: new Error("DB error") });

    await expect(
      loadLedgerStripTicks(client, {
        accountId: "acct-1",
        month: "2026-06",
        today: "2026-07-20",
        currentBalance: 500,
      }),
    ).rejects.toThrow("DB error");
  });
});

describe("buildLedgerStripDays", () => {
  it("groups ticks by date and returns days in ascending order", () => {
    const days = buildLedgerStripDays(
      [
        stripTick({ id: "c", date: "2026-08-20", amount: -30 }),
        stripTick({ id: "a", date: "2026-08-03", amount: -10 }),
        stripTick({ id: "b", date: "2026-08-03", amount: -20 }),
      ],
      "2026-08",
    );

    expect(days.map((day) => day.date)).toEqual(["2026-08-03", "2026-08-20"]);
    expect(days[0]!.dayOfMonth).toBe(3);
    expect(days[0]!.transactionCount).toBe(2);
  });

  it("collapses ten same-day ticks into one column", () => {
    const ticks = Array.from({ length: 10 }, (_, index) =>
      stripTick({ id: `t${index}`, date: "2026-08-15", amount: -(index + 1) }),
    );

    const days = buildLedgerStripDays(ticks, "2026-08");

    expect(days).toHaveLength(1);
    expect(days[0]!.transactionCount).toBe(10);
  });

  it("keeps gross inflow and gross outflow separate on a mixed day", () => {
    const days = buildLedgerStripDays(
      [
        stripTick({ id: "in", date: "2026-08-05", amount: 2450, label: "Acme Payroll" }),
        stripTick({ id: "out", date: "2026-08-05", amount: -2400, label: "Maple St" }),
      ],
      "2026-08",
    );

    // Netting these to $50 would hide both the paycheck and the rent.
    expect(days[0]!.grossIn).toBe(2450);
    expect(days[0]!.grossOut).toBe(2400);
    expect(days[0]!.net).toBe(50);
  });

  it("takes end-of-day balance from the last tick by date then id", () => {
    const days = buildLedgerStripDays(
      [
        stripTick({ id: "b", date: "2026-08-04", amount: -10, runningBalance: 900 }),
        stripTick({ id: "a", date: "2026-08-04", amount: -10, runningBalance: 910 }),
      ],
      "2026-08",
    );

    expect(days[0]!.endOfDayBalance).toBe(900);
  });

  it("returns an empty array when the month has no ticks", () => {
    expect(buildLedgerStripDays([], "2026-08")).toEqual([]);
  });

  it("excludes ticks that fall outside the requested month", () => {
    const days = buildLedgerStripDays(
      [
        stripTick({ id: "in", date: "2026-08-10" }),
        stripTick({ id: "before", date: "2026-07-31" }),
        stripTick({ id: "after", date: "2026-09-01" }),
      ],
      "2026-08",
    );

    expect(days.map((day) => day.date)).toEqual(["2026-08-10"]);
  });

  it("throws a documented RangeError for a month that is not a calendar month", () => {
    for (const month of ["2026-13", "2026-00", "not-a-month", "2026-8"]) {
      expect(() => buildLedgerStripDays([], month)).toThrow(RangeError);
      expect(() => buildLedgerStripDays([], month)).toThrow("ledger_strip_invalid_month");
    }
  });

  it("gives the month's largest inflow and largest outflow a tier 1 label", () => {
    const ticks = [
      stripTick({ id: "pay", date: "2026-08-05", amount: 2450, label: "Acme Payroll", major: true }),
      stripTick({ id: "small-in", date: "2026-08-09", amount: 40, label: "Refund", major: true }),
      stripTick({ id: "rent", date: "2026-08-01", amount: -1650, label: "Maple St", major: true }),
      // The month's only tiny outflow stays below the threshold, so it is not
      // a candidate and must not consume a label slot.
      stripTick({ id: "coffee", date: "2026-08-17", amount: -6, label: "Blue Bottle", major: false }),
    ];

    const days = buildLedgerStripDays(ticks, "2026-08");
    const byDate = new Map(days.map((day) => [day.date, day]));

    expect(byDate.get("2026-08-05")!.inflowLabel).toMatchObject({
      merchant: "Acme Payroll",
      tier: 1,
    });
    expect(byDate.get("2026-08-01")!.outflowLabel).toMatchObject({
      merchant: "Maple St",
      tier: 1,
    });
    // Coffee is excluded by the major threshold, not merely unlucky in the
    // slot budget, so it can never earn a label.
    expect(byDate.get("2026-08-17")!.outflowLabel).toBeNull();
  });

  it("skips a day whose only outflow is below the major threshold", () => {
    const days = buildLedgerStripDays(
      [
        stripTick({ id: "in", date: "2026-08-05", amount: 2450, label: "Acme Payroll", major: true }),
        stripTick({ id: "tip", date: "2026-08-03", amount: -4, label: "Barista", major: false }),
      ],
      "2026-08",
    );
    const byDate = new Map(days.map((day) => [day.date, day]));
    expect(byDate.get("2026-08-03")!.outflowLabel).toBeNull();
    // The inflow still labels, so the month's shape survives.
    expect(byDate.get("2026-08-05")!.inflowLabel).not.toBeNull();
  });

  it("treats 4, 8, and 12 as cumulative label-slot maxima across both sides", () => {
    // One outflow and one inflow on each of 28 days: far more candidates than
    // any breakpoint can show, so the budget is what has to bind.
    const ticks = Array.from({ length: 28 }, (_, index) => index + 1).flatMap((day) => [
      stripTick({
        id: `out-${day}`,
        date: `2026-08-${String(day).padStart(2, "0")}`,
        amount: -(1000 + day),
        label: `Out ${day}`,
        major: true,
      }),
      stripTick({
        id: `in-${day}`,
        date: `2026-08-${String(day).padStart(2, "0")}`,
        amount: 1000 + day,
        label: `In ${day}`,
        major: true,
      }),
    ]);

    const slots = labelSlots(buildLedgerStripDays(ticks, "2026-08"));
    const upTo = (tier: number) => slots.filter((slot) => slot.tier <= tier).length;

    expect(upTo(1)).toBeLessThanOrEqual(LEDGER_LABEL_SLOT_BUDGETS[1]);
    expect(upTo(2)).toBeLessThanOrEqual(LEDGER_LABEL_SLOT_BUDGETS[2]);
    expect(upTo(3)).toBeLessThanOrEqual(LEDGER_LABEL_SLOT_BUDGETS[3]);
    expect(slots.length).toBeLessThanOrEqual(LEDGER_LABEL_SLOT_BUDGETS[3]);
  });

  it("separates same-side labels sharing a band by the tier's minimum day gap", () => {
    const ticks = Array.from({ length: 28 }, (_, index) => index + 1).map((day) =>
      stripTick({
        id: `out-${day}`,
        date: `2026-08-${String(day).padStart(2, "0")}`,
        amount: -(1000 + day),
        label: `Out ${day}`,
        major: true,
      }),
    );

    const slots = labelSlots(buildLedgerStripDays(ticks, "2026-08"));

    for (const tier of [1, 2, 3] as const) {
      const gap = ledgerLabelMinDayGap(tier, 31);
      const visible = slots.filter((slot) => slot.tier <= tier);
      for (const band of [0, 1] as const) {
        const days = visible
          .filter((slot) => slot.side === "out" && slot.band === band)
          .map((slot) => slot.day)
          .sort((a, b) => a - b);
        for (let i = 1; i < days.length; i++) {
          expect(
            days[i]! - days[i - 1]!,
            `tier ${tier} band ${band} days ${days.join(",")}`,
          ).toBeGreaterThanOrEqual(gap);
        }
      }
    }
  });

  it("is deterministic when amounts tie", () => {
    const ticks = Array.from({ length: 12 }, (_, index) => index + 1).map((day) =>
      stripTick({
        id: `out-${day}`,
        date: `2026-08-${String(day).padStart(2, "0")}`,
        amount: -100,
        label: `Merchant ${day}`,
        major: true,
      }),
    );

    expect(buildLedgerStripDays(ticks, "2026-08")).toEqual(
      buildLedgerStripDays([...ticks].reverse(), "2026-08"),
    );
  });
});
