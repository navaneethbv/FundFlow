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

let currentUser: { id: string } | null = { id: "user-1" };
let supabase = clientStub({});

vi.mock("@/lib/http", () => ({
  requireUser: () =>
    currentUser
      ? { user: currentUser, supabase }
      : new NextResponse("Unauthorized", { status: 401 }),
  badRequest: (msg: string) => mockBadRequest(msg),
  errorResponse: (_c: string, _e: unknown) =>
    NextResponse.json({ error: `boom: ${_c}: ${String((_e as Error)?.message ?? _e)}` }, { status: 500 }),
}));

import { POST, DELETE } from "@/app/api/transactions/override/route";
import type { NextRequest } from "next/server";

function jsonRequest(body: unknown): NextRequest {
  return { json: () => Promise.resolve(body) } as unknown as NextRequest;
}

function seeded(seed: Record<string, { data?: unknown; error?: unknown }>) {
  supabase = clientStub(seed);
  return supabase;
}

describe("transaction override route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentUser = { id: "user-1" };
    mockWriteAudit.mockResolvedValue(undefined);
  });

  it("returns 401 when unauthenticated", async () => {
    currentUser = null;
    const res = await POST(jsonRequest({ transaction_id: "11111111-1111-4111-8111-111111111111" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 for a missing or invalid transaction id", async () => {
    const res = await POST(jsonRequest({}));
    expect(res.status).toBe(400);
    const bad = await POST(jsonRequest({ transaction_id: "not-a-uuid" }));
    expect(bad.status).toBe(400);
  });

  it("rejects invalid override field values instead of clearing them", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect((await POST(jsonRequest({
      transaction_id: id,
      cash_flow_classification: "transfer",
    }))).status).toBe(400);
    expect((await POST(jsonRequest({
      transaction_id: id,
      display_category: 42,
    }))).status).toBe(400);
    expect(supabase.writtenTo("transaction_annotations")).toBeUndefined();
  });

  it("returns 400 when the transaction is not owned by the caller", async () => {
    seeded({ transactions: { data: null } });
    const res = await POST(
      jsonRequest({
        transaction_id: "11111111-1111-4111-8111-111111111111",
        display_category: "SHOP",
      }),
    );
    expect(res.status).toBe(400);
    // The ownership lookup must be scoped to the caller.
    expect(supabase.scopedToUser("transactions", "user-1")).toBe(true);
  });

  it("requires explicit confirmation to turn a provider transfer into spending", async () => {
    seeded({
      transactions: {
        data: {
          id: "11111111-1111-4111-8111-111111111111",
          user_id: "user-1",
          amount: 500,
          pfc_primary: "TRANSFER_OUT",
          pfc_detailed: "TRANSFER_OUT",
        },
      },
    });
    const res = await POST(
      jsonRequest({
        transaction_id: "11111111-1111-4111-8111-111111111111",
        display_category: "SHOPPING",
        cash_flow_classification: "expense",
      }),
    );
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith(expect.stringMatching(/confirm/i));
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });

  it("requires confirmation to turn a provider transfer into income", async () => {
    seeded({
      transactions: {
        data: {
          id: "11111111-1111-4111-8111-111111111111",
          user_id: "user-1",
          amount: -400,
          pfc_primary: "TRANSFER_IN",
          pfc_detailed: "TRANSFER_IN",
        },
      },
    });
    const res = await POST(
      jsonRequest({
        transaction_id: "11111111-1111-4111-8111-111111111111",
        cash_flow_classification: "income",
        confirmed: false,
      }),
    );
    expect(res.status).toBe(400);
  });

  it("writes a confirmed override to the annotation table and audits a create", async () => {
    const supabase = seeded({
      transactions: {
        data: {
          id: "11111111-1111-4111-8111-111111111111",
          user_id: "user-1",
          amount: 500,
          pfc_primary: "TRANSFER_OUT",
          pfc_detailed: "TRANSFER_OUT",
        },
      },
      transaction_annotations: { data: null },
    });
    const res = await POST(
      jsonRequest({
        transaction_id: "11111111-1111-4111-8111-111111111111",
        display_category: "SHOPPING",
        cash_flow_classification: "expense",
        confirmed: true,
      }),
    );
    expect(res.status).toBe(200);
    const written = supabase.writtenTo("transaction_annotations") as Record<string, unknown>;
    expect(written).toMatchObject({
      user_id: "user-1",
      transaction_id: "11111111-1111-4111-8111-111111111111",
      display_category: "SHOPPING",
      cash_flow_classification: "expense",
    });
    expect(supabase.scopedToUser("transaction_annotations", "user-1")).toBe(true);
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        action: "transaction_override_created",
        metadata: expect.objectContaining({
          transaction_id: "11111111-1111-4111-8111-111111111111",
          confirmed: true,
        }),
      }),
    );
  });

  it("audits an update when the transaction already has an override", async () => {
    seeded({
      transactions: {
        data: {
          id: "11111111-1111-4111-8111-111111111111",
          user_id: "user-1",
          amount: 500,
          pfc_primary: "SHOPS",
          pfc_detailed: "SHOPS_JEWELRY",
        },
      },
      transaction_annotations: {
        data: {
          display_category: "SHOPPING",
          cash_flow_classification: "expense",
        },
      },
    });
    const res = await POST(
      jsonRequest({
        transaction_id: "11111111-1111-4111-8111-111111111111",
        display_category: "CLOTHING",
      }),
    );
    expect(res.status).toBe(200);
    const written = supabase.writtenTo("transaction_annotations") as Record<string, unknown>;
    expect(written).toMatchObject({
      display_category: "CLOTHING",
      cash_flow_classification: "expense",
    });
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "transaction_override_updated" }),
    );
  });

  it("preserves the other override field when updating only one field", async () => {
    const supabase = seeded({
      transactions: {
        data: {
          id: "11111111-1111-4111-8111-111111111111",
          pfc_primary: "SHOPS",
          pfc_detailed: "SHOPS_JEWELRY",
        },
      },
      transaction_annotations: {
        data: { display_category: "SHOPPING", cash_flow_classification: "expense" },
      },
    });
    const res = await POST(jsonRequest({
      transaction_id: "11111111-1111-4111-8111-111111111111",
      cash_flow_classification: "income",
    }));
    expect(res.status).toBe(200);
    expect(supabase.writtenTo("transaction_annotations")).toMatchObject({
      display_category: "SHOPPING",
      cash_flow_classification: "income",
    });
  });

  it("does not need confirmation for a normal expense recategorization", async () => {
    seeded({
      transactions: {
        data: {
          id: "11111111-1111-4111-8111-111111111111",
          user_id: "user-1",
          amount: 500,
          pfc_primary: "SHOPS",
          pfc_detailed: "SHOPS_JEWELRY",
        },
      },
    });
    const res = await POST(
      jsonRequest({
        transaction_id: "11111111-1111-4111-8111-111111111111",
        display_category: "CLOTHING",
      }),
    );
    expect(res.status).toBe(200);
  });

  it("clears the override on DELETE, scoped to the owner, and audits it", async () => {
    const supabase = seeded({
      transactions: {
        data: {
          id: "11111111-1111-4111-8111-111111111111",
          user_id: "user-1",
          amount: 500,
          pfc_primary: "SHOPS",
          pfc_detailed: "SHOPS_JEWELRY",
        },
      },
    });
    const res = await DELETE(
      jsonRequest({ transaction_id: "11111111-1111-4111-8111-111111111111" }),
    );
    expect(res.status).toBe(200);
    const update = supabase.writtenTo("transaction_annotations") as Record<string, unknown>;
    expect(update).toMatchObject({ display_category: null, cash_flow_classification: null });
    expect(supabase.scopedToUser("transaction_annotations", "user-1")).toBe(true);
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "transaction_override_deleted" }),
    );
    // The immutable provider row is never written.
    expect(supabase.callsOn("transactions").some((c) => c.method === "update" || c.method === "upsert")).toBe(false);
  });
});
