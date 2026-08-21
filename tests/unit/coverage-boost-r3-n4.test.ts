import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse, NextRequest } from "next/server";
import { queryStub } from "../fixtures/supabase-query";

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

const mockIsAllowedPushEndpoint = vi.fn<(...args: unknown[]) => unknown>(
  () => true,
);
vi.mock("@/lib/push", () => ({
  isAllowedPushEndpoint: (...args: unknown[]) => mockIsAllowedPushEndpoint(...args),
}));

import { POST, DELETE } from "@/app/api/push/subscribe/route";

function post(body: unknown, opts: { rejectJson?: boolean } = {}) {
  return {
    url: "https://x.local/api/push/subscribe",
    json: opts.rejectJson
      ? () => Promise.reject(new Error("bad json"))
      : () => Promise.resolve(body),
  } as unknown as NextRequest;
}

const VALID_ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc";
const VALID_BODY = {
  endpoint: VALID_ENDPOINT,
  keys: { p256dh: "key-p256dh", auth: "key-auth" },
};

function subClient(result: { error: unknown }) {
  return { from: vi.fn().mockReturnValue(queryStub(result)) };
}

function unsubClient(result: { error: unknown }) {
  return { from: vi.fn().mockReturnValue(queryStub(result)) };
}

describe("POST /api/push/subscribe (r3-n4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: {} });
    mockIsAllowedPushEndpoint.mockReturnValue(true);
  });

  it("returns the auth response when not signed in", async () => {
    mockRequireUser.mockResolvedValue(new NextResponse("unauthorized", { status: 401 }));
    const res = await POST({} as NextRequest);
    expect(res.status).toBe(401);
  });

  it("returns bad request when the body fails to parse", async () => {
    const res = await POST(post({}, { rejectJson: true }));
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith(
      "A push subscription (endpoint + keys) is required",
    );
  });

  it("returns bad request when the body is null", async () => {
    const res = await POST(post(null));
    expect(res.status).toBe(400);
  });

  it("returns bad request when the endpoint is missing", async () => {
    const res = await POST(post({ keys: { p256dh: "a", auth: "b" } }));
    expect(res.status).toBe(400);
  });

  it("returns bad request when the keys object is missing", async () => {
    const res = await POST(post({ endpoint: VALID_ENDPOINT }));
    expect(res.status).toBe(400);
  });

  it("returns bad request when p256dh is missing", async () => {
    const res = await POST(post({ endpoint: VALID_ENDPOINT, keys: { auth: "b" } }));
    expect(res.status).toBe(400);
  });

  it("returns bad request when auth is missing", async () => {
    const res = await POST(
      post({ endpoint: VALID_ENDPOINT, keys: { p256dh: "a" } }),
    );
    expect(res.status).toBe(400);
  });

  it("returns bad request when the endpoint is not allowlisted", async () => {
    mockIsAllowedPushEndpoint.mockReturnValue(false);
    const res = await POST(post(VALID_BODY));
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith("Unsupported push endpoint");
  });

  it("upserts a subscription successfully", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: "user-1" },
      supabase: subClient({ error: null }),
    });
    const res = await POST(post(VALID_BODY));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });

  it("returns an error response when the upsert fails", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: "user-1" },
      supabase: subClient({ error: new Error("db down") }),
    });
    const res = await POST(post(VALID_BODY));
    expect(res.status).toBe(500);
    expect(mockErrorResponse).toHaveBeenCalledWith("push.subscribe", expect.any(Error));
  });
});

describe("DELETE /api/push/subscribe (r3-n4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue({ user: { id: "user-1" }, supabase: {} });
  });

  it("returns the auth response when not signed in", async () => {
    mockRequireUser.mockResolvedValue(new NextResponse("unauthorized", { status: 401 }));
    const res = await DELETE({} as NextRequest);
    expect(res.status).toBe(401);
  });

  it("returns bad request when the body fails to parse", async () => {
    const res = await DELETE(post({}, { rejectJson: true }));
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith("endpoint is required");
  });

  it("returns bad request when the endpoint is missing", async () => {
    const res = await DELETE(post({}));
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith("endpoint is required");
  });

  it("unsubscribes successfully", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: "user-1" },
      supabase: unsubClient({ error: null }),
    });
    const res = await DELETE(post({ endpoint: VALID_ENDPOINT }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });

  it("returns an error response when the delete fails", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: "user-1" },
      supabase: unsubClient({ error: new Error("db down") }),
    });
    const res = await DELETE(post({ endpoint: VALID_ENDPOINT }));
    expect(res.status).toBe(500);
    expect(mockErrorResponse).toHaveBeenCalledWith("push.unsubscribe", expect.any(Error));
  });
});