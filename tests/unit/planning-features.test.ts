import { describe, expect, it } from "vitest";
import {
  buildBudgetEnvelopes,
  forecastCashFlow,
  groupRecurringByWeek,
  applyMerchantRules,
  previewMerchantRules,
  detectSpendingAnomalies,
  groupRecurringByPeriod,
  computeNetWorthSnapshot,
  buildNotification,
  shouldSendAlert,
  toAiInsightPayload,
  buildImportReview,
  canManageHousehold,
} from "@/lib/planning";

describe("planning roadmap features", () => {
  it("builds budget envelopes with month-end pacing", () => {
    const envelopes = buildBudgetEnvelopes({
      budgets: [
        { category: "FOOD_AND_DRINK", monthlyLimit: 500 },
        { category: "TRANSPORTATION", monthlyLimit: 200 },
      ],
      currentSpend: [
        { category: "FOOD_AND_DRINK", amount: 300 },
        { category: "TRANSPORTATION", amount: 60 },
      ],
      previousSpend: [
        { month: "2026-05", category: "FOOD_AND_DRINK", amount: 420 },
        { month: "2026-06", category: "FOOD_AND_DRINK", amount: 450 },
        { month: "2026-06", category: "TRANSPORTATION", amount: 180 },
      ],
      dayOfMonth: 15,
      daysInMonth: 30,
    });

    expect(envelopes[0]).toMatchObject({
      category: "FOOD_AND_DRINK",
      remaining: 200,
      projectedSpend: 600,
      status: "at-risk",
      lastMonthSpend: 450,
      threeMonthAverage: 435,
    });
    expect(envelopes[1]).toMatchObject({
      category: "TRANSPORTATION",
      remaining: 140,
      projectedSpend: 120,
      status: "on-track",
    });
  });

  it("forecasts cash flow and explains low-balance risk", () => {
    const forecast = forecastCashFlow({
      startingBalance: 1000,
      asOf: "2026-07-01",
      horizonDays: 14,
      items: [
        { name: "Paycheck", amount: 2000, itemType: "income", frequency: "biweekly", nextDate: "2026-07-05" },
        { name: "Rent", amount: 1800, itemType: "expense", frequency: "monthly", nextDate: "2026-07-03" },
        { name: "Utilities", amount: 400, itemType: "expense", frequency: "weekly", nextDate: "2026-07-10" },
      ],
      lowBalanceThreshold: 500,
    });

    expect(forecast.projectedBalance).toBe(800);
    expect(forecast.lowBalanceRisk).toBe(true);
    expect(forecast.assumptions).toContain("Starts from $1,000.00 cash.");
  });

  it("groups recurring items by due week", () => {
    const groups = groupRecurringByWeek(
      [
        { name: "Rent", amount: 1800, itemType: "expense", frequency: "monthly", nextDate: "2026-07-03" },
        { name: "Payroll", amount: 2500, itemType: "income", frequency: "biweekly", nextDate: "2026-07-10" },
      ],
      "2026-07-01",
      14,
    );

    expect(groups).toEqual([
      {
        weekStart: "2026-06-29",
        items: [expect.objectContaining({ name: "Rent", status: "expected" })],
      },
      {
        weekStart: "2026-07-06",
        items: [expect.objectContaining({ name: "Payroll", status: "expected" })],
      },
    ]);
  });

  it("previews and applies merchant cleanup rules without mutating the input", () => {
    const transactions = [
      { id: "txn-1", merchant: "SQ *COFFEE BAR", category: "GENERAL_MERCHANDISE" },
      { id: "txn-2", merchant: "PAYROLL ACME INC", category: "INCOME" },
    ];
    const rules = [
      { matchType: "keyword" as const, pattern: "coffee", displayName: "Coffee Bar", category: "FOOD_AND_DRINK", enabled: true },
    ];

    expect(previewMerchantRules(transactions, rules)).toEqual([
      { transactionId: "txn-1", before: transactions[0], after: { id: "txn-1", merchant: "Coffee Bar", category: "FOOD_AND_DRINK" } },
    ]);
    expect(applyMerchantRules(transactions, rules)[0]).toEqual({
      id: "txn-1",
      merchant: "Coffee Bar",
      category: "FOOD_AND_DRINK",
    });
    expect(transactions[0]!.merchant).toBe("SQ *COFFEE BAR");
  });

  it("detects large transactions, category spikes, and likely duplicates", () => {
    const anomalies = detectSpendingAnomalies({
      currentTransactions: [
        { id: "a", date: "2026-07-02", merchant: "Grocery", category: "FOOD", amount: 260 },
        { id: "b", date: "2026-07-02", merchant: "Grocery", category: "FOOD", amount: 260 },
        { id: "c", date: "2026-07-03", merchant: "Airline", category: "TRAVEL", amount: 900 },
      ],
      priorCategoryAverages: [{ category: "FOOD", amount: 200 }],
      largeTransactionThreshold: 500,
    });

    expect(anomalies.map((a) => a.kind)).toEqual(
      expect.arrayContaining(["duplicate-charge", "large-transaction", "category-spike"]),
    );
  });

  it("flags a merchant charge at least double its trailing median", () => {
    const anomalies = detectSpendingAnomalies({
      currentTransactions: [
        { id: "x", date: "2026-07-05", merchant: "Power Co", category: "RENT_AND_UTILITIES", amount: 210 },
      ],
      priorCategoryAverages: [],
      priorMerchantMedians: [{ merchant: "Power Co", amount: 90 }],
      largeTransactionThreshold: 500,
    });
    expect(anomalies).toEqual([
      expect.objectContaining({
        kind: "merchant-spike",
        transactionId: "x",
        severity: "warning",
      }),
    ]);
  });

  it("does not flag merchant charges below double the median or with tiny dollar jumps", () => {
    const anomalies = detectSpendingAnomalies({
      currentTransactions: [
        { id: "y", date: "2026-07-05", merchant: "Power Co", category: "RENT_AND_UTILITIES", amount: 170 },
        { id: "z", date: "2026-07-06", merchant: "Coffee Cart", category: "FOOD_AND_DRINK", amount: 12 },
      ],
      priorCategoryAverages: [],
      priorMerchantMedians: [
        { merchant: "Power Co", amount: 90 },
        { merchant: "Coffee Cart", amount: 5 },
      ],
      largeTransactionThreshold: 500,
    });
    expect(anomalies).toEqual([]);
  });

  it("groups upcoming bills by month with occurrence expansion and totals", () => {
    const groups = groupRecurringByPeriod(
      [
        { name: "Netflix", amount: 17.99, itemType: "expense", frequency: "monthly", nextDate: "2026-08-05" },
        { name: "Gym", amount: 25, itemType: "expense", frequency: "weekly", nextDate: "2026-08-03" },
        { name: "Payroll", amount: 2400, itemType: "income", frequency: "biweekly", nextDate: "2026-08-07" },
      ],
      "2026-08-01",
      40,
      "monthly",
    );
    expect(groups).toHaveLength(2);
    expect(groups[0]!.periodStart).toBe("2026-08-01");
    expect(groups[1]!.periodStart).toBe("2026-09-01");
    // weekly gym occurs 4x in August (3, 10, 17, 24, 31 → 5x)
    const august = groups[0]!;
    expect(august.items.filter((i) => i.name === "Gym")).toHaveLength(5);
    expect(august.expenseTotal).toBe(17.99 + 25 * 5);
    expect(august.incomeTotal).toBe(4800);
  });

  it("groups weekly with Monday period starts and expands within the horizon", () => {
    const groups = groupRecurringByPeriod(
      [{ name: "Gym", amount: 25, itemType: "expense", frequency: "weekly", nextDate: "2026-08-05" }],
      "2026-08-03",
      14,
      "weekly",
    );
    // 2026-08-05 is a Wednesday; Monday of that week is 08-03. Horizon ends
    // 08-17, so occurrences land 08-05 and 08-12 → two Monday-keyed groups.
    expect(groups.map((g) => g.periodStart)).toEqual(["2026-08-03", "2026-08-10"]);
  });

  it("applies budget rollover carry when enabled", () => {
    const envelopes = buildBudgetEnvelopes({
      budgets: [
        { category: "FOOD_AND_DRINK", monthlyLimit: 500, rolloverEnabled: true },
        { category: "TRANSPORTATION", monthlyLimit: 200 },
      ],
      currentSpend: [
        { category: "FOOD_AND_DRINK", amount: 300 },
        { category: "TRANSPORTATION", amount: 60 },
      ],
      previousSpend: [
        { month: "2026-05", category: "FOOD_AND_DRINK", amount: 420 },
        { month: "2026-06", category: "FOOD_AND_DRINK", amount: 550 },
      ],
      windowMonths: ["2026-05", "2026-06"],
      dayOfMonth: 15,
      daysInMonth: 30,
    });

    // carry = (500-420) + (500-550) = 30
    expect(envelopes[0]).toMatchObject({
      carry: 30,
      effectiveLimit: 530,
      remaining: 230,
    });
    // rollover disabled → no carry, remaining unchanged from limit math
    expect(envelopes[1]).toMatchObject({ carry: 0, effectiveLimit: 200, remaining: 140 });
  });

  it("counts zero-spend window months as full carry and floors effective limit at zero", () => {
    const envelopes = buildBudgetEnvelopes({
      budgets: [{ category: "FUN", monthlyLimit: 100, rolloverEnabled: true }],
      currentSpend: [{ category: "FUN", amount: 20 }],
      previousSpend: [{ month: "2026-06", category: "FUN", amount: 450 }],
      windowMonths: ["2026-05", "2026-06"],
      dayOfMonth: 10,
      daysInMonth: 31,
    });
    // carry = (100-0) + (100-450) = -250 → effectiveLimit floored at 0
    expect(envelopes[0]!.carry).toBe(-250);
    expect(envelopes[0]!.effectiveLimit).toBe(0);
    expect(envelopes[0]!.status).toBe("over");
  });

  it("assigns severities to the subscription alert types", () => {
    expect(
      buildNotification("price_hike", { title: "t", body: "b" }).severity,
    ).toBe("warning");
    expect(
      buildNotification("new_subscription", { title: "t", body: "b" }).severity,
    ).toBe("info");
  });

  it("computes net worth from linked and manual accounts", () => {
    expect(
      computeNetWorthSnapshot([
        { name: "Checking", type: "depository", balance: 1000 },
        { name: "Brokerage", type: "investment", balance: 5000 },
        { name: "Credit Card", type: "credit", balance: 600 },
        { name: "Car Loan", type: "liability", balance: 12000 },
        { name: "Hidden", type: "asset", balance: 999, includeInNetWorth: false },
      ]),
    ).toEqual({ assets: 6000, liabilities: 12600, netWorth: -6600 });
  });

  it("builds notification and respects alert opt-outs", () => {
    const notification = buildNotification("budget_exceeded", {
      title: "Dining budget exceeded",
      body: "Dining is $40 over budget.",
    });

    expect(notification.severity).toBe("warning");
    expect(shouldSendAlert("budget_exceeded", { budget_exceeded: false })).toBe(false);
    expect(shouldSendAlert("goal_reached", { goal_reached: true })).toBe(true);
  });

  it("keeps AI insight payloads privacy-safe and opt-in", () => {
    expect(toAiInsightPayload({ enabled: false, exportRows: [{ merchant: "Coffee", amount: 5 }] })).toBeNull();
    expect(
      toAiInsightPayload({
        enabled: true,
        exportRows: [{ merchant: "Coffee", amount: 5, access_token: "secret", plaid_account_id: "acct" }],
      }),
    ).toEqual({ rows: [{ merchant: "Coffee", amount: 5 }] });
  });

  it("builds import review rows with duplicate flags", () => {
    const review = buildImportReview(
      [
        { date: "2026-07-01", amount: 4.5, merchant: "Coffee", category: null },
        { date: "2026-07-01", amount: 4.5, merchant: "Coffee", category: null },
      ],
      new Set(["2026-07-01|4.50|Coffee"]),
    );

    expect(review.approvedCount).toBe(0);
    expect(review.rows.every((row) => row.status === "pending")).toBe(true);
    expect(review.rows[0]!.flags).toContain("possible-duplicate");
    expect(review.rows[1]!.flags).toContain("file-duplicate");
  });

  it("limits household management to owners", () => {
    expect(canManageHousehold({ userId: "u1", householdOwnerId: "u1", role: "owner" })).toBe(true);
    expect(canManageHousehold({ userId: "u2", householdOwnerId: "u1", role: "read_only" })).toBe(false);
  });
});
