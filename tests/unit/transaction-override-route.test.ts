import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { clientStub } from "../fixtures/supabase-query";

const mockWriteAudit = vi.fn<(...args: unknown[]) => unknown>();
const mockGetClientIp = vi.fn<(...args: unknown[]) => unknown>(() => "127.0.0.1");
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
  getClientIp: (...args: unknown[]) => mockGetClientIp(...args),
}));

const mockBadRequest = vi.fn((msg: string) => NextResponse.json({ error: msg }, { status: 400 }));
vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  badRequest: (msg: string) => mockBadRequest(msg),
  errorResponse: (_c: string, _e: unknown) => NextResponse.json({ error: "boom" }, { status: 500 }),
}));

let mockRequireUser = vi.fn<() => unknown>(() => ({
  user: { id: "user-1" },
  supabase: mockSupabase,
}));

const mockSupabase = clientStub({});

import { POST, DELETE } from "@/app/api/transactions/override/route";
import type { NextRequest } from "next/server";

function jsonRequest(body: unknown): NextRequest {
  return { json: () => Promise.resolve(body) } as unknown as NextRequest;
}

describe("transaction override route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser = vi.fn(() => ({
      user: { id: "user-1" },
      supabase: mockSupabase,
    }));
    mockWriteAudit.mockResolvedValue(undefined);
  });

  it("returns 401 when unauthenticated", async () => {
    mockRequireUser.mockResolvedValueOnce(new NextResponse("Unauthorized", { status: 401 }));
    const res = await POST(jsonRequest({ transaction_id: "t1" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 for a missing transaction id", async () => {
    const res = await POST(jsonRequest({}));
    expect(res.status).toBe(400);
  });

  it("returns 400 when the transaction is not owned by the caller", async () => {
    mockSupabase.tables.transactions ??= clientStub({
      data: [],
    });
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === "transactions") return clientStub({ data: [] });
      return clientStub({});
    });
    const res = await POST(jsonRequest({ transaction_id: "txn-1", display_category: "SHOP" }));
    expect(res.status).toBe(400);
    // The ownership lookup must be scoped to the caller.
    expect(mockSupabase.tables.transactions.calls.some(
      (c) => c.method === "eq" && c.args[0] === "user_id" && c.args[1] === "user-1",
    )).toBe(true);
  });

  it("requires explicit confirmation to turn a provider transfer into spending", async () => {
    mockSupabase.tables.transactions = clientStub({
      data: [
        {
          id: "txn-1",
          user_id: "user-1",
          amount: 500,
          pfc_primary: "TRANSFER_OUT",
          pfc_detailed: "TRANSFER_OUT",
        },
      ],
    });
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === "transactions") return mockSupabase.tables.transactions;
      if (table === "transaction_annotations") return clientStub({});
      return clientStub({});
    });

    const res = await POST(
      jsonRequest({
        transaction_id: "txn-1",
        display_category: "SHOPPING",
        cash_flow_classification: "expense",
      }),
    );
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith(
      expect.stringContaining("confirm"),
    );
    // Nothing was written without confirmation.
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });

  it("requires confirmation to turn a provider transfer into income", async () => {
    mockSupabase.tables.transactions = clientStub({
      data: [
        {
          id: "txn-1",
          user_id: "user-1",
          amount: -400,
          pfc_primary: "TRANSFER_IN",
          pfc_detailed: "TRANSFER_IN",
        },
      ],
    });
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === "transactions") return mockSupabase.tables.transactions;
      return clientStub({});
    });
    const res = await POST(
      jsonRequest({
        transaction_id: "txn-1",
        cash_flow_classification: "income",
        confirmed: false,
      }),
    );
    expect(res.status).toBe(400);
  });

  it("writes a confirmed override to the annotation table and audits it", async () => {
    mockSupabase.tables.transactions = clientStub({
      data: [
        {
          id: "txn-1",
          user_id: "user-1",
          amount: 500,
          pfc_primary: "TRANSFER_OUT",
          pfc_detailed: "TRANSFER_OUT",
        },
      ],
    });
    const annStub = clientStub({ data: [] });
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === "transactions") return mockSupabase.tables.transactions;
      if (table === "transaction_annotations") return annStub;
      return clientStub({});
    });

    const res = await POST(
      jsonRequest({
        transaction_id: "txn-1",
        display_category: "SHOPPING",
        cash_flow_classification: "expense",
        confirmed: true,
      }),
    );
    expect(res.status).toBe(200);
    const written = annStub.calls.find((c) => c.method === "upsert")?.args[0] as Record<string, unknown>;
    expect(written).toMatchObject({
      user_id: "user-1",
      transaction_id: "txn-1",
      display_category: "SHOPPING",
      cash_flow_classification: "expense",
    });
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        action: "transaction_override_created",
        metadata: expect.objectContaining({ transaction_id: "txn-1" }),
      }),
    );
  });

  it("does not need confirmation for a normal expense recategorization", async () => {
    mockSupabase.tables.transactions = clientStub({
      data: [
        {
          id: "txn-1",
          user_id: "user-1",
          amount: 500,
          pfc_primary: "SHOPS",
          pfc_detailed: "SHOPS_JEWELRY",
        },
      ],
    });
    const annStub = clientStub({ data: [] });
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === "transactions") return mockSupabase.tables.transactions;
      if (table === "transaction_annotations") return annStub;
      return clientStub({});
    });

    const res = await POST(
      jsonRequest({ transaction_id: "txn-1", display_category: "CLOTHING" }),
    );
    expect(res.status).toBe(200);
  });

  it("clears the override on DELETE and audits it, never touching the transaction row", async () => {
    mockSupabase.tables.transactions = clientStub({
      data: [
        {
          id: "txn-1",
          user_id: "user-1",
          amount: 500,
          pfc_primary: "TRANSFER_OUT",
          pfc_detailed: "TRANSFER_OUT",
        },
      ],
    });
    const annStub = clientStub({ data: [] });
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === "transactions") return mockSupabase.tables.transactions;
      if (table === "transaction_annotations") return annStub;
      return clientStub({});
    });

    const res = await DELETE(jsonRequest({ transaction_id: "txn-1" }));
    expect(res.status).toBe(200);
    const update = annStub.calls.find((c) => c.method === "update")?.args[0] as Record<string, unknown>;
    expect(update).toMatchObject({
      display_category: null,
      cash_flow_classification: null,
    });
    expect(annStub.calls.some((c) => c.method === "eq" && c.args[0] === "user_id" && c.args[1] === "user-1")).toBe(true);
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "transaction_override_deleted" }),
    );
    // The immutable provider row is never written.
    expect(mockSupabase.tables.transactions.calls.some((c) => c.method === "update" || c.method === "upsert")).toBe(false);
  });
});