import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaidItemRow } from "@/lib/types";
const mocks = vi.hoisted(() => ({ sync: vi.fn(), from: vi.fn(), batch: vi.fn(), write: vi.fn() }));
vi.mock("@/lib/plaid", () => ({ getPlaidClient: () => ({ transactionsSync: mocks.sync }) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({ from: mocks.from, rpc: vi.fn().mockResolvedValue({ data: true }) }) }));
vi.mock("@/lib/plaid-service", () => ({ decryptItemTokenAndUpgrade: vi.fn(), upsertAccounts: vi.fn(), getAccountIdMap: async () => new Map([["a", "db-a"]]), clearItemRepairCursor: vi.fn(), completeItemCursor: vi.fn(), updateItemRepairCursor: vi.fn(), setItemStatus: vi.fn(), listActiveItems: vi.fn() }));
vi.mock("@/lib/cursor-health", () => ({ recordCursorAttempt: async () => {}, recordCursorSuccess: async () => {}, recordCursorPartialSuccess: async () => {}, recordCursorFailure: async () => {} }));
vi.mock("@/lib/dashboard-cache", () => ({ invalidateDashboardCache: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn().mockResolvedValue(null), createNotificationsBatch: mocks.batch }));
import { syncItemTransactions } from "@/lib/sync";
const item = { id: "i", user_id: "u", sync_cursor: "cursor" } as PlaidItemRow;
const transaction = (id: string, overrides = {}) => ({ account_id: "a", transaction_id: id, amount: 600, merchant_name: "Shop", date: "2026-09-30", ...overrides });
function page(rows: unknown[]) {
  mocks.sync.mockResolvedValue({ data: { added: rows, modified: [], removed: [], accounts: [], next_cursor: "next", has_more: false } });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-01T01:00:00Z"));
  mocks.write.mockResolvedValue({ error: null });
  mocks.batch.mockResolvedValue([]);
  mocks.from.mockImplementation((table: string) => {
    const data = table === "profiles" ? { timezone: "America/Los_Angeles" } : table === "alert_preferences" ? { large_transaction: true, large_transaction_threshold: 500 } : [{ merchant: "Shop", created_at: "2026-09-29T01:00:00Z" }];
    const chain = { select: vi.fn(() => chain), eq: vi.fn(() => chain), maybeSingle: async () => ({ data, error: null }), then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve), upsert: mocks.write };
    return chain;
  });
});
afterEach(() => vi.useRealTimers());
describe("transaction alert eligibility", () => {
  it("keeps a cursorless 50-row historical backfill silent", async () => {
    page(Array.from({ length: 50 }, (_, n) => transaction(String(n), { date: "2025-01-01" })));
    await syncItemTransactions({ ...item, sync_cursor: null });
    expect(mocks.batch).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalledWith("alert_preferences");
  });
  it("batches recent alerts, using the pending purchase identity after posting", async () => {
    page([transaction("posted", { pending_transaction_id: "pending", authorized_date: "2026-09-27" }), transaction("old", { date: "2025-01-01" }), transaction("future", { date: "2026-10-02" })]);
    await syncItemTransactions(item);
    expect(mocks.write.mock.calls[0][0][0].pending_transaction_id).toBe("pending");
    expect(mocks.batch).toHaveBeenCalledTimes(1);
    const candidates = mocks.batch.mock.calls[0][1];
    expect(candidates.filter((c: { type: string }) => c.type === "large_transaction")).toEqual([expect.objectContaining({ subjectKey: "pending" })]);
    expect(candidates.some((c: { type: string; subjectKey: string }) => c.type === "cancellation_watch" && c.subjectKey === "posted")).toBe(false);
  });
  it("warns only for posted charges authorized after cancellation", async () => {
    page([transaction("before", { authorized_date: "2026-09-27" }), transaction("pending", { pending: true }), transaction("after")]);
    await syncItemTransactions(item);
    const candidates = mocks.batch.mock.calls[0][1];
    expect(candidates.filter((c: { type: string }) => c.type === "cancellation_watch")).toEqual([expect.objectContaining({ subjectKey: "after" })]);
  });
});
