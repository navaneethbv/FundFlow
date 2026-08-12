import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { clientStub } from "../fixtures/supabase-query";

const mockRequireUser = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  badRequest: (message: string) => NextResponse.json({ error: message }, { status: 400 }),
  errorResponse: (_context: string, error: unknown) =>
    NextResponse.json({ error: error instanceof Error ? error.message : "error" }, { status: 500 }),
}));

const mockWriteAudit = vi.fn();
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
  getClientIp: () => "127.0.0.1",
}));

let service = makeService();
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => service }));

import { GET, POST } from "@/app/api/transactions/duplicates/route";
import { DELETE } from "@/app/api/transactions/duplicates/[subjectId]/route";

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FIRST_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_ID = "22222222-2222-4222-8222-222222222222";
const SUBJECT = `${FIRST_ID}:${SECOND_ID}`;

function makeService(seeds: Record<string, { data?: unknown; error?: unknown }> = {}) {
  const db = clientStub(seeds);
  return {
    ...db,
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
}

function request(method: string, body?: unknown) {
  return new NextRequest("http://localhost/api/transactions/duplicates", {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function ownedClient(overrides: Record<string, { data?: unknown; error?: unknown }> = {}) {
  return clientStub({
    transactions: {
      data: [
        { id: FIRST_ID, date: "2026-08-01", merchant_name: "Cafe", name: "CAFE", amount: 20, account_id: "account-1" },
        { id: SECOND_ID, date: "2026-08-02", merchant_name: "Cafe", name: "CAFE", amount: 20, account_id: "account-2" },
      ],
    },
    accounts: {
      data: [
        { id: "account-1", name: "Card A", plaid_item_id: "item-1" },
        { id: "account-2", name: "Card B", plaid_item_id: "item-2" },
      ],
    },
    transaction_review_decisions: { data: [] },
    linked_duplicates: { data: [] },
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  service = makeService();
  mockRequireUser.mockResolvedValue({ user: { id: USER_ID }, supabase: ownedClient() });
});

describe("GET /api/transactions/duplicates", () => {
  it("returns the auth response when not signed in", async () => {
    mockRequireUser.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    const response = await GET();
    expect(response.status).toBe(401);
  });

  it("returns empty pairs when account and transaction data are missing", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER_ID },
      supabase: clientStub({
        transactions: { data: null, error: null },
        accounts: { data: null, error: null },
        transaction_review_decisions: { data: null, error: null },
        linked_duplicates: { data: null, error: null },
      }),
    });
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ pairs: [], confirmed: [] });
  });

  it("falls back to placeholders when account and merchant details are sparse", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER_ID },
      supabase: clientStub({
        transactions: {
          data: [
            { id: FIRST_ID, date: "2026-08-01", merchant_name: null, name: null, amount: 20, account_id: "no-such-account-1" },
            { id: SECOND_ID, date: "2026-08-02", merchant_name: null, name: null, amount: 20, account_id: "no-such-account-2" },
          ],
        },
        accounts: {
          data: [{ id: "account-1", name: null, plaid_item_id: null }],
        },
        transaction_review_decisions: { data: null },
        linked_duplicates: { data: null },
      }),
    });
    const response = await GET();
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.pairs[0].first.merchant).toBe("Unknown");
    expect(payload.pairs[0].first.accountName).toBe("Account");
    expect(payload.pairs[0].first.plaidItemId).toBeNull();
  });

  it("maps confirmed links even when one side is missing from the ledger", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER_ID },
      supabase: ownedClient({
        linked_duplicates: {
          data: [
            { subject_id: SUBJECT, kept_transaction_id: FIRST_ID, excluded_transaction_id: "missing-id" },
            { subject_id: SUBJECT, kept_transaction_id: "missing-id", excluded_transaction_id: SECOND_ID },
          ],
        },
      }),
    });
    const response = await GET();
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.confirmed).toEqual([
      { subjectId: SUBJECT, kept: expect.objectContaining({ id: FIRST_ID }), excluded: null },
      { subjectId: SUBJECT, kept: null, excluded: expect.objectContaining({ id: SECOND_ID }) },
    ]);
  });

  it("returns unresolved owner-scoped pairs with account context", async () => {
    const supabase = ownedClient();
    mockRequireUser.mockResolvedValue({ user: { id: USER_ID }, supabase });

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.pairs).toEqual([expect.objectContaining({ subjectId: SUBJECT })]);
    expect(payload.pairs[0].first.accountName).toBe("Card A");
    expect(supabase.scopedToUser("transactions", USER_ID)).toBe(true);
    expect(supabase.scopedToUser("transaction_review_decisions", USER_ID)).toBe(true);
  });

  it("returns 500 when transactions query fails", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER_ID },
      supabase: clientStub({ transactions: { data: null, error: { message: "DB Error" } } }),
    });
    const response = await GET();
    expect(response.status).toBe(500);
  });
});

describe("POST /api/transactions/duplicates", () => {
  it("returns the auth response when not signed in", async () => {
    mockRequireUser.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    const response = await POST(request("POST", { subjectId: SUBJECT }));
    expect(response.status).toBe(401);
  });

  it("returns 500 when the ownership query fails", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER_ID },
      supabase: clientStub({ transactions: { data: null, error: { message: "Ownership Error" } } }),
    });
    const response = await POST(request("POST", {
      subjectId: SUBJECT,
      keptTransactionId: FIRST_ID,
      excludedTransactionId: SECOND_ID,
      decision: "confirmed",
    }));
    expect(response.status).toBe(500);
  });

  it("404s when the ownership query returns no rows", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER_ID },
      supabase: clientStub({ transactions: { data: null, error: null } }),
    });
    const response = await POST(request("POST", {
      subjectId: SUBJECT,
      keptTransactionId: FIRST_ID,
      excludedTransactionId: SECOND_ID,
      decision: "confirmed",
    }));
    expect(response.status).toBe(404);
  });

  it("rejects an invalid payload or missing fields", async () => {
    const response = await POST(request("POST", { subjectId: SUBJECT }));
    expect(response.status).toBe(400);
  });

  it("rejects identical kept and excluded IDs", async () => {
    const response = await POST(request("POST", {
      subjectId: `${FIRST_ID}:${FIRST_ID}`,
      keptTransactionId: FIRST_ID,
      excludedTransactionId: FIRST_ID,
      decision: "confirmed",
    }));
    expect(response.status).toBe(400);
  });

  it("rejects a subject that does not match the supplied ids", async () => {
    const response = await POST(request("POST", {
      subjectId: `${SECOND_ID}:${FIRST_ID}`,
      keptTransactionId: FIRST_ID,
      excludedTransactionId: SECOND_ID,
      decision: "confirmed",
    }));

    expect(response.status).toBe(400);
    expect(service.rpc).not.toHaveBeenCalled();
  });

  it("404s when user does not own both transactions", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER_ID },
      supabase: clientStub({ transactions: { data: [{ id: FIRST_ID }] } }),
    });
    const response = await POST(request("POST", {
      subjectId: SUBJECT,
      keptTransactionId: FIRST_ID,
      excludedTransactionId: SECOND_ID,
      decision: "confirmed",
    }));
    expect(response.status).toBe(404);
  });

  it("confirms through the atomic service-only function after ownership checks", async () => {
    const response = await POST(request("POST", {
      subjectId: SUBJECT,
      keptTransactionId: FIRST_ID,
      excludedTransactionId: SECOND_ID,
      decision: "confirmed",
    }));

    expect(response.status).toBe(200);
    expect(service.rpc).toHaveBeenCalledWith("confirm_transaction_duplicate", {
      p_user_id: USER_ID,
      p_subject_id: SUBJECT,
      p_kept_transaction_id: FIRST_ID,
      p_excluded_transaction_id: SECOND_ID,
    });
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "duplicate_confirmed",
      metadata: { subject_id: SUBJECT },
    }));
  });

  it("returns 500 when RPC returns an error on confirmed decision", async () => {
    service.rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "RPC Error" } });
    const response = await POST(request("POST", {
      subjectId: SUBJECT,
      keptTransactionId: FIRST_ID,
      excludedTransactionId: SECOND_ID,
      decision: "confirmed",
    }));
    expect(response.status).toBe(500);
  });

  it("returns 409 conflict when transaction is already linked to another duplicate", async () => {
    service.rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "duplicate_link_conflict: already linked" } });
    const response = await POST(request("POST", {
      subjectId: SUBJECT,
      keptTransactionId: FIRST_ID,
      excludedTransactionId: SECOND_ID,
      decision: "confirmed",
    }));
    expect(response.status).toBe(409);
    const json = await response.json();
    expect(json.error).toBe("One of these transactions is already linked to another duplicate.");
  });

  it("persists dismissal without creating an exclusion link", async () => {
    service = makeService({ transaction_review_decisions: { data: null, error: null } });

    const response = await POST(request("POST", {
      subjectId: SUBJECT,
      keptTransactionId: FIRST_ID,
      excludedTransactionId: SECOND_ID,
      decision: "dismissed",
    }));

    expect(response.status).toBe(200);
    expect(service.writtenTo("transaction_review_decisions")).toMatchObject({
      user_id: USER_ID,
      kind: "duplicate",
      subject_id: SUBJECT,
      decision: "dismissed",
    });
    expect(service.rpc).not.toHaveBeenCalled();
  });

  it("returns 500 when upserting dismissal returns an error", async () => {
    service = makeService({ transaction_review_decisions: { data: null, error: { message: "Upsert Error" } } });
    const response = await POST(request("POST", {
      subjectId: SUBJECT,
      keptTransactionId: FIRST_ID,
      excludedTransactionId: SECOND_ID,
      decision: "dismissed",
    }));
    expect(response.status).toBe(500);
  });
});

describe("DELETE /api/transactions/duplicates/[subjectId]", () => {
  it("rejects an invalid subjectId without colon", async () => {
    const response = await DELETE(
      request("DELETE"),
      { params: Promise.resolve({ subjectId: "nocolon" }) },
    );
    expect(response.status).toBe(400);
  });

  it("404s when duplicate link is not found", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER_ID },
      supabase: clientStub({ linked_duplicates: { data: null } }),
    });
    const response = await DELETE(
      request("DELETE"),
      { params: Promise.resolve({ subjectId: encodeURIComponent(SUBJECT) }) },
    );
    expect(response.status).toBe(404);
  });

  it("undoes an owned link atomically", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER_ID },
      supabase: ownedClient({ linked_duplicates: { data: { subject_id: SUBJECT } } }),
    });

    const response = await DELETE(
      request("DELETE"),
      { params: Promise.resolve({ subjectId: encodeURIComponent(SUBJECT) }) },
    );

    expect(response.status).toBe(200);
    expect(service.rpc).toHaveBeenCalledWith("undo_transaction_duplicate", {
      p_user_id: USER_ID,
      p_subject_id: SUBJECT,
    });
  });

  it("returns 500 when undo RPC fails", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER_ID },
      supabase: ownedClient({ linked_duplicates: { data: { subject_id: SUBJECT } } }),
    });
    service.rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "Undo Error" } });

    const response = await DELETE(
      request("DELETE"),
      { params: Promise.resolve({ subjectId: encodeURIComponent(SUBJECT) }) },
    );
    expect(response.status).toBe(500);
  });
});
