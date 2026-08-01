import { describe, it, expect } from "vitest";
import type { CanonicalFinanceTransaction } from "@/lib/finance-domain";
import {
  applyReportFilters,
  buildCashFlowSankeyData,
  defaultReportFilters,
  endExclusiveFor,
  isIsoDate,
  parseReportFilters,
  REPORT_FILTERS_VERSION,
  reportFiltersFromSearchParams,
  reportFiltersToSearchParams,
  summarizeTransactions,
  type ReportFilters,
} from "@/lib/reports";

/**
 * `buildCashFlowSankeyData` is where sign convention, transfer exclusion, and
 * the overspend case all meet, so these tests assert conservation explicitly.
 * A Sankey that does not conserve still renders, which is exactly why it needs
 * arithmetic tests rather than a screenshot.
 */

let sequence = 0;

function txn(
  partial: Partial<CanonicalFinanceTransaction> = {},
): CanonicalFinanceTransaction {
  sequence += 1;
  return {
    id: `t${sequence}`,
    sourceTransactionId: `s${sequence}`,
    date: "2026-07-15",
    signedAmount: 100,
    flow: "expense",
    merchant: "Merchant",
    groupKey: "FOOD_AND_DRINK",
    categoryKey: "FOOD_AND_DRINK_RESTAURANT",
    accountId: "acct-1",
    manualAccountId: null,
    pending: false,
    source: "plaid",
    ...partial,
  };
}

/** Plaid sign convention: income is negative, spending positive. */
function income(amount: number, category: string): CanonicalFinanceTransaction {
  return txn({
    signedAmount: -Math.abs(amount),
    flow: "income",
    groupKey: "INCOME",
    categoryKey: category,
  });
}

function expense(
  amount: number,
  group: string,
  category: string,
): CanonicalFinanceTransaction {
  return txn({
    signedAmount: Math.abs(amount),
    flow: "expense",
    groupKey: group,
    categoryKey: category,
  });
}

function linkTotal(
  links: Array<{ source: string; target: string; value: number }>,
  predicate: (link: { source: string; target: string }) => boolean,
): number {
  return links
    .filter(predicate)
    .reduce((sum, link) => Math.round((sum + link.value) * 100) / 100, 0);
}

describe("buildCashFlowSankeyData with income above spending", () => {
  const rows = [
    income(4000, "INCOME_WAGES"),
    income(500, "INCOME_INTEREST"),
    expense(1200, "RENT_AND_UTILITIES", "RENT_AND_UTILITIES_RENT"),
    expense(300, "FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES"),
  ];
  const { nodes, links } = buildCashFlowSankeyData(rows);

  it("routes income categories into a hub labelled Income", () => {
    const hub = nodes.find((node) => node.column === 1)!;
    expect(hub.label).toBe("Income");
    expect(hub.value).toBeCloseTo(4500);
  });

  it("adds a Net Income node carrying the surplus", () => {
    const net = nodes.find((node) => node.label === "Net Income")!;
    expect(net.column).toBe(2);
    expect(net.value).toBeCloseTo(3000);
  });

  it("has no Unfunded Spending node", () => {
    expect(nodes.some((node) => node.label === "Unfunded Spending")).toBe(false);
  });

  it("conserves value through the hub", () => {
    const hub = nodes.find((node) => node.column === 1)!;
    const into = linkTotal(links, (link) => link.target === hub.id);
    const outOf = linkTotal(links, (link) => link.source === hub.id);
    expect(into).toBeCloseTo(4500);
    expect(outOf).toBeCloseTo(4500);
  });

  it("splits each expense group into its categories", () => {
    const rent = nodes.find((node) => node.label === "Rent And Utilities")!;
    const outOfRent = linkTotal(links, (link) => link.source === rent.id);
    expect(outOfRent).toBeCloseTo(1200);
    expect(nodes.filter((node) => node.column === 3)).toHaveLength(2);
  });

  it("never emits a negative or zero link value", () => {
    for (const link of links) expect(link.value).toBeGreaterThan(0);
  });
});

describe("buildCashFlowSankeyData at exact break-even", () => {
  const rows = [
    income(2000, "INCOME_WAGES"),
    expense(2000, "FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES"),
  ];
  const { nodes, links } = buildCashFlowSankeyData(rows);

  it("labels the hub Income and adds neither surplus nor shortfall node", () => {
    const hub = nodes.find((node) => node.column === 1)!;
    expect(hub.label).toBe("Income");
    expect(nodes.some((node) => node.label === "Net Income")).toBe(false);
    expect(nodes.some((node) => node.label === "Unfunded Spending")).toBe(false);
  });

  it("still conserves", () => {
    const hub = nodes.find((node) => node.column === 1)!;
    expect(linkTotal(links, (link) => link.target === hub.id)).toBeCloseTo(2000);
    expect(linkTotal(links, (link) => link.source === hub.id)).toBeCloseTo(2000);
  });
});

describe("buildCashFlowSankeyData when spending exceeds income", () => {
  const rows = [
    income(1000, "INCOME_WAGES"),
    expense(1500, "FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES"),
  ];
  const { nodes, links } = buildCashFlowSankeyData(rows);

  it("relabels the hub Available Funds", () => {
    const hub = nodes.find((node) => node.column === 1)!;
    expect(hub.label).toBe("Available Funds");
    expect(hub.value).toBeCloseTo(1500);
  });

  it("adds an Unfunded Spending source for the shortfall", () => {
    const unfunded = nodes.find((node) => node.label === "Unfunded Spending")!;
    expect(unfunded.column).toBe(0);
    expect(unfunded.value).toBeCloseTo(500);
  });

  it("has no Net Income node", () => {
    expect(nodes.some((node) => node.label === "Net Income")).toBe(false);
  });

  it("conserves with the shortfall counted as an inflow", () => {
    const hub = nodes.find((node) => node.column === 1)!;
    expect(linkTotal(links, (link) => link.target === hub.id)).toBeCloseTo(1500);
    expect(linkTotal(links, (link) => link.source === hub.id)).toBeCloseTo(1500);
  });
});

describe("buildCashFlowSankeyData exclusions", () => {
  it("ignores transfers, so a refund pair cannot inflate either side", () => {
    const rows = [
      income(1000, "INCOME_WAGES"),
      expense(200, "FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES"),
      // A linked refund pair is projected as `transfer` on both halves.
      txn({ signedAmount: 80, flow: "transfer", groupKey: "FOOD_AND_DRINK" }),
      txn({ signedAmount: -80, flow: "transfer", groupKey: "FOOD_AND_DRINK" }),
      // Credit-card payment: cash movement, never spending.
      txn({ signedAmount: 400, flow: "transfer", groupKey: "LOAN_PAYMENTS" }),
    ];
    const { nodes } = buildCashFlowSankeyData(rows);
    const hub = nodes.find((node) => node.column === 1)!;

    expect(hub.value).toBeCloseTo(1000);
    expect(nodes.some((node) => node.label === "LOAN_PAYMENTS")).toBe(false);
    const net = nodes.find((node) => node.label === "Net Income")!;
    expect(net.value).toBeCloseTo(800);
  });

  it("keeps split parts inside their parent group", () => {
    const rows = [
      income(1000, "INCOME_WAGES"),
      // One $300 purchase split 200/100 across two categories.
      expense(200, "GENERAL_MERCHANDISE", "Gifts"),
      expense(100, "GENERAL_MERCHANDISE", "Household"),
    ];
    const { nodes, links } = buildCashFlowSankeyData(rows);
    const group = nodes.find((node) => node.label === "General Merchandise")!;

    expect(group.value).toBeCloseTo(300);
    expect(linkTotal(links, (link) => link.source === group.id)).toBeCloseTo(300);
    expect(nodes.filter((node) => node.column === 3)).toHaveLength(2);
  });

  it("labels a blank or uncategorized group Unknown", () => {
    const rows = [
      income(500, "INCOME_WAGES"),
      expense(100, "   ", "  "),
      expense(50, "UNCATEGORIZED", "UNCATEGORIZED"),
    ];
    const { nodes } = buildCashFlowSankeyData(rows);
    const unknown = nodes.filter(
      (node) => node.column === 2 && node.label === "Unknown",
    );
    expect(unknown).toHaveLength(1);
    expect(unknown[0]!.value).toBeCloseTo(150);
  });

  it("returns nothing for an empty row set", () => {
    expect(buildCashFlowSankeyData([])).toEqual({ nodes: [], links: [] });
  });

  it("returns nothing when every row is a transfer", () => {
    const rows = [txn({ flow: "transfer" }), txn({ flow: "transfer" })];
    expect(buildCashFlowSankeyData(rows)).toEqual({ nodes: [], links: [] });
  });

  it("handles income with no spending at all", () => {
    const { nodes, links } = buildCashFlowSankeyData([
      income(900, "INCOME_WAGES"),
    ]);
    const net = nodes.find((node) => node.label === "Net Income")!;
    expect(net.value).toBeCloseTo(900);
    expect(links.every((link) => link.value > 0)).toBe(true);
  });

  it("handles spending with no income at all", () => {
    const { nodes } = buildCashFlowSankeyData([
      expense(750, "FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES"),
    ]);
    const unfunded = nodes.find((node) => node.label === "Unfunded Spending")!;
    expect(unfunded.value).toBeCloseTo(750);
    const hub = nodes.find((node) => node.column === 1)!;
    expect(hub.value).toBeCloseTo(750);
  });

  it("orders each column by value so the layout is deterministic", () => {
    const { nodes } = buildCashFlowSankeyData([
      income(100, "SMALL"),
      income(900, "BIG"),
      expense(50, "B_GROUP", "B_CAT"),
      expense(400, "A_GROUP", "A_CAT"),
    ]);
    const sources = nodes.filter((node) => node.column === 0);
    expect(sources.map((node) => node.label)).toEqual(["Big", "Small"]);
    const groups = nodes
      .filter((node) => node.column === 2 && node.label !== "Net Income")
      .map((node) => node.label);
    expect(groups).toEqual(["A Group", "B Group"]);
  });

  it("renders Plaid keys as readable names, not raw enums", () => {
    const { nodes } = buildCashFlowSankeyData([
      income(1000, "INCOME_SALARY"),
      expense(300, "RENT_AND_UTILITIES", "RENT_AND_UTILITIES_RENT"),
    ]);
    const labels = nodes.map((node) => node.label);

    // The category sheds its parent's prefix; the group keeps its own name.
    expect(labels).toContain("Salary");
    expect(labels).toContain("Rent And Utilities");
    expect(labels).toContain("Rent");
    expect(labels.some((text) => text.includes("_"))).toBe(false);
  });

  it("keeps two groups' same-named categories as separate nodes", () => {
    // Every Plaid group has its own `_OTHER`, and all of them render "Other".
    // Keying totals by display name instead of raw key would merge these into
    // one node worth 500 - a wrong number that still draws cleanly.
    const { nodes } = buildCashFlowSankeyData([
      income(2000, "INCOME_WAGES"),
      expense(200, "TRAVEL", "TRAVEL_OTHER"),
      expense(300, "GENERAL_SERVICES", "GENERAL_SERVICES_OTHER"),
    ]);
    const others = nodes.filter(
      (node) => node.column === 3 && node.label === "Other",
    );

    expect(others).toHaveLength(2);
    expect(others.map((node) => node.value).sort((a, b) => a - b)).toEqual([
      200, 300,
    ]);
    expect(new Set(others.map((node) => node.id)).size).toBe(2);
  });
});

describe("summarizeTransactions", () => {
  it("summarizes counts, totals, extremes, and the date span", () => {
    const rows = [
      txn({ date: "2026-07-03", signedAmount: -2000, flow: "income" }),
      txn({ date: "2026-07-10", signedAmount: 250, flow: "expense" }),
      txn({ date: "2026-07-28", signedAmount: 50, flow: "expense" }),
    ];
    const summary = summarizeTransactions(rows);

    expect(summary.totalTransactions).toBe(3);
    expect(summary.totalIncome).toBeCloseTo(2000);
    expect(summary.totalSpending).toBeCloseTo(300);
    expect(summary.averageAbsolute).toBeCloseTo(766.67);
    expect(summary.firstDate).toBe("2026-07-03");
    expect(summary.lastDate).toBe("2026-07-28");
  });

  it("reports the largest row by absolute magnitude, keeping its sign", () => {
    const rows = [
      txn({ signedAmount: 400, flow: "expense" }),
      txn({ signedAmount: -900, flow: "income" }),
    ];
    expect(summarizeTransactions(rows).largest).toBeCloseTo(-900);
  });

  it("does not let a large transfer hide from the largest-row figure", () => {
    const rows = [
      txn({ signedAmount: 100, flow: "expense" }),
      txn({ signedAmount: 5000, flow: "transfer" }),
    ];
    const summary = summarizeTransactions(rows);
    expect(summary.largest).toBeCloseTo(5000);
    // ...but it is still not spending.
    expect(summary.totalSpending).toBeCloseTo(100);
  });

  it("returns a zeroed summary with null dates for no rows", () => {
    expect(summarizeTransactions([])).toEqual({
      totalTransactions: 0,
      largest: 0,
      averageAbsolute: 0,
      totalIncome: 0,
      totalSpending: 0,
      firstDate: null,
      lastDate: null,
    });
  });

  it("finds the span even when rows arrive out of order", () => {
    const rows = [
      txn({ date: "2026-07-20" }),
      txn({ date: "2026-01-02" }),
      txn({ date: "2026-12-31" }),
    ];
    const summary = summarizeTransactions(rows);
    expect(summary.firstDate).toBe("2026-01-02");
    expect(summary.lastDate).toBe("2026-12-31");
  });
});

describe("applyReportFilters", () => {
  const base: ReportFilters = {
    version: REPORT_FILTERS_VERSION,
    start: "2026-07-01",
    end: "2026-07-31",
    tab: "cash_flow",
    mode: "breakdown",
    dimension: "category",
    scope: null,
    accounts: [],
    merchants: [],
    categories: [],
    excludePending: false,
  };

  const rows = [
    txn({ date: "2026-06-30", merchant: "Old" }),
    txn({ date: "2026-07-01", merchant: "Costco", accountId: "acct-1" }),
    txn({ date: "2026-07-31", merchant: "Target", accountId: "acct-2" }),
    txn({ date: "2026-08-01", merchant: "Future" }),
    txn({ date: "2026-07-15", merchant: "Pending Co", pending: true }),
  ];

  it("keeps the range inclusive at both ends", () => {
    const kept = applyReportFilters(rows, base).map((row) => row.merchant);
    expect(kept).toContain("Costco");
    expect(kept).toContain("Target");
    expect(kept).not.toContain("Old");
    expect(kept).not.toContain("Future");
  });

  it("drops pending rows only when asked", () => {
    expect(
      applyReportFilters(rows, base).some((row) => row.pending),
    ).toBe(true);
    expect(
      applyReportFilters(rows, { ...base, excludePending: true }).some(
        (row) => row.pending,
      ),
    ).toBe(false);
  });

  it("filters by account, merchant, and category", () => {
    expect(
      applyReportFilters(rows, { ...base, accounts: ["acct-2"] }).map(
        (row) => row.merchant,
      ),
    ).toEqual(["Target"]);
    expect(
      applyReportFilters(rows, { ...base, merchants: ["Costco"] }).map(
        (row) => row.merchant,
      ),
    ).toEqual(["Costco"]);
    expect(
      applyReportFilters(rows, { ...base, categories: ["nothing-matches"] }),
    ).toEqual([]);
  });

  it("matches merchants case-insensitively so a saved filter survives a rename", () => {
    expect(
      applyReportFilters(rows, { ...base, merchants: ["costco"] }),
    ).toHaveLength(1);
  });
});

describe("parseReportFilters", () => {
  const valid = {
    version: 1,
    start: "2026-07-01",
    end: "2026-07-31",
    tab: "spending",
    mode: "trends",
    dimension: "merchant",
    scope: null,
    accounts: ["a"],
    merchants: ["m"],
    categories: ["c"],
    excludePending: true,
  };

  it("accepts a well-formed payload", () => {
    expect(parseReportFilters(valid)).toEqual(valid);
  });

  it("rejects a payload that is not an object", () => {
    expect(parseReportFilters(null)).toBeNull();
    expect(parseReportFilters("nope")).toBeNull();
    expect(parseReportFilters([])).toBeNull();
  });

  it("rejects an unknown schema version rather than guessing", () => {
    expect(parseReportFilters({ ...valid, version: 2 })).toBeNull();
    expect(parseReportFilters({ ...valid, version: "1" })).toBeNull();
  });

  it("rejects malformed dates and inverted ranges", () => {
    expect(parseReportFilters({ ...valid, start: "07/01/2026" })).toBeNull();
    expect(parseReportFilters({ ...valid, end: "2026-13-45" })).toBeNull();
    expect(
      parseReportFilters({ ...valid, start: "2026-08-01", end: "2026-07-01" }),
    ).toBeNull();
  });

  it("rejects unknown enum values", () => {
    expect(parseReportFilters({ ...valid, tab: "everything" })).toBeNull();
    expect(parseReportFilters({ ...valid, mode: "sideways" })).toBeNull();
    expect(parseReportFilters({ ...valid, dimension: "vibes" })).toBeNull();
  });

  it("rejects non-string array entries and non-boolean flags", () => {
    expect(parseReportFilters({ ...valid, accounts: [1] })).toBeNull();
    expect(parseReportFilters({ ...valid, merchants: "m" })).toBeNull();
    expect(parseReportFilters({ ...valid, excludePending: "yes" })).toBeNull();
  });

  it("rejects an oversized filter list instead of storing unbounded jsonb", () => {
    const many = Array.from({ length: 501 }, (_, index) => `m${index}`);
    expect(parseReportFilters({ ...valid, merchants: many })).toBeNull();
  });

  it("rejects an over-long filter entry", () => {
    expect(
      parseReportFilters({ ...valid, merchants: ["x".repeat(201)] }),
    ).toBeNull();
  });

  it("accepts a household scope id and rejects a non-string scope", () => {
    expect(parseReportFilters({ ...valid, scope: "abc" })?.scope).toBe("abc");
    expect(parseReportFilters({ ...valid, scope: 7 })).toBeNull();
  });

  it("round-trips through search params", () => {
    const filters = parseReportFilters(valid)!;
    const params = reportFiltersToSearchParams(filters);
    expect(params.get("start")).toBe("2026-07-01");
    expect(params.get("tab")).toBe("spending");
    expect(params.get("merchant")).toBe("m");
    expect(params.get("pending")).toBe("exclude");
  });
});

describe("endExclusiveFor", () => {
  it("advances one day so the inclusive end is actually included", () => {
    expect(endExclusiveFor("2026-07-31")).toBe("2026-08-01");
    expect(endExclusiveFor("2026-07-15")).toBe("2026-07-16");
  });

  it("crosses month, year, and leap-day boundaries", () => {
    expect(endExclusiveFor("2026-12-31")).toBe("2027-01-01");
    expect(endExclusiveFor("2028-02-28")).toBe("2028-02-29");
    expect(endExclusiveFor("2028-02-29")).toBe("2028-03-01");
  });
});

describe("defaultReportFilters", () => {
  it("spans the whole of a 31-day month", () => {
    const filters = defaultReportFilters("2026-07");
    expect(filters.start).toBe("2026-07-01");
    expect(filters.end).toBe("2026-07-31");
    expect(filters.tab).toBe("cash_flow");
    expect(filters.excludePending).toBe(false);
  });

  it("gets February right in common and leap years", () => {
    expect(defaultReportFilters("2026-02").end).toBe("2026-02-28");
    expect(defaultReportFilters("2028-02").end).toBe("2028-02-29");
  });

  it("gets a 30-day month right", () => {
    expect(defaultReportFilters("2026-04").end).toBe("2026-04-30");
  });

  it("produces a payload its own strict parser accepts", () => {
    expect(parseReportFilters(defaultReportFilters("2026-07"))).not.toBeNull();
  });
});

describe("reportFiltersFromSearchParams", () => {
  const fallback = defaultReportFilters("2026-07");

  it("reads a well-formed query string", () => {
    const filters = reportFiltersFromSearchParams(
      {
        start: "2026-01-01",
        end: "2026-03-31",
        tab: "income",
        mode: "trends",
        dimension: "merchant",
        pending: "exclude",
        merchant: ["Costco", "Target"],
        account: "acct-1",
        category: [],
      },
      fallback,
    );

    expect(filters.start).toBe("2026-01-01");
    expect(filters.end).toBe("2026-03-31");
    expect(filters.tab).toBe("income");
    expect(filters.mode).toBe("trends");
    expect(filters.dimension).toBe("merchant");
    expect(filters.excludePending).toBe(true);
    expect(filters.merchants).toEqual(["Costco", "Target"]);
    expect(filters.accounts).toEqual(["acct-1"]);
    expect(filters.categories).toEqual([]);
  });

  it("falls back rather than 404ing on a hand-edited query string", () => {
    const filters = reportFiltersFromSearchParams(
      { start: "nonsense", end: "2026-13-99", tab: "everything", mode: "sideways" },
      fallback,
    );
    expect(filters.start).toBe(fallback.start);
    expect(filters.end).toBe(fallback.end);
    expect(filters.tab).toBe(fallback.tab);
    expect(filters.mode).toBe(fallback.mode);
  });

  it("falls back on an inverted range instead of showing nothing", () => {
    const filters = reportFiltersFromSearchParams(
      { start: "2026-09-01", end: "2026-08-01" },
      fallback,
    );
    expect(filters.start).toBe(fallback.start);
    expect(filters.end).toBe(fallback.end);
  });

  it("takes the first value when a scalar param is repeated", () => {
    const filters = reportFiltersFromSearchParams(
      { tab: ["spending", "income"] },
      fallback,
    );
    expect(filters.tab).toBe("spending");
  });

  it("drops blank and over-long list entries", () => {
    const filters = reportFiltersFromSearchParams(
      { merchant: ["  ", "Costco", "x".repeat(201)] },
      fallback,
    );
    expect(filters.merchants).toEqual(["Costco"]);
  });

  it("defaults pending to included when the param is absent or unknown", () => {
    expect(reportFiltersFromSearchParams({}, fallback).excludePending).toBe(false);
    expect(
      reportFiltersFromSearchParams({ pending: "maybe" }, fallback).excludePending,
    ).toBe(false);
  });

  it("takes scope from the fallback, never from the raw query string", () => {
    // The page resolves ?scope= against the households RLS exposes before
    // building the fallback; trusting the raw value here would bypass that.
    const filters = reportFiltersFromSearchParams(
      { scope: "someone-elses-household" },
      { ...fallback, scope: "my-household" },
    );
    expect(filters.scope).toBe("my-household");
  });

  it("round-trips through reportFiltersToSearchParams", () => {
    const original: ReportFilters = {
      ...fallback,
      tab: "spending",
      mode: "trends",
      dimension: "group",
      merchants: ["Costco"],
      accounts: ["acct-9"],
      categories: ["Groceries"],
      excludePending: true,
    };
    const params = reportFiltersToSearchParams(original);
    const back = reportFiltersFromSearchParams(
      {
        start: params.get("start")!,
        end: params.get("end")!,
        tab: params.get("tab")!,
        mode: params.get("mode")!,
        dimension: params.get("dimension")!,
        pending: params.get("pending")!,
        merchant: params.getAll("merchant"),
        account: params.getAll("account"),
        category: params.getAll("category"),
      },
      fallback,
    );
    expect(back).toEqual(original);
  });
});

describe("isIsoDate", () => {
  it("accepts a real date and rejects impossible or malformed ones", () => {
    expect(isIsoDate("2026-07-31")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("26-07-31")).toBe(false);
    expect(isIsoDate(20260731)).toBe(false);
    expect(isIsoDate(undefined)).toBe(false);
  });
});
