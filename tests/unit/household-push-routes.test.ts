import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
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

const mockCheckRateLimit = vi.fn<(...args: unknown[]) => unknown>(() => true);
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

const mockSendInvite = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/reporting", () => ({
  sendHouseholdInviteEmail: (...args: unknown[]) => mockSendInvite(...args),
}));

vi.mock("@/lib/env.server", () => ({
  serverEnv: { appUrl: "https://fundflow.test" },
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

import { POST as invitePost } from "@/app/api/household/invite/route";
import { GET as acceptGet } from "@/app/api/household/accept/route";
import {
  POST as pushPost,
  DELETE as pushDelete,
} from "@/app/api/push/subscribe/route";
import { POST as batchPost } from "@/app/api/transactions/annotate-batch/route";
import { NextResponse, NextRequest } from "next/server";

const USER = "user-1";
const OWNER_EMAIL = "owner@example.com";

function jsonRequest(url: string, method: string, payload: unknown) {
  return new NextRequest(url, {
    method,
    body: JSON.stringify(payload),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckRateLimit.mockResolvedValue(true);
  serviceClient = clientStub();
});

describe("POST /api/household/invite", () => {
  const url = "http://localhost/api/household/invite";

  it("429s once the daily invite limit is spent", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: USER }, supabase: clientStub() });
    mockCheckRateLimit.mockResolvedValue(false);

    const res = await invitePost(
      jsonRequest(url, "POST", { householdId: "h1", email: "a@b.com" }),
    );
    expect(res.status).toBe(429);
    expect(mockSendInvite).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing household", { email: "a@b.com" }],
    ["a missing email", { householdId: "h1" }],
    ["an email with no @", { householdId: "h1", email: "nope" }],
    ["an over-long email", { householdId: "h1", email: `${"x".repeat(320)}@b.com` }],
  ])("rejects %s", async (_label, payload) => {
    mockRequireUser.mockResolvedValue({ user: { id: USER }, supabase: clientStub() });
    const res = await invitePost(jsonRequest(url, "POST", payload));
    expect(res.status).toBe(400);
  });

  it("404s when the caller does not own the household", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER },
      supabase: clientStub({
        households: { data: { id: "h1", name: "Home", owner_user_id: "someone-else" } },
      }),
    });

    const res = await invitePost(
      jsonRequest(url, "POST", { householdId: "h1", email: "a@b.com" }),
    );

    expect(res.status).toBe(404);
    expect(mockSendInvite).not.toHaveBeenCalled();
  });

  it("stores only the token hash and emails the plaintext link", async () => {
    const userClient = clientStub({
      households: { data: { id: "h1", name: "Home", owner_user_id: USER } },
      household_invites: { error: null },
    });
    mockRequireUser.mockResolvedValue({
      user: { id: USER, email: OWNER_EMAIL },
      supabase: userClient,
    });

    const res = await invitePost(
      jsonRequest(url, "POST", { householdId: "h1", email: "  Partner@Example.COM " }),
    );

    expect(res.status).toBe(200);

    const written = userClient.writtenTo("household_invites") as Record<string, string>;
    // Email is normalized, and the invite is bound to the resolved household.
    expect(written.email).toBe("partner@example.com");
    expect(written.household_id).toBe("h1");
    expect(written.invited_by).toBe(USER);
    expect(new Date(written.expires_at).getTime()).toBeGreaterThan(Date.now());

    const acceptUrl = mockSendInvite.mock.calls[0][3] as string;
    const plaintext = new URL(acceptUrl).searchParams.get("token") as string;
    expect(acceptUrl.startsWith("https://fundflow.test/")).toBe(true);
    expect(written.token_hash).toBe(
      createHash("sha256").update(plaintext).digest("hex"),
    );
    expect(JSON.stringify(written)).not.toContain(plaintext);
  });
});

describe("GET /api/household/accept", () => {
  const url = "http://localhost/api/household/accept?token=";
  const token = "t".repeat(40);
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const future = () => new Date(Date.now() + 3600_000).toISOString();

  function get(t: string) {
    return new NextRequest(`${url}${t}`);
  }

  it("redirects to login when not signed in", async () => {
    mockRequireUser.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const res = await acceptGet(get(token));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("rejects a token too short to be real", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: USER, email: OWNER_EMAIL } });
    const res = await acceptGet(get("short"));
    expect(res.headers.get("location")).toContain("invite=invalid");
  });

  it.each([
    ["an unknown token", null],
    [
      "an already-accepted invite",
      {
        id: "i1",
        household_id: "h1",
        email: OWNER_EMAIL,
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
        accepted_at: new Date().toISOString(),
      },
    ],
    [
      "an expired invite",
      {
        id: "i1",
        household_id: "h1",
        email: OWNER_EMAIL,
        expires_at: new Date(Date.now() - 1000).toISOString(),
        accepted_at: null,
      },
    ],
  ])("refuses %s", async (_label, invite) => {
    serviceClient = clientStub({ household_invites: { data: invite } });
    mockRequireUser.mockResolvedValue({ user: { id: USER, email: OWNER_EMAIL } });

    const res = await acceptGet(get(token));

    expect(res.headers.get("location")).toContain("invite=invalid");
    expect(serviceClient.callsOn("household_members")).toHaveLength(0);
  });

  it("refuses a leaked link opened by a different account", async () => {
    serviceClient = clientStub({
      household_invites: {
        data: {
          id: "i1",
          household_id: "h1",
          email: "invited@example.com",
          expires_at: future(),
          accepted_at: null,
        },
      },
    });
    mockRequireUser.mockResolvedValue({
      user: { id: USER, email: "someone-else@example.com" },
    });

    const res = await acceptGet(get(token));

    expect(res.headers.get("location")).toContain("invite=invalid");
    expect(serviceClient.callsOn("household_members")).toHaveLength(0);
  });

  it("creates the membership from the invite row, not from request input", async () => {
    serviceClient = clientStub({
      household_invites: {
        data: {
          id: "i1",
          household_id: "h1",
          email: OWNER_EMAIL,
          expires_at: future(),
          accepted_at: null,
        },
      },
      household_members: { error: null },
    });
    mockRequireUser.mockResolvedValue({ user: { id: USER, email: OWNER_EMAIL } });

    const res = await acceptGet(get(token));

    expect(res.headers.get("location")).toContain("invite=accepted");
    expect(serviceClient.writtenTo("household_members")).toEqual({
      household_id: "h1",
      user_id: USER,
      role: "member",
    });
    expect(
      serviceClient
        .callsOn("household_invites")
        .some(({ method, args }) => method === "eq" && args[1] === tokenHash),
    ).toBe(true);
  });

  it("treats an already-present membership as success", async () => {
    serviceClient = clientStub({
      household_invites: {
        data: {
          id: "i1",
          household_id: "h1",
          email: OWNER_EMAIL,
          expires_at: future(),
          accepted_at: null,
        },
      },
      household_members: { error: { message: "duplicate key value" } },
    });
    mockRequireUser.mockResolvedValue({ user: { id: USER, email: OWNER_EMAIL } });

    const res = await acceptGet(get(token));
    expect(res.headers.get("location")).toContain("invite=accepted");
  });
});

describe("/api/push/subscribe", () => {
  const url = "http://localhost/api/push/subscribe";

  it.each([
    ["no endpoint", { keys: { p256dh: "p", auth: "a" } }],
    ["no p256dh", { endpoint: "https://push", keys: { auth: "a" } }],
    ["no auth key", { endpoint: "https://push", keys: { p256dh: "p" } }],
  ])("rejects a subscription with %s", async (_label, payload) => {
    mockRequireUser.mockResolvedValue({ user: { id: USER }, supabase: clientStub() });
    const res = await pushPost(jsonRequest(url, "POST", payload));
    expect(res.status).toBe(400);
  });

  it("upserts the subscription against the caller, keyed on endpoint", async () => {
    const userClient = clientStub({ push_subscriptions: { error: null } });
    mockRequireUser.mockResolvedValue({ user: { id: USER }, supabase: userClient });

    const res = await pushPost(
      jsonRequest(url, "POST", {
        endpoint: "https://push.example/abc",
        keys: { p256dh: "p-key", auth: "a-key" },
      }),
    );

    expect(res.status).toBe(200);
    expect(userClient.writtenTo("push_subscriptions")).toEqual({
      user_id: USER,
      endpoint: "https://push.example/abc",
      p256dh: "p-key",
      auth: "a-key",
    });
    const upsert = userClient
      .callsOn("push_subscriptions")
      .find(({ method }) => method === "upsert");
    expect(upsert?.args[1]).toEqual({ onConflict: "endpoint" });
  });

  it("requires an endpoint to unsubscribe", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: USER }, supabase: clientStub() });
    const res = await pushDelete(jsonRequest(url, "DELETE", {}));
    expect(res.status).toBe(400);
  });

  it("deletes the named endpoint", async () => {
    const userClient = clientStub({ push_subscriptions: { error: null } });
    mockRequireUser.mockResolvedValue({ user: { id: USER }, supabase: userClient });

    const res = await pushDelete(
      jsonRequest(url, "DELETE", { endpoint: "https://push.example/abc" }),
    );

    expect(res.status).toBe(200);
    expect(
      userClient
        .callsOn("push_subscriptions")
        .some(
          ({ method, args }) =>
            method === "eq" && args[1] === "https://push.example/abc",
        ),
    ).toBe(true);
  });
});

describe("POST /api/transactions/annotate-batch", () => {
  const url = "http://localhost/api/transactions/annotate-batch";

  it.each([
    ["a missing tag", { transaction_ids: ["t1"] }],
    ["an over-long tag", { transaction_ids: ["t1"], tag: "x".repeat(41) }],
    ["no ids", { transaction_ids: [], tag: "tax" }],
    [
      "more than 100 ids",
      { transaction_ids: Array.from({ length: 101 }, (_, i) => `t${i}`), tag: "tax" },
    ],
  ])("rejects %s", async (_label, payload) => {
    mockRequireUser.mockResolvedValue({ user: { id: USER }, supabase: clientStub() });
    const res = await batchPost(jsonRequest(url, "POST", payload));
    expect(res.status).toBe(400);
  });

  it("reports zero updates when none of the ids belong to the caller", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER },
      supabase: clientStub({ transactions: { data: [] } }),
    });

    const res = await batchPost(
      jsonRequest(url, "POST", { transaction_ids: ["t1"], tag: "tax" }),
    );

    await expect(res.json()).resolves.toEqual({ updated: 0 });
    expect(serviceClient.callsOn("transaction_annotations")).toHaveLength(0);
  });

  it("only tags rows the caller owns, ignoring shared household rows", async () => {
    const userClient = clientStub({ transactions: { data: [{ id: "mine" }] } });
    mockRequireUser.mockResolvedValue({ user: { id: USER }, supabase: userClient });
    serviceClient = clientStub({ transaction_annotations: { data: [], error: null } });

    const res = await batchPost(
      jsonRequest(url, "POST", {
        transaction_ids: ["mine", "someone-elses"],
        tag: "tax",
      }),
    );

    await expect(res.json()).resolves.toEqual({ updated: 1 });
    expect(userClient.scopedToUser("transactions", USER)).toBe(true);

    const upserts = serviceClient.writtenTo("transaction_annotations") as Array<
      Record<string, unknown>
    >;
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({
      user_id: USER,
      transaction_id: "mine",
      tags: ["tax"],
    });
  });

  it("normalizes the tag and merges it into existing tags, keeping the note", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER },
      supabase: clientStub({ transactions: { data: [{ id: "t1" }] } }),
    });
    serviceClient = clientStub({
      transaction_annotations: {
        data: [{ transaction_id: "t1", note: "keep me", tags: ["receipt"] }],
        error: null,
      },
    });

    await batchPost(
      jsonRequest(url, "POST", { transaction_ids: ["t1"], tag: "  TAX " }),
    );

    const upserts = serviceClient.writtenTo("transaction_annotations") as Array<
      Record<string, unknown>
    >;
    expect(upserts[0]).toMatchObject({ note: "keep me", tags: ["receipt", "tax"] });
  });

  it("does not duplicate a tag the row already has", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER },
      supabase: clientStub({ transactions: { data: [{ id: "t1" }] } }),
    });
    serviceClient = clientStub({
      transaction_annotations: {
        data: [{ transaction_id: "t1", note: "", tags: ["tax"] }],
        error: null,
      },
    });

    await batchPost(
      jsonRequest(url, "POST", { transaction_ids: ["t1"], tag: "tax" }),
    );

    const upserts = serviceClient.writtenTo("transaction_annotations") as Array<
      Record<string, unknown>
    >;
    expect(upserts[0].tags).toEqual(["tax"]);
  });

  it("caps stored tags at 12", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER },
      supabase: clientStub({ transactions: { data: [{ id: "t1" }] } }),
    });
    serviceClient = clientStub({
      transaction_annotations: {
        data: [
          {
            transaction_id: "t1",
            note: "",
            tags: Array.from({ length: 15 }, (_, i) => `tag${i}`),
          },
        ],
        error: null,
      },
    });

    await batchPost(
      jsonRequest(url, "POST", { transaction_ids: ["t1"], tag: "tax" }),
    );

    const upserts = serviceClient.writtenTo("transaction_annotations") as Array<
      Record<string, unknown>
    >;
    expect((upserts[0].tags as string[]).length).toBe(12);
  });
});
