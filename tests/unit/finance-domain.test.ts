import { describe, it, expect } from "vitest";
import {
  financeTotals,
  fromTransactionRow,
  projectFinanceTransactions,
  type RawFinanceTransaction,
} from "@/lib/finance-domain";

/**
 * Phase 0 fixture: one row per meaning the projection has to get right.
 * Every later page reads these rows instead of re-deriving transaction
 * semantics, so this fixture is the contract the whole app agrees on.
 */
function raw(overrides: Partial<RawFinanceTransaction>): RawFinanceTransaction {
  return {
    id: "t-generic",
    providerTransactionId: "plaid-generic",
    userId: "user-1",
    accountId: "acct-checking",
    manualAccountId: null,
    date: "2026-07-10",
    amount: 10,
    merchant: "Generic",
    name: "GENERIC PURCHASE",
    pfcPrimary: "GENERAL_MERCHANDISE",
    pfcDetailed: "GENERAL_MERCHANDISE_OTHER",
    pending: false,
    source: "plaid",
    ...overrides,
  };
}

const PAYCHECK = raw({
  id: "t-paycheck",
  date: "2026-07-01",
  amount: -3500,
  merchant: "Acme Payroll",
  pfcPrimary: "INCOME",
  pfcDetailed: "INCOME_WAGES",
});

const GROCERIES = raw({
  id: "t-groceries",
  date: "2026-07-03",
  amount: 120.5,
  merchant: "Fred Meyer",
  pfcPrimary: "FOOD_AND_DRINK",
  pfcDetailed: "FOOD_AND_DRINK_GROCERIES",
});

const CARD_PAYMENT = raw({
  id: "t-card-payment",
  date: "2026-07-05",
  amount: 800,
  merchant: "Chase Card Payment",
  pfcPrimary: "LOAN_PAYMENTS",
  pfcDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
});

const CHARGE = raw({
  id: "t-charge",
  date: "2026-07-06",
  amount: 200,
  merchant: "Returned Store",
  pfcPrimary: "GENERAL_MERCHANDISE",
});

const REFUND = raw({
  id: "t-refund",
  date: "2026-07-09",
  amount: -200,
  merchant: "Returned Store",
  pfcPrimary: "GENERAL_MERCHANDISE",
});

const SPLIT_PARENT = raw({
  id: "t-split",
  date: "2026-07-12",
  amount: 100,
  merchant: "Costco",
  pfcPrimary: "GENERAL_MERCHANDISE",
  pfcDetailed: "GENERAL_MERCHANDISE_SUPERSTORES",
});

const IMPORTED = raw({
  id: "t-imported",
  providerTransactionId: "import-abc123",
  date: "2026-07-14",
  amount: 45,
  merchant: "Old Bank CSV Row",
  source: "import",
});

const MANUAL = raw({
  id: "t-manual",
  providerTransactionId: "manual-def456",
  date: "2026-07-15",
  amount: 30,
  merchant: "Cash Lunch",
  source: "manual",
});

const PENDING = raw({
  id: "t-pending",
  date: "2026-07-20",
  amount: 60,
  merchant: "Pending Shop",
  pending: true,
});

const HOUSEHOLD_ROW = raw({
  id: "t-household",
  userId: "user-2",
  date: "2026-07-21",
  amount: 75,
  merchant: "Partner Purchase",
});

const RENAMED = raw({
  id: "t-renamed",
  date: "2026-07-22",
  amount: 15,
  merchant: "SQ *COFFEE #402",
  pfcPrimary: "FOOD_AND_DRINK",
  pfcDetailed: "FOOD_AND_DRINK_COFFEE",
});

const OVERRIDDEN = raw({
  id: "t-overridden",
  date: "2026-07-23",
  amount: 25,
  merchant: "Pet Store",
  pfcPrimary: "GENERAL_MERCHANDISE",
});

const ALL_ROWS: RawFinanceTransaction[] = [
  PAYCHECK,
  GROCERIES,
  CARD_PAYMENT,
  CHARGE,
  REFUND,
  SPLIT_PARENT,
  IMPORTED,
  MANUAL,
  PENDING,
  HOUSEHOLD_ROW,
  RENAMED,
  OVERRIDDEN,
];

function project(rows: RawFinanceTransaction[] = ALL_ROWS) {
  return projectFinanceTransactions({
    rows,
    merchantRules: [
      {
        matchType: "keyword",
        pattern: "sq *coffee",
        displayName: "Neighborhood Coffee",
        category: null,
        enabled: true,
      },
    ],
    categoryOverrides: [{ sourceCategory: "GENERAL_MERCHANDISE", displayCategory: "Shopping" }],
    splits: [
      { transactionId: "t-split", category: "FOOD_AND_DRINK_GROCERIES", amount: 60 },
      { transactionId: "t-split", category: "HOME_IMPROVEMENT_HARDWARE", amount: 40 },
    ],
    linkedRefunds: [{ chargeTransactionId: "t-charge", refundTransactionId: "t-refund" }],
  });
}

function byId(rows: ReturnType<typeof project>, id: string) {
  return rows.find((row) => row.id === id);
}

describe("projectFinanceTransactions", () => {
  it("classifies an expense, income, and a transfer-like loan payment", () => {
    const rows = project();
    expect(byId(rows, "t-groceries")?.flow).toBe("expense");
    expect(byId(rows, "t-paycheck")?.flow).toBe("income");
    // Credit-card payments are cash movement, never spending.
    expect(byId(rows, "t-card-payment")?.flow).toBe("transfer");
  });

  it("treats a loan disbursement as a transfer, not income", () => {
    // Borrowing is cash movement. Counting the draw as income while
    // LOAN_PAYMENTS excludes the repayment would report borrowed money as
    // earnings and then hide the repayment that cancels it.
    const rows = project([
      raw({
        id: "t-loan-draw",
        date: "2026-07-02",
        amount: -7800,
        merchant: "Bank Loan",
        pfcPrimary: "LOAN_DISBURSEMENTS",
        pfcDetailed: "LOAN_DISBURSEMENTS_OTHER",
      }),
    ]);

    expect(rows[0]!.flow).toBe("transfer");
    expect(financeTotals(rows).income).toBe(0);
  });

  it("preserves the Plaid sign convention on signedAmount", () => {
    const rows = project();
    expect(byId(rows, "t-groceries")?.signedAmount).toBe(120.5);
    expect(byId(rows, "t-paycheck")?.signedAmount).toBe(-3500);
  });

  it("nets a linked refund pair out of spending and income", () => {
    const rows = project();
    expect(byId(rows, "t-charge")?.flow).toBe("transfer");
    expect(byId(rows, "t-refund")?.flow).toBe("transfer");
    // The rows survive so cash-flow and the ledger still see the money move.
    expect(byId(rows, "t-charge")).toBeDefined();
    expect(byId(rows, "t-refund")).toBeDefined();
  });

  it("expands a validly split transaction without changing its total", () => {
    const rows = project();
    const parts = rows.filter((row) => row.sourceTransactionId === "t-split");
    expect(parts).toHaveLength(2);
    expect(parts.map((p) => p.categoryKey).sort()).toEqual([
      "FOOD_AND_DRINK_GROCERIES",
      "HOME_IMPROVEMENT_HARDWARE",
    ]);
    expect(parts.reduce((sum, p) => sum + p.signedAmount, 0)).toBe(100);
    // Split rows carry unique ids so consumers can key on them safely.
    expect(new Set(parts.map((p) => p.id)).size).toBe(2);
    expect(parts.every((p) => p.flow === "expense")).toBe(true);
  });

  it("leaves a transaction whose splits do not reconcile as a single row", () => {
    const rows = projectFinanceTransactions({
      rows: [SPLIT_PARENT],
      merchantRules: [],
      categoryOverrides: [],
      splits: [{ transactionId: "t-split", category: "FOOD_AND_DRINK_GROCERIES", amount: 60 }],
      linkedRefunds: [],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.signedAmount).toBe(100);
    expect(rows[0]!.categoryKey).toBe("GENERAL_MERCHANDISE_SUPERSTORES");
  });

  it("applies merchant rules before category overrides", () => {
    const rows = project();
    expect(byId(rows, "t-renamed")?.merchant).toBe("Neighborhood Coffee");
    expect(byId(rows, "t-overridden")?.groupKey).toBe("Shopping");
  });

  it("never lets a category override move a row into or out of transfers", () => {
    const rows = projectFinanceTransactions({
      rows: [CARD_PAYMENT, GROCERIES],
      merchantRules: [],
      categoryOverrides: [
        { sourceCategory: "LOAN_PAYMENTS", displayCategory: "Shopping" },
        { sourceCategory: "FOOD_AND_DRINK", displayCategory: "TRANSFER_OUT" },
      ],
      splits: [],
      linkedRefunds: [],
    });
    expect(byId(rows, "t-card-payment")?.flow).toBe("transfer");
    expect(byId(rows, "t-groceries")?.flow).toBe("expense");
  });

  it("keeps import, manual, and plaid provenance", () => {
    const rows = project();
    expect(byId(rows, "t-imported")?.source).toBe("import");
    expect(byId(rows, "t-manual")?.source).toBe("manual");
    expect(byId(rows, "t-groceries")?.source).toBe("plaid");
  });

  it("includes pending rows and marks them", () => {
    const rows = project();
    expect(byId(rows, "t-pending")?.pending).toBe(true);
    expect(byId(rows, "t-pending")?.flow).toBe("expense");
  });

  it("keeps household rows owned by another user", () => {
    const rows = project();
    expect(byId(rows, "t-household")?.flow).toBe("expense");
  });

  it("falls back to the transaction name then an empty merchant", () => {
    const rows = projectFinanceTransactions({
      rows: [
        raw({ id: "t-noname", merchant: null, name: "RAW DESCRIPTOR" }),
        raw({ id: "t-blank", merchant: null, name: null }),
      ],
      merchantRules: [],
      categoryOverrides: [],
      splits: [],
      linkedRefunds: [],
    });
    expect(byId(rows, "t-noname")?.merchant).toBe("RAW DESCRIPTOR");
    expect(byId(rows, "t-blank")?.merchant).toBe("");
  });

  it("sorts stably by date then id", () => {
    const rows = projectFinanceTransactions({
      rows: [
        raw({ id: "b", date: "2026-07-02" }),
        raw({ id: "a", date: "2026-07-02" }),
        raw({ id: "c", date: "2026-07-01" }),
      ],
      merchantRules: [],
      categoryOverrides: [],
      splits: [],
      linkedRefunds: [],
    });
    expect(rows.map((r) => r.id)).toEqual(["c", "a", "b"]);
  });

  it("treats a row with no category as an uncategorized expense", () => {
    const rows = projectFinanceTransactions({
      rows: [raw({ id: "t-null", pfcPrimary: null, pfcDetailed: null })],
      merchantRules: [],
      categoryOverrides: [],
      splits: [],
      linkedRefunds: [],
    });
    expect(rows[0]!.flow).toBe("expense");
    expect(rows[0]!.groupKey).toBe("UNCATEGORIZED");
    expect(rows[0]!.categoryKey).toBe("UNCATEGORIZED");
  });

  it("projects a manual transaction (Phase 12) with no accountId alongside Plaid rows", () => {
    const manual = raw({
      id: "t-manual",
      accountId: null,
      manualAccountId: "man-1",
      source: "manual",
      amount: 45,
      merchant: "Cash tip",
      pfcPrimary: "FOOD_AND_DRINK",
      pfcDetailed: "FOOD_AND_DRINK_OTHER",
    });
    const rows = projectFinanceTransactions({
      rows: [GROCERIES, manual],
      merchantRules: [],
      categoryOverrides: [],
      splits: [],
      linkedRefunds: [],
    });
    const manualRow = byId(rows, "t-manual")!;
    expect(manualRow.accountId).toBeNull();
    expect(manualRow.manualAccountId).toBe("man-1");
    expect(manualRow.flow).toBe("expense");
    // It counts toward the shared total exactly like a Plaid row would.
    expect(financeTotals(rows).expenses).toBe(GROCERIES.amount + manual.amount);
  });
});

describe("financeTotals", () => {
  it("reports income, expenses, and net with transfers excluded", () => {
    const totals = financeTotals(project());
    // Expenses: groceries 120.50 + split 100 + import 45 + manual 30
    //           + pending 60 + household 75 + renamed 15 + overridden 25
    expect(totals.expenses).toBe(470.5);
    expect(totals.income).toBe(3500);
    expect(totals.net).toBe(3029.5);
  });

  it("counts the projected rows, so a split counts once per part", () => {
    const totals = financeTotals(project());
    expect(totals.count).toBe(ALL_ROWS.length + 1);
  });

  it("returns zeros for an empty ledger", () => {
    expect(financeTotals([])).toEqual({ income: 0, expenses: 0, net: 0, count: 0 });
  });
});

describe("fromTransactionRow", () => {
  it("derives provenance from the existing transaction id prefixes", () => {
    const base = {
      id: "row-1",
      user_id: "user-1",
      account_id: "acct-1",
      date: "2026-07-01",
      amount: 12,
      merchant_name: "Shop",
      name: "SHOP",
      pfc_primary: "GENERAL_MERCHANDISE",
      pfc_detailed: "GENERAL_MERCHANDISE_OTHER",
      pending: false,
    };
    expect(fromTransactionRow({ ...base, plaid_transaction_id: "abc" }).source).toBe("plaid");
    expect(fromTransactionRow({ ...base, plaid_transaction_id: "import-abc" }).source).toBe("import");
    expect(fromTransactionRow({ ...base, plaid_transaction_id: "manual-abc" }).source).toBe("manual");
  });

  it("defaults pending to false and manual account to null when the row omits both", () => {
    const row = fromTransactionRow({
      id: "row-2",
      user_id: "user-1",
      account_id: "acct-1",
      plaid_transaction_id: "xyz",
      date: "2026-07-01",
      amount: 12,
      merchant_name: null,
      name: null,
      pfc_primary: null,
      pfc_detailed: null,
    });
    expect(row.pending).toBe(false);
    expect(row.manualAccountId).toBeNull();
  });

  it("passes through a manual transaction's null account_id and set manual_account_id (Phase 12)", () => {
    const row = fromTransactionRow({
      id: "row-3",
      user_id: "user-1",
      account_id: null,
      manual_account_id: "man-1",
      plaid_transaction_id: "manual-abc",
      date: "2026-07-01",
      amount: 12,
      merchant_name: "Cash purchase",
      name: null,
      pfc_primary: null,
      pfc_detailed: null,
    });
    expect(row.accountId).toBeNull();
    expect(row.manualAccountId).toBe("man-1");
    expect(row.source).toBe("manual");
  });
});
