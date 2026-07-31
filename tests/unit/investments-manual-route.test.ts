import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { clientStub } from "../fixtures/supabase-query";

const mockRequireUser = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  badRequest: (message: string) => NextResponse.json({ error: message }, { status: 400 }),
  errorResponse: (_context: string, error: unknown) => {
    throw error;
  },
}));

let serviceClient = clientStub();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => serviceClient,
}));

const mockWriteAudit = vi.fn();
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
  getClientIp: () => "127.0.0.1",
}));

import { POST, DELETE } from "@/app/api/investments/manual/route";

const USER_ID = "user-1";

function request(method: string, body: unknown) {
  return new NextRequest("http://localhost/api/investments/manual", {
    method,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function authedRequestClient(seeds: Record<string, { data?: unknown; error?: unknown }> = {}) {
  return clientStub(seeds);
}

beforeEach(() => {
  vi.clearAllMocks();
  serviceClient = clientStub({
    securities: { data: { id: "sec-1" }, error: null },
    holdings: { data: { id: "holding-1" }, error: null },
    holding_snapshots: { data: null, error: null },
  });
});

describe("POST /api/investments/manual", () => {
  it("returns the authentication response", async () => {
    const unauthorized = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    mockRequireUser.mockResolvedValue(unauthorized);
    await expect(POST(request("POST", {}))).resolves.toBe(unauthorized);
  });

  it("rejects an invalid body with 400 before touching the database", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER_ID },
      supabase: authedRequestClient(),
    });
    const res = await POST(request("POST", { accountSource: "manual", quantity: -1 }));
    expect(res.status).toBe(400);
  });

  it("404s when the chosen account does not belong to the caller", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER_ID },
      supabase: authedRequestClient({ manual_accounts: { data: null, error: null } }),
    });
    const res = await POST(
      request("POST", {
        accountSource: "manual",
        accountId: "not-mine",
        securityName: "Private Fund",
        quantity: 1,
        price: 100,
        asOf: "2026-07-01",
      }),
    );
    expect(res.status).toBe(404);
  });

  it("creates a manual security, holding, and snapshot, and audits the action", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER_ID },
      supabase: authedRequestClient({ manual_accounts: { data: { id: "man-1" }, error: null } }),
    });
    const res = await POST(
      request("POST", {
        accountSource: "manual",
        accountId: "man-1",
        securityName: "Private Fund",
        quantity: 10,
        price: 25,
        asOf: "2026-07-01",
      }),
    );
    expect(res.status).toBe(201);

    const securityWrite = serviceClient.writtenTo("securities") as Record<string, unknown>;
    expect(securityWrite).toMatchObject({ user_id: USER_ID, name: "Private Fund" });

    const holdingWrite = serviceClient.writtenTo("holdings") as Record<string, unknown>;
    expect(holdingWrite).toMatchObject({
      user_id: USER_ID,
      manual_account_id: "man-1",
      account_id: null,
      source: "manual",
      institution_value: 250,
    });

    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "manual_holding_created" }),
    );
  });
});

describe("DELETE /api/investments/manual", () => {
  it("404s when the holding is not manual or not found", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER_ID },
      supabase: authedRequestClient({ holdings: { data: { id: "h1", source: "plaid" }, error: null } }),
    });
    const res = await DELETE(request("DELETE", { id: "h1" }));
    expect(res.status).toBe(404);
  });

  it("deletes a manual holding scoped to the caller and audits it", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER_ID },
      supabase: authedRequestClient({ holdings: { data: { id: "h1", source: "manual" }, error: null } }),
    });
    const res = await DELETE(request("DELETE", { id: "h1" }));
    expect(res.status).toBe(200);
    expect(serviceClient.scopedToUser("holdings", USER_ID)).toBe(true);
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "manual_holding_deleted" }),
    );
  });
});
