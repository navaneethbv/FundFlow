import { describe, it, expect } from "vitest";
import { getDashboardData } from "@/lib/dashboard";
import { breakdownBy, computePeriodCashFlow } from "@/lib/cash-flow";
import {
  financeTotals,
  fromTransactionRow,
  projectFinanceTransactions,
  type TransactionRow,
} from "@/lib/finance-domain";
import type { TransactionSplit } from "@/lib/transaction-quality";

type Row = Record<string, unknown>;

/**
 * Phase 0 parity guard. The dashboard and the canonical projection must report
 * the same income and expenses for the same ledger — if they ever drift, every
 * page built on the projection silently disagrees with the dashboard.
 */
function makeSupabase(data: {
  accounts: Row[];
  transactions: Row[];
  linkedRefunds: Row[];
  merchantRules: Row[];
  categoryOverrides: Row[];
  oldestDate: string;
}) {
  const inFilters: Array<{ table: string; column: string; values: unknown[] }> = [];
  const from = (table: string) => {
    const state = { table, cols: "" };
    const chain: Record<string, unknown> = {};
    const resolveData = () => {
      switch (state.table) {
        case "accounts":
          return { data: data.accounts };
        case "transactions":
          return { data: state.cols.includes("amount") ? data.transactions : [] };
        case "linked_refunds":
          return { data: data.linkedRefunds };
        case "merchant_rules":
          return { data: data.merchantRules };
        case "category_overrides":
          return { data: data.categoryOverrides };
        default:
          return { data: [] };
      }
    };
    Object.assign(chain, {
      select: (cols: string) => {
        state.cols = cols;
        return chain;
      },
      eq: () => chain,
      order: () => chain,
      gte: () => chain,
      lt: () => chain,
      in: (column: string, values: unknown[]) => {
        inFilters.push({ table, column, values });
        return chain;
      },
      range: () => chain,
      limit: () => chain,
      maybeSingle: () =>
        Promise.resolve(
          state.table === "transactions" ? { data: { date: data.oldestDate } } : { data: null },
        ),
      then: (resolve: (value: { data: unknown }) => unknown) => resolve(resolveData()),
    });
    return chain;
  };
  return { from, inFilters } as never;
}

const ACCOUNTS: Row[] = [
  {
    id: "acc1",
    name: "Everyday Checking",
    official_name: null,
    mask: "0688",
    type: "depository",
    subtype: "checking",
    current_balance: 4200,
    available_balance: 4200,
    credit_limit: null,
    iso_currency_code: "USD",
    plaid_item_id: "item1",
  },
];

/** One row per meaning: income, spend, transfer, refunded pair, rename, override. */
const TRANSACTIONS: Row[] = [
  {
    id: "paycheck",
    date: "2026-07-01",
    amount: -3500,
    merchant_name: "Acme Payroll",
    name: "ACME PAYROLL",
    pfc_primary: "INCOME",
    pfc_detailed: "INCOME_WAGES",
    account_id: "acc1",
    user_id: "user-1",
    plaid_transaction_id: "p-1",
  },
  {
    id: "groceries",
    date: "2026-07-03",
    amount: 120.5,
    merchant_name: "Fred Meyer",
    name: "FRED MEYER",
    pfc_primary: "FOOD_AND_DRINK",
    pfc_detailed: "FOOD_AND_DRINK_GROCERIES",
    account_id: "acc1",
    user_id: "user-1",
    plaid_transaction_id: "p-2",
  },
  {
    id: "cardpay",
    date: "2026-07-05",
    amount: 800,
    merchant_name: "Chase Payment",
    name: "CHASE PAYMENT",
    pfc_primary: "LOAN_PAYMENTS",
    pfc_detailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
    account_id: "acc1",
    user_id: "user-1",
    plaid_transaction_id: "p-3",
  },
  {
    id: "charge",
    date: "2026-07-06",
    amount: 200,
    merchant_name: "Returned Store",
    name: "RETURNED STORE",
    pfc_primary: "GENERAL_MERCHANDISE",
    pfc_detailed: "GENERAL_MERCHANDISE_OTHER",
    account_id: "acc1",
    user_id: "user-1",
    plaid_transaction_id: "p-4",
  },
  {
    id: "refund",
    date: "2026-07-09",
    amount: -200,
    merchant_name: "Returned Store",
    name: "RETURNED STORE",
    pfc_primary: "GENERAL_MERCHANDISE",
    pfc_detailed: "GENERAL_MERCHANDISE_OTHER",
    account_id: "acc1",
    user_id: "user-1",
    plaid_transaction_id: "p-5",
  },
  {
    id: "coffee",
    date: "2026-07-12",
    amount: 15,
    merchant_name: "SQ *COFFEE #402",
    name: "SQ *COFFEE #402",
    pfc_primary: "FOOD_AND_DRINK",
    pfc_detailed: "FOOD_AND_DRINK_COFFEE",
    account_id: "acc1",
    user_id: "user-1",
    plaid_transaction_id: "p-6",
  },
  {
    id: "petstore",
    date: "2026-07-14",
    amount: 25,
    merchant_name: "Pet Store",
    name: "PET STORE",
    pfc_primary: "GENERAL_MERCHANDISE",
    pfc_detailed: "GENERAL_MERCHANDISE_PET",
    account_id: "acc1",
    user_id: "user-1",
    plaid_transaction_id: "p-7",
  },
  {
    id: "imported",
    date: "2026-07-16",
    amount: 45,
    merchant_name: "Legacy CSV Row",
    name: "LEGACY CSV ROW",
    pfc_primary: "GENERAL_MERCHANDISE",
    pfc_detailed: "GENERAL_MERCHANDISE_OTHER",
    account_id: "acc1",
    user_id: "user-1",
    plaid_transaction_id: "import-9",
  },
];

const LINKED_REFUNDS: Row[] = [
  { charge_transaction_id: "charge", refund_transaction_id: "refund" },
];

const MERCHANT_RULES: Row[] = [
  {
    match_type: "keyword",
    pattern: "sq *coffee",
    display_name: "Neighborhood Coffee",
    category: null,
    enabled: true,
  },
];

const CATEGORY_OVERRIDES: Row[] = [
  { source_category: "GENERAL_MERCHANDISE", display_category: "Shopping" },
];

function supabase() {
  return makeSupabase({
    accounts: ACCOUNTS,
    transactions: TRANSACTIONS,
    linkedRefunds: LINKED_REFUNDS,
    merchantRules: MERCHANT_RULES,
    categoryOverrides: CATEGORY_OVERRIDES,
    oldestDate: "2026-07-01",
  });
}

/** The same ledger, projected directly — the reference the dashboard must match. */
function reference(splits: TransactionSplit[] = []) {
  return projectFinanceTransactions({
    rows: (TRANSACTIONS as unknown as TransactionRow[]).map(fromTransactionRow),
    merchantRules: MERCHANT_RULES.map((r) => ({
      matchType: r.match_type as "merchant" | "keyword" | "account",
      pattern: r.pattern as string,
      displayName: r.display_name as string | null,
      category: r.category as string | null,
      enabled: r.enabled as boolean,
    })),
    categoryOverrides: CATEGORY_OVERRIDES.map((r) => ({
      sourceCategory: r.source_category as string,
      displayCategory: r.display_category as string,
    })),
    splits,
    linkedRefunds: LINKED_REFUNDS.map((r) => ({
      chargeTransactionId: r.charge_transaction_id as string,
      refundTransactionId: r.refund_transaction_id as string,
    })),
    accountNames: new Map([["acc1", "Everyday Checking"]]),
  });
}

describe("dashboard / canonical projection parity", () => {
  it("skips override reads for an empty ledger and chunks non-empty ids", async () => {
    const empty = makeSupabase({
      accounts: ACCOUNTS,
      transactions: [],
      linkedRefunds: [],
      merchantRules: [],
      categoryOverrides: [],
      oldestDate: "2026-07-01",
    }) as unknown as {
      from: unknown;
      inFilters: Array<{ table: string; column: string; values: unknown[] }>;
    };
    await getDashboardData(empty as never, undefined, "2026-07", "user-1");
    expect(
      empty.inFilters.filter(({ table }) => table === "transaction_annotations"),
    ).toEqual([]);

    const many = makeSupabase({
      accounts: ACCOUNTS,
      transactions: Array.from({ length: 501 }, (_, index) => ({
        ...TRANSACTIONS[1],
        id: `txn-${index}`,
        plaid_transaction_id: `plaid-${index}`,
      })),
      linkedRefunds: [],
      merchantRules: [],
      categoryOverrides: [],
      oldestDate: "2026-07-01",
    }) as unknown as {
      from: unknown;
      inFilters: Array<{ table: string; column: string; values: unknown[] }>;
    };
    await getDashboardData(many as never, undefined, "2026-07", "user-1");
    const annotationFilters = many.inFilters.filter(
      ({ table }) => table === "transaction_annotations",
    );
    expect(annotationFilters).toHaveLength(3);
    expect(annotationFilters.every(({ values }) => values.length <= 250)).toBe(true);
  });
  it("reports the same month expenses as financeTotals", async () => {
    const data = await getDashboardData(supabase(), undefined, "2026-07", "user-1");
    const totals = financeTotals(reference());
    // groceries 120.50 + coffee 15 + pet store 25 + imported 45; the refunded
    // pair and the credit-card payment are cash movement, not spending.
    expect(totals.expenses).toBe(205.5);
    expect(data.currentMonthExpenses).toBe(totals.expenses);
  });

  it("reports the same month income as financeTotals", async () => {
    const data = await getDashboardData(supabase(), undefined, "2026-07", "user-1");
    const totals = financeTotals(reference());
    expect(totals.income).toBe(3500);
    expect(data.currentMonthIncome).toBe(totals.income);
  });

  it("agrees with the projection on the monthly spending series", async () => {
    const data = await getDashboardData(supabase(), undefined, "2026-07", "user-1");
    const july = data.monthlySpending.find((m) => m.month === "2026-07");
    expect(july?.amount).toBe(financeTotals(reference()).expenses);
  });

  it("applies merchant renames and category overrides exactly once", async () => {
    const data = await getDashboardData(supabase(), undefined, "2026-07", "user-1");
    const merchants = data.merchantBreakdown.map((m) => m.merchant);
    expect(merchants).toContain("Neighborhood Coffee");
    expect(merchants).not.toContain("SQ *COFFEE #402");

    const categories = data.categoryBreakdown.map((c) => c.category);
    expect(categories).toContain("Shopping");
    // The refunded pair carried GENERAL_MERCHANDISE too, but nets to nothing,
    // so "Shopping" must only reflect the pet-store and imported rows.
    const shopping = data.categoryBreakdown.find((c) => c.category === "Shopping");
    expect(shopping?.amount).toBe(70);
  });

  it("keeps the refunded pair out of spend while cash flow still sees it", async () => {
    const data = await getDashboardData(supabase(), undefined, "2026-07", "user-1");
    expect(data.merchantBreakdown.some((m) => m.merchant === "Returned Store")).toBe(false);
    // Deposits include the $200 refund and the $3,500 paycheck.
    expect(data.cashFlow.deposits).toBe(3700);
  });

  it("reconciles the selected Cash Flow period with canonical totals while passing real splits", () => {
    const projected = reference([
      {
        transactionId: "groceries",
        category: "Groceries",
        amount: 70.5,
      },
      {
        transactionId: "groceries",
        category: "Household supplies",
        amount: 50,
      },
    ]);
    const totals = financeTotals(projected);
    const july = computePeriodCashFlow(projected, "monthly")[0];

    expect(july).toMatchObject({
      key: "2026-07",
      income: totals.income,
      expenses: totals.expenses,
      savings: totals.net,
    });
    expect(july?.savingsRate).toBe(94.13);
    expect(breakdownBy(projected, "category", "expense")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Groceries", amount: 70.5 }),
        expect.objectContaining({
          label: "Household supplies",
          amount: 50,
        }),
      ]),
    );
  });
});
