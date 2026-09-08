import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { clientStub } from "../fixtures/supabase-query";
const calls = vi.hoisted(() => ({ bank: vi.fn(), promote: vi.fn(), snapshots: vi.fn(), recurring: vi.fn(), notify: vi.fn(), alert: vi.fn() }));
let service = clientStub();
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => service }));
vi.mock("@/lib/env.server", () => ({ serverEnv: { cronSecret: "test" } }));
vi.mock("@/lib/sync", () => ({ syncAllForUser: calls.bank }));
vi.mock("@/lib/scheduled-promotion", () => ({ promoteDueScheduledTransactions: calls.promote }));
vi.mock("@/lib/plaid-service", () => ({ rotateStaleItemTokens: async () => undefined }));
vi.mock("@/lib/feature-flags", () => ({ isFeatureEnabled: () => false }));
vi.mock("@/lib/recurring", () => ({ refreshRecurringForUser: calls.recurring }));
vi.mock("@/lib/account-history", () => ({ writeDailyAccountSnapshots: calls.snapshots }));
vi.mock("@/lib/net-worth", () => ({ writeNetWorthSnapshot: async () => undefined }));
vi.mock("@/lib/liabilities", () => ({ syncCardAprsForUser: async () => undefined }));
vi.mock("@/lib/notifications", () => ({ processNotificationsForUser: calls.notify }));
vi.mock("@/lib/cron-alert", () => ({ alertCronFailure: calls.alert }));
import { GET } from "@/app/api/cron/sync/route";
const run = () => GET(new NextRequest("http://localhost/api/cron/sync", { headers: { authorization: "Bearer test" } }));
beforeEach(() => {
  vi.clearAllMocks(); calls.bank.mockResolvedValue(undefined); calls.promote.mockResolvedValue({ promoted: 1, failed: null });
  service = clientStub({ profiles: { data: [{ id: "manual" }] } });
});
describe("daily maintenance without bank connections", () => {
  it("promotes scheduled entries before snapshots and forecasts for manual-only users", async () => {
    const result = await run(); expect(result.status).toBe(200); expect(await result.json()).toMatchObject({ users: 1, synced: 1 });
    expect(calls.bank).not.toHaveBeenCalled();
    expect(calls.promote).toHaveBeenCalledWith(service, expect.any(String), "manual");
    expect(calls.snapshots).toHaveBeenCalledWith("manual", expect.any(String)); expect(calls.recurring).toHaveBeenCalledWith("manual", expect.any(String));
    expect(calls.promote.mock.invocationCallOrder[0]).toBeLessThan(calls.snapshots.mock.invocationCallOrder[0]);
  });
  it.each(["database error with private details", ""])("reports a returned promotion failure and continues other maintenance: %j", async (failed) => {
    calls.promote.mockResolvedValue({ promoted: 0, failed });
    const response = await run(); expect(response.status).toBe(207);
    expect(await response.json()).toMatchObject({ ok: false, synced: 0, failures: ["cron.sync.scheduled-promotion: SCHEDULED_PROMOTION_FAILED"] });
    expect(calls.notify).toHaveBeenCalledWith("manual", expect.any(String));
    expect(calls.alert).toHaveBeenCalledWith("daily-sync", expect.objectContaining({ firstError: "cron.sync.scheduled-promotion: SCHEDULED_PROMOTION_FAILED" }));
  });
  it("continues maintenance when a user's bank sync fails", async () => {
    service = clientStub({ profiles: { data: [{ id: "bank" }] }, plaid_items: { data: [{ user_id: "bank" }] } });
    calls.bank.mockRejectedValue(new Error("ITEM_LOGIN_REQUIRED"));
    const response = await run(); expect(response.status).toBe(207);
    expect(calls.promote).toHaveBeenCalledWith(service, expect.any(String), "bank"); expect(calls.notify).toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ failures: ["ITEM_LOGIN_REQUIRED"] });
  });
});
