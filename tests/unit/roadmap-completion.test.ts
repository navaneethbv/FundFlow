import { describe, expect, it } from "vitest";
import {
  aggregateSpendWithSplits,
  detectRefundPairs,
  filterReviewDecisions,
  validateSplits,
} from "@/lib/transaction-quality";
import {
  buildRecurringStatuses,
  planDebtPayoff,
  suggestSinkingFunds,
} from "@/lib/planning-depth";
import {
  buildAuditLogPage,
  buildDataTakeout,
  buildSessionList,
  redactTakeoutSecrets,
} from "@/lib/security-account";
import { createDashboardCache } from "@/lib/dashboard-cache";
import { generateAiInsightSummaries } from "@/lib/ai-insights";

describe("roadmap completion helpers", () => {
  it("validates split totals and aggregates split categories without double counting", () => {
    const transaction = { id: "txn-1", amount: 120, category: "GENERAL" };
    const splits = [
      { transactionId: "txn-1", category: "FOOD", amount: 45 },
      { transactionId: "txn-1", category: "GIFTS", amount: 75 },
    ];

    expect(validateSplits(transaction, splits)).toEqual({ valid: true, difference: 0 });
    expect(
      aggregateSpendWithSplits(
        [
          transaction,
          { id: "txn-2", amount: 30, category: "TRANSPORTATION" },
        ],
        splits,
      ),
    ).toEqual([
      { category: "GIFTS", amount: 75 },
      { category: "FOOD", amount: 45 },
      { category: "TRANSPORTATION", amount: 30 },
    ]);
  });

  it("detects refund pairs and filters dismissed duplicate reviews", () => {
    const transactions = [
      { id: "charge", date: "2026-07-01", merchant: "Store", amount: 80 },
      { id: "refund", date: "2026-07-05", merchant: "store", amount: -80 },
      { id: "dupe", date: "2026-07-01", merchant: "Store", amount: 80 },
    ];

    expect(detectRefundPairs(transactions, 7)).toEqual([
      { chargeId: "charge", refundId: "refund", amount: 80 },
    ]);
    expect(
      filterReviewDecisions(
        [{ kind: "duplicate", subjectId: "dupe", message: "Same merchant and amount" }],
        [{ kind: "duplicate", subjectId: "dupe", decision: "dismissed" }],
      ),
    ).toEqual([]);
  });

  it("marks recurring items as paid, late, or unusual amount with linked transactions", () => {
    const statuses = buildRecurringStatuses({
      asOf: "2026-07-12",
      unusualAmountPct: 0.2,
      items: [
        { id: "rent", name: "Rent", amount: 1800, itemType: "expense", nextDate: "2026-07-01" },
        { id: "gym", name: "Gym", amount: 50, itemType: "expense", nextDate: "2026-07-10" },
        { id: "phone", name: "Phone", amount: 100, itemType: "expense", nextDate: "2026-07-15" },
      ],
      transactions: [
        { id: "txn-rent", date: "2026-07-01", merchant: "Rent", amount: 1800 },
        { id: "txn-gym", date: "2026-07-10", merchant: "Gym", amount: 70 },
      ],
    });

    expect(statuses.map((item) => [item.id, item.status, item.transactionIds])).toEqual([
      ["rent", "paid", ["txn-rent"]],
      ["gym", "unusual_amount", ["txn-gym"]],
      ["phone", "expected", []],
    ]);
  });

  it("plans debt payoff with avalanche and snowball ordering", () => {
    const debts = [
      { id: "card", name: "Card", balance: 1200, apr: 0.24, minimumPayment: 40 },
      { id: "loan", name: "Loan", balance: 800, apr: 0.08, minimumPayment: 80 },
    ];

    expect(planDebtPayoff(debts, 300, "avalanche").order.map((d) => d.id)).toEqual(["card", "loan"]);
    expect(planDebtPayoff(debts, 300, "snowball").order.map((d) => d.id)).toEqual(["loan", "card"]);
  });

  it("suggests sinking fund contributions only from surplus", () => {
    expect(
      suggestSinkingFunds({
        monthlyIncome: 7000,
        monthlySpend: 5200,
        existingGoalPace: 1000,
        goals: [
          { id: "vacation", name: "Vacation", targetAmount: 2400, currentAmount: 0, monthsRemaining: 12 },
          { id: "car", name: "Car repair", targetAmount: 600, currentAmount: 0, monthsRemaining: 6 },
        ],
      }),
    ).toEqual([
      { goalId: "vacation", monthlyContribution: 200 },
      { goalId: "car", monthlyContribution: 100 },
    ]);
  });

  it("redacts takeout secrets and paginates user audit rows", () => {
    const takeout = buildDataTakeout({
      accounts: [{ name: "Checking", access_token: "secret", mask: "1234" }],
      transactions: [{ merchant_name: "Coffee", amount: 5 }],
    });

    expect(redactTakeoutSecrets(takeout)).toEqual({
      accounts: [{ name: "Checking", mask: "1234" }],
      transactions: [{ merchant_name: "Coffee", amount: 5 }],
    });
    expect(
      buildAuditLogPage(
        [
          { userId: "u1", action: "login", metadata: { ip: "127.0.0.1" } },
          { userId: "u2", action: "login", metadata: {} },
        ],
        "u1",
        1,
      ),
    ).toEqual({
      rows: [{ action: "login", metadata: { ip: "[redacted]" } }],
      nextCursor: null,
    });
  });

  it("builds revocable session lists and isolates dashboard cache by user", async () => {
    expect(
      buildSessionList([
        { id: "s1", current: true, userAgent: "Mobile Safari", lastSeenAt: "2026-07-01T00:00:00Z" },
        { id: "s2", current: false, userAgent: "Chrome", lastSeenAt: "2026-07-02T00:00:00Z" },
      ]),
    ).toEqual([
      { id: "s2", label: "Chrome", current: false },
      { id: "s1", label: "Mobile Safari", current: true },
    ]);

    const cache = createDashboardCache<string>(60_000);
    await cache.set("u1", "dashboard", "one");
    await cache.set("u2", "dashboard", "two");
    expect(await cache.get("u1", "dashboard")).toBe("one");
    cache.invalidateUser("u1");
    expect(await cache.get("u1", "dashboard")).toBeNull();
    expect(await cache.get("u2", "dashboard")).toBe("two");
  });

  it("generates deterministic privacy-safe AI summaries from export-safe rows", () => {
    expect(
      generateAiInsightSummaries({
        enabled: true,
        rows: [
          { month: "2026-07", merchant: "Coffee", category: "FOOD", amount: 75 },
          { month: "2026-07", merchant: "Payroll", category: "INCOME", amount: -3000 },
        ],
      }),
    ).toEqual([
      expect.objectContaining({ insightType: "what_changed", sourceMonth: "2026-07" }),
      expect.objectContaining({ insightType: "save_100" }),
      expect.objectContaining({ insightType: "subscriptions_to_review" }),
      expect.objectContaining({ insightType: "goal_pace_check" }),
    ]);
    expect(generateAiInsightSummaries({ enabled: false, rows: [] })).toEqual([]);
  });
});
