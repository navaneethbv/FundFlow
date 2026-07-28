import { describe, it, expect, vi, beforeEach } from "vitest";
import { clientStub } from "../fixtures/supabase-query";

const mockRequireUser = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  badRequest: (msg: unknown) =>
    Response.json({ error: String(msg) }, { status: 400 }),
  errorResponse: (_context: unknown, error: unknown) => {
    throw error;
  },
}));

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
      accounts: { data: [{ id: "acc-1" }, { id: "acc-2" }, { id: "acc-3" }], error: null },
      transactions: { error: null },
    });

    const res = await demoPost();
    const payload = (await res.json()) as { ok: boolean; transactions: number };

    expect(res.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.transactions).toBeGreaterThan(0);
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
      accounts: { data: [{ id: "a" }, { id: "b" }, { id: "c" }], error: null },
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
    });

    const res = await backupGet(cronRequest());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, users: 1, sent: 1 });
    expect(mockBuildBackupArchive).toHaveBeenCalledWith(
      expect.objectContaining({ backup_version: 1 }),
      "backup-key",
    );
    expect(mockSendBackupEmail).toHaveBeenCalledWith(
      "user@example.com",
      expect.stringMatching(/^fundflow-backup-.*\.json\.enc$/),
      "ENCRYPTED",
      expect.any(String),
    );
    expect(serviceClient.scopedToUser("transactions", USER)).toBe(true);
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

    // The run still reports success; the failure is surfaced via the alert.
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ sent: 0 });
    expect(mockAlertCronFailure).toHaveBeenCalledWith(
      "backup",
      expect.objectContaining({ failed: 1, total: 1 }),
    );
  });
});
