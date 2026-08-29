import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientStub } from "../fixtures/supabase-query";
import { loadHoldings, loadHoldingSnapshots, loadInvestmentTransactions, loadHoldingAccountOptions } from "@/lib/investments-data";
import { collectLedgerChunks, ledgerDatabaseOrder, needsProjectedLedgerPage, shouldShowLedgerDayGroups, selectProjectedLedgerPage } from "@/lib/ledger-data";
import { projectLedgerRows, buildLedgerFilterOptions, sortLedgerRows, toLedgerFacetRow, resolvedLedgerAccountId, filterProjectedLedgerRows } from "@/lib/ledger-projection";
import { buildRecurringStatuses, planDebtPayoff, buildPlanningDepthView, suggestSinkingFunds } from "@/lib/planning-depth";
import { validateProfilePatch } from "@/lib/profile";
import { detectRefundPairs, detectDuplicatePairs, validateSplits, aggregateSpendWithSplits, filterReviewDecisions } from "@/lib/transaction-quality";
import { computeNetWorth, netWorthDeltaFromHistory, computeSavingsRate } from "@/components/dashboard/metrics";

describe("investments-data", () => {
  it("loadHoldings joins account and manual account names, defaulting null names", async () => {
    const client = clientStub({
      holdings: {
        data: [
          { id: "h1", account_id: "a1", manual_account_id: null, quantity: 2, institution_price: 10, institution_value: 20, source: "plaid", is_active: true, securities: { name: "VTI", ticker: "VTI", security_type: "etf", close_price: 10 } },
          { id: "h2", account_id: null, manual_account_id: "m1", quantity: null, institution_price: null, institution_value: 5, source: "manual", is_active: false, securities: null },
          { id: "h3", account_id: null, manual_account_id: "m2", quantity: 1, institution_price: null, institution_value: 9, source: "manual", is_active: true, securities: { name: null, ticker: null, security_type: null, close_price: 9 } },
        ],
      },
      accounts: {
        data: [{ id: "a1", name: null }],
      },
      manual_accounts: {
        data: [{ id: "m1", name: "Manual Acct" }, { id: "m2", name: "Unnamed Manual" }],
      },
    });
    const rows = await loadHoldings(client as unknown as SupabaseClient);
    expect(rows[0]!.accountName).toBe("Account");
    expect(rows[1]!.accountName).toBe("Manual Acct");
    expect(rows[2]!.securityName).toBe("Unnamed security");
  });

  it("loadHoldings throws when the manual accounts query errors", async () => {
    const client = clientStub({
      holdings: { data: [{ id: "h1", account_id: null, manual_account_id: "m1", quantity: 1, institution_price: 1, institution_value: 1, source: "manual", is_active: true, securities: null }] },
      accounts: { data: [] },
      manual_accounts: { error: { message: "manual boom" } },
    });
    await expect(loadHoldings(client as unknown as SupabaseClient)).rejects.toMatchObject({ message: "manual boom" });
  });

  it("loadHoldings throws when the accounts query errors", async () => {
    const client = clientStub({
      holdings: { data: [{ id: "h1", account_id: "a1", manual_account_id: null, quantity: 1, institution_price: 1, institution_value: 1, source: "plaid", is_active: true, securities: null }] },
      accounts: { error: { message: "acct boom" } },
    });
    await expect(loadHoldings(client as unknown as SupabaseClient)).rejects.toMatchObject({ message: "acct boom" });
  });

  it("loadHoldingSnapshots honors the since window and maps rows", async () => {
    const client = clientStub({
      holding_snapshots: {
        data: [
          { holding_id: "h1", snapshot_date: "2026-07-01", quantity: 1, price: 10, value: 10 },
        ],
      },
    });
    const rows = await loadHoldingSnapshots(client as unknown as SupabaseClient, { since: "2026-06-01" });
    expect(rows[0]).toEqual({ holdingId: "h1", snapshotDate: "2026-07-01", quantity: 1, price: 10, value: 10 });
    expect(await loadHoldingSnapshots(client as unknown as SupabaseClient)).toHaveLength(1);
  });

  it("loadInvestmentTransactions and loadHoldingAccountOptions map rows and default account names", async () => {
    const client = clientStub({
      investment_transactions: { data: [{ date: "2026-07-01", amount: 5, txn_subtype: "buy" }] },
      accounts: { data: [{ id: "a1", name: null }] },
      manual_accounts: { data: [{ id: "m1", name: "Manual" }] },
    });
    const txns = await loadInvestmentTransactions(client as unknown as SupabaseClient);
    expect(txns[0]).toEqual({ date: "2026-07-01", amount: 5, txnSubtype: "buy" });
    const opts = await loadHoldingAccountOptions(client as unknown as SupabaseClient, "u1");
    expect(opts).toEqual([
      { id: "a1", name: "Account", source: "plaid" },
      { id: "m1", name: "Manual", source: "manual" },
    ]);
  });
});

describe("ledger-data", () => {
  it("collectLedgerChunks throws the error code when present", async () => {
    await expect(
      collectLedgerChunks(async () => ({ rows: [], error: { code: "SOME_CODE" } })),
    ).rejects.toThrow("SOME_CODE");
  });
  it("collectLedgerChunks throws the message when there is no code", async () => {
    await expect(
      collectLedgerChunks(async () => ({ rows: [], error: { message: "boom" } })),
    ).rejects.toThrow("boom");
  });
  it("collectLedgerChunks falls back to the generic code when neither is present", async () => {
    await expect(
      collectLedgerChunks(async () => ({ rows: [], error: {} })),
    ).rejects.toThrow("ledger_query_failed");
  });
  it("collectLedgerChunks concatenates full chunks and stops on a short chunk", async () => {
    const calls: number[] = [];
    const rows = await collectLedgerChunks(async (from) => {
      calls.push(from);
      const size = from === 0 ? 2 : 1;
      return { rows: Array.from({ length: size }, (_, i) => `${from}-${i}`), error: null };
    }, 2);
    expect(rows).toHaveLength(3);
    expect(calls).toEqual([0, 2]);
  });

  it("ledgerDatabaseOrder covers amount and date directions plus tie-breakers", () => {
    expect(ledgerDatabaseOrder("amount", "desc")).toEqual([
      { column: "amount", ascending: true }, { column: "date", ascending: false }, { column: "id", ascending: true },
    ]);
    expect(ledgerDatabaseOrder("amount", "asc")).toEqual([
      { column: "amount", ascending: false }, { column: "date", ascending: false }, { column: "id", ascending: true },
    ]);
    expect(ledgerDatabaseOrder("date", "asc")).toEqual([
      { column: "date", ascending: true }, { column: "id", ascending: true },
    ]);
    expect(ledgerDatabaseOrder("date", "desc")).toEqual([
      { column: "date", ascending: false }, { column: "id", ascending: true },
    ]);
  });

  it("needsProjectedLedgerPage and shouldShowLedgerDayGroups cover each field", () => {
    expect(needsProjectedLedgerPage("date", true)).toBe(true);
    expect(needsProjectedLedgerPage("date", false)).toBe(false);
    expect(needsProjectedLedgerPage("merchant", false)).toBe(true);
    expect(needsProjectedLedgerPage("category", false)).toBe(true);
    expect(needsProjectedLedgerPage("account", false)).toBe(true);
    expect(shouldShowLedgerDayGroups("date")).toBe(true);
    expect(shouldShowLedgerDayGroups("merchant")).toBe(false);
  });

  it("selectProjectedLedgerPage filters, sorts, and slices a page", () => {
    const rows = [
      { id: "1", date: "2026-07-01", amount: 10, iso_currency_code: null, pfc_detailed: null, pending: false, merchant: "A", category: "FOOD", accountLabel: "Checking", displayedAmount: 10, merchant_name: "A", name: "A", pfc_primary: "FOOD", account_id: "a1", manual_account_id: null },
      { id: "2", date: "2026-07-02", amount: 20, iso_currency_code: null, pfc_detailed: null, pending: false, merchant: "B", category: "TRANSPORT", accountLabel: "Savings", displayedAmount: 20, merchant_name: "B", name: "B", pfc_primary: "TRANSPORT", account_id: "a2", manual_account_id: null },
    ];
    const res = selectProjectedLedgerPage(rows, { category: "", sub: "", merchant: "", sort: "date", direction: "asc", page: 1, pageSize: 1 });
    expect(res.total).toBe(2);
    expect(res.rows).toHaveLength(1);
  });
});

describe("ledger-projection", () => {
  const sourceRows = [
    { id: "1", date: "2026-07-01", amount: 10, iso_currency_code: null, pfc_detailed: "GROCERIES", pending: false, merchant_name: "Blue Bottle", name: null, pfc_primary: "FOOD_AND_DRINK", account_id: "a1", manual_account_id: null, displayedAmount: 0 },
    { id: "2", date: "2026-07-02", amount: 20, iso_currency_code: null, pfc_detailed: null, pending: false, merchant_name: null, name: "Safeway", pfc_primary: null, account_id: null, manual_account_id: "m1", displayedAmount: 0 },
  ];

  it("projects rows and builds facet rows and account ids", () => {
    const projected = projectLedgerRows(
      sourceRows,
      [],
      new Map([["a1", "Everyday Checking"]]),
      new Map([["a1", "Everyday ••••1234"], ["m1", "Manual"]]),
    );
    expect(projected[0]!.accountLabel).toBe("Everyday ••••1234");
    expect(projected[0]!.displayedAmount).toBe(-10);
    expect(projected[1]!.merchant).toBe("Safeway");
    expect(projected[1]!.accountLabel).toBe("Manual");
    expect(toLedgerFacetRow({ pfc_primary: "FOOD", pfc_detailed: "X", merchant_name: null, name: "N" }).merchant).toBe("N");
    expect(resolvedLedgerAccountId({ account_id: "a", manual_account_id: "m" })).toBe("a");
  });

  it("buildLedgerFilterOptions derives categories, subcategories, merchants, and sorts accounts", () => {
    const options = buildLedgerFilterOptions(
      [
        { category: "FOOD_AND_DRINK", pfc_detailed: "COFFEE", merchant: "Blue Bottle" },
        { category: "FOOD_AND_DRINK", pfc_detailed: "COFFEE", merchant: "blue bottle" },
        { category: null, pfc_detailed: null, merchant: "  " },
        { category: "TRANSPORT", pfc_detailed: null, merchant: "Uber" },
      ],
      [
        { value: "b", label: "B Account" },
        { value: "a", label: "A Account" },
      ],
    );
    expect(options.accounts.map((a) => a.label)).toEqual(["A Account", "B Account"]);
    expect(options.categories).toContainEqual({ value: "UNCATEGORIZED", label: "Uncategorized" });
    expect(options.categories).toContainEqual({ value: "FOOD_AND_DRINK", label: "Food And Drink" });
    expect(options.subcategoriesByCategory.FOOD_AND_DRINK).toEqual([{ value: "COFFEE", label: "Coffee" }]);
    expect(options.merchants).toEqual(["blue bottle", "Uber"]);
  });

  it("sortLedgerRows keeps missing labels last in both directions", () => {
    const rows = [
      { id: "a", date: "2026-07-01", amount: 1, iso_currency_code: null, pfc_detailed: null, pending: false, merchant: "", category: "", accountLabel: "Z", displayedAmount: 1, merchant_name: "", name: "", pfc_primary: null, account_id: "a1", manual_account_id: null },
      { id: "b", date: "2026-07-02", amount: 2, iso_currency_code: null, pfc_detailed: null, pending: false, merchant: "Mid", category: "C", accountLabel: "A", displayedAmount: 2, merchant_name: "Mid", name: "Mid", pfc_primary: "C", account_id: "a2", manual_account_id: null },
      { id: "c", date: "2026-07-03", amount: 3, iso_currency_code: null, pfc_detailed: null, pending: false, merchant: "", category: "", accountLabel: "", displayedAmount: 3, merchant_name: "", name: "", pfc_primary: null, account_id: "a3", manual_account_id: null },
    ];
    const asc = sortLedgerRows(rows, "merchant", "asc");
    const desc = sortLedgerRows(rows, "merchant", "desc");
    expect(asc.at(-1)!.merchant).toBe("");
    expect(desc.at(-1)!.merchant).toBe("");
    expect(sortLedgerRows(rows, "account", "asc").at(-1)!.accountLabel).toBe("");
    expect(sortLedgerRows(rows, "account", "desc").at(-1)!.accountLabel).toBe("");
    expect(sortLedgerRows(rows, "category", "asc").at(-1)!.category).toBe("");
    expect(sortLedgerRows(rows, "date", "asc")[0]!.id).toBe("a");
  });

  it("filterProjectedLedgerRows matches committed category, sub, and merchant", () => {
    const rows = [
      { id: "1", merchant: "Blue Bottle", category: "FOOD_AND_DRINK", pfc_detailed: "COFFEE", accountLabel: "Checking" },
      { id: "2", merchant: "Uber", category: "TRANSPORT", pfc_detailed: null, accountLabel: "Checking" },
    ];
    expect(filterProjectedLedgerRows(rows, { category: "FOOD_AND_DRINK", sub: "COFFEE", merchant: "blue bottle" })).toEqual([rows[0]]);
    expect(filterProjectedLedgerRows(rows, { category: "FOOD_AND_DRINK", sub: "WRONG", merchant: "" })).toEqual([]);
  });
});

describe("planning-depth", () => {
  it("buildRecurringStatuses handles missing, late, expected, and unusual amounts", () => {
    const statuses = buildRecurringStatuses({
      asOf: "2026-07-10",
      unusualAmountPct: 0.2,
      items: [
        { id: "i1", name: "Rent", amount: 1000, itemType: "expense", nextDate: "2026-07-01" },
        { id: "i2", name: "No Match", amount: 500, itemType: "expense", nextDate: "2026-07-01" },
        { id: "i3", name: "Coffee", amount: 5, itemType: "expense", nextDate: "" },
        { id: "i4", name: "Salary", amount: 2000, itemType: "income", nextDate: "2026-07-01" },
      ],
      transactions: [
        { id: "t1", date: "2026-07-02", merchant: "Rent", amount: 1300 },
        { id: "t3", date: "2026-07-01", merchant: "Coffee", amount: 5 },
        { id: "t4", date: "2026-07-03", merchant: "Salary", amount: 5000 },
      ],
    });
    const byId = Object.fromEntries(statuses.map((s) => [s.id, s]));
    expect(byId["i1"]!.status).toBe("unusual_amount");
    expect(byId["i1"]!.reviewPrompt).toContain("Review Rent");
    expect(byId["i2"]!.status).toBe("late");
    expect(byId["i3"]!.status).toBe("late");
    expect(byId["i4"]!.status).toBe("unusual_amount");
    expect(byId["i4"]!.reviewPrompt).toBeNull();
  });

  it("planDebtPayoff orders by avalanche and snowball", () => {
    const debts = [
      { id: "a", name: "High APR", balance: 1000, apr: 20, minimumPayment: 50 },
      { id: "b", name: "Low Balance", balance: 100, apr: 5, minimumPayment: 10 },
    ];
    const ava = planDebtPayoff(debts, 300, "avalanche");
    expect(ava.order[0]!.id).toBe("a");
    expect(ava.assumptions[0]).toContain("avalanche");
    const snow = planDebtPayoff(debts, 300, "snowball");
    expect(snow.order[0]!.id).toBe("b");
    const noApr = planDebtPayoff([{ id: "a", name: "X", balance: 500, apr: null, minimumPayment: null }], 100, "avalanche");
    expect(noApr.steps[0]!.payoffMonth).toBeGreaterThan(0);

    const equalApr = planDebtPayoff([
      { id: "a", name: "A", balance: 1000, apr: 10, minimumPayment: 10 },
      { id: "b", name: "B", balance: 100, apr: 10, minimumPayment: 10 },
    ], 200, "avalanche");
    expect(equalApr.order[0]!.id).toBe("b");

    const nullApr = planDebtPayoff([
      { id: "a", name: "A", balance: 100, apr: null, minimumPayment: 10 },
      { id: "b", name: "B", balance: 200, apr: null, minimumPayment: 10 },
    ], 200, "avalanche");
    expect(nullApr.order[0]!.id).toBe("a");

    const equalBalance = planDebtPayoff([
      { id: "a", name: "A", balance: 500, apr: 10, minimumPayment: 10 },
      { id: "b", name: "B", balance: 500, apr: 20, minimumPayment: 10 },
    ], 200, "snowball");
    expect(equalBalance.order[0]!.id).toBe("b");

    const snowballNullApr = planDebtPayoff([
      { id: "a", name: "A", balance: 100, apr: null, minimumPayment: null },
      { id: "b", name: "B", balance: 100, apr: null, minimumPayment: null },
    ], 100, "snowball");
    expect(snowballNullApr.order[0]!.id).toBe("a");
  });

  it("buildPlanningDepthView and suggestSinkingFunds cover no-debt and no-surplus paths", () => {
    const accounts = [{ name: "Checking", type: "depository", balance: 100 }];
    const view = buildPlanningDepthView({ accounts, monthlyIncome: 5000, monthlySpend: 4000, goals: [] });
    expect(view.surplus).toBe(1000);
    expect(view.debtPayoff).toBeNull();
    expect(view.sinkingFunds).toEqual([]);

    const withDebt = buildPlanningDepthView({
      accounts: [{ name: "Card", type: "credit", balance: -200, apr: 20, minimumPayment: 25 }],
      monthlyIncome: 5000,
      monthlySpend: 4000,
      goals: [],
    });
    expect(withDebt.debtPayoff).not.toBeNull();

    expect(suggestSinkingFunds({ monthlyIncome: 1000, monthlySpend: 2000, existingGoalPace: 0, goals: [] })).toEqual([]);
    const funds = suggestSinkingFunds({
      monthlyIncome: 1000,
      monthlySpend: 400,
      existingGoalPace: 100,
      goals: [
        { id: "g1", name: "Trip", targetAmount: 600, currentAmount: 0, monthsRemaining: 6 },
        { id: "g2", name: "Done", targetAmount: 100, currentAmount: 100, monthsRemaining: 1 },
      ],
    });
    expect(funds[0]!.monthlyContribution).toBe(100);
  });
});

describe("profile", () => {
  it("validates a null body and rejects non-string text fields", () => {
    expect(validateProfilePatch(null as never, "2026-07-30").ok).toBe(true);
    expect(validateProfilePatch(undefined as never, "2026-07-30").ok).toBe(true);
    const bad = validateProfilePatch({ fullName: 123 }, "2026-07-30");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain("must be a string");
  });
});

describe("transaction-quality", () => {
  it("detectRefundPairs and detectDuplicatePairs tolerate empty dates (parseDate fallback)", () => {
    const pairs = detectRefundPairs(
      [
        { id: "c", date: "", merchant: "Store", amount: 20 },
        { id: "r", date: "", merchant: "Store", amount: -20 },
      ],
      5,
    );
    expect(pairs).toHaveLength(1);

    const dups = detectDuplicatePairs(
      [
        { id: "d1", date: "", amount: 10, merchant: "Store", accountId: "a", plaidItemId: null, accountName: "A" },
        { id: "d2", date: "", amount: 10, merchant: "Store", accountId: "b", plaidItemId: null, accountName: "B" },
      ],
      [{ kind: "duplicate", subjectId: "d1:d2", decision: "dismissed" }],
    );
    expect(dups).toHaveLength(0);

    const dupPairs = detectDuplicatePairs([
      { id: "x", date: "2026-07-01", amount: 10, merchant: "Store", accountId: "a", plaidItemId: null, accountName: "A" },
      { id: "y", date: "2026-07-01", amount: 10, merchant: "Store", accountId: "b", plaidItemId: null, accountName: "B" },
    ], []);
    expect(dupPairs).toHaveLength(1);
  });

  it("validateSplits, aggregateSpendWithSplits, and filterReviewDecisions cover branches", () => {
    expect(validateSplits({ id: "t", amount: 100, category: null }, [
      { transactionId: "t", category: "A", amount: 60 },
      { transactionId: "t", category: "B", amount: 40 },
    ]).valid).toBe(true);

    const agg = aggregateSpendWithSplits(
      [
        { id: "t1", amount: 100, category: null },
        { id: "t2", amount: 50, category: "FOOD" },
      ],
      [{ transactionId: "t1", category: "A", amount: 100 }],
    );
    expect(agg).toEqual([{ category: "A", amount: 100 }, { category: "FOOD", amount: 50 }]);

    const kept = filterReviewDecisions(
      [
        { kind: "duplicate", subjectId: "x", message: "m" },
        { kind: "refund", subjectId: "y", message: "m" },
      ],
      [{ kind: "duplicate", subjectId: "x", decision: "dismissed" }],
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]!.kind).toBe("refund");
  });
});

describe("dashboard metrics", () => {
  it("computeNetWorth treats credit/loan as liabilities and null as zero", () => {
    expect(computeNetWorth([
      { type: "depository", current_balance: 100 },
      { type: "credit", current_balance: null },
      { type: "loan", current_balance: 30 },
      { type: null, current_balance: 200 },
    ])).toBe(270);
    expect(netWorthDeltaFromHistory(100, [{ month: "a", netWorth: 90 }])).toBeUndefined();
    expect(netWorthDeltaFromHistory(100, [{ month: "a", netWorth: 80 }, { month: "b", netWorth: 90 }])).toBe(20);
  });

  it("computeSavingsRate handles non-positive income and savings", () => {
    expect(computeSavingsRate(0, 10)).toBeNull();
    expect(computeSavingsRate(100, 150)).toBe(-50);
    expect(computeSavingsRate(100, 70)).toBe(30);
  });
});
