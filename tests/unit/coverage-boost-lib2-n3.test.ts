import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientStub } from "../fixtures/supabase-query";
import { loadRecurringData } from "@/lib/recurring-data";
import { expandStreamsForMonth, occurrenceDatesInWindow, countUnreviewedStreams } from "@/lib/recurring-page";
import { buildWeeklyReportModel, formatCardLabel, type WeeklyReportInput } from "@/lib/weekly-report";

describe("recurring-data dominantCurrency", () => {
  function makeClient(accounts: Array<{ id: string; name: string | null; type: string | null; subtype: string | null; iso_currency_code: string | null }>) {
    return clientStub({
      households: { data: [] },
      recurring_streams: { data: [] },
      recurring_stream_transactions: { data: [] },
      manual_recurring_items: { data: [] },
      accounts: { data: accounts },
      sync_jobs: { data: null },
    });
  }

  it("picks the most common currency even when it is not the first seen", async () => {
    const client = makeClient([
      { id: "a", name: "Checking", type: "depository", subtype: null, iso_currency_code: "USD" },
      { id: "b", name: "Savings", type: "depository", subtype: null, iso_currency_code: "eur" },
      { id: "c", name: "Other", type: "depository", subtype: null, iso_currency_code: "EUR" },
      { id: "d", name: "None", type: "depository", subtype: null, iso_currency_code: "" },
    ]);
    const result = await loadRecurringData(client as unknown as SupabaseClient, {
      userId: "user-1",
      anchorMonth: "2026-07",
    });
    expect(result.currency).toBe("EUR");
  });

  it("falls back to USD when no account resolves a currency code", async () => {
    const client = makeClient([
      { id: "a", name: "Checking", type: "depository", subtype: null, iso_currency_code: null },
    ]);
    const result = await loadRecurringData(client as unknown as SupabaseClient, {
      userId: "user-1",
      anchorMonth: "2026-07",
    });
    expect(result.currency).toBe("USD");
  });
});

describe("recurring-page expandStreamsForMonth", () => {
  const baseStream = {
    id: "s1",
    streamType: "outflow" as const,
    merchantName: "Netflix",
    description: null,
    averageAmount: 15.49,
    lastAmount: null,
    userAmount: null,
    frequency: "MONTHLY" as const,
    status: "MATURE" as const,
    isActive: true,
    accountName: "Checking",
    firstDate: "2026-01-15",
    lastDate: "2026-06-15",
    predictedNextDate: "2026-07-15",
    reviewedAt: null,
    dismissedAt: null,
    matchedTransactions: [
      { id: "t1", date: "2026-07-16" },
      { id: "t2", date: "2026-07-14" },
    ],
    category: null,
    source: "plaid" as const,
    detectionEvidence: null,
  };

  it("expands plaid streams, matching transactions within tolerance and consuming them", () => {
    const { occurrences, totals } = expandStreamsForMonth([baseStream], [], "2026-07", "2026-07-10");
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]!.status).toBe("complete");
    expect(occurrences[0]!.matchedTransactionId).toBe("t1");
    expect(totals.expenses.paid).toBe(15.49);
  });

  it("covers userAmount, averageAmount, and lastAmount fallbacks and excluded categories", () => {
    const withUser = expandStreamsForMonth(
      [{ ...baseStream, id: "s-user", userAmount: 20, averageAmount: null, lastAmount: null }],
      [],
      "2026-07",
      "2026-07-10",
    );
    expect(withUser.occurrences[0]!.amount).toBe(20);

    const onlyLast = expandStreamsForMonth(
      [{ ...baseStream, id: "s-last", userAmount: null, averageAmount: null, lastAmount: 8 }],
      [],
      "2026-07",
      "2026-07-10",
    );
    expect(onlyLast.occurrences[0]!.amount).toBe(8);

    const excluded = expandStreamsForMonth(
      [{ ...baseStream, id: "s-xfer", category: "TRANSFER_IN", streamType: "inflow" }],
      [],
      "2026-07",
      "2026-07-10",
    );
    expect(excluded.totals.income.paid).toBe(0);
  });

  it("skips dismissed, tombstoned, inactive, and anchor-less streams", () => {
    const { occurrences } = expandStreamsForMonth(
      [
        { ...baseStream, id: "a", dismissedAt: "2026-01-01T00:00:00Z" },
        { ...baseStream, id: "b", status: "TOMBSTONED" },
        { ...baseStream, id: "c", isActive: false },
        { ...baseStream, id: "d", predictedNextDate: null, lastDate: null, firstDate: null },
      ],
      [],
      "2026-07",
      "2026-07-10",
    );
    expect(occurrences).toHaveLength(0);
  });

  it("appends manual income and expense items and sorts by due date", () => {
    const { occurrences, totals } = expandStreamsForMonth(
      [],
      [
        { id: "m1", name: "Salary", amount: 2000, frequency: "monthly", nextDate: "2026-07-05", itemType: "income", category: null, enabled: true },
        { id: "m2", name: "Rent", amount: 1000, frequency: "monthly", nextDate: "2026-07-01", itemType: "expense", category: "HOUSING", enabled: true },
        { id: "m3", name: "Disabled", amount: 5, frequency: "weekly", nextDate: "2026-07-01", itemType: "expense", category: null, enabled: false },
      ],
      "2026-07",
      "2026-07-10",
    );
    expect(occurrences).toHaveLength(2);
    expect(occurrences[0]!.dueDate).toBe("2026-07-01");
    expect(totals.income.remaining).toBe(2000);
    expect(totals.expenses.remaining).toBe(1000);
  });

  it("occurrenceDatesInWindow and countUnreviewedStreams cover cadence and review logic", () => {
    const dates = occurrenceDatesInWindow("2026-07-15", { unit: "days", amount: 7 }, "2026-07-01", "2026-07-31");
    expect(dates).toContain("2026-07-15");
    expect(countUnreviewedStreams([
      { isActive: true, status: "MATURE", dismissedAt: null, reviewedAt: null },
      { isActive: true, status: "MATURE", dismissedAt: "x", reviewedAt: null },
      { isActive: false, status: "MATURE", dismissedAt: null, reviewedAt: null },
    ])).toBe(1);
  });
});

describe("weekly-report buildWeeklyReportModel", () => {
  function makeInput(overrides: Partial<WeeklyReportInput> = {}): WeeklyReportInput {
    return {
      userId: "u1",
      userEmail: "u@fundflow.dev",
      period: {
        start: "2026-07-06",
        end: "2026-07-12",
        previousStart: "2026-06-29",
        previousEnd: "2026-07-05",
      },
      transactions: [
        { id: "t1", date: "2026-07-07", amount: 50, merchantName: "", name: "Store", category: "FOOD", accountId: "acct" },
        { id: "t2", date: "2026-07-08", amount: -200, merchantName: "Payroll", name: null, category: "INCOME", accountId: "acct" },
      ],
      accounts: [
        { id: "acct", name: "Checking", type: "depository", plaidItemId: "item-1" },
        { id: "card", name: "CREDIT CARD", type: "credit", plaidItemId: "item-missing" },
      ],
      institutions: [{ id: "item-1", name: "Chase" }],
      budgets: [
        { category: "FOOD", monthlyLimit: 400 },
        { category: "HOUSING", monthlyLimit: 0 },
      ],
      merchantRules: [],
      splits: [{ transactionId: "t1", category: "GROCERIES", amount: 50 }],
      linkedRefundTransactionIds: new Set(),
      duplicateTransactionIds: new Set(),
      ...overrides,
    };
  }

  it("builds the model with credit-card and cash-flow branches", () => {
    const input = makeInput({
      transactions: [
        ...makeInput().transactions,
        { id: "t3", date: "2026-07-09", amount: 30, merchantName: "Card spend", name: null, category: "SHOPPING", accountId: "card" },
        { id: "t0", date: "2026-06-30", amount: 20, merchantName: "Last week", name: null, category: "FOOD", accountId: "acct" },
      ],
    });
    const data = buildWeeklyReportModel(input);
    expect(data.totalSpend).toBe(80);
    expect(data.previousTotalSpend).toBe(20);
    expect(data.changePercent).not.toBeNull();
    expect(data.cards).toEqual([{ name: "Credit Card", amount: 30 }]);
    expect(data.cashFlow.net).toBe(150);
    expect(data.categories.find((c) => c.category === "GROCERIES")!.share).toBeGreaterThan(0);
  });

  it("returns a null change percent when there was no prior spend", () => {
    const input = makeInput();
    const data = buildWeeklyReportModel(input);
    expect(data.changePercent).toBeNull();
  });

  it("covers budget statuses including over, at-risk, on-track, and zero-allowance", () => {
    const base = makeInput({
      transactions: [
        { id: "a", date: "2026-07-07", amount: 10, merchantName: "A", name: null, category: "OVER", accountId: "acct" },
        { id: "b", date: "2026-07-07", amount: 10, merchantName: "B", name: null, category: "RISK", accountId: "acct" },
        { id: "c", date: "2026-07-07", amount: 10, merchantName: "C", name: null, category: "TRACK", accountId: "acct" },
        { id: "d", date: "2026-07-07", amount: 10, merchantName: "D", name: null, category: "ZERO", accountId: "acct" },
      ],
      budgets: [
        { category: "OVER", monthlyLimit: 1 },
        { category: "RISK", monthlyLimit: 45 },
        { category: "TRACK", monthlyLimit: 100 },
        { category: "ZERO", monthlyLimit: 0 },
        { category: "ZERONO", monthlyLimit: 0 },
      ],
      splits: [],
    });
    const data = buildWeeklyReportModel(base);
    const statuses = Object.fromEntries(data.budgets.map((b) => [b.category, b.status]));
    expect(statuses["OVER"]).toBe("over");
    expect(statuses["RISK"]).toBe("at-risk");
    expect(statuses["TRACK"]).toBe("on-track");
    expect(statuses["ZERO"]).toBe("at-risk");
    expect(statuses["ZERONO"]).toBe("on-track");
  });

  it("formatCardLabel covers shouting names and missing pieces", () => {
    expect(formatCardLabel("CREDIT CARD", "Chase")).toBe("Chase · Credit Card");
    expect(formatCardLabel("Platinum", "Chase")).toBe("Chase · Platinum");
    expect(formatCardLabel(null, null)).toBe("Credit card");
    expect(formatCardLabel(undefined, undefined)).toBe("Credit card");
  });
});
