import { describe, expect, it, vi } from "vitest";
import {
  toGoalSummaryItem,
  toLegacyGoalSummaryItem,
} from "@/lib/goal-summary";
import {
  buildWeeklyDeliveryHistory,
  loadLatestWeeklyDelivery,
} from "@/lib/weekly-delivery-history";
import { buildCreditCardBucket } from "@/lib/recurring-credit-bill";
import {
  detectDuplicatePairs,
  duplicateSubjectId,
  filterReviewDecisions,
  detectRefundPairs,
  type DuplicateTransaction,
} from "@/lib/transaction-quality";
import {
  repairMessage,
  repairResponseToUiState,
  runItemRepair,
} from "@/lib/repair";
import { buildWeeklyReportModel } from "@/lib/weekly-report";
import { stripTrailingAccountMask } from "@/lib/account-label";
import { syncCardAprsForUser } from "@/lib/liabilities";

describe("Coverage Boost for High Target Coverage (>95%)", () => {
  it("covers toLegacyGoalSummaryItem and toGoalSummaryItem branches", () => {
    const legacyCompleted = toLegacyGoalSummaryItem({
      id: "g1",
      name: "Vacation",
      target_amount: 1000,
      saved_amount: 1200,
      target_date: "2026-12-31",
    });
    expect(legacyCompleted.complete).toBe(true);
    expect(legacyCompleted.remainingAmount).toBe(0);
    expect(legacyCompleted.progressPct).toBe(100);

    const legacyInProgress = toLegacyGoalSummaryItem({
      id: "g2",
      name: "Car",
      target_amount: 5000,
      saved_amount: 1000,
      target_date: null,
    });
    expect(legacyInProgress.complete).toBe(false);
    expect(legacyInProgress.remainingAmount).toBe(4000);
    expect(legacyInProgress.monthlyPace).toBeNull();

    const summaryItemBadge = toGoalSummaryItem({
      id: "g3",
      name: "House",
      target_amount: 1000,
      saved_amount: 0,
      target_date: null,
      goal_type: "save_up",
      image_slug: null,
      monthly_contribution: null,
      spending_reduces: false,
      starting_balance: null,
      target_balance: null,
      funded_amount: 500,
      remainingAmount: 500,
      progressPct: 50,
      est_monthly: 100,
      badge: "completed",
      allocatedFromAccounts: 0,
      eventTotal: 0,
      linkedAccountBalance: 0,
      trailingMonthlyPace: 0,
    });
    expect(summaryItemBadge.complete).toBe(true);
  });

  it("covers humanizeReason branches in weekly-delivery-history", async () => {
    const rows = [
      { period_start: "2026-08-03", period_end: "2026-08-09", status: "sent", error_code: null, attempted_at: "2026-08-10T08:00:00Z", sent_at: "2026-08-10T08:01:00Z" },
      { period_start: "2026-07-27", period_end: "2026-08-02", status: "missing", error_code: null },
      { period_start: "2026-07-20", period_end: "2026-07-26", status: "skipped", error_code: null },
      { period_start: "2026-07-13", period_end: "2026-07-19", status: "failed", error_code: null },
      { period_start: "2026-07-06", period_end: "2026-07-12", status: "processing", error_code: null },
      { period_start: "2026-06-29", period_end: "2026-07-05", status: "skipped", error_code: "disabled" },
      { period_start: "2026-06-22", period_end: "2026-06-28", status: "skipped", error_code: "no_data" },
      { period_start: "2026-06-15", period_end: "2026-06-21", status: "failed", error_code: "smtp_error" },
      { period_start: "2026-06-08", period_end: "2026-06-14", status: "failed", error_code: "email_delivery_failed" },
      { period_start: "2026-06-01", period_end: "2026-06-07", status: "failed", error_code: "missing_account_email" },
      { period_start: "2026-05-25", period_end: "2026-05-31", status: "failed", error_code: "recipient_undeliverable" },
      { period_start: "2026-05-18", period_end: "2026-05-24", status: "failed", error_code: "pdf_generation_failed" },
      { period_start: "2026-05-11", period_end: "2026-05-17", status: "failed", error_code: "pdf_render_failed" },
      { period_start: "2026-05-04", period_end: "2026-05-10", status: "skipped", error_code: "unknown_code" },
      { period_start: "2026-04-27", period_end: "2026-05-03", status: "failed", error_code: "unknown_code" },
    ];

    const history = buildWeeklyDeliveryHistory(rows, new Date("2026-08-10T12:00:00Z"), "UTC", 15);
    expect(history).toHaveLength(15);
    expect(history[0]?.reason).toBeNull();
    expect(history[1]?.reason).toBe("No run recorded");
    expect(history[2]?.reason).toBe("Skipped");
    expect(history[3]?.reason).toBe("Delivery failed");
    expect(history[4]?.reason).toBeNull();
    expect(history[5]?.reason).toBe("Weekly reports disabled");
    expect(history[6]?.reason).toBe("No transaction activity");
    expect(history[7]?.reason).toBe("Email delivery service issue");
    expect(history[8]?.reason).toBe("Email delivery service issue");
    expect(history[9]?.reason).toBe("The report could not resolve its recipient");
    expect(history[10]?.reason).toBe("The recipient address cannot receive reports");
    expect(history[11]?.reason).toBe("Report summary generation issue");
    expect(history[12]?.reason).toBe("Report summary generation issue");
    expect(history[13]?.reason).toBe("Report skipped");
    expect(history[14]?.reason).toBe("Delivery failed");

    // scheduled vs missing when no stored rows (Monday 6 AM UTC is not due yet)
    const emptyHistoryNotDue = buildWeeklyDeliveryHistory([], new Date("2026-08-10T06:00:00Z"), "UTC", 2);
    expect(emptyHistoryNotDue[0]?.status).toBe("scheduled");
    expect(emptyHistoryNotDue[0]?.reason).toBe("Scheduled for 8:00 AM");

    // loadLatestWeeklyDelivery tests
    const maybeSingleMock = vi.fn().mockResolvedValue({
      data: {
        period_start: "2026-08-03",
        period_end: "2026-08-09",
        status: "sent",
        attempted_at: "2026-08-10T08:00:00Z",
        sent_at: "2026-08-10T08:01:00Z",
      },
      error: null,
    });

    const mockQueryBuilder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: maybeSingleMock,
    };

    const mockSupabase = {
      from: vi.fn().mockReturnValue(mockQueryBuilder),
    } as unknown as import("@supabase/supabase-js").SupabaseClient;

    const latest = await loadLatestWeeklyDelivery(mockSupabase, "u1");
    expect(latest?.status).toBe("sent");

    // null row
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: null });
    const nullLatest = await loadLatestWeeklyDelivery(mockSupabase, "u1");
    expect(nullLatest).toBeNull();

    // error throw
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: new Error("DB fail") });
    await expect(loadLatestWeeklyDelivery(mockSupabase, "u1")).rejects.toThrow("DB fail");
  });

  it("covers recurring-credit-bill edge cases", () => {
    const bucket = buildCreditCardBucket(
      [
        { accountId: "a1", statementBalance: null, minimumPayment: null, dueDate: null },
        { accountId: "a2", statementBalance: 0, minimumPayment: 0, dueDate: "2026-08-15" },
        { accountId: "a3", statementBalance: 150.555, minimumPayment: 25, dueDate: "2026-09-15" },
        { accountId: "a4", statementBalance: 200.222, minimumPayment: 35, dueDate: "2026-08-20" },
        { accountId: "a5", statementBalance: 50, minimumPayment: 10, dueDate: null },
      ],
      "2026-08",
    );
    expect(bucket.paid).toBe(0);
    expect(bucket.remaining).toBe(200.22);
  });

  it("covers transaction-quality tie-breakers and duplicate candidates", () => {
    // Refund matching with same-day multiple refunds test tie-breaker:
    // a.date.localeCompare(b.date) || a.id.localeCompare(b.id)
    const refunds = detectRefundPairs(
      [
        { id: "c1", amount: 50, merchant: "Target", date: "2026-08-01" },
        { id: "r1", amount: -50, merchant: "Target", date: "2026-08-02" },
        { id: "r2", amount: -50, merchant: "Target", date: "2026-08-02" },
        { id: "r3", amount: -50, merchant: "Target", date: "2026-08-03" },
      ],
      5,
    );
    expect(refunds).toHaveLength(1);
    expect(refunds[0]?.chargeId).toBe("c1");

    // duplicateCandidate branches
    const txA: DuplicateTransaction = {
      id: "t1",
      accountId: "acc1",
      amount: 100,
      merchant: "Store",
      date: "2026-08-01",
      plaidItemId: "p1",
      accountName: "Account 1",
    };
    const txB: DuplicateTransaction = {
      id: "t2",
      accountId: "acc1", // same account -> null
      amount: 100,
      merchant: "Store",
      date: "2026-08-01",
      plaidItemId: "p1",
      accountName: "Account 1",
    };
    const txC: DuplicateTransaction = {
      id: "t3",
      accountId: "acc2",
      amount: 105, // different amount -> null
      merchant: "Store",
      date: "2026-08-01",
      plaidItemId: "p2",
      accountName: "Account 2",
    };
    const txD: DuplicateTransaction = {
      id: "t4",
      accountId: "acc2",
      amount: 100,
      merchant: "Different Store", // different merchant -> null
      date: "2026-08-01",
      plaidItemId: "p2",
      accountName: "Account 2",
    };
    const txE: DuplicateTransaction = {
      id: "t5",
      accountId: "acc2",
      amount: 100,
      merchant: "Store",
      date: "2026-08-10", // date diff > 2 -> null
      plaidItemId: "p2",
      accountName: "Account 2",
    };
    const txF: DuplicateTransaction = {
      id: "t6",
      accountId: "acc2",
      amount: 100,
      merchant: "Store",
      date: "2026-08-02", // match
      plaidItemId: "p2",
      accountName: "Account 2",
    };

    expect(detectDuplicatePairs([txA, txB, txC, txD, txE, txF], [])).toHaveLength(1);

    // duplicate sorting tie-breakers
    const first1: DuplicateTransaction = { id: "1", accountId: "a", amount: 10, merchant: "A", date: "2026-08-01", plaidItemId: null, accountName: "A" };
    const second1: DuplicateTransaction = { id: "2", accountId: "b", amount: 10, merchant: "A", date: "2026-08-01", plaidItemId: null, accountName: "B" };
    const first2: DuplicateTransaction = { id: "3", accountId: "a", amount: 20, merchant: "A", date: "2026-08-01", plaidItemId: null, accountName: "A" };
    const second2: DuplicateTransaction = { id: "4", accountId: "b", amount: 20, merchant: "A", date: "2026-08-01", plaidItemId: null, accountName: "B" };
    const pairs = detectDuplicatePairs([first1, second1, first2, second2], []);
    expect(pairs).toHaveLength(2);

    expect(duplicateSubjectId("b", "a")).toBe("a:b");

    const filtered = filterReviewDecisions(
      [
        { kind: "duplicate", subjectId: "a:b", message: "dup 1" },
        { kind: "duplicate", subjectId: "c:d", message: "dup 2" },
      ],
      [{ kind: "duplicate", subjectId: "a:b", decision: "dismissed" }],
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.subjectId).toBe("c:d");
  });

  it("covers repair.ts fallback and edge cases", async () => {
    expect(repairMessage("generic_failure" as unknown as Parameters<typeof repairMessage>[0])).toBe("The repair could not be completed. Try again.");

    const errState = repairResponseToUiState({
      ok: false,
      status: "unknown_error",
      message: "Custom error",
    });
    expect(errState.kind).toBe("error");
    expect(errState.message).toBe("Custom error");

    // test runItemRepair with simulated fetch error
    const globalFetch = globalThis.fetch;
    try {
      globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error("Network down"));
      const state = await runItemRepair("item_123");
      expect(state.kind).toBe("error");
      expect(state.retry).toBe(true);
    } finally {
      globalThis.fetch = globalFetch;
    }
  });

  it("covers weekly-report.ts sorting and empty spend branches", () => {
    const reportZeroSpend = buildWeeklyReportModel({
      userId: "u1",
      userEmail: "u@example.com",
      period: {
        start: "2026-08-01",
        end: "2026-08-07",
        previousStart: "2026-07-25",
        previousEnd: "2026-07-31",
        kind: "weekly",
      },
      accounts: [
        { id: "a1", name: "Credit 1", type: "credit", plaidItemId: "p1" },
        { id: "a2", name: "Checking 1", type: "depository", plaidItemId: "p2" },
      ],
      institutions: [
        { id: "p1", name: "Bank A" },
        { id: "p2", name: null },
      ],
      transactions: [
        { id: "t1", accountId: "a1", amount: 0, date: "2026-08-02", category: "Dining", name: "Cafe", merchantName: null },
      ],
      merchantRules: [],
      splits: [],
      linkedRefundTransactionIds: new Set(),
      duplicateTransactionIds: new Set(),
      budgets: [
        { category: "Dining", monthlyLimit: 0 },
        { category: "Groceries", monthlyLimit: 500 },
      ],
    });
    expect(reportZeroSpend.totalSpend).toBe(0);
    expect(reportZeroSpend.categories.every((c) => c.share === 0)).toBe(true);
    expect(reportZeroSpend.cards).toHaveLength(0);
  });

  it("covers stripTrailingAccountMask and liabilities edge cases", async () => {
    expect(stripTrailingAccountMask("Amex 1234", "xX •*")).toBe("Amex");
    expect(stripTrailingAccountMask("Freedom Flex 1234", "xX •*")).toBe("Freedom Flex");
    expect(stripTrailingAccountMask("1234", "xX •*")).toBe("");

    const aprsDisabled = await syncCardAprsForUser("user_1");
    expect(aprsDisabled).toBe(0);
  });
});
