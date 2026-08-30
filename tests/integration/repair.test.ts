import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { POST } from "@/app/api/plaid/repair/route";
import { storeItem, getItem } from "@/lib/plaid-service";

// Sandbox-shape repair integration: a real disposable user + item in the
// shared project, with the Plaid client and auth mocked so the route's full
// DB path is exercised (bounded backfill, cursor health, ownership).

const mockTransactionsSync = vi.fn();
const mockItemGet = vi.fn();
vi.mock("@/lib/plaid", () => ({
  getPlaidClient: () => ({
    transactionsSync: mockTransactionsSync,
    itemGet: mockItemGet,
  }),
}));

vi.mock("@/lib/http", () => ({
  requireUser: () => authContext,
  badRequest: (msg: string) => NextResponse.json({ error: msg }, { status: 400 }),
  errorResponse: (_c: string, _e: unknown) =>
    NextResponse.json({ error: `repair failed: ${_c}: ${String((_e as Error)?.message ?? _e)}` }, { status: 500 }),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: () => Promise.resolve(true),
}));
vi.mock("@/lib/audit", async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    getClientIp: () => null,
  };
});

let authContext: { user: { id: string } } | NextResponse = {
  user: { id: "" },
};

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
const run = Boolean(url && secret);
const suite = run ? describe : describe.skip;

suite("repair route DB integration & mock Plaid", () => {
  if (!run) return;

  const admin = createClient(url!, secret!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const stamp = Date.now();
  let ownerId = "";
  let otherId = "";
  let itemDbId = "";
  const plaidItemId = `plaid-item-repair-${stamp}`;
  const plaidAccountId = `acct-repair-${stamp}`;
  const txnId = `txn-repair-${stamp}`;

  beforeAll(async () => {
    const { data: owner, error: ownerError } = await admin.auth.admin.createUser({
      email: `repair-owner-${stamp}@example.com`,
      password: "Password123!",
      email_confirm: true,
    });
    if (ownerError) throw ownerError;
    ownerId = owner.user.id;
    const { data: other, error: otherError } = await admin.auth.admin.createUser({
      email: `repair-other-${stamp}@example.com`,
      password: "Password123!",
      email_confirm: true,
    });
    if (otherError) throw otherError;
    otherId = other.user.id;

    itemDbId = await storeItem({
      userId: ownerId,
      plaidItemId,
      accessToken: "dummy-token",
      institutionId: "ins_repair",
      institutionName: "Repair Bank",
    });
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (ownerId) await admin.auth.admin.deleteUser(ownerId);
    if (otherId) await admin.auth.admin.deleteUser(otherId);
  });

  it("repairs a stale item with a bounded backfill, without duplicates", async () => {
    authContext = { user: { id: ownerId } };
    mockItemGet.mockResolvedValue({ data: { item: { item_id: plaidItemId } } });
    mockTransactionsSync.mockResolvedValue({
      data: {
        added: [
          {
            transaction_id: txnId,
            account_id: plaidAccountId,
            amount: 12.5,
            iso_currency_code: "USD",
            date: "2026-08-01",
            name: "Repair Merchant",
            merchant_name: "Repair",
            personal_finance_category: { primary: "SHOPS" },
            payment_channel: "in store",
            pending: false,
          },
        ],
        modified: [],
        removed: [],
        accounts: [
          {
            account_id: plaidAccountId,
            name: "Checking",
            balances: { current: 500 },
            type: "depository",
          },
        ],
        next_cursor: `repair-cursor-${stamp}`,
        has_more: false,
      },
    });

    const req = {
      json: () => Promise.resolve({ itemId: itemDbId }),
    } as unknown as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      status: "repaired",
      completed: true,
      added: 1,
    });

    // Idempotent: a second repair of the same item must not duplicate the row.
    const res2 = await POST(req);
    const body2 = await res2.json();
    expect(body2).toMatchObject({ ok: true, status: "repaired" });

    const { data: rows } = await admin
      .from("transactions")
      .select("id")
      .eq("plaid_transaction_id", txnId)
      .eq("user_id", ownerId);
    expect(rows).toHaveLength(1);

    const item = await getItem(ownerId, itemDbId);
    expect(item!.sync_cursor).toBe(`repair-cursor-${stamp}`);
    expect(item!.last_sync_success_at).toBeTruthy();
    expect(item!.last_sync_completed_pages).toBe(true);
  });

  it("rejects a repair attempt on another user's item", async () => {
    authContext = { user: { id: otherId } };
    const req = {
      json: () => Promise.resolve({ itemId: itemDbId }),
    } as unknown as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it("reports institution_login_required when the provider needs re-auth", async () => {
    authContext = { user: { id: ownerId } };
    mockItemGet.mockRejectedValue({
      response: { data: { error_code: "ITEM_LOGIN_REQUIRED" } },
    });
    const req = {
      json: () => Promise.resolve({ itemId: itemDbId }),
    } as unknown as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      status: "institution_login_required",
    });
    // The item must be flagged error so Settings offers a reconnect.
    const item = await getItem(ownerId, itemDbId);
    expect(item!.status).toBe("error");
  });
});