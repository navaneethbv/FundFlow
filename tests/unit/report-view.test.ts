import { describe, expect, it } from "vitest";
import { buildReportView } from "@/lib/report-view";
import { defaultReportFilters } from "@/lib/reports";
import type { ReportDataResult } from "@/lib/reports-data";
import type { CanonicalFinanceTransaction } from "@/lib/finance-domain";

const filters = { ...defaultReportFilters("2026-10"), comparison: "previous_period" as const };
function data(amount = 100, date = "2026-10-01", currency = "USD"): ReportDataResult {
  const row: CanonicalFinanceTransaction = { id: "row", sourceTransactionId: "row", date, signedAmount: amount,
    flow: "expense", merchant: "Shop", groupKey: "FOOD_AND_DRINK", categoryKey: "GROCERIES",
    accountId: "account", manualAccountId: null, pending: false, source: "plaid" };
  return { transactions: [row], currencyByAccountId: new Map([["account", currency]]), truncated: false };
}

describe("report view integration", () => {
  it("compares same-currency rows and derives daily habits through today", () => {
    const view = buildReportView(data(100), data(80, "2026-09-01"), { ...filters, interval: "daily" }, "2026-10-02");
    expect(view.selectedCurrency).toBe("USD");
    expect(view.comparison?.spending.change).toBe(20);
    expect(view.comparisonUnavailable).toBeNull();
    expect(view.habits?.elapsedDays).toBe(2);
    expect(view.periods[0]?.key).toBe("2026-10-01");
  });

  it("never changes a selected currency when it has no matching rows", () => {
    const view = buildReportView(data(), data(80, "2026-09-01"), { ...filters, currency: "EUR" }, "2026-10-02");
    expect(view.selectedCurrency).toBe("EUR");
    expect(view.rows).toEqual([]);
    expect(view.comparison).toBeNull();
    expect(view.comparisonUnavailable).toMatch(/currency/);
    expect(view.currencies).toContain("EUR");
  });

  it.each(["current", "reference"])("suppresses comparisons when %s data is truncated", side => {
    const current = data(), reference = data(80, "2026-09-01");
    (side === "current" ? current : reference).truncated = true;
    const view = buildReportView(current, reference, filters, "2026-10-02");
    expect(view.comparison).toBeNull();
    expect(view.comparisonUnavailable).toMatch(/incomplete/);
    if (side === "current") expect(view.habits).toBeNull();
  });

  it("does not silently assume missing reference currency means zero spending", () => {
    const view = buildReportView(data(), data(80, "2026-09-01", "EUR"), filters, "2026-10-02");
    expect(view.comparison).toBeNull();
    expect(view.comparisonUnavailable).toMatch(/currency/);
  });

  it("offers original facets after a selection and does not compare by default", () => {
    const current = { ...data(), transactions: [], facetTransactions: data().transactions };
    const view = buildReportView(current, null, defaultReportFilters("2026-10"), "2026-10-02");
    expect(view.facets.merchants).toEqual([{ value: "Shop", label: "Shop" }]);
    expect(view.comparison).toBeNull();
    expect(view.comparisonUnavailable).toBeNull();
  });

  it("does not compare unknown currency or load missing comparison data as zero", () => {
    const unknown = data(); unknown.currencyByAccountId = new Map();
    const view = buildReportView(unknown, unknown, filters, "2026-10-02");
    expect(view.comparison).toBeNull();
    expect(view.comparisonUnavailable).toMatch(/currency/);
    expect(buildReportView(data(), null, filters, "2026-10-02").comparisonUnavailable).toMatch(/unavailable/);
  });

  it("keeps readable names for selected accounts missing from the current period", () => {
    const current = { ...data(), accountNames: new Map([["account", "Checking"], ["cash", "Cash wallet"]]) };
    const view = buildReportView(current, null, { ...filters, accounts: ["cash", "account", "missing"] }, "2026-10-02");
    expect(view.facets.accounts).toEqual([
      { value: "cash", label: "Cash wallet" }, { value: "account", label: "Checking" },
    ]);
  });
});
