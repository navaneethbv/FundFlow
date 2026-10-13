import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ReportComparison from "@/components/reports/ReportComparison";
import ReportSpendingHabits from "@/components/reports/ReportSpendingHabits";
import { buildReportComparison, buildReportSpendingHabits, type ReportAnalysisPeriod } from "@/lib/report-analysis";
import type { CanonicalFinanceTransaction } from "@/lib/finance-domain";

const expense: CanonicalFinanceTransaction = {
  id: "row", sourceTransactionId: "row", date: "2024-03-01", signedAmount: 20,
  flow: "expense", merchant: "Merchant", groupKey: "TRAVEL", categoryKey: "TRAVEL_OTHER",
  accountId: null, manualAccountId: null, pending: false, source: "manual",
};
const current: ReportAnalysisPeriod = { transactions: [expense], startDate: "2024-03-01", endDate: "2024-03-31", currency: "EUR" };
const reference: ReportAnalysisPeriod = { ...current, transactions: [], startDate: "2024-02-01", endDate: "2024-02-29" };

describe("ReportComparison", () => {
  it("renders labeled exact ranges, signed monetary values, tables and privacy markers", () => {
    const html = renderToStaticMarkup(createElement(ReportComparison, {
      comparison: buildReportComparison(current, reference)!, referenceLabel: "Previous period",
    }));
    expect(html).toContain("2024-03-01 to 2024-03-31");
    expect(html).toContain("2024-02-01 to 2024-02-29");
    expect(html).toContain("Previous period");
    expect(html).toContain("EUR");
    expect(html).toContain("Income");
    expect(html).toContain("Spending");
    expect(html).toContain("Net");
    expect(html).toContain("+€20.00");
    expect(html).toContain("-€20.00");
    expect(html).toContain("Category spending changes");
    expect(html).toContain("Travel");
    expect(html).toContain("Other");
    expect(html).toContain("Percentage change unavailable: reference amount is zero.");
    expect(html).toContain("data-money");
    expect(html).toContain('scope="col"');
    expect(html).toContain('scope="row"');
    expect(html).toContain("No transactions in the reference period.");
  });

  it("states an empty current period and empty category data without inventing percentages", () => {
    const html = renderToStaticMarkup(createElement(ReportComparison, {
      comparison: buildReportComparison({ ...current, transactions: [] }, reference)!,
    }));
    expect(html).toContain("No transactions in the current period.");
    expect(html).toContain("No spending categories in either period.");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
  });

  it("renders computed percentages with signs and protects their privacy", () => {
    const html = renderToStaticMarkup(createElement(ReportComparison, {
      comparison: buildReportComparison(current, { ...current, transactions: [{ ...expense, signedAmount: 10 }] })!,
    }));
    expect(html).toMatch(/data-money[^>]*>\+100%/);
    expect(html).toMatch(/data-money[^>]*>-100%/);
  });

  it("does not claim an unavailable percentage when every baseline is nonzero", () => {
    const income = { ...expense, flow: "income" as const, signedAmount: -100 };
    const comparison = buildReportComparison(
      { ...current, transactions: [expense, income] },
      { ...current, transactions: [{ ...expense, signedAmount: 10 }, income] },
    )!;
    const html = renderToStaticMarkup(createElement(ReportComparison, { comparison }));
    expect(html).not.toContain("Percentage change unavailable");
    expect(html).toContain("Percentages use the absolute reference amount.");
  });
});

describe("ReportSpendingHabits", () => {
  it("shows the elapsed range and defines the calendar average and no-spend metric", () => {
    const html = renderToStaticMarkup(createElement(ReportSpendingHabits, {
      habits: buildReportSpendingHabits(current, "2024-03-02"),
    }));
    expect(html).toContain("Spending habits");
    expect(html).toContain("2024-03-01 to 2024-03-31");
    expect(html).toContain("2024-03-01 to 2024-03-02");
    expect(html).toContain("EUR");
    expect(html).toContain("€10.00");
    expect(html).toContain("including days with no transactions");
    expect(html).toContain("no positive expense transactions");
    expect(html).toContain("Refunds reduce spending");
    expect(html).toContain("Weekday spending");
    expect(html).toContain("Monday");
    expect(html).toContain("Sunday");
    expect(html).toContain('scope="row"');
    expect(html).toContain("data-money");
  });

  it("explains future-only and empty elapsed periods", () => {
    const future = renderToStaticMarkup(createElement(ReportSpendingHabits, {
      habits: buildReportSpendingHabits(current, "2024-02-29"),
    }));
    expect(future).toContain("No elapsed days in this range yet.");
    expect(future).toContain("Unavailable");
    const empty = renderToStaticMarkup(createElement(ReportSpendingHabits, {
      habits: buildReportSpendingHabits({ ...current, transactions: [] }, "2024-03-02"),
    }));
    expect(empty).toContain("No transactions in the elapsed range.");
  });
});
