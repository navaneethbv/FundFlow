import { describe, it, expect } from "vitest";
import {
  buildInvestmentsPage,
  classifySecurityType,
  externalFlowsFromTransactions,
  normalizeManualHolding,
  type HoldingJoinRow,
  type HoldingSnapshotRow,
} from "@/lib/investments";

function holding(partial: Partial<HoldingJoinRow> = {}): HoldingJoinRow {
  return {
    id: "h1",
    accountId: "acct-1",
    manualAccountId: null,
    accountName: "Brokerage",
    securityName: "Vanguard Total Stock",
    ticker: "VTI",
    securityType: "etf",
    quantity: 10,
    price: 100,
    value: 1000,
    source: "plaid",
    isActive: true,
    ...partial,
  };
}

describe("classifySecurityType", () => {
  it("maps known Plaid types to display classes", () => {
    expect(classifySecurityType("equity")).toBe("Stocks");
    expect(classifySecurityType("etf")).toBe("Funds");
    expect(classifySecurityType("mutual fund")).toBe("Funds");
    expect(classifySecurityType("fixed income")).toBe("Bonds");
    expect(classifySecurityType("cash")).toBe("Cash");
    expect(classifySecurityType("cryptocurrency")).toBe("Crypto");
  });

  it("falls back to Other for an unrecognized type and Unclassified for null", () => {
    expect(classifySecurityType("derivative")).toBe("Other");
    expect(classifySecurityType("something-new")).toBe("Other");
    expect(classifySecurityType(null)).toBe("Unclassified");
  });
});

describe("externalFlowsFromTransactions", () => {
  it("keeps only deposit/withdrawal/contribution/distribution rows", () => {
    const flows = externalFlowsFromTransactions([
      { date: "2026-07-01", amount: -1000, txnSubtype: "deposit" },
      { date: "2026-07-02", amount: 100, txnSubtype: "buy" },
      { date: "2026-07-03", amount: 500, txnSubtype: "withdrawal" },
      { date: "2026-07-04", amount: -50, txnSubtype: "dividend" },
      { date: "2026-07-05", amount: -10, txnSubtype: null },
    ]);
    expect(flows).toEqual([
      { date: "2026-07-01", amount: 1000 },
      { date: "2026-07-03", amount: -500 },
    ]);
  });

  it("flips Plaid's sign so a deposit is positive and a withdrawal is negative", () => {
    const flows = externalFlowsFromTransactions([
      { date: "2026-07-01", amount: -1000, txnSubtype: "contribution" },
    ]);
    expect(flows[0].amount).toBe(1000);
  });
});

describe("normalizeManualHolding", () => {
  const TODAY = "2026-07-30";
  function body(partial: Record<string, unknown> = {}) {
    return {
      accountSource: "manual",
      accountId: "man-1",
      securityName: "Vanguard Total Stock",
      ticker: "VTI",
      securityType: "etf",
      quantity: 10,
      price: 100,
      asOf: "2026-07-29",
      currency: "USD",
      ...partial,
    };
  }

  it("accepts a fully valid manual holding", () => {
    const result = normalizeManualHolding(body(), TODAY);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.securityName).toBe("Vanguard Total Stock");
      expect(result.value.quantity).toBe(10);
    }
  });

  it("rejects a missing or invalid accountSource", () => {
    expect(normalizeManualHolding(body({ accountSource: "other" }), TODAY).ok).toBe(false);
    expect(normalizeManualHolding(body({ accountSource: undefined }), TODAY).ok).toBe(false);
  });

  it("rejects a missing accountId", () => {
    expect(normalizeManualHolding(body({ accountId: "" }), TODAY).ok).toBe(false);
  });

  it("rejects an empty or overlong security name", () => {
    expect(normalizeManualHolding(body({ securityName: "" }), TODAY).ok).toBe(false);
    expect(normalizeManualHolding(body({ securityName: "x".repeat(161) }), TODAY).ok).toBe(false);
  });

  it("drops an unrecognized security type to null rather than rejecting", () => {
    const result = normalizeManualHolding(body({ securityType: "nonsense" }), TODAY);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.securityType).toBeNull();
  });

  it("rejects a non-positive quantity", () => {
    expect(normalizeManualHolding(body({ quantity: 0 }), TODAY).ok).toBe(false);
    expect(normalizeManualHolding(body({ quantity: -5 }), TODAY).ok).toBe(false);
  });

  it("rejects a negative price but allows zero", () => {
    expect(normalizeManualHolding(body({ price: -1 }), TODAY).ok).toBe(false);
    expect(normalizeManualHolding(body({ price: 0 }), TODAY).ok).toBe(true);
  });

  it("rejects a malformed or future as-of date", () => {
    expect(normalizeManualHolding(body({ asOf: "07/29/2026" }), TODAY).ok).toBe(false);
    expect(normalizeManualHolding(body({ asOf: "2026-07-31" }), TODAY).ok).toBe(false);
    expect(normalizeManualHolding(body({ asOf: TODAY }), TODAY).ok).toBe(true);
  });

  it("falls back to USD for a missing or malformed currency", () => {
    const result = normalizeManualHolding(body({ currency: undefined }), TODAY);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.currency).toBe("USD");
  });

  it("trims and caps an overlong ticker rather than rejecting", () => {
    const result = normalizeManualHolding(body({ ticker: "  waytoolongtickersymbol  " }), TODAY);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.ticker).toHaveLength(16);
  });
});

describe("buildInvestmentsPage", () => {
  it("totals only active holdings", () => {
    const page = buildInvestmentsPage(
      [holding({ id: "a", value: 1000 }), holding({ id: "b", value: 500, isActive: false })],
      [],
    );
    expect(page.total).toBe(1000);
  });

  it("computes weight as a percentage of the total, 0 when the total is 0", () => {
    const page = buildInvestmentsPage(
      [holding({ id: "a", value: 750 }), holding({ id: "b", value: 250, securityType: "cash" })],
      [],
    );
    const a = page.byClass.flatMap((c) => c.holdings).find((h) => h.id === "a")!;
    expect(a.weightPct).toBe(75);

    const empty = buildInvestmentsPage([holding({ value: 0 })], []);
    expect(empty.byClass[0].holdings[0].weightPct).toBe(0);
  });

  it("groups holdings by asset class in a fixed order regardless of input order", () => {
    const page = buildInvestmentsPage(
      [
        holding({ id: "cash1", securityType: "cash", value: 100 }),
        holding({ id: "eq1", securityType: "equity", value: 100 }),
        holding({ id: "bond1", securityType: "fixed income", value: 100 }),
      ],
      [],
    );
    expect(page.byClass.map((c) => c.label)).toEqual(["Stocks", "Bonds", "Cash"]);
  });

  it("falls back a null security type to Unclassified", () => {
    const page = buildInvestmentsPage([holding({ securityType: null })], []);
    expect(page.byClass[0].label).toBe("Unclassified");
  });

  it("includes manual holdings alongside Plaid ones in the same totals", () => {
    const page = buildInvestmentsPage(
      [
        holding({ id: "p", source: "plaid", value: 500 }),
        holding({
          id: "m",
          source: "manual",
          accountId: null,
          manualAccountId: "man-1",
          value: 500,
        }),
      ],
      [],
    );
    expect(page.total).toBe(1000);
  });

  it("computes a missing value from quantity * price rather than erroring", () => {
    const page = buildInvestmentsPage(
      [holding({ value: null, quantity: 4, price: 25 })],
      [],
    );
    expect(page.total).toBe(100);
  });

  it("treats a holding with no value and no price/quantity as zero, not an error", () => {
    const page = buildInvestmentsPage(
      [holding({ value: null, quantity: null, price: null })],
      [],
    );
    expect(page.total).toBe(0);
  });

  it("subtotals each class independently", () => {
    const page = buildInvestmentsPage(
      [
        holding({ id: "eq1", securityType: "equity", value: 300 }),
        holding({ id: "eq2", securityType: "equity", value: 200 }),
        holding({ id: "cash1", securityType: "cash", value: 100 }),
      ],
      [],
    );
    const stocks = page.byClass.find((c) => c.label === "Stocks")!;
    expect(stocks.subtotal).toBe(500);
    expect(stocks.holdings.map((h) => h.id)).toEqual(["eq1", "eq2"]); // sorted by value desc
  });

  it("computes price-based movers from first vs last snapshot", () => {
    const snapshots: HoldingSnapshotRow[] = [
      { holdingId: "a", snapshotDate: "2026-07-01", quantity: 10, price: 100, value: 1000 },
      { holdingId: "a", snapshotDate: "2026-07-30", quantity: 10, price: 110, value: 1100 },
    ];
    const page = buildInvestmentsPage([holding({ id: "a" })], snapshots);
    expect(page.topMovers).toEqual([{ name: "Vanguard Total Stock", ticker: "VTI", changePct: 10 }]);
  });

  it("returns null topMovers when no holding has snapshot history", () => {
    const page = buildInvestmentsPage([holding()], []);
    expect(page.topMovers).toBeNull();
  });

  it("returns null periodChangePct for a holding with a single snapshot", () => {
    const snapshots: HoldingSnapshotRow[] = [
      { holdingId: "a", snapshotDate: "2026-07-30", quantity: 10, price: 110, value: 1100 },
    ];
    const page = buildInvestmentsPage([holding({ id: "a" })], snapshots);
    const row = page.byClass[0].holdings[0];
    expect(row.periodChangePct).toBeNull();
  });

  it("caps top movers at five, ranked by magnitude of change", () => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    const changes = [1, 2, 3, 4, 5, 6];
    const holdings = ids.map((id) => holding({ id, securityName: id }));
    const snapshots: HoldingSnapshotRow[] = ids.flatMap((id, i) => [
      { holdingId: id, snapshotDate: "2026-07-01", quantity: 1, price: 100, value: 100 },
      { holdingId: id, snapshotDate: "2026-07-30", quantity: 1, price: 100 + changes[i], value: 100 },
    ]);
    const page = buildInvestmentsPage(holdings, snapshots);
    expect(page.topMovers).toHaveLength(5);
    expect(page.topMovers!.map((m) => m.name)).toEqual(["f", "e", "d", "c", "b"]);
  });

  it("computes day change from the two most recent distinct snapshot dates", () => {
    const snapshots: HoldingSnapshotRow[] = [
      { holdingId: "a", snapshotDate: "2026-07-28", quantity: 1, price: 100, value: 1000 },
      { holdingId: "a", snapshotDate: "2026-07-29", quantity: 1, price: 110, value: 1100 },
    ];
    const page = buildInvestmentsPage([holding({ id: "a" })], snapshots);
    expect(page.dayChange).toEqual({ amount: 100, pct: 10 });
  });

  it("returns null day change with fewer than two snapshot dates", () => {
    const snapshots: HoldingSnapshotRow[] = [
      { holdingId: "a", snapshotDate: "2026-07-29", quantity: 1, price: 110, value: 1100 },
    ];
    const page = buildInvestmentsPage([holding({ id: "a" })], snapshots);
    expect(page.dayChange).toBeNull();
  });

  it("returns null day change rather than dividing by a zero prior total", () => {
    const snapshots: HoldingSnapshotRow[] = [
      { holdingId: "a", snapshotDate: "2026-07-28", quantity: 0, price: 100, value: 0 },
      { holdingId: "a", snapshotDate: "2026-07-29", quantity: 1, price: 100, value: 100 },
    ];
    const page = buildInvestmentsPage([holding({ id: "a" })], snapshots);
    expect(page.dayChange).toBeNull();
  });

  it("builds balance history as one point per distinct snapshot date, in order", () => {
    const snapshots: HoldingSnapshotRow[] = [
      { holdingId: "a", snapshotDate: "2026-07-29", quantity: 1, price: 100, value: 100 },
      { holdingId: "b", snapshotDate: "2026-07-29", quantity: 1, price: 50, value: 50 },
      { holdingId: "a", snapshotDate: "2026-07-28", quantity: 1, price: 90, value: 90 },
    ];
    const page = buildInvestmentsPage([holding({ id: "a" }), holding({ id: "b" })], snapshots);
    expect(page.balanceHistory).toEqual([
      { date: "2026-07-28", value: 90 },
      { date: "2026-07-29", value: 150 },
    ]);
  });
});
