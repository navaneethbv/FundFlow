import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse, NextRequest } from "next/server";
import { clientStub } from "../fixtures/supabase-query";

const mockRequireUser = vi.fn<(...args: unknown[]) => unknown>();
const mockErrorResponse = vi.fn<(...args: unknown[]) => unknown>(
  (_ctx: unknown, error: unknown) =>
    NextResponse.json({ error: (error as Error).message }, { status: 500 }),
);
const mockBadRequest = vi.fn<(...args: unknown[]) => unknown>(
  (msg: unknown) => NextResponse.json({ error: String(msg) }, { status: 400 }),
);
vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  errorResponse: (...args: unknown[]) => mockErrorResponse(...args),
  badRequest: (...args: unknown[]) => mockBadRequest(...args),
}));

const mockWriteAudit = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
  getClientIp: () => "127.0.0.1",
}));

let serviceClient: ReturnType<typeof clientStub>;
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => serviceClient,
}));

import { POST } from "@/app/api/plaid/share/route";

function post(body: unknown, opts: { rejectJson?: boolean } = {}) {
  return {
    url: "https://x.local/api/plaid/share",
    json: opts.rejectJson
      ? () => Promise.reject(new Error("bad json"))
      : () => Promise.resolve(body),
  } as unknown as NextRequest;
}

function userClient(item: unknown, household: unknown) {
  return clientStub({
    plaid_items: { data: item },
    households: { data: household },
  });
}

describe("POST /api/plaid/share (r3-n1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue({
      user: { id: "u1" },
      supabase: userClient({ id: "i1" }, { id: "h1" }),
    });
    serviceClient = clientStub({ plaid_items: { error: null } });
  });

  it("returns the auth response when not signed in", async () => {
    mockRequireUser.mockResolvedValue(new NextResponse("unauthorized", { status: 401 }));
    const res = await POST({} as NextRequest);
    expect(res.status).toBe(401);
  });

  it("returns bad request when the body fails to parse", async () => {
    const res = await POST(post({}, { rejectJson: true }));
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith("itemId and share are required");
  });

  it("returns bad request when the body is null", async () => {
    const res = await POST(post(null));
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith("itemId and share are required");
  });

  it("returns bad request when itemId is missing", async () => {
    const res = await POST(post({ share: false }));
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith("itemId and share are required");
  });

  it("returns bad request when share is not a boolean", async () => {
    const res = await POST(post({ itemId: "i1", share: "yes" }));
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith("itemId and share are required");
  });

  it("returns bad request when sharing without a householdId", async () => {
    const res = await POST(post({ itemId: "i1", share: true }));
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith(
      "householdId is required when sharing",
    );
  });

  it("returns bad request when sharing with a non-string householdId", async () => {
    const res = await POST(post({ itemId: "i1", share: true, householdId: 42 }));
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith(
      "householdId is required when sharing",
    );
  });

  it("returns 404 when the item is not found", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: "u1" },
      supabase: userClient(null, { id: "h1" }),
    });
    const res = await POST(
      post({ itemId: "missing", share: true, householdId: "h1" }),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Bank not found" });
  });

  it("refuses to share into a household the caller is not a member of", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: "u1" },
      supabase: userClient({ id: "i1" }, null),
    });
    const res = await POST(
      post({ itemId: "i1", share: true, householdId: "other-hh" }),
    );
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith(
      "You are not a member of that household",
    );
  });

  it("shares the item into the household and audits", async () => {
    const res = await POST(
      post({ itemId: "i1", share: true, householdId: "h1" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, householdId: "h1" });
    expect(serviceClient.callsOn("plaid_items").some((c) => c.method === "update")).toBe(true);
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        action: "household_share_changed",
        metadata: { item_id: "i1", shared: true },
      }),
    );
  });

  it("unshares by nulling the shared household id", async () => {
    const res = await POST(post({ itemId: "i1", share: false }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, householdId: null });
    const update = serviceClient.callsOn("plaid_items").find(
      (c) => c.method === "update",
    );
    expect(update?.args[0]).toEqual({ shared_household_id: null });
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { item_id: "i1", shared: false },
      }),
    );
  });

  it("returns an error response when the service update fails", async () => {
    serviceClient = clientStub({
      plaid_items: { error: new Error("update failed") },
    });
    const res = await POST(
      post({ itemId: "i1", share: true, householdId: "h1" }),
    );
    expect(res.status).toBe(500);
    expect(mockErrorResponse).toHaveBeenCalledWith(
      "plaid.share",
      expect.any(Error),
    );
    expect(mockWriteAudit).not.toHaveBeenCalled();
  });

  it("surfaces a rejection from the item lookup as a 500", async () => {
    const failing = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockRejectedValue(new Error("db down")),
      })),
    };
    mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: failing });
    const res = await POST(
      post({ itemId: "i1", share: false }),
    );
    expect(res.status).toBe(500);
    expect(mockErrorResponse).toHaveBeenCalledWith("plaid.share", expect.any(Error));
  });
});