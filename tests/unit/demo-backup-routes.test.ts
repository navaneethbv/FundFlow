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

/**
 * Stand-in for `public.backup_deliveries`, the FF-10 delivery journal.
 *
 * The shared table stub resolves every query on a table with one seeded value,
 * but the claim protocol asks three different questions of this table (insert
 * the claim, read who holds it, mark it delivered), so this answers each op
 * separately.
 */
interface JournalBehaviour {
  /** Rows the claiming upsert returns; [] means someone else already holds it. */
  claim?: unknown[];
  /** The existing row a losing claimant reads back. */
  existing?: Record<string, unknown> | null;
  /** Rows the stale-claim takeover update returns. */
  reclaim?: unknown[];
  /** Error the completion update reports, if any. */
  updateError?: { message: string } | null;
}

function journalStub(behaviour: JournalBehaviour) {
  const ops: Array<{ method: string; args: unknown[] }> = [];
  const builder: Record<string, unknown> = {
    ops,
    then: (resolve: (value: unknown) => unknown) => {
      const first = ops[0]?.method;
      if (first === "upsert") return resolve({ data: behaviour.claim ?? [], error: null });
      if (first === "select") return resolve({ data: behaviour.existing ?? null, error: null });
      if (first === "update") {
        const values = ops[0].args[0] as Record<string, unknown>;
        return resolve({
          data: "claimed_at" in values ? behaviour.reclaim ?? [] : [{ user_id: USER }],
          error: "delivered_at" in values ? behaviour.updateError ?? null : null,
        });
      }
      return resolve({ data: null, error: null });
    },
  };
  for (const method of [
    "select", "insert", "update", "upsert", "delete", "eq", "is", "lt", "maybeSingle",
  ]) {
    builder[method] = (...args: unknown[]) => {
      ops.push({ method, args });
      return builder;
    };
  }
  return builder;
}

/** Every op recorded against the delivery journal across the whole run. */
type JournalLog = Array<{ method: string; args: unknown[] }>;

function withDeliveryJournal<T extends { from: (table: string) => unknown }>(
  client: T,
  behaviour: JournalBehaviour,
): { client: T; journal: JournalLog } {
  const journal: JournalLog = [];
  const inner = client.from.bind(client);
  client.from = ((table: string) => {
    if (table !== "backup_deliveries") return inner(table);
    const stub = journalStub(behaviour);
    return new Proxy(stub, {
      get(target, prop) {
        const value = Reflect.get(target, prop);
        if (typeof value === "function" && prop !== "then") {
          return (...args: unknown[]) => {
            journal.push({ method: String(prop), args });
            return (value as (...a: unknown[]) => unknown)(...args);
          };
        }
        return value;
      },
    });
  }) as T["from"];
  return { client, journal };
}

/** Service client stub with the auth.admin surface the backup cron uses. */
function buildServiceClient(
  seeds: Record<string, { data?: unknown; error?: unknown }> = {},
  email: string | null = "user@example.com",
  journal: JournalBehaviour = { claim: [{ user_id: USER }] },
) {
  const base = clientStub(seeds);
  const { journal: journalLog } = withDeliveryJournal(base, journal);
  return Object.assign(base, {
    journalLog,
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
        backup_version: 2,
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

  const populatedSeeds = {
    profiles: { data: [{ id: "user-already-sent" }], error: null },
    transactions: { data: [{ date: "2026-07-01", amount: 10 }] },
    accounts: { data: [] },
    budgets: { data: [] },
    goals: { data: [] },
    merchant_rules: { data: [] },
    manual_accounts: { data: [] },
  };

  it("skips a user whose backup for the period is already recorded as delivered (FF-10)", async () => {
    // Arrange: the claim insert conflicts, and the row that holds it is done.
    serviceClient = buildServiceClient(populatedSeeds, "user@example.com", {
      claim: [],
      existing: { delivered_at: "2026-07-02T00:00:00Z", claimed_at: "2026-07-02T00:00:00Z" },
    });

    const res = await backupGet(cronRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sent).toBe(0);
    expect(body.skipped).toBe(1);
    expect(mockSendBackupEmail).not.toHaveBeenCalled();
  });

  it("stands aside for a claim another worker is still holding (FF-10)", async () => {
    // Arrange: the claim conflicts and the holder is recent, so not stale.
    serviceClient = buildServiceClient(populatedSeeds, "user@example.com", {
      claim: [],
      existing: { delivered_at: null, claimed_at: new Date().toISOString() },
    });

    const res = await backupGet(cronRequest());

    const body = await res.json();
    expect(body.skipped).toBe(1);
    expect(mockSendBackupEmail).not.toHaveBeenCalled();
  });

  it("does not resend an uncertain delivery even after its claim expires", async () => {
    serviceClient = buildServiceClient(populatedSeeds, "user@example.com", {
      claim: [],
      existing: { delivered_at: null, send_started_at: "2026-01-01T00:00:00Z", claimed_at: "2026-01-01T00:00:00Z" },
      reclaim: [{ user_id: USER }],
    });
    const res = await backupGet(cronRequest());
    expect(res.status).toBe(500);
    expect((await res.json()).failures[0].error).toBe("BackupDeliveryUncertainError");
    expect(mockSendBackupEmail).not.toHaveBeenCalled();
    expect(serviceClient.journalLog.some((op) => op.method === "delete")).toBe(false);
  });

  it("takes over a stale undelivered claim so a crashed run does not lose the month (FF-10)", async () => {
    // Arrange: the holder claimed hours ago and never delivered.
    serviceClient = buildServiceClient(populatedSeeds, "user@example.com", {
      claim: [],
      existing: {
        delivered_at: null,
        claimed_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      },
      reclaim: [{ user_id: "user-already-sent" }],
    });

    const res = await backupGet(cronRequest());

    const body = await res.json();
    expect(body.sent).toBe(1);
    expect(mockSendBackupEmail).toHaveBeenCalledTimes(1);
  });

  it("fails the user rather than reporting a send whose completion marker was rejected (FF-10)", async () => {
    // Arrange: the email goes out, but the delivered_at write errors.
    serviceClient = buildServiceClient(populatedSeeds, "user@example.com", {
      claim: [{ user_id: "user-already-sent" }],
      updateError: { message: "write rejected" },
    });

    const res = await backupGet(cronRequest());

    // An accepted email with a failed completion marker must retain its claim.
    expect(serviceClient.journalLog.some((op) => op.method === "delete")).toBe(false);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.failed).toBe(1);
  });

  it("fails the run when the claim insert itself errors (FF-10)", async () => {
    // The journal is the dedup mechanism, so a claim that cannot be written
    // must stop the backup, not fall through to sending one anyway.
    serviceClient = buildServiceClient(populatedSeeds, "user@example.com", {
      claim: [],
      existing: null,
    });
    const original = serviceClient.from.bind(serviceClient);
    serviceClient.from = ((table: string) =>
      table === "backup_deliveries"
        ? {
            upsert: () => ({
              select: () => ({
                then: (resolve: (value: unknown) => unknown) =>
                  resolve({ data: null, error: { message: "journal unavailable" } }),
              }),
            }),
          }
        : original(table)) as typeof serviceClient.from;

    const res = await backupGet(cronRequest());

    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.failed).toBe(1);
    expect(mockSendBackupEmail).not.toHaveBeenCalled();
  });

  it("stands aside when a losing claimant finds no row at all (FF-10)", async () => {
    // The holder's row vanished between the conflict and the read; without a
    // claimed_at there is nothing to judge stale, so do not take it over.
    serviceClient = buildServiceClient(populatedSeeds, "user@example.com", {
      claim: [],
      existing: null,
    });

    const res = await backupGet(cronRequest());

    const body = await res.json();
    expect(body.skipped).toBe(1);
    expect(mockSendBackupEmail).not.toHaveBeenCalled();
  });

  it("stands aside when the stale-claim takeover loses the race (FF-10)", async () => {
    serviceClient = buildServiceClient(populatedSeeds, "user@example.com", {
      claim: [],
      existing: {
        delivered_at: null,
        claimed_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      },
      reclaim: [],
    });

    const res = await backupGet(cronRequest());

    const body = await res.json();
    expect(body.skipped).toBe(1);
    expect(mockSendBackupEmail).not.toHaveBeenCalled();
  });

  it("releases the claim for a user with nothing worth archiving (FF-10)", async () => {
    // No records and no email: drop the claim so a later run reconsiders once
    // the account has data, instead of burning the period.
    serviceClient = buildServiceClient(
      { profiles: { data: [{ id: "empty-user" }], error: null } },
      null,
    );

    const res = await backupGet(cronRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sent).toBe(0);
    // The claim was taken and then handed back.
    expect(serviceClient.journalLog.some(({ method }) => method === "upsert")).toBe(true);
    expect(serviceClient.journalLog.some(({ method }) => method === "delete")).toBe(true);
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
