import { describe, it, expect } from "vitest";
import { buildInvestmentsPage, type HoldingJoinRow } from "@/lib/investments";

describe("lib/investments.ts", () => {
  it("groups active holdings by security type and computes portfolio weights", () => {
    const holdings: HoldingJoinRow[] = [
      {
        id: "h1",
        accountId: "a1",
        manualAccountId: null,
        accountName: "Brokerage",
        securityName: "Vanguard Total Stock Market",
        ticker: "VTI",
        securityType: "equity",
        quantity: 10,
        price: 220,
        value: 2200,
        source: "plaid",
        isActive: true,
      },
      {
        id: "h2",
        accountId: "a1",
        manualAccountId: null,
        accountName: "Brokerage",
        securityName: "Apple Inc",
        ticker: "AAPL",
        securityType: "equity",
        quantity: 5,
        price: 180,
        value: 900,
        source: "plaid",
        isActive: true,
      },
    ];

    const res = buildInvestmentsPage(holdings);

    expect(res.total).toBe(3100);
    expect(res.byClass.length).toBe(1);
    expect(res.byClass[0].label).toBe("EQUITY");
    expect(res.byClass[0].holdings[0].weightPct).toBe(70.97); // 2200 / 3100
  });
});
