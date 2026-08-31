import { describe, expect, it, vi } from "vitest";
import {
  detectRecurringCandidates,
  normalizeRecurringMerchant,
  recurringIdentityKey,
  RECURRING_DETECTION_VERSION,
} from "@/lib/recurring-detection";
import {
  refreshRecurringForUser,
} from "@/lib/recurring";
import {
  buildAccountReconciliation,
  loadInstitutionObservability,
} from "@/lib/sync-health";
import { repairResponseToUiState, repairMessage } from "@/lib/repair";
import {
  loadInvestmentTransactions,
  loadInvestmentSyncStatus,
} from "@/lib/investments-data";
import { buildInvestmentAccountCoverage } from "@/lib/investments";
import { syncCreditCardLiabilitiesForUser } from "@/lib/liabilities-sync";
import { inferDateOrder } from "@/lib/import";
import { parseMonarchGoals } from "@/lib/goal-import";
import { buildWeeklyReportModel } from "@/lib/weekly-report";
import { parseLifeEvent } from "@/lib/life-events";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("Coverage Boost: Recurring Detection Branches", () => {
  it("covers recurringIdentityKey overloads and normalizations", () => {
    const key1 = recurringIdentityKey(
      "user-1",
      "acct-1",
      "outflow",
      "Netflix™",
      "MONTHLY",
    );
    const key2 = recurringIdentityKey({
      userId: "user-1",
      accountId: "acct-1",
      streamType: "outflow",
      merchant: "Netflix™",
      frequency: "MONTHLY",
    });
    expect(key1).toBe(key2);
    expect(key1.startsWith(`recurring-v${RECURRING_DETECTION_VERSION}:`)).toBe(true);

    expect(normalizeRecurringMerchant("Acme Store™ ®")).toContain("ACME STORE");
    expect(normalizeRecurringMerchant("Card # 123456789 XXXXXX1234")).not.toContain("123456789");
    expect(normalizeRecurringMerchant("2026-08-01 Ref# 99887766")).not.toContain("99887766");
  });

  it("detects weekly and monthly candidates across boundary cadences", () => {
    // 8 weekly transactions in a 56 day window
    const baseDate = new Date("2026-06-01T00:00:00Z");
    const transactions = Array.from({ length: 8 }, (_, i) => {
      const d = new Date(baseDate.getTime() + i * 7 * 86400000);
      const iso = d.toISOString().slice(0, 10);
      return {
        id: `tx-weekly-${i}`,
        userId: "u1",
        plaidItemId: "item-1",
        accountId: "a1",
        postedDate: iso,
        authorizedDate: iso,
        amount: 25.0,
        flow: "expense" as const,
        merchant: "Weekly Coffee Club",
        rawName: "Weekly Coffee Club AUTOPAY",
        category: "UTILITY",
        detailedCategory: "UTILITIES",
        paymentChannel: "online",
        currency: "USD",
      };
    });

    const candidates = detectRecurringCandidates(transactions, "2026-07-25");
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    expect(candidates[0]!.frequency).toBe("WEEKLY");
  });

  it("covers variable pattern with even transaction count and 2.5x median threshold", () => {
    // 4 transactions (even count) with variable amounts: 10, 12, 14, 16 -> median is (12+14)/2 = 13
    const dates = ["2026-04-01", "2026-05-01", "2026-06-01", "2026-07-01"];
    const txsEven = dates.map((d, i) => ({
      id: `even-tx-${i}`,
      userId: "u1",
      plaidItemId: "item-1",
      accountId: "a1",
      postedDate: d,
      authorizedDate: d,
      amount: [10, 12, 14, 16][i]!,
      flow: "expense" as const,
      merchant: "City Power",
      rawName: "City Power Electric",
      category: "UTILITY",
      detailedCategory: "ELECTRIC",
      paymentChannel: "online",
      currency: "USD",
    }));

    const result = detectRecurringCandidates(txsEven, "2026-07-05");
    expect(result.length).toBe(1);
    expect(result[0]!.amountPattern).toBe("variable");
    expect(result[0]!.expectedAmount).toBe(13);

    // If one transaction exceeds median * 2.5 (13 * 2.5 = 32.5), variable pattern is rejected
    const txsOutlier = dates.map((d, i) => ({
      ...txsEven[i]!,
      id: `outlier-tx-${i}`,
      amount: [10, 12, 14, 40][i]!,
    }));
    const rejected = detectRecurringCandidates(txsOutlier, "2026-07-05");
    expect(rejected.length).toBe(0);
  });

  it("handles candidate category fallbacks and description fallbacks", () => {
    const dates = ["2026-05-01", "2026-06-01", "2026-07-01"];
    const txs = dates.map((d, i) => ({
      id: `fb-tx-${i}`,
      userId: "u1",
      plaidItemId: "item-1",
      accountId: "a1",
      postedDate: d,
      authorizedDate: d,
      amount: 15,
      flow: "income" as const,
      merchant: "",
      rawName: "Salary Transfer SUB",
      category: i === 0 ? "INCOME" : null,
      detailedCategory: null,
      paymentChannel: "online",
      currency: "USD",
    }));

    const result = detectRecurringCandidates(txs, "2026-07-05");
    expect(result.length).toBe(1);
    expect(result[0]!.streamType).toBe("inflow");
    expect(result[0]!.category).toBe("INCOME");
  });

  it("rejects invalid dates, negative amounts, and in-store channels for variable items", () => {
    expect(detectRecurringCandidates([], "invalid-date")).toEqual([]);

    const badTxs = [
      {
        id: "tx-bad-1",
        userId: "u1",
        plaidItemId: "item-1",
        accountId: "a1",
        postedDate: "2026-05-01",
        authorizedDate: null,
        amount: -50,
        flow: "expense" as const,
        merchant: "Store",
        rawName: "Store",
        category: null,
        detailedCategory: null,
        paymentChannel: "in store",
        currency: "USD",
      },
    ];
    expect(detectRecurringCandidates(badTxs, "2026-06-01")).toEqual([]);
  });
});

describe("Coverage Boost: Recurring Inference & Lifecycle", () => {
  it("covers refreshRecurringForUser item-level catch blocks", async () => {
    const res = await refreshRecurringForUser("00000000-0000-0000-0000-000000000000");
    expect(res.plaid).toBe(0);
    expect(res.inferred.failed).toBe(0);
  });
});

describe("Coverage Boost: Sync Health & Reconciliations", () => {
  it("derives all account reconciliation states", () => {
    const baseAccount = {
      id: "a1",
      plaidItemId: "i1",
      name: "Checking",
      mask: "1234",
      currentBalance: 500,
      type: "depository",
      subtype: "checking",
      updatedAt: "2026-08-01T00:00:00Z",
    };

    // missing_balance
    const r1 = buildAccountReconciliation({
      account: { ...baseAccount, currentBalance: null },
      anchor: null,
      coverage: null,
      historyComplete: false,
      transactionTotalCents: 0,
    });
    expect(r1.state).toBe("missing_balance");

    // missing_anchor
    const r2 = buildAccountReconciliation({
      account: baseAccount,
      anchor: null,
      coverage: null,
      historyComplete: true,
      transactionTotalCents: 0,
    });
    expect(r2.state).toBe("missing_anchor");

    // incomplete_history
    const r3 = buildAccountReconciliation({
      account: baseAccount,
      anchor: { snapshotDate: "2026-07-01", currentBalance: 500 },
      coverage: { oldest: "2026-07-01", newest: "2026-08-01" },
      historyComplete: false,
      transactionTotalCents: 0,
    });
    expect(r3.state).toBe("incomplete_history");

    // balanced depository (direction = -1)
    const r4 = buildAccountReconciliation({
      account: baseAccount,
      anchor: { snapshotDate: "2026-07-01", currentBalance: 500 },
      coverage: { oldest: "2026-07-01", newest: "2026-08-01" },
      historyComplete: true,
      transactionTotalCents: 0,
    });
    expect(r4.state).toBe("balanced");
    expect(r4.difference).toBe(0);

    // balanced credit liability (direction = 1)
    const r5 = buildAccountReconciliation({
      account: { ...baseAccount, type: "credit", subtype: "credit card", currentBalance: 300 },
      anchor: { snapshotDate: "2026-07-01", currentBalance: 200 },
      coverage: { oldest: "2026-07-01", newest: "2026-08-01" },
      historyComplete: true,
      transactionTotalCents: 10000,
    });
    expect(r5.state).toBe("balanced");
    expect(r5.difference).toBe(0);
  });

  it("handles PGRST202 error in loadInstitutionObservability migration window", async () => {
    function createQueryBuilder(data: any = []) {
      const q: any = {};
      q.select = vi.fn(() => q);
      q.eq = vi.fn(() => q);
      q.order = vi.fn(() => q);
      q.limit = vi.fn(() => q);
      q.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }));
      q.range = vi.fn(() => Promise.resolve({ data, error: null }));
      return q;
    }

    const supabase = {
      from: vi.fn(() => createQueryBuilder([])),
      rpc: vi.fn().mockReturnValue({
        range: vi.fn().mockResolvedValue({ data: null, error: { code: "PGRST202" } }),
      }),
    } as unknown as SupabaseClient;

    const obs = await loadInstitutionObservability(supabase, "u1", [
      {
        id: "i1",
        user_id: "u1",
        plaid_item_id: "pi-1",
        institution_name: "Test Bank",
        status: "good",
        error_code: null,
        created_at: "2026-01-01",
        last_sync_completed_pages: true,
        last_sync_attempt_at: "2026-08-01T00:00:00Z",
        last_sync_success_at: "2026-08-01T00:00:00Z",
        initial_history_incomplete: false,
        cursor_reset_detected_at: null,
      },
    ]);
    expect(obs.reconciliations).toEqual([]);
    expect(obs.institutions.length).toBe(1);
  });
});

describe("Coverage Boost: Repair and Investments", () => {
  it("classifies rate_limited and backfill_incomplete repair responses", () => {
    const rateLimited = repairResponseToUiState({
      ok: false,
      status: "rate_limited",
      message: "Please wait",
    });
    expect(rateLimited.kind).toBe("rate_limited");
    expect(rateLimited.message).toBe("Please wait");

    const backfill = repairResponseToUiState({
      ok: true,
      status: "backfill_incomplete",
      pagesCompleted: 3,
      maxPages: 10,
    });
    expect(backfill.kind).toBe("backfill_incomplete");
    expect(backfill.message).toContain("3 of 10 pages");

    expect(repairMessage("unknown" as any)).toBe("The repair could not be completed. Try again.");
  });

  it("calculates investment coverage accounts with and without holdings", () => {
    const coverage = buildInvestmentAccountCoverage(
      [
        { id: "a1", name: "Brokerage 1", mask: "1111", balance: 5000, type: "investment", subtype: "brokerage", institutionName: "Bank" },
        { id: "a2", name: "Brokerage 2", mask: "2222", balance: 3000, type: "investment", subtype: "brokerage", institutionName: "Bank" },
      ],
      [
        {
          id: "h1",
          accountId: "a1",
          securityId: "s1",
          quantity: 10,
          value: 5050.25,
          costBasis: 5000,
          currency: "USD",
          price: 505.025,
          name: "Stock A",
          tickerSymbol: "STKA",
          type: "equity",
          closePrice: null,
          closePriceAsOf: null,
          isCashEquivalent: false,
          isActive: true,
          accountName: "Brokerage 1",
          source: "plaid",
        },
      ],
    );
    expect(coverage.total).toBe(8050.25);
    expect(coverage.accounts.length).toBe(2);
    expect(coverage.accountsWithoutHoldings).toBe(1);
  });

  it("loads investment transactions and sync status", async () => {
    function createQueryBuilder(data: any = []) {
      const q: any = {};
      q.select = vi.fn(() => q);
      q.eq = vi.fn(() => q);
      q.order = vi.fn(() => q);
      q.limit = vi.fn(() => q);
      q.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }));
      q.range = vi.fn(() => Promise.resolve({ data, error: null }));
      return q;
    }

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "investment_transactions") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({
                  data: [{ date: "2026-08-01", amount: 100, txn_subtype: "buy" }],
                  error: null,
                }),
              }),
            }),
          };
        }
        return createQueryBuilder([]);
      }),
    } as unknown as SupabaseClient;

    const txs = await loadInvestmentTransactions(supabase);
    expect(txs.length).toBe(1);
    expect(txs[0]!.txnSubtype).toBe("buy");

    const status = await loadInvestmentSyncStatus(supabase, "u1");
    expect(Array.isArray(status)).toBe(true);
  });

  it("handles liabilities sync errors gracefully", async () => {
    const count = await syncCreditCardLiabilitiesForUser("00000000-0000-0000-0000-000000000000");
    expect(count).toBe(0);
  });
});

describe("Coverage Boost: Import, Weekly Report & Life Events", () => {
  it("infers date orders and detects conflicts", () => {
    expect(inferDateOrder(["2026-08-01", "2026-08-02"])).toBe("ymd");
    expect(inferDateOrder(["13/01/2026", "14/01/2026"])).toBe("dmy");
    expect(inferDateOrder(["01/13/2026", "02/14/2026"])).toBe("mdy");
    expect(inferDateOrder(["2026-08-01", "13/01/2026"])).toBe(null); // conflict
    expect(inferDateOrder(["01/02/2026"])).toBe(null); // ambiguous returns null
  });

  it("builds weekly report with cash flow classifications and depository flows", () => {
    const report = buildWeeklyReportModel({
      userId: "u1",
      userEmail: "test@example.com",
      period: { start: "2026-08-01", end: "2026-08-07" },
      accounts: [{ id: "acct-1", name: "Checking", type: "depository", plaidItemId: "p1" }],
      transactions: [
        {
          id: "t1",
          date: "2026-08-03",
          amount: -1500,
          merchantName: "Employer",
          name: "Direct Deposit",
          category: "INCOME",
          accountId: "acct-1",
          displayCategory: null,
          cashFlowClassification: "income",
        },
        {
          id: "t2",
          date: "2026-08-04",
          amount: 50,
          merchantName: "Grocery",
          name: "Market",
          category: "FOOD",
          accountId: "acct-1",
          displayCategory: null,
          cashFlowClassification: "expense",
        },
      ],
      institutions: [{ id: "p1", name: "Main Bank" }],
      budgets: [{ category: "FOOD", monthlyLimit: 500 }],
      merchantRules: [],
      splits: [],
      linkedRefundTransactionIds: new Set(),
      duplicateTransactionIds: new Set(),
    });

    expect(report.cashFlow.inflows).toBe(1500);
    expect(report.cashFlow.outflows).toBe(50);
  });

  it("validates life event payloads and errors", () => {
    expect(parseLifeEvent(null).ok).toBe(false);
    expect(parseLifeEvent("not an object").ok).toBe(false);
    expect(parseLifeEvent({ type: "invalid" }).ok).toBe(false);
    expect(parseLifeEvent({ type: "retirement", startMonth: -1 }).ok).toBe(false);
    expect(parseLifeEvent({ type: "retirement", startMonth: 12, amount: 500 }).ok).toBe(false);
    expect(parseLifeEvent({ type: "home_purchase", startMonth: 12, amount: 0 }).ok).toBe(false);
    expect(
      parseLifeEvent({
        type: "home_purchase",
        startMonth: 12,
        amount: 500000,
        durationMonths: -5,
      }).ok,
    ).toBe(false);
    expect(
      parseLifeEvent({
        type: "home_purchase",
        startMonth: 12,
        amount: 500000,
        durationMonths: 12,
      }).ok,
    ).toBe(false);
  });
});

describe("Coverage Boost: Goals and Goal Import Branches", () => {
  it("covers parseMonarchGoals error branches and duplicate IDs", () => {
    expect(parseMonarchGoals("invalid json").errors.length).toBeGreaterThan(0);
    expect(parseMonarchGoals("{}").errors).toContain("The goals file has no goals to import.");
    expect(parseMonarchGoals(JSON.stringify({ goals: [] })).rows).toEqual([]);
    
    const validAndDuplicate = JSON.stringify({
      goals: [
        { id: "g1", name: "Emergency Fund", type: "save_up", target_amount: 10000 },
        { id: "g1", name: "Duplicate ID", type: "save_up", target_amount: 5000 },
        { id: "g3", name: "", type: "save_up" }, // empty name skipped
      ],
    });
    const res = parseMonarchGoals(validAndDuplicate);
    expect(res.rows.length).toBe(1);
    expect(res.errors.length).toBe(2);
  });
});

