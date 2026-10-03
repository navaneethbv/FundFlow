import { beforeEach, describe, expect, it, vi } from "vitest";
import { clientStub } from "../fixtures/supabase-query";

const state = vi.hoisted(() => ({
  flags: new Set<string>(),
  dashboard: vi.fn(),
}));

vi.mock("@/lib/feature-flags", () => ({
  isFeatureEnabled: (flag: string) => state.flags.has(flag),
}));
vi.mock("@/lib/dashboard", () => ({
  getDashboardData: (...args: unknown[]) => state.dashboard(...args),
}));

import { loadPrivateLendingData } from "@/lib/private-lending-data";
import { loadExistingImportIds, trackImportCommitTransactions } from "@/lib/import-undo-tracking";
import { loadWeeklyReviewData } from "@/lib/weekly-review";

beforeEach(() => {
  state.flags.clear();
  state.dashboard.mockReset();
});

describe("private lending data loader", () => {
  it("loads owner-scoped loans, payments, balances, and summary", async () => {
    const client = clientStub({
      private_loans: {
        data: [
          { id: "loan-1", direction: "lent", counterparty: "Sam", principal: 100, annual_interest_rate: 0, start_date: "2026-01-01", due_date: null, notes: null, status: "active" },
          { id: "loan-2", direction: "borrowed", counterparty: "Lee", principal: 50, annual_interest_rate: 0, start_date: "2026-02-01", due_date: "2026-12-01", notes: "note", status: "active" },
        ],
      },
      private_loan_payments: { data: [{ id: "payment-1", loan_id: "loan-1", payment_date: "2026-01-02", amount: 25, note: "partial" }] },
    });
    const result = await loadPrivateLendingData(client as never, "owner-1", "2026-03-01");
    expect(result.loans[0]?.balance.totalOutstanding).toBe(75);
    expect(result.loans[0]?.payments[0]?.note).toBe("partial");
    expect(result.summary).toEqual({ receivable: 75, payable: 50, netWorthAdjustment: 25 });
    expect(client.scopedToUser("private_loans", "owner-1")).toBe(true);
    expect(client.scopedToUser("private_loan_payments", "owner-1")).toBe(true);
    expect(client.callsOn("private_loan_payments")).toContainEqual({ method: "in", args: ["loan_id", ["loan-1", "loan-2"]] });
  });

  it("skips payment reads when there are no loans and propagates query errors", async () => {
    const emptyClient = clientStub({ private_loans: { data: [] } });
    expect((await loadPrivateLendingData(emptyClient as never, "owner-1", "2026-03-01")).loans).toEqual([]);
    expect(emptyClient.callsOn("private_loan_payments")).toEqual([]);
    await expect(loadPrivateLendingData(clientStub({ private_loans: { error: new Error("loan read failed") } }) as never, "owner-1", "2026-03-01")).rejects.toThrow("loan read failed");
    await expect(loadPrivateLendingData(clientStub({ private_loans: { data: [{ id: "loan-1" }] }, private_loan_payments: { error: new Error("payment read failed") } }) as never, "owner-1", "2026-03-01")).rejects.toThrow("payment read failed");
  });
});

describe("import undo tracking", () => {
  it("records only newly created transaction provenance", async () => {
    const client = clientStub({
      transactions: { data: [{ id: "txn-old", plaid_transaction_id: "import-old" }, { id: "txn-new", plaid_transaction_id: "import-new" }] },
      record_import_commit_transactions: { data: null, error: null },
    });
    const rows = [
      { rowId: "row-old", plaid_transaction_id: "import-old" },
      { rowId: "row-new", plaid_transaction_id: "import-new" },
    ];
    const existing = await loadExistingImportIds(client as never, rows, "owner-1");
    expect(existing).toEqual(new Set(["import-old", "import-new"]));
    await trackImportCommitTransactions(client as never, rows, "batch-1", "owner-1", new Set(["import-old"]));
    expect(client.callsOnRpc("record_import_commit_transactions")).toHaveLength(1);
    expect(client.callsOnRpc("record_import_commit_transactions")[0]?.[0]).toEqual({
      p_user_id: "owner-1",
      p_batch_id: "batch-1",
      p_rows: [{ row_id: "row-new", transaction_id: "txn-new" }],
    });
  });

  it("tolerates legacy service stubs without select and propagates tracking errors", async () => {
    const legacyService = { from: () => ({}), rpc: vi.fn() };
    expect(await loadExistingImportIds(legacyService as never, [{ rowId: "row-1", plaid_transaction_id: "import-1" }], "owner-1")).toEqual(new Set());
    const failing = clientStub({ transactions: { error: new Error("tracking read failed") } });
    await expect(loadExistingImportIds(failing as never, [{ rowId: "row-1", plaid_transaction_id: "import-1" }], "owner-1")).rejects.toThrow("tracking read failed");
    const rpcFailure = clientStub({ transactions: { data: [{ id: "txn-1", plaid_transaction_id: "import-1" }] }, record_import_commit_transactions: { error: new Error("tracking write failed") } });
    await expect(trackImportCommitTransactions(rpcFailure as never, [{ rowId: "row-1", plaid_transaction_id: "import-1" }], "batch-1", "owner-1", new Set())).rejects.toThrow("tracking write failed");
  });
});

describe("weekly review data loader", () => {
  it("builds the five checks from owner-scoped dashboard and review data", async () => {
    state.flags.add("transactionReview");
    const freshSync = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const staleSync = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
    state.dashboard.mockResolvedValue({
      budgetEnvelopes: [{ monthlyLimit: 100, projectedSpend: 120 }, { monthlyLimit: 0, projectedSpend: 999 }],
      billPeriods: { weekly: [{ items: [{ itemType: "expense", nextDate: "2026-10-08" }, { itemType: "income", nextDate: "2026-10-08" }] }] },
      spendingAnomalies: [{ id: "anomaly-1" }],
    });
    const client = clientStub({
      plaid_items: { data: [
        { status: "active", last_sync_success_at: freshSync },
        { status: "active", last_sync_success_at: staleSync },
        { status: "inactive", last_sync_success_at: freshSync },
        { status: "active", last_sync_success_at: null },
      ] },
      transaction_review_ledger: { count: 2, data: null },
      notifications: { count: 1, data: null },
      weekly_review_streaks: { data: { last_completed_week: "2026-09-28", current_streak: 2 } },
    });
    const result = await loadWeeklyReviewData(client as never, "owner-1", "2026-10-07");
    expect(result.weekStart).toBe("2026-10-05");
    expect(result.streak).toBe(2);
    expect(result.completed).toBe(false);
    expect(result.steps.map((step) => step.count)).toEqual([3, 2, 1, 1, 1]);
    expect(result.steps.every((step) => step.complete)).toBe(false);
    expect(client.scopedToUser("plaid_items", "owner-1")).toBe(true);
    expect(client.scopedToUser("notifications", "owner-1")).toBe(true);
  });

  it("treats disabled review and empty checks as complete", async () => {
    const freshSync = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    state.dashboard.mockResolvedValue({ budgetEnvelopes: [], billPeriods: { weekly: [] }, spendingAnomalies: [] });
    const client = clientStub({
      plaid_items: { data: [{ status: "active", last_sync_success_at: freshSync }] },
      notifications: { count: 0, data: null },
      weekly_review_streaks: { data: { last_completed_week: "2026-10-05", current_streak: 3 } },
    });
    const result = await loadWeeklyReviewData(client as never, "owner-1", "2026-10-07");
    expect(result.completed).toBe(true);
    expect(result.steps.map((step) => step.count)).toEqual([0, null, 0, 0, 0]);
    expect(result.steps.every((step) => step.complete)).toBe(true);
  });

  it("propagates review query failures", async () => {
    state.dashboard.mockResolvedValue({ budgetEnvelopes: [], billPeriods: { weekly: [] }, spendingAnomalies: [] });
    const client = clientStub({
      plaid_items: { error: new Error("connection read failed") },
      notifications: { count: 0, data: null },
      weekly_review_streaks: { data: null },
    });
    await expect(loadWeeklyReviewData(client as never, "owner-1", "2026-10-07")).rejects.toThrow("connection read failed");
  });
});
