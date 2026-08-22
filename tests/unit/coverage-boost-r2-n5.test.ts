import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { clientStub } from "../fixtures/supabase-query";

const mockRequireUser = vi.fn<(...args: unknown[]) => unknown>();
const mockErrorResponse = vi.fn<(...args: unknown[]) => unknown>(
  (_context: unknown, error: unknown) =>
    NextResponse.json({ error: String(error) }, { status: 500 }),
);
const mockBadRequest = vi.fn<(...args: unknown[]) => unknown>(
  (msg: unknown) => NextResponse.json({ error: String(msg) }, { status: 400 }),
);
vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  errorResponse: (...args: unknown[]) => mockErrorResponse(...args),
  badRequest: (...args: unknown[]) => mockBadRequest(...args),
}));

const serviceState = vi.hoisted(() => ({
  upsert: null as unknown,
  rowsUpdate: null as unknown,
  batchUpdate: null as unknown,
  rowsUpdatePayload: null as unknown,
  batchUpdatePayload: null as unknown,
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table === "transactions") return { upsert: serviceState.upsert };
      if (table === "import_review_rows") {
        return {
          update: (payload: unknown) => {
            serviceState.rowsUpdatePayload = payload;
            return { eq: () => ({ in: serviceState.rowsUpdate }) };
          },
        };
      }
      if (table === "import_review_batches") {
        return {
          update: (payload: unknown) => {
            serviceState.batchUpdatePayload = payload;
            return { eq: () => ({ eq: serviceState.batchUpdate }) };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

import { POST } from "@/app/api/import/commit/route";

function postReq(body: unknown): NextRequest {
  return new NextRequest("https://x.local/api/import/commit", {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("POST /api/import/commit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serviceState.upsert = vi.fn().mockResolvedValue({ error: null });
    serviceState.rowsUpdate = vi.fn().mockResolvedValue({ error: null });
    serviceState.batchUpdate = vi.fn().mockResolvedValue({ error: null });
  });

  it("passes through the auth response when not signed in", async () => {
    mockRequireUser.mockResolvedValue(new NextResponse("unauthorized", { status: 401 }));
    const res = await POST(postReq({ batch_id: "b1", account_id: "a1" }));
    expect(res.status).toBe(401);
  });

  it("rejects a missing or non-string batch_id or account_id", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
    for (const body of [
      { account_id: "a1" },
      { batch_id: "b1" },
      { batch_id: 5, account_id: {} },
      {},
    ]) {
      const res = await POST(postReq(body));
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith(
        "batch_id and account_id are required",
      );
    }
  });

  it("falls back to null body when json() rejects", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
    const res = await POST(
      new NextRequest("https://x.local/api/import/commit", {
        method: "POST",
        body: "not-json",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 when the account is not found", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: "u1" },
      supabase: clientStub({ accounts: { data: null, error: null } }),
    });
    const res = await POST(postReq({ batch_id: "b1", account_id: "a1" }));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Account not found" });
  });

  it("throws through errorResponse when the rows query fails", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: "u1" },
      supabase: clientStub({
        accounts: { data: { id: "a1" }, error: null },
        import_review_rows: { data: null, error: new Error("rows query failed") },
      }),
    });
    const res = await POST(postReq({ batch_id: "b1", account_id: "a1" }));
    expect(res.status).toBe(500);
  });

  it("commits approved rows, threading categories and duplicate occurrences", async () => {
    const client = clientStub({
      accounts: { data: { id: "a1" }, error: null },
      import_review_rows: {
        data: [
          {
            id: "r1",
            date: "2026-07-01",
            description: "Coffee Bar",
            amount: 5.5,
            category: "dining",
            status: "pending",
          },
          {
            id: "r2",
            date: "2026-07-01",
            description: "Coffee Bar",
            amount: 5.5,
            category: null,
            status: "pending",
          },
        ],
        error: null,
      },
    });
    mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: client });

    const res = await POST(
      postReq({ batch_id: "b1", account_id: "a1", approved_row_ids: ["r1", "r2"] }),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, imported: 2 });

    expect(serviceState.upsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ pfc_primary: "DINING", name: "Coffee Bar" }),
        expect.objectContaining({ pfc_primary: null, name: "Coffee Bar" }),
      ]),
      expect.objectContaining({ onConflict: "plaid_transaction_id" }),
    );
    const upsertPayload = (serviceState.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      plaid_transaction_id: string;
    }[];
    expect(upsertPayload).toHaveLength(2);
    expect(upsertPayload[0].plaid_transaction_id).not.toBe(upsertPayload[1].plaid_transaction_id);
    expect(serviceState.rowsUpdate).toHaveBeenCalledWith("id", ["r1", "r2"]);
    expect(serviceState.rowsUpdatePayload).toEqual({ status: "committed" });
    expect(serviceState.batchUpdate).toHaveBeenCalledWith("id", "b1");
    expect(serviceState.batchUpdatePayload).toEqual({ status: "committed" });
  });

  it("skips the id filter when no approved_row_ids are given", async () => {
    const client = clientStub({
      accounts: { data: { id: "a1" }, error: null },
      import_review_rows: {
        data: [
          {
            id: "r1",
            date: "2026-07-02",
            description: "Store",
            amount: 10,
            category: null,
            status: "pending",
          },
        ],
        error: null,
      },
    });
    mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: client });

    const res = await POST(postReq({ batch_id: "b1", account_id: "a1" }));
    expect(res.status).toBe(200);
    const rowCalls = client.callsOn("import_review_rows");
    expect(rowCalls.some((c) => c.method === "in")).toBe(false);
    await expect(res.json()).resolves.toEqual({ ok: true, imported: 1 });
  });

  it("handles null rows as an empty import", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: "u1" },
      supabase: clientStub({
        accounts: { data: { id: "a1" }, error: null },
        import_review_rows: { data: null, error: null },
      }),
    });
    const res = await POST(postReq({ batch_id: "b1", account_id: "a1" }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, imported: 0 });
    expect(serviceState.rowsUpdate).not.toHaveBeenCalled();
  });

  it("handles an empty rows array as an empty import", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: "u1" },
      supabase: clientStub({
        accounts: { data: { id: "a1" }, error: null },
        import_review_rows: { data: [], error: null },
      }),
    });
    const res = await POST(postReq({ batch_id: "b1", account_id: "a1" }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, imported: 0 });
    expect(serviceState.rowsUpdate).not.toHaveBeenCalled();
    expect(serviceState.batchUpdate).toHaveBeenCalled();
  });

  it("throws through errorResponse when the transaction upsert fails", async () => {
    serviceState.upsert = vi.fn().mockResolvedValue({ error: new Error("upsert failed") });
    mockRequireUser.mockResolvedValue({
      user: { id: "u1" },
      supabase: clientStub({
        accounts: { data: { id: "a1" }, error: null },
        import_review_rows: {
          data: [
            {
              id: "r1",
              date: "2026-07-01",
              description: "Store",
              amount: 10,
              category: null,
              status: "pending",
            },
          ],
          error: null,
        },
      }),
    });
    const res = await POST(postReq({ batch_id: "b1", account_id: "a1" }));
    expect(res.status).toBe(500);
  });

  it("throws through errorResponse when the row status update fails", async () => {
    serviceState.rowsUpdate = vi.fn().mockResolvedValue({ error: new Error("row update failed") });
    mockRequireUser.mockResolvedValue({
      user: { id: "u1" },
      supabase: clientStub({
        accounts: { data: { id: "a1" }, error: null },
        import_review_rows: {
          data: [
            {
              id: "r1",
              date: "2026-07-01",
              description: "Store",
              amount: 10,
              category: null,
              status: "pending",
            },
          ],
          error: null,
        },
      }),
    });
    const res = await POST(postReq({ batch_id: "b1", account_id: "a1" }));
    expect(res.status).toBe(500);
  });

  it("throws through errorResponse when the batch update fails", async () => {
    serviceState.batchUpdate = vi.fn().mockResolvedValue({ error: new Error("batch update failed") });
    mockRequireUser.mockResolvedValue({
      user: { id: "u1" },
      supabase: clientStub({
        accounts: { data: { id: "a1" }, error: null },
        import_review_rows: { data: [], error: null },
      }),
    });
    const res = await POST(postReq({ batch_id: "b1", account_id: "a1" }));
    expect(res.status).toBe(500);
  });
});