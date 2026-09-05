import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { clientStub } from "../fixtures/supabase-query";

const mockSyncAllForUser = vi.fn().mockResolvedValue({ added: 1, modified: 0, removed: 0 });
const mockSyncInvestmentsForUser = vi.fn().mockResolvedValue(0);
const mockSyncCreditCardLiabilitiesForUser = vi.fn().mockResolvedValue(0);
const mockRefreshRecurringForUser = vi.fn().mockResolvedValue(0);
const mockAlertCronFailure = vi.fn().mockResolvedValue(undefined);
const mockCreateServiceClient = vi.fn();

vi.mock("@/lib/env.server", () => ({
  serverEnv: {
    cronSecret: "test-cron-secret",
    backupEncKey: Buffer.from("12345678901234567890123456789012").toString("base64"),
  },
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => mockCreateServiceClient(),
}));

vi.mock("@/lib/sync", () => ({
  syncAllForUser: (...args: unknown[]) => mockSyncAllForUser(...args),
}));

vi.mock("@/lib/investment-sync", () => ({
  syncInvestmentsForUser: (...args: unknown[]) => mockSyncInvestmentsForUser(...args),
}));

vi.mock("@/lib/liabilities-sync", () => ({
  syncCreditCardLiabilitiesForUser: (...args: unknown[]) =>
    mockSyncCreditCardLiabilitiesForUser(...args),
}));

vi.mock("@/lib/recurring", () => ({
  refreshRecurringForUser: (...args: unknown[]) => mockRefreshRecurringForUser(...args),
}));

vi.mock("@/lib/net-worth", () => ({
  writeNetWorthSnapshot: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/liabilities", () => ({
  syncCardAprsForUser: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/integrity", () => ({
  runIntegrityChecks: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/notifications", () => ({
  processNotificationsForUser: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/reporting", () => ({
  sendDailyDigestEmail: vi.fn().mockResolvedValue(undefined),
  sendBackupEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/cron-alert", () => ({
  alertCronFailure: (...args: unknown[]) => mockAlertCronFailure(...args),
}));

vi.mock("@/lib/account-history", () => ({
  writeDailyAccountSnapshots: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/audit", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
  getClientIp: () => "127.0.0.1",
}));

import { GET as cronSyncGet } from "@/app/api/cron/sync/route";
import { GET as cronBackupGet } from "@/app/api/cron/backup/route";

describe("Cron API Route Handlers Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FUNDFLOW_FEATURE_FLAGS = "";
  });

  describe("GET /api/cron/sync", () => {
    it("returns 401 when authorization header is missing or incorrect", async () => {
      const req = new NextRequest("http://localhost/api/cron/sync");
      const res = await cronSyncGet(req);
      expect(res.status).toBe(401);
    });

    it("runs daily sync for active users when auth header matches", async () => {
      const db = clientStub({
        plaid_items: { data: [{ user_id: "user-1" }] },
        alert_preferences: { data: [] },
        notifications: { data: [] },
        profiles: { data: { locale: "en-US" } },
      });
      mockCreateServiceClient.mockReturnValue(db);

      const req = new NextRequest("http://localhost/api/cron/sync", {
        headers: { authorization: "Bearer test-cron-secret" },
      });
      const res = await cronSyncGet(req);
      expect(res.status).toBe(200);
      expect(mockSyncCreditCardLiabilitiesForUser).not.toHaveBeenCalled();
    });

    it("runs the billed liabilities call only when its flag is enabled", async () => {
      process.env.FUNDFLOW_FEATURE_FLAGS = "liabilitiesSync";
      const db = clientStub({
        plaid_items: { data: [{ user_id: "user-1" }] },
        alert_preferences: { data: [] },
        notifications: { data: [] },
        profiles: { data: { locale: "en-US" } },
      });
      mockCreateServiceClient.mockReturnValue(db);

      const req = new NextRequest("http://localhost/api/cron/sync", {
        headers: { authorization: "Bearer test-cron-secret" },
      });
      const res = await cronSyncGet(req);
      expect(res.status).toBe(200);
      expect(mockSyncCreditCardLiabilitiesForUser).toHaveBeenCalledWith("user-1");
    });
  });

  describe("GET /api/cron/backup", () => {
    it("returns 401 when authorization header is invalid", async () => {
      const req = new NextRequest("http://localhost/api/cron/backup");
      const res = await cronBackupGet(req);
      expect(res.status).toBe(401);
    });

    it("creates backup archive and sends email for users", async () => {
      const db = {
        ...clientStub({
          profiles: { data: [{ id: "user-1" }] },
          accounts: { data: [{ id: "acc-1", name: "Checking" }] },
          transactions: { data: [] },
          budgets: { data: [] },
          goals: { data: [] },
          merchant_rules: { data: [] },
          manual_accounts: { data: [] },
          account_balance_snapshots: { data: [] },
          budget_periods: { data: [] },
          saved_reports: { data: [] },
          holdings: { data: [] },
          holding_snapshots: { data: [] },
          securities: { data: [] },
          investment_transactions: { data: [] },
        }),
        auth: {
          admin: {
            getUserById: async () => ({
              data: { user: { email: "user@example.com" } },
              error: null,
            }),
          },
        },
      };
      mockCreateServiceClient.mockReturnValue(db);

      const req = new NextRequest("http://localhost/api/cron/backup", {
        headers: { authorization: "Bearer test-cron-secret" },
      });
      const res = await cronBackupGet(req);
      expect(res.status).toBe(200);
    });

    it("skips backup when user email is not found", async () => {
      const db = {
        ...clientStub({
          profiles: { data: [{ id: "user-no-email" }] },
        }),
        auth: {
          admin: {
            getUserById: async () => ({
              data: { user: null },
              error: null,
            }),
          },
        },
      };
      mockCreateServiceClient.mockReturnValue(db);

      const req = new NextRequest("http://localhost/api/cron/backup", {
        headers: { authorization: "Bearer test-cron-secret" },
      });
      const res = await cronBackupGet(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.sent).toBe(0);
    });

    it("catches errors per user and alerts cron failure", async () => {
      const db = {
        ...clientStub({
          profiles: { data: [{ id: "user-err" }] },
          accounts: { error: new Error("Accounts query error") },
        }),
        auth: {
          admin: {
            getUserById: async () => ({
              data: { user: { email: "user@example.com" } },
              error: null,
            }),
          },
        },
      };
      mockCreateServiceClient.mockReturnValue(db);

      const req = new NextRequest("http://localhost/api/cron/backup", {
        headers: { authorization: "Bearer test-cron-secret" },
      });
      const res = await cronBackupGet(req);
      expect(res.status).toBe(500);
      expect(mockAlertCronFailure).toHaveBeenCalledWith("backup", expect.objectContaining({ failed: 1 }));
    });

    it("returns 500 and alerts when the profiles query crashes the run", async () => {
      const db = {
        ...clientStub({
          profiles: { data: null, error: { message: "profiles select failed" } },
        }),
        auth: {
          admin: {
            getUserById: async () => ({
              data: { user: { email: "user@example.com" } },
              error: null,
            }),
          },
        },
      };
      mockCreateServiceClient.mockReturnValue(db);

      const req = new NextRequest("http://localhost/api/cron/backup", {
        headers: { authorization: "Bearer test-cron-secret" },
      });
      const res = await cronBackupGet(req);
      expect(res.status).toBe(500);
      expect(mockAlertCronFailure).toHaveBeenCalledWith(
        "backup",
        expect.objectContaining({ failed: 1, total: 1, firstError: "run_crashed" }),
      );
    });
  });
});
