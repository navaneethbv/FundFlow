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

const mockWriteAudit = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
  getClientIp: () => "127.0.0.1",
}));

let serviceClient = clientStub();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => serviceClient,
}));

import { POST as tokensPost, DELETE as tokensDelete } from "@/app/api/tokens/route";
import {
  POST as calTokenPost,
  DELETE as calTokenDelete,
} from "@/app/api/calendar/token/route";
import { GET as calFeedGet } from "@/app/api/calendar/[token]/route";
import { NextResponse, NextRequest } from "next/server";

const USER = "user-1";

function body(url: string, method: string, payload: unknown) {
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

describe("POST /api/tokens", () => {
  it("returns the auth response when not signed in", async () => {
    mockRequireUser.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const res = await tokensPost(body("http://localhost/api/tokens", "POST", {}));
    expect(res.status).toBe(401);
  });

  it("429s once the daily mint limit is spent", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: USER }, supabase: clientStub() });
    mockCheckRateLimit.mockResolvedValue(false);

    const res = await tokensPost(
      body("http://localhost/api/tokens", "POST", { name: "scripts" }),
    );

    expect(res.status).toBe(429);
    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      `api-token-mint:${USER}`,
      5,
      24 * 3600,
    );
  });

  it("requires a name of at most 80 characters", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: USER }, supabase: clientStub() });

    const missing = await tokensPost(
      body("http://localhost/api/tokens", "POST", { name: "  " }),
    );
    const tooLong = await tokensPost(
      body("http://localhost/api/tokens", "POST", { name: "x".repeat(81) }),
    );

    expect(missing.status).toBe(400);
    expect(tooLong.status).toBe(400);
  });

  it("returns the plaintext once and stores only its hash", async () => {
    const userClient = clientStub({
      api_tokens: { data: { id: "t1", name: "scripts" } },
    });
    mockRequireUser.mockResolvedValue({ user: { id: USER }, supabase: userClient });

    const res = await tokensPost(
      body("http://localhost/api/tokens", "POST", { name: "scripts" }),
    );
    const payload = (await res.json()) as { token: string };

    expect(res.status).toBe(200);
    expect(payload.token).toMatch(/^fft_/);

    const written = userClient.writtenTo("api_tokens") as Record<string, string>;
    expect(written.user_id).toBe(USER);
    expect(written.name).toBe("scripts");
    expect(written.token_hash).toBe(
      createHash("sha256").update(payload.token).digest("hex"),
    );
    // The plaintext itself is never persisted.
    expect(JSON.stringify(written)).not.toContain(payload.token);
  });

  it("mints a distinct token each time", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER },
      supabase: clientStub({ api_tokens: { data: { id: "t1" } } }),
    });

    const first = await (
      await tokensPost(body("http://localhost/api/tokens", "POST", { name: "a" }))
    ).json();
    const second = await (
      await tokensPost(body("http://localhost/api/tokens", "POST", { name: "b" }))
    ).json();

    expect(first.token).not.toBe(second.token);
  });

  it("requires an id to revoke", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: USER }, supabase: clientStub() });
    const res = await tokensDelete(
      body("http://localhost/api/tokens", "DELETE", {}),
    );
    expect(res.status).toBe(400);
  });

  it("revokes by stamping revoked_at and audits it", async () => {
    const userClient = clientStub({ api_tokens: { error: null } });
    mockRequireUser.mockResolvedValue({ user: { id: USER }, supabase: userClient });

    const res = await tokensDelete(
      body("http://localhost/api/tokens", "DELETE", { id: "t1" }),
    );

    expect(res.status).toBe(200);
    expect(userClient.writtenTo("api_tokens")).toMatchObject({
      revoked_at: expect.any(String),
    });
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "api_token_revoked" }),
    );
  });
});

describe("/api/calendar/token", () => {
  it("returns the plaintext once and stores only its hash", async () => {
    const userClient = clientStub({
      calendar_tokens: { data: { id: "c1", include_amounts: false } },
    });
    mockRequireUser.mockResolvedValue({ user: { id: USER }, supabase: userClient });

    const res = await calTokenPost(
      body("http://localhost/api/calendar/token", "POST", {}),
    );
    const payload = (await res.json()) as { token: string };

    expect(res.status).toBe(200);
    const written = userClient.writtenTo("calendar_tokens") as Record<string, unknown>;
    expect(written.token_hash).toBe(
      createHash("sha256").update(payload.token).digest("hex"),
    );
    expect(written.user_id).toBe(USER);
  });

  it("defaults include_amounts off and records an explicit opt-in", async () => {
    const off = clientStub({ calendar_tokens: { data: { id: "c1" } } });
    mockRequireUser.mockResolvedValue({ user: { id: USER }, supabase: off });
    await calTokenPost(body("http://localhost/api/calendar/token", "POST", {}));
    expect(off.writtenTo("calendar_tokens")).toMatchObject({
      include_amounts: false,
    });

    const on = clientStub({ calendar_tokens: { data: { id: "c2" } } });
    mockRequireUser.mockResolvedValue({ user: { id: USER }, supabase: on });
    await calTokenPost(
      body("http://localhost/api/calendar/token", "POST", { includeAmounts: true }),
    );
    expect(on.writtenTo("calendar_tokens")).toMatchObject({
      include_amounts: true,
    });
  });

  it("requires an id to revoke", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: USER }, supabase: clientStub() });
    const res = await calTokenDelete(
      body("http://localhost/api/calendar/token", "DELETE", {}),
    );
    expect(res.status).toBe(400);
  });

  it("revokes by stamping revoked_at", async () => {
    const userClient = clientStub({ calendar_tokens: { error: null } });
    mockRequireUser.mockResolvedValue({ user: { id: USER }, supabase: userClient });

    const res = await calTokenDelete(
      body("http://localhost/api/calendar/token", "DELETE", { id: "c1" }),
    );

    expect(res.status).toBe(200);
    expect(userClient.writtenTo("calendar_tokens")).toMatchObject({
      revoked_at: expect.any(String),
    });
  });
});

describe("GET /api/calendar/[token]", () => {
  const params = (token: string) => ({ params: Promise.resolve({ token }) });

  it("404s a token that is too short to be real, without querying", async () => {
    const res = await calFeedGet(new Request("http://localhost"), params("short"));
    expect(res.status).toBe(404);
    expect(serviceClient.callsOn("calendar_tokens")).toHaveLength(0);
  });

  it("404s an unknown or revoked token", async () => {
    serviceClient = clientStub({ calendar_tokens: { data: null } });
    const res = await calFeedGet(
      new Request("http://localhost"),
      params("k".repeat(40)),
    );
    expect(res.status).toBe(404);
  });

  it("looks the token up by hash and only when unrevoked", async () => {
    const token = "k".repeat(40);
    serviceClient = clientStub({
      calendar_tokens: { data: { user_id: USER, include_amounts: false } },
      recurring_streams: { data: [] },
    });

    await calFeedGet(new Request("http://localhost"), params(token));

    const calls = serviceClient.callsOn("calendar_tokens");
    expect(
      calls.some(
        ({ method, args }) =>
          method === "eq" &&
          args[0] === "token_hash" &&
          args[1] === createHash("sha256").update(token).digest("hex"),
      ),
    ).toBe(true);
    expect(
      calls.some(({ method, args }) => method === "is" && args[0] === "revoked_at"),
    ).toBe(true);
  });

  it("scopes streams to the token's user and serves calendar content", async () => {
    serviceClient = clientStub({
      calendar_tokens: { data: { user_id: USER, include_amounts: true } },
      recurring_streams: {
        data: [
          {
            merchant_name: "Gym",
            average_amount: 40,
            last_amount: 42,
            frequency: "MONTHLY",
            stream_type: "outflow",
            is_active: true,
          },
        ],
      },
    });

    const res = await calFeedGet(
      new Request("http://localhost"),
      params("k".repeat(40)),
    );
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/calendar");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(text).toContain("BEGIN:VCALENDAR");
    expect(text).toContain("Gym");
    expect(serviceClient.scopedToUser("recurring_streams", USER)).toBe(true);
  });

  it("omits amounts unless the token opted into them", async () => {
    serviceClient = clientStub({
      calendar_tokens: { data: { user_id: USER, include_amounts: false } },
      recurring_streams: {
        data: [
          {
            merchant_name: "Gym",
            last_amount: 42,
            frequency: "MONTHLY",
            stream_type: "outflow",
            is_active: true,
          },
        ],
      },
    });

    const text = await (
      await calFeedGet(new Request("http://localhost"), params("k".repeat(40)))
    ).text();

    expect(text).toContain("Gym");
    expect(text).not.toContain("42");
  });
});
