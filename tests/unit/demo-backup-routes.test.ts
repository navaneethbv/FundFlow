import { describe, it, expect, vi, beforeEach } from "vitest";
import { clientStub } from "../fixtures/supabase-query";

const mockRequireUser = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/http")>();
  return {
    ...actual,
    requireUser: () => mockRequireUser(),
    badRequest: (msg: unknown) =>
      Response.json({ error: String(msg) }, { status: 400 }),
    errorResponse: (_context: unknown, error: unknown) => {
      throw error;
    },
  };
});

const mockWriteAudit = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
  getClientIp: () => "127.0.0.1",
}));

const mockInvalidate = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/dashboard-cache", () => ({
  invalidateDashboardCache: (...args: unknown[]) => mockInvalidate(...args),
}));

const mockSendBackupEmail = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/reporting", () => ({
  sendBackupEmail: (...args: unknown[]) => mockSendBackupEmail(...args),
}));

const mockAlertCronFailure = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/cron-alert", () => ({
  alertCronFailure: (...args: unknown[]) => mockAlertCronFailure(...args),
}));

const mockBuildBackupArchive = vi.fn<(...args: unknown[]) => unknown>(
  () => "ENCRYPTED",
);
vi.mock("@/lib/backup", () => ({
  buildBackupArchive: (...args: unknown[]) => mockBuildBackupArchive(...args),
}));

vi.mock("@/lib/log", () => ({ logError: vi.fn() }));

// vi.mock factories are hoisted, so the mutable env object has to be too.
const { env } = vi.hoisted(() => ({
  env: { cronSecret: "cron-secret", backupEncKey: "backup-key" },
}));
vi.mock("@/lib/env.server", () => ({ serverEnv: env }));

vi.mock("@/lib/crypto", () => ({
  safeEqual: (a: string, b: string) => a === b,
}));

let serviceClient: ReturnType<typeof buildServiceClient>;
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => serviceClient,
}));

import { POST as demoPost, DELETE as demoDelete } from "@/app/api/demo/route";
import { GET as backupGet } from "@/app/api/cron/backup/route";
import { countUserDataRows, countUserRecordRows } from "@/lib/user-data";
import { NextResponse, NextRequest } from "next/server";

const USER = "user-1";

/** Service client stub with the auth.admin surface the backup cron uses. */
function buildServiceClient(
  seeds: Record<string, { data?: unknown; error?: unknown }> = {},
  email: string | null = "user@example.com",
) {
  const base = clientStub(seeds);
  return Object.assign(base, {
    auth: {
      admin: {
        getUserById: vi.fn(async () => ({
          data: email ? { user: { email } } : { user: null },
        })),
      },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  env.cronSecret = "cron-secret";
  env.backupEncKey = "backup-key";
  serviceClient = buildServiceClient();
});

describe("POST /api/demo", () => {
  it("returns the auth response when not signed in", async () => {
    mockRequireUser.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const res = await demoPost();
    expect(res.status).toBe(401);
  });

  it("409s rather than mixing demo data into a real connection", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER },
      supabase: clientStub({
        plaid_items: { data: [{ plaid_item_id: "real-item-123" }] },
      }),
    });

    const res = await demoPost();

    expect(res.status).toBe(409);
    expect(serviceClient.callsOn("transactions")).toHaveLength(0);
  });

  it("loads the dataset when only prior demo items exist", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER },
      supabase: clientStub({ plaid_items: { data: [{ plaid_item_id: "demo-1" }] } }),
    });
    serviceClient = buildServiceClient({
      plaid_items: { data: { id: "item-1" }, error: null },
      accounts: { data: [{ id: "acc-1" }, { id: "acc-2" }], error: null },
      account_balance_snapshots: { error: null },
      transactions: { error: null },
    });

    const res = await demoPost();
    const payload = (await res.json()) as { ok: boolean; transactions: number };

    expect(res.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.transactions).toBeGreaterThan(0);
    expect(serviceClient.writtenTo("account_balance_snapshots")).toEqual([
      expect.objectContaining({
        user_id: USER,
        account_id: "acc-1",
        manual_account_id: null,
        snapshot_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        current_balance: 4820.55,
        iso_currency_code: "USD",
      }),
      expect.objectContaining({
        user_id: USER,
        account_id: "acc-2",
        manual_account_id: null,
        snapshot_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        current_balance: 1240.3,
        iso_currency_code: "USD",
      }),
    ]);
    expect(mockInvalidate).toHaveBeenCalledWith(USER);
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "demo_data_loaded" }),
    );
  });

  it("clears prior demo rows first, scoped to the caller and the demo prefix", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER },
      supabase: clientStub({ plaid_items: { data: [] } }),
    });
    serviceClient = buildServiceClient({
      plaid_items: { data: { id: "item-1" }, error: null },
      accounts: { data: [{ id: "a" }, { id: "b" }], error: null },
      transactions: { error: null },
    });

    await demoPost();

    const calls = serviceClient.callsOn("plaid_items");
    expect(calls.some(({ method }) => method === "delete")).toBe(true);
    expect(
      calls.some(({ method, args }) => method === "like" && args[1] === "demo-%"),
    ).toBe(true);
    expect(serviceClient.scopedToUser("plaid_items", USER)).toBe(true);
  });

  it("clears demo data on DELETE, scoped to the caller and the demo prefix", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: USER } });
    serviceClient = buildServiceClient({ plaid_items: { error: null } });

    const res = await demoDelete();

    expect(res.status).toBe(200);
    const calls = serviceClient.callsOn("plaid_items");
    expect(calls.some(({ method }) => method === "delete")).toBe(true);
    expect(
      calls.some(({ method, args }) => method === "like" && args[1] === "demo-%"),
    ).toBe(true);
    expect(serviceClient.scopedToUser("plaid_items", USER)).toBe(true);
    expect(mockInvalidate).toHaveBeenCalledWith(USER);
  });
});

describe("GET /api/cron/backup", () => {
  function cronRequest(secret = "cron-secret") {
    return new NextRequest("http://localhost/api/cron/backup", {
      headers: { authorization: `Bearer ${secret}` },
    });
  }

  it("401s a request without the cron secret", async () => {
    const res = await backupGet(cronRequest("wrong"));
    expect(res.status).toBe(401);
    expect(mockSendBackupEmail).not.toHaveBeenCalled();
  });

  it("fails closed and alerts when BACKUP_ENC_KEY is missing", async () => {
    env.backupEncKey = "";

    const res = await backupGet(cronRequest());

    expect(res.status).toBe(500);
    expect(mockSendBackupEmail).not.toHaveBeenCalled();
    expect(mockAlertCronFailure).toHaveBeenCalledWith(
      "backup",
      expect.objectContaining({
        firstError: expect.stringContaining("BACKUP_ENC_KEY"),
      }),
    );
  });

  it("emails an encrypted archive per user with transactions", async () => {
    serviceClient = buildServiceClient({
      profiles: { data: [{ id: USER }], error: null },
      transactions: { data: [{ date: "2026-07-01", amount: 10 }] },
      accounts: { data: [] },
      budgets: { data: [] },
      goals: { data: [] },
      merchant_rules: { data: [] },
      manual_accounts: { data: [] },
      account_balance_snapshots: {
        data: [
          {
            snapshot_date: "2026-07-29",
            current_balance: 100,
            available_balance: 80,
            iso_currency_code: "USD",
          },
        ],
      },
    });

    const res = await backupGet(cronRequest());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, users: 1, sent: 1 });
    expect(mockBuildBackupArchive).toHaveBeenCalledWith(
      expect.objectContaining({
        backup_version: 1,
        account_balance_snapshots: [
          expect.objectContaining({
            snapshot_date: "2026-07-29",
            current_balance: 100,
          }),
        ],
      }),
      "backup-key",
      USER,
    );
    expect(mockSendBackupEmail).toHaveBeenCalledWith(
      "user@example.com",
      expect.stringMatching(/^fundflow-backup-.*\.json\.enc$/),
      "ENCRYPTED",
      expect.any(String),
    );
    expect(serviceClient.scopedToUser("transactions", USER)).toBe(true);
    expect(
      serviceClient.scopedToUser("account_balance_snapshots", USER),
    ).toBe(true);
  });

  it("skips a user with no transactions instead of mailing an empty archive", async () => {
    serviceClient = buildServiceClient({
      profiles: { data: [{ id: USER }], error: null },
      transactions: { data: [] },
      accounts: { data: [] },
      budgets: { data: [] },
      goals: { data: [] },
      merchant_rules: { data: [] },
      manual_accounts: { data: [] },
    });

    const res = await backupGet(cronRequest());

    await expect(res.json()).resolves.toMatchObject({ sent: 0 });
    expect(mockSendBackupEmail).not.toHaveBeenCalled();
  });

  it("backs up balance history even when the user has no transactions", async () => {
    serviceClient = buildServiceClient({
      profiles: { data: [{ id: USER }], error: null },
      transactions: { data: [] },
      accounts: { data: [] },
      budgets: { data: [] },
      goals: { data: [] },
      merchant_rules: { data: [] },
      manual_accounts: { data: [] },
      account_balance_snapshots: {
        data: [
          {
            account_id: "account-1",
            manual_account_id: null,
            snapshot_date: "2026-07-29",
            current_balance: 100,
            available_balance: null,
            iso_currency_code: "USD",
          },
        ],
      },
    });

    const res = await backupGet(cronRequest());

    await expect(res.json()).resolves.toMatchObject({ sent: 1 });
    expect(mockSendBackupEmail).toHaveBeenCalledOnce();
  });

  it("does not email a partial archive when budget history fails", async () => {
    serviceClient = buildServiceClient({
      profiles: { data: [{ id: USER }], error: null },
      transactions: { data: [{ date: "2026-07-01", amount: 10 }] },
      accounts: { data: [] },
      budgets: { data: [] },
      goals: { data: [] },
      merchant_rules: { data: [] },
      manual_accounts: { data: [] },
      account_balance_snapshots: { data: [] },
      budget_periods: {
        data: null,
        error: { code: "42501", message: "permission denied" },
      },
    });

    const res = await backupGet(cronRequest());

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ ok: false, sent: 0, failed: 1 });
    expect(mockBuildBackupArchive).not.toHaveBeenCalled();
    expect(mockSendBackupEmail).not.toHaveBeenCalled();
    expect(mockAlertCronFailure).toHaveBeenCalledWith(
      "backup",
      expect.objectContaining({ failed: 1, total: 1 }),
    );
  });

  it("skips a user whose email cannot be resolved", async () => {
    serviceClient = buildServiceClient(
      {
        profiles: { data: [{ id: USER }], error: null },
        transactions: { data: [{ date: "2026-07-01", amount: 10 }] },
        accounts: { data: [] },
        budgets: { data: [] },
        goals: { data: [] },
        merchant_rules: { data: [] },
        manual_accounts: { data: [] },
      },
      null,
    );

    const res = await backupGet(cronRequest());

    await expect(res.json()).resolves.toMatchObject({ sent: 0 });
    expect(mockSendBackupEmail).not.toHaveBeenCalled();
  });

  it("reports zero users when the profiles query returns no rows", async () => {
    serviceClient = buildServiceClient({
      profiles: { data: null, error: null },
    });

    const res = await backupGet(cronRequest());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, users: 0, sent: 0 });
    expect(mockSendBackupEmail).not.toHaveBeenCalled();
  });

  it("isolates a per-user failure and alerts once for the run", async () => {
    serviceClient = buildServiceClient({
      profiles: { data: [{ id: USER }], error: null },
      transactions: { data: [{ date: "2026-07-01", amount: 10 }] },
      accounts: { data: [] },
      budgets: { data: [] },
      goals: { data: [] },
      merchant_rules: { data: [] },
      manual_accounts: { data: [] },
    });
    mockSendBackupEmail.mockRejectedValueOnce(new Error("smtp down"));

    const res = await backupGet(cronRequest());

    // FF-10: Failures report non-200 so backup automation does not mask missing backups.
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toMatchObject({ ok: false, sent: 0, failed: 1 });
    expect(mockAlertCronFailure).toHaveBeenCalledWith(
      "backup",
      expect.objectContaining({ failed: 1, total: 1 }),
    );
  });

  it("returns 207 when some users succeed and others fail", async () => {
    serviceClient = buildServiceClient({
      profiles: { data: [{ id: "user-ok" }, { id: "user-fail" }], error: null },
      transactions: { data: [{ date: "2026-07-01", amount: 10 }] },
      accounts: { data: [] },
      budgets: { data: [] },
      goals: { data: [] },
      merchant_rules: { data: [] },
      manual_accounts: { data: [] },
    });
    // First user succeeds, second user fails
    mockSendBackupEmail.mockResolvedValueOnce(undefined);
    mockSendBackupEmail.mockRejectedValueOnce(new Error("smtp failure"));

    const res = await backupGet(cronRequest());
    expect(res.status).toBe(207);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.sent).toBe(1);
    expect(body.failed).toBe(1);
  });

  it("skips users who have already received a backup in the current month", async () => {
    serviceClient = buildServiceClient({
      profiles: { data: [{ id: "user-already-sent" }], error: null },
      audit_logs: {
        data: [{ user_id: "user-already-sent", action: "data_backup" }],
        error: null,
      },
      transactions: { data: [{ date: "2026-07-01", amount: 10 }] },
      accounts: { data: [] },
      budgets: { data: [] },
      goals: { data: [] },
      merchant_rules: { data: [] },
      manual_accounts: { data: [] },
    });

    const res = await backupGet(cronRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sent).toBe(0);
    expect(body.skipped).toBe(1);
    expect(mockSendBackupEmail).not.toHaveBeenCalled();
  });

  it("accurately counts user data rows and separates financial records from preferences", () => {
    const sections = {
      transactions: [{ id: "t1" }, { id: "t2" }],
      accounts: [{ id: "a1" }],
      alert_preferences: [{ id: "p1" }],
      ai_settings: [{ enabled: true }],
    };
    expect(countUserDataRows(sections)).toBe(5);
    expect(countUserRecordRows(sections)).toBe(3);
    expect(countUserRecordRows({})).toBe(0);
  });
});
