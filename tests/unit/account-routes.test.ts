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

let serviceClient = clientStub();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => serviceClient,
}));

import { POST as aprPost } from "@/app/api/accounts/apr/route";
import { POST as sharePost } from "@/app/api/plaid/share/route";
import {
  POST as cancelledPost,
  DELETE as cancelledDelete,
} from "@/app/api/subscriptions/cancelled/route";
import { GET as healthGet } from "@/app/api/health/route";
import { NextResponse, NextRequest } from "next/server";

const USER = "user-1";

function post(url: string, body: unknown) {
  return new NextRequest(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function del(url: string, body: unknown) {
  return new NextRequest(url, {
    method: "DELETE",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const unauthorized = () =>
  NextResponse.json({ error: "Unauthorized" }, { status: 401 });

beforeEach(() => {
  vi.clearAllMocks();
  serviceClient = clientStub();
});

describe("POST /api/accounts/apr", () => {
  it("returns the auth response when not signed in", async () => {
    mockRequireUser.mockResolvedValue(unauthorized());
    const res = await aprPost(post("http://localhost/api/accounts/apr", {}));
    expect(res.status).toBe(401);
  });

  it("rejects a missing accountId", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: USER }, supabase: clientStub() });
    const res = await aprPost(post("http://localhost/api/accounts/apr", { apr: 20 }));
    expect(res.status).toBe(400);
  });

  it.each([
    ["above the maximum", 100],
    ["negative", -1],
    ["not a number", "20"],
    ["a boolean", true],
  ])("rejects an apr that is %s", async (_label, apr) => {
    mockRequireUser.mockResolvedValue({ user: { id: USER }, supabase: clientStub() });
    const res = await aprPost(
      post("http://localhost/api/accounts/apr", { accountId: "a1", apr }),
    );
    expect(res.status).toBe(400);
  });

  it("404s when the account is not visible to the caller", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER },
      supabase: clientStub({ accounts: { data: null } }),
    });
    const res = await aprPost(
      post("http://localhost/api/accounts/apr", { accountId: "a1", apr: 20 }),
    );
    expect(res.status).toBe(404);
  });

  it("writes the apr scoped to the caller and audits it", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER },
      supabase: clientStub({ accounts: { data: { id: "a1" } } }),
    });
    const res = await aprPost(
      post("http://localhost/api/accounts/apr", { accountId: "a1", apr: 21.5 }),
    );

    expect(res.status).toBe(200);
    expect(serviceClient.writtenTo("accounts")).toEqual({ apr: 21.5 });
    expect(serviceClient.scopedToUser("accounts", USER)).toBe(true);
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER, action: "apr_updated" }),
    );
  });

  it("accepts a null apr, which clears it", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER },
      supabase: clientStub({ accounts: { data: { id: "a1" } } }),
    });
    const res = await aprPost(
      post("http://localhost/api/accounts/apr", { accountId: "a1", apr: null }),
    );
    expect(res.status).toBe(200);
    expect(serviceClient.writtenTo("accounts")).toEqual({ apr: null });
  });
});

describe("POST /api/plaid/share", () => {
  it("requires itemId and a boolean share", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: USER }, supabase: clientStub() });
    const res = await sharePost(
      post("http://localhost/api/plaid/share", { itemId: "i1" }),
    );
    expect(res.status).toBe(400);
  });

  it("404s when the item does not resolve for the caller", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER },
      supabase: clientStub({ plaid_items: { data: null } }),
    });
    const res = await sharePost(
      post("http://localhost/api/plaid/share", { itemId: "i1", share: true }),
    );
    expect(res.status).toBe(404);
  });

  it("refuses to share when the caller has no household", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER },
      supabase: clientStub({
        plaid_items: { data: { id: "i1" } },
        households: { data: null },
      }),
    });
    const res = await sharePost(
      post("http://localhost/api/plaid/share", { itemId: "i1", share: true }),
    );
    expect(res.status).toBe(400);
  });

  it("stamps the household id on the item, scoped to the owner", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER },
      supabase: clientStub({
        plaid_items: { data: { id: "i1" } },
        households: { data: { id: "h1" } },
      }),
    });
    const res = await sharePost(
      post("http://localhost/api/plaid/share", { itemId: "i1", share: true }),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, householdId: "h1" });
    expect(serviceClient.writtenTo("plaid_items")).toEqual({
      shared_household_id: "h1",
    });
    expect(serviceClient.scopedToUser("plaid_items", USER)).toBe(true);
  });

  it("unshares by nulling the household id without looking one up", async () => {
    const userClient = clientStub({ plaid_items: { data: { id: "i1" } } });
    mockRequireUser.mockResolvedValue({ user: { id: USER }, supabase: userClient });
    const res = await sharePost(
      post("http://localhost/api/plaid/share", { itemId: "i1", share: false }),
    );

    expect(res.status).toBe(200);
    expect(serviceClient.writtenTo("plaid_items")).toEqual({
      shared_household_id: null,
    });
    expect(userClient.callsOn("households")).toHaveLength(0);
  });
});

describe("/api/subscriptions/cancelled", () => {
  it("requires a merchant on POST", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: USER }, supabase: clientStub() });
    const res = await cancelledPost(
      post("http://localhost/api/subscriptions/cancelled", { merchant: "   " }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects an over-long merchant", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: USER }, supabase: clientStub() });
    const res = await cancelledPost(
      post("http://localhost/api/subscriptions/cancelled", {
        merchant: "x".repeat(161),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("inserts the trimmed merchant against the caller", async () => {
    const userClient = clientStub({ cancelled_subscriptions: { error: null } });
    mockRequireUser.mockResolvedValue({ user: { id: USER }, supabase: userClient });
    const res = await cancelledPost(
      post("http://localhost/api/subscriptions/cancelled", { merchant: "  Netflix " }),
    );

    expect(res.status).toBe(200);
    expect(userClient.writtenTo("cancelled_subscriptions")).toEqual({
      user_id: USER,
      merchant: "Netflix",
    });
  });

  it("treats a duplicate insert as success", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER },
      supabase: clientStub({
        cancelled_subscriptions: { error: { message: "duplicate key value" } },
      }),
    });
    const res = await cancelledPost(
      post("http://localhost/api/subscriptions/cancelled", { merchant: "Netflix" }),
    );
    expect(res.status).toBe(200);
  });

  it("surfaces a non-duplicate insert error", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER },
      supabase: clientStub({
        cancelled_subscriptions: { error: { message: "permission denied" } },
      }),
    });
    await expect(
      cancelledPost(
        post("http://localhost/api/subscriptions/cancelled", { merchant: "Netflix" }),
      ),
    ).rejects.toMatchObject({ message: "permission denied" });
  });

  it("requires a merchant on DELETE", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: USER }, supabase: clientStub() });
    const res = await cancelledDelete(
      del("http://localhost/api/subscriptions/cancelled", {}),
    );
    expect(res.status).toBe(400);
  });

  it("deletes the named merchant", async () => {
    const userClient = clientStub({ cancelled_subscriptions: { error: null } });
    mockRequireUser.mockResolvedValue({ user: { id: USER }, supabase: userClient });
    const res = await cancelledDelete(
      del("http://localhost/api/subscriptions/cancelled", { merchant: "Netflix" }),
    );

    expect(res.status).toBe(200);
    expect(
      userClient
        .callsOn("cancelled_subscriptions")
        .some(({ method, args }) => method === "eq" && args[1] === "Netflix"),
    ).toBe(true);
  });
});

describe("GET /api/health", () => {
  it("reports ok with the last sync age", async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3600000).toISOString();
    serviceClient = clientStub({ sync_jobs: { data: { updated_at: twoHoursAgo } } });

    const res = await healthGet();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      db: true,
      degraded: false,
      lastSyncAgeHours: 2,
    });
  });

  it("flags degraded once the last sync is older than 48h", async () => {
    const old = new Date(Date.now() - 60 * 3600000).toISOString();
    serviceClient = clientStub({ sync_jobs: { data: { updated_at: old } } });

    const res = await healthGet();
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      degraded: true,
      lastSyncAgeHours: 60,
    });
  });

  it("is not degraded when no sync has ever run", async () => {
    serviceClient = clientStub({ sync_jobs: { data: null } });

    const res = await healthGet();
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      degraded: false,
      lastSyncAgeHours: null,
    });
  });

  it("503s and reports no data when the database errors", async () => {
    serviceClient = clientStub({ sync_jobs: { error: { message: "down" } } });

    const res = await healthGet();
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ ok: false, db: false });
  });
});
