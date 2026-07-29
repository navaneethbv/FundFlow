import { describe, expect, it } from "vitest";
import {
  applyAccountsPageView,
  buildAccountsPageData,
  groupKeyFor,
  type AccountBalanceSnapshot,
  type UnifiedAccountSummary,
} from "@/lib/accounts-page";

const NOW = new Date("2026-07-29T12:00:00.000Z");

function account(
  input: Partial<UnifiedAccountSummary> &
    Pick<UnifiedAccountSummary, "id" | "name" | "type" | "currentBalance">,
): UnifiedAccountSummary {
  return {
    ownerUserId: "user-1",
    source: "plaid",
    mask: null,
    subtype: null,
    availableBalance: null,
    currency: "USD",
    institution: null,
    updatedAt: "2026-07-29T11:00:00.000Z",
    includeInNetWorth: true,
    ...input,
  };
}

function snapshot(
  sourceId: string,
  snapshotDate: string,
  currentBalance: number | null,
  options: {
    manual?: boolean;
    currency?: string;
  } = {},
): AccountBalanceSnapshot {
  return {
    accountId: options.manual ? null : sourceId,
    manualAccountId: options.manual ? sourceId : null,
    snapshotDate,
    currentBalance,
    availableBalance: null,
    currency: options.currency ?? "USD",
  };
}

describe("groupKeyFor", () => {
  it.each([
    ["credit", null, "credit"],
    ["depository", "checking", "cash"],
    ["investment", "brokerage", "investment"],
    ["loan", "mortgage", "loan"],
    ["cash", null, "cash"],
    ["debt", null, "loan"],
    ["liability", null, "loan"],
    ["asset", null, "other"],
    [null, null, "other"],
  ])("maps %s / %s to %s", (type, subtype, expected) => {
    expect(groupKeyFor(type, subtype)).toBe(expected);
  });
});

describe("buildAccountsPageData", () => {
  it("groups Plaid and manual rows and keeps liability balances positive", () => {
    const data = buildAccountsPageData(
      [
        account({
          id: "cash-1",
          name: "Checking",
          mask: "1234",
          type: "depository",
          currentBalance: 1000,
        }),
        account({
          id: "card-1",
          name: "Freedom",
          type: "credit",
          currentBalance: 200,
        }),
        account({
          id: "loan-1",
          name: "Student loan",
          type: "debt",
          source: "manual",
          currentBalance: -500,
        }),
      ],
      [],
      NOW,
    );

    expect(data.groups.cash.rows[0]).toMatchObject({
      name: "Checking (...1234)",
      balance: 1000,
    });
    expect(data.groups.credit.rows[0]?.balance).toBe(200);
    expect(data.groups.loan.rows[0]?.balance).toBe(500);
    expect(data.groups.cash.totals).toEqual([
      { currency: "USD", amount: 1000 },
    ]);
    expect(data.groups.loan.totals).toEqual([
      { currency: "USD", amount: 500 },
    ]);
  });

  it("separates currencies instead of inventing an exchange rate", () => {
    const data = buildAccountsPageData(
      [
        account({
          id: "cash-1",
          name: "Checking",
          type: "depository",
          currentBalance: 1000,
        }),
        account({
          id: "card-1",
          name: "Card",
          type: "credit",
          currentBalance: 200,
        }),
        account({
          id: "loan-1",
          name: "Loan",
          type: "loan",
          currentBalance: 500,
        }),
        account({
          id: "investment-1",
          name: "Canadian brokerage",
          type: "investment",
          currentBalance: 3000,
          currency: "CAD",
        }),
      ],
      [],
      NOW,
    );

    expect(data.summary.currencyMismatch).toBe(true);
    expect(data.summary.currencies).toEqual(["CAD", "USD"]);
    expect(data.summary.assets).toEqual([
      { currency: "CAD", amount: 3000 },
      { currency: "USD", amount: 1000 },
    ]);
    expect(data.summary.liabilities).toEqual([
      { currency: "USD", amount: 700 },
    ]);
    expect(data.summary.netWorth).toEqual([
      { currency: "CAD", amount: 3000 },
      { currency: "USD", amount: 300 },
    ]);
  });

  it("does not coerce a missing balance to zero", () => {
    const data = buildAccountsPageData(
      [
        account({
          id: "unknown-1",
          name: "Unavailable",
          type: "depository",
          currentBalance: null,
        }),
      ],
      [],
      NOW,
    );

    expect(data.groups.cash.rows[0]?.balance).toBeNull();
    expect(data.groups.cash.totals).toEqual([]);
    expect(data.summary.assets).toEqual([]);
  });

  it("keeps a real zero balance distinct from a missing balance", () => {
    const data = buildAccountsPageData(
      [
        account({
          id: "zero-1",
          name: "Empty checking",
          type: "depository",
          currentBalance: 0,
        }),
      ],
      [],
      NOW,
    );

    expect(data.groups.cash.totals).toEqual([
      { currency: "USD", amount: 0 },
    ]);
    expect(data.summary.netWorth).toEqual([
      { currency: "USD", amount: 0 },
    ]);
  });

  it("builds oldest-first sparks and first-available month changes", () => {
    const history = Array.from({ length: 35 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 5, 25 + index))
        .toISOString()
        .slice(0, 10);
      return snapshot("cash-1", date, index);
    });
    const data = buildAccountsPageData(
      [
        account({
          id: "cash-1",
          name: "Checking",
          type: "depository",
          currentBalance: 34,
        }),
      ],
      history,
      NOW,
    );
    const row = data.groups.cash.rows[0]!;

    expect(row.spark).toHaveLength(30);
    expect(row.spark[0]).toBe(5);
    expect(row.spark.at(-1)).toBe(34);
    expect(row.monthChange).toEqual({ amount: 30, pct: 750 });
    expect(data.historyStartsOn).toBe("2026-06-25");
  });

  it("uses null percent when the starting balance is zero", () => {
    const data = buildAccountsPageData(
      [
        account({
          id: "cash-1",
          name: "Checking",
          type: "depository",
          currentBalance: 100,
        }),
      ],
      [
        snapshot("cash-1", "2026-06-29", 0),
        snapshot("cash-1", "2026-07-29", 100),
      ],
      NOW,
    );

    expect(data.groups.cash.rows[0]?.monthChange).toEqual({
      amount: 100,
      pct: null,
    });
  });

  it("builds per-currency daily net worth without fabricating missing days", () => {
    const data = buildAccountsPageData(
      [
        account({
          id: "cash-1",
          name: "Checking",
          type: "depository",
          currentBalance: 1000,
        }),
        account({
          id: "card-1",
          name: "Card",
          type: "credit",
          currentBalance: 200,
        }),
        account({
          id: "investment-1",
          name: "Brokerage",
          type: "investment",
          currentBalance: 3000,
          currency: "CAD",
        }),
      ],
      [
        snapshot("cash-1", "2026-06-29", 900),
        snapshot("card-1", "2026-06-29", 150),
        snapshot("investment-1", "2026-06-29", 2500, {
          currency: "CAD",
        }),
        snapshot("cash-1", "2026-07-29", 1000),
        snapshot("card-1", "2026-07-29", 200),
        snapshot("investment-1", "2026-07-29", 3000, {
          currency: "CAD",
        }),
      ],
      NOW,
    );

    expect(data.summary.netWorthSeries).toEqual({
      CAD: [
        { date: "2026-06-29", value: 2500 },
        { date: "2026-07-29", value: 3000 },
      ],
      USD: [
        { date: "2026-06-29", value: 750 },
        { date: "2026-07-29", value: 800 },
      ],
    });
    expect(data.summary.netWorthMonthChange).toEqual({
      CAD: { amount: 500, pct: 20 },
      USD: { amount: 50, pct: 6.67 },
    });
  });

  it("omits excluded manual accounts from summary without hiding their row", () => {
    const data = buildAccountsPageData(
      [
        account({
          id: "manual-1",
          ownerUserId: "household-member",
          source: "manual",
          name: "Collectibles",
          type: "asset",
          currentBalance: 10000,
          includeInNetWorth: false,
        }),
      ],
      [snapshot("manual-1", "2026-07-29", 10000, { manual: true })],
      NOW,
    );

    expect(data.groups.other.rows[0]).toMatchObject({
      ownerUserId: "household-member",
      includeInNetWorth: false,
    });
    expect(data.summary.assets).toEqual([]);
    expect(data.summary.netWorthSeries).toEqual({});
  });

  it("humanizes freshness and marks accounts stale after 24 hours", () => {
    const data = buildAccountsPageData(
      [
        account({
          id: "fresh",
          name: "Fresh",
          type: "depository",
          currentBalance: 1,
          updatedAt: "2026-07-29T11:59:40.000Z",
        }),
        account({
          id: "hours",
          name: "Hours",
          type: "depository",
          currentBalance: 1,
          updatedAt: "2026-07-29T03:00:00.000Z",
        }),
        account({
          id: "stale",
          name: "Stale",
          type: "depository",
          currentBalance: 1,
          updatedAt: "2026-07-27T12:00:00.000Z",
        }),
      ],
      [],
      NOW,
    );
    const rows = data.groups.cash.rows;

    expect(rows.find((row) => row.id === "fresh")).toMatchObject({
      updatedAgo: "just now",
      stale: false,
    });
    expect(rows.find((row) => row.id === "hours")?.updatedAgo).toBe(
      "9 hours ago",
    );
    expect(rows.find((row) => row.id === "stale")).toMatchObject({
      updatedAgo: "2 days ago",
      stale: true,
    });
  });

  it("filters and orders list rows without changing summary net worth", () => {
    const built = buildAccountsPageData(
      [
        account({
          id: "cash-1",
          name: "Checking",
          type: "depository",
          currentBalance: 100,
          institution: "Bank A",
        }),
        account({
          id: "cash-2",
          ownerUserId: "member-2",
          name: "Savings",
          type: "depository",
          currentBalance: 200,
          institution: "Bank B",
        }),
      ],
      [],
      NOW,
    );

    const visible = applyAccountsPageView(built, {
      hiddenIds: ["cash-1"],
      order: ["cash-2", "cash-1"],
      visibility: "visible",
      institution: "Bank B",
      ownerUserId: "member-2",
    });
    const hidden = applyAccountsPageView(built, {
      hiddenIds: ["cash-1"],
      order: ["cash-2", "cash-1"],
      visibility: "hidden",
    });

    expect(visible.groups.cash.rows.map((row) => row.id)).toEqual(["cash-2"]);
    expect(hidden.groups.cash.rows.map((row) => row.id)).toEqual(["cash-1"]);
    expect(visible.summary).toEqual(built.summary);
  });
});
