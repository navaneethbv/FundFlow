import { describe, expect, it, vi } from "vitest";
import { financeTotals, projectFinanceTransactions } from "@/lib/finance-domain";
import { buildWeeklyReportModel } from "@/lib/weekly-report";
import { detectPriceSpikes } from "@/lib/recurring-alerts";
import { planDebtPayoff, buildPlanningDepthView } from "@/lib/planning-depth";
import { buildDebtPlannerData } from "@/lib/debt-data";
import { buildBudgetEnvelopes } from "@/lib/planning";
import { detectRefundPairs } from "@/lib/transaction-quality";

function rawTxn(id: string, amount: number, group: string, detailed: string, date = "2026-07-05") {
  return {
    id,
    providerTransactionId: `plaid-${id}`,
    userId: "u1",
    accountId: "acc-1",
    manualAccountId: null,
    date,
    amount,
    merchant: "Store",
    name: "Store",
    pfcPrimary: group,
    pfcDetailed: detailed,
    pending: false,
    source: "plaid" as const,
  };
}

const emptyCtx = {
  merchantRules: [],
  categoryOverrides: [],
  splits: [],
  linkedRefunds: [],
};

describe("M-8 expense credits", () => {
  it("nets an unlinked refund against expenses instead of inflating income", () => {
    const rows = projectFinanceTransactions({
      ...emptyCtx,
      rows: [
        rawTxn("pay", -5000, "INCOME", "INCOME_PAYCHECK"),
        rawTxn("groc", 700, "FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES"),
        rawTxn("refund", -200, "FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES"),
      ],
    });
    expect(financeTotals(rows)).toMatchObject({
      income: 5000,
      expenses: 500,
      net: 4500,
    });
    // The retailer is not listed as an income source: no income-flow row.
    expect(rows.filter((row) => row.flow === "income")).toHaveLength(1);
  });

  it("keeps genuine INCOME-group negatives as income", () => {
    const rows = projectFinanceTransactions({
      ...emptyCtx,
      rows: [rawTxn("pay", -5000, "INCOME", "INCOME_PAYCHECK")],
    });
    expect(financeTotals(rows)).toMatchObject({ income: 5000, expenses: 0 });
  });
});

describe("M-8 partial refund suggestions", () => {
  const ledger = (amounts: Array<{ id: string; amount: number; date: string }>) =>
    amounts.map((row) => ({ ...row, merchant: "Store" }));

  it("suggests exact matches as full pairs", () => {
    const pairs = detectRefundPairs(
      ledger([
        { id: "c", amount: 200, date: "2026-07-01" },
        { id: "r", amount: -200, date: "2026-07-03" },
      ]),
      14,
    );
    expect(pairs).toEqual([{ chargeId: "c", refundId: "r", amount: 200, partial: false }]);
  });

  it("suggests partial refunds with an upper bound instead of ignoring them", () => {
    const pairs = detectRefundPairs(
      ledger([
        { id: "c", amount: 200, date: "2026-07-01" },
        { id: "r", amount: -50, date: "2026-07-03" },
      ]),
      14,
    );
    expect(pairs).toEqual([{ chargeId: "c", refundId: "r", amount: 200, partial: true }]);
  });

  it("never suggests a refund larger than its charge", () => {
    const pairs = detectRefundPairs(
      ledger([
        { id: "c", amount: 200, date: "2026-07-01" },
        { id: "r", amount: -250, date: "2026-07-03" },
      ]),
      14,
    );
    expect(pairs).toEqual([]);
  });
});

describe("M-5 linked transfers excluded from the weekly report", () => {
  function weeklyInput(transferIds: Set<string>) {
    return {
      userId: "user-1",
      userEmail: "person@example.com",
      period: {
        kind: "weekly" as const,
        start: "2026-07-01",
        end: "2026-07-07",
        previousStart: "2026-06-24",
        previousEnd: "2026-06-30",
      },
      transactions: [
        {
          id: "cc-pay",
          date: "2026-07-05",
          amount: 1500,
          merchantName: "Card payment",
          name: "PAYMENT",
          category: "TRANSFER_OUT",
          accountId: "checking",
        },
        {
          id: "groc",
          date: "2026-07-05",
          amount: 100,
          merchantName: "Store",
          name: "GROCERIES",
          category: "FOOD_AND_DRINK",
          accountId: "checking",
        },
      ],
      accounts: [{ id: "checking", name: "Checking", type: "depository", plaidItemId: "item-1" }],
      institutions: [{ id: "item-1", name: "Bank" }],
      budgets: [],
      merchantRules: [],
      splits: [],
      linkedRefundTransactionIds: new Set<string>(),
      linkedTransferTransactionIds: transferIds,
      duplicateTransactionIds: new Set<string>(),
    };
  }

  it("counts a user-linked transfer as spend when unlinked, and drops it when linked", () => {
    // TRANSFER_OUT is excluded by category anyway; use a Plaid-mistagged
    // service charge as the linked leg, which is the reported scenario.
    const mistagged = {
      id: "svc",
      date: "2026-07-05",
      amount: 1500,
      merchantName: "Bank",
      name: "TRANSFER",
      category: "GENERAL_SERVICES",
      accountId: "checking",
    };
    const base = weeklyInput(new Set());
    const unlinked = buildWeeklyReportModel({
      ...base,
      transactions: [mistagged, base.transactions[1]!],
    });
    expect(unlinked.totalSpend).toBe(1600);
    const linked = buildWeeklyReportModel({
      ...base,
      transactions: [mistagged, base.transactions[1]!],
      linkedTransferTransactionIds: new Set(["svc", "other-leg"]),
    });
    expect(linked.totalSpend).toBe(100);
    expect(linked.banks).toEqual([{ name: "Bank", amount: 100 }]);
  });
});

describe("M-6 price-spike predicates", () => {
  const candidate = {
    id: "s1",
    merchantName: "StreamCo",
    averageAmount: 10,
    frequency: "MONTHLY",
  };

  it("alerts on a genuine Plaid hike (last vs average)", () => {
    const alerts = detectPriceSpikes([{ ...candidate, lastAmount: 15 }]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ currentAmount: 15, previousAmount: 10 });
  });

  it("does not alert on a user override equal to the average", () => {
    // lastAmount falls back to the average when no charge is known: no hike.
    expect(detectPriceSpikes([{ ...candidate, lastAmount: null }])).toEqual([]);
  });

  it("skips tombstoned, dismissed, and inactive streams", () => {
    const hiked = { ...candidate, lastAmount: 15 };
    expect(detectPriceSpikes([{ ...hiked, status: "TOMBSTONED" }])).toEqual([]);
    expect(detectPriceSpikes([{ ...hiked, dismissedAt: "2026-07-01" }])).toEqual([]);
    expect(detectPriceSpikes([{ ...hiked, isActive: false }])).toEqual([]);
  });
});

describe("M-7 debt payoff APR as percent", () => {
  it("charges 22% APR as 22 percent, not a 183%/month fraction", () => {
    const plan = planDebtPayoff(
      [{ id: "card", name: "Card", balance: 1000, apr: 22, minimumPayment: null }],
      300,
      "avalanche",
    );
    // 300 - 18.33 interest = 281.67/mo -> 4 months, ~73.33 interest.
    // The old apr/12 math paid it off in 1 month with 1,833 interest.
    expect(plan.steps[0]?.payoffMonth).toBe(4);
    expect(plan.steps[0]?.estimatedInterest).toBeCloseTo(73.33, 2);
  });
});

describe("M-9 non-card liabilities without APR stay unplanned", () => {
  it("plans cards with the assumed rate but excludes mortgages without one", () => {
    const data = buildDebtPlannerData(
      [
        { id: "card", name: "Visa", balance: 1000, apr: null, type: "credit" },
        { id: "mtg", name: "Mortgage", balance: 300000, apr: null, type: "loan" },
      ],
      0,
    );
    const byId = new Map(data.debts.map((debt) => [debt.id, debt]));
    expect(byId.get("card")).toMatchObject({ planned: true, apr: 22, aprAssumed: true });
    expect(byId.get("mtg")).toMatchObject({ planned: false, aprAssumed: true });
    // The mortgage is listed (balance visible) but absent from the projection.
    expect(data.avalanche?.order ?? []).not.toContain("mtg");
    expect(data.avalanche?.order ?? []).toContain("card");
    // Its fabricated 6,000/month minimum does not enter the budget.
    expect(data.totalMonthlyBudget).toBeLessThan(6000);
  });

  it("plans a loan once it carries a real APR", () => {
    const data = buildDebtPlannerData(
      [{ id: "mtg", name: "Mortgage", balance: 300000, apr: 6.5, type: "loan" }],
      0,
    );
    expect(data.debts[0]).toMatchObject({ planned: true, aprAssumed: false });
    expect(data.avalanche?.order ?? []).toContain("mtg");
  });
});

describe("M-12 income budgets stay out of envelopes", () => {
  it("builds envelopes for expense budgets only", () => {
    const envelopes = buildBudgetEnvelopes({
      budgets: [
        { category: "PAYCHECK", monthlyLimit: 3000 },
        { category: "FOOD_AND_DRINK", monthlyLimit: 500 },
      ],
      currentSpend: [
        { category: "INCOME", amount: 3000, groupKey: "INCOME", categoryKey: "INCOME_PAYCHECK" },
        { category: "FOOD_AND_DRINK", amount: 100, groupKey: "FOOD_AND_DRINK", categoryKey: "FOOD_AND_DRINK_GROCERIES" },
      ],
      previousSpend: [],
      dayOfMonth: 15,
      daysInMonth: 30,
    });
    // buildBudgetEnvelopes itself is granularity-agnostic; the dashboard
    // filters income budgets before calling (M-12). A group filter keeps it.
    const expenseOnly = envelopes.filter((envelope) => envelope.category !== "PAYCHECK");
    expect(expenseOnly).toHaveLength(1);
    expect(expenseOnly[0]?.spent).toBe(100);
  });

  it("excludes income-group budgets from dashboard envelopes and groups", async () => {
    const { getDashboardData } = await import("@/lib/dashboard");
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "limit", "gte", "lt", "in", "range", "single"]) {
      chain[m] = () => chain;
    }
    chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
    chain.then = (resolve: (v: unknown) => unknown) =>
      resolve({
        data: null,
        error: null,
      });
    const mockFrom = vi.fn((table: string) => {
      if (table === "budgets") {
        const budgetChain: Record<string, unknown> = {};
        for (const m of ["select", "eq", "order", "limit", "gte", "lt", "in", "range", "single"]) {
          budgetChain[m] = () => budgetChain;
        }
        budgetChain.then = (resolve: (v: unknown) => unknown) =>
          resolve({
            data: [
              { category: "PAYCHECK", monthly_limit: 3000, group_name: "income", rollover_enabled: false },
              { category: "FOOD_AND_DRINK", monthly_limit: 500, group_name: "flexible", rollover_enabled: false },
            ],
            error: null,
          });
        return budgetChain;
      }
      return chain;
    });
    const data = await getDashboardData({ from: mockFrom } as never, undefined, "2026-09", "u1");
    expect(data.budgetEnvelopes.map((envelope) => envelope.category)).not.toContain("PAYCHECK");
    expect(data.budgetEnvelopes.map((envelope) => envelope.category)).toContain("FOOD_AND_DRINK");
  });
});

describe("M-10 unknown cash balance stays unknown", () => {
  it("reports null Safe-to-Spend and runway instead of a zero-based fiction", async () => {
    const { getDashboardData } = await import("@/lib/dashboard");
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "limit", "gte", "lt", "in", "range", "single"]) {
      chain[m] = () => chain;
    }
    chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
    chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
    const mockFrom = vi.fn((table: string) => {
      if (table === "accounts") {
        const accountChain: Record<string, unknown> = {};
        for (const m of ["select", "eq", "order", "limit", "gte", "lt", "in", "range", "single"]) {
          accountChain[m] = () => accountChain;
        }
        accountChain.then = (resolve: (v: unknown) => unknown) =>
          resolve({
            data: [
              { id: "checking", name: "Checking", type: "depository", current_balance: null, plaid_item_id: "item-1" },
            ],
            error: null,
          });
        return accountChain;
      }
      return chain;
    });
    const data = await getDashboardData({ from: mockFrom } as never, undefined, "2026-09", "u1");
    expect(data.insights.safeToSpend).toBeNull();
    expect(data.insights.runwayMonths).toBeNull();
  });
});

describe("M-13 trailing-median surplus", () => {
  it("prefers the override over the partial current month", () => {
    const monthToDate = buildPlanningDepthView({
      accounts: [{ name: "Card", type: "credit", balance: 1000, apr: 22, minimumPayment: 25 }],
      monthlyIncome: 3000,
      monthlySpend: 200,
      goals: [],
    });
    const trailing = buildPlanningDepthView({
      accounts: [{ name: "Card", type: "credit", balance: 1000, apr: 22, minimumPayment: 25 }],
      monthlyIncome: 3000,
      monthlySpend: 200,
      surplusOverride: 800,
      goals: [],
    });
    expect(monthToDate.surplus).toBe(2800);
    expect(trailing.surplus).toBe(800);
  });
});
