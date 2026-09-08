import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

let featureEnabled = true;
vi.mock("@/lib/feature-flags", () => ({
  isFeatureEnabled: vi.fn((flag: string) => {
    if (flag === "transactionReview") return featureEnabled;
    return false;
  }),
}));

const mockWriteAudit = vi.fn<(...args: unknown[]) => unknown>();
const mockGetClientIp = vi.fn<(...args: unknown[]) => unknown>(() => "127.0.0.1");
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
  getClientIp: (...args: unknown[]) => mockGetClientIp(...args),
}));

let rateLimitAllowed = true;
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => rateLimitAllowed),
}));

let currentUser: { id: string } | null = { id: "user-1" };
vi.mock("@/lib/http", () => ({
  requireUser: () =>
    currentUser
      ? { user: currentUser }
      : new NextResponse("Unauthorized", { status: 401 }),
  badRequest: (msg: string) =>
    NextResponse.json({ error: msg }, { status: 400 }),
  errorResponse: () =>
    NextResponse.json({ error: "server error" }, { status: 500 }),
}));

let mockRpcResult: { data: unknown; error: unknown } = {
  data: { updated: 1, unchanged: 0, items: [] },
  error: null,
};
const mockRpc = vi.fn(async () => mockRpcResult);
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    rpc: mockRpc,
  }),
}));

import { PATCH } from "@/app/api/transactions/review/route";

function makeRequest(
  body: unknown,
  options: { contentLength?: number; isRawString?: boolean } = {},
): NextRequest {
  const text = options.isRawString
    ? (body as string)
    : JSON.stringify(body);
  const headers = new Headers();
  if (options.contentLength !== undefined) {
    headers.set("content-length", String(options.contentLength));
  }
  return new NextRequest("http://localhost/api/transactions/review", {
    method: "PATCH", headers, body: text,
  });
}

describe("PATCH /api/transactions/review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    featureEnabled = true;
    rateLimitAllowed = true;
    currentUser = { id: "user-1" };
    mockWriteAudit.mockResolvedValue(undefined);
    mockRpcResult = {
      data: {
        updated: 1,
        unchanged: 0,
        items: [
          {
            transaction_id: "11111111-1111-4111-8111-111111111111",
            status: "reviewed",
            version: "2",
            reviewed_at: "2026-09-08T00:00:00Z",
          },
        ],
      },
      error: null,
    };
  });

  it("returns 404 when feature flag is disabled", async () => {
    featureEnabled = false;
    const req = makeRequest({
      status: "reviewed",
      items: [{ transaction_id: "11111111-1111-4111-8111-111111111111", expected_version: "1" }],
    });
    const res = await PATCH(req);
    expect(res.status).toBe(404);
  });

  it("returns 401 when unauthenticated", async () => {
    currentUser = null;
    const req = makeRequest({
      status: "reviewed",
      items: [{ transaction_id: "11111111-1111-4111-8111-111111111111", expected_version: "1" }],
    });
    const res = await PATCH(req);
    expect(res.status).toBe(401);
  });

  it("returns 429 when rate limit is exceeded", async () => {
    rateLimitAllowed = false;
    const req = makeRequest({
      status: "reviewed",
      items: [{ transaction_id: "11111111-1111-4111-8111-111111111111", expected_version: "1" }],
    });
    const res = await PATCH(req);
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toMatch(/Too many review requests/);
  });

  it("returns 400 when payload exceeds byte size in Content-Length header or body", async () => {
    const reqHeader = makeRequest(
      { status: "reviewed", items: [] },
      { contentLength: 40 * 1024 },
    );
    const resHeader = await PATCH(reqHeader);
    expect(resHeader.status).toBe(400);

    const largeString = "x".repeat(35 * 1024);
    const reqBody = makeRequest(largeString, { isRawString: true });
    const resBody = await PATCH(reqBody);
    expect(resBody.status).toBe(400);
  });

  it("returns 400 for invalid JSON or invalid payload schema", async () => {
    const badJson = makeRequest("{invalid json", { isRawString: true });
    const resJson = await PATCH(badJson);
    expect(resJson.status).toBe(400);

    const invalidPayload = makeRequest({ status: "invalid_status", items: [] });
    const resPayload = await PATCH(invalidPayload);
    expect(resPayload.status).toBe(400);
  });

  it("maps P0002 RPC error to 404", async () => {
    mockRpcResult = {
      data: null,
      error: { code: "P0002", message: "transaction_not_found" },
    };
    const req = makeRequest({
      status: "reviewed",
      items: [{ transaction_id: "11111111-1111-4111-8111-111111111111", expected_version: "1" }],
    });
    const res = await PATCH(req);
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toMatch(/unavailable/);
  });

  it("maps 40001 or REVIEW_STATE_CHANGED RPC error to 409", async () => {
    mockRpcResult = {
      data: null,
      error: { code: "40001", message: "REVIEW_STATE_CHANGED: version mismatch" },
    };
    const req = makeRequest({
      status: "reviewed",
      items: [{ transaction_id: "11111111-1111-4111-8111-111111111111", expected_version: "1" }],
    });
    const res = await PATCH(req);
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.code).toBe("REVIEW_STATE_CHANGED");
  });

  it("maps 22023 RPC error to 400", async () => {
    mockRpcResult = {
      data: null,
      error: { code: "22023", message: "Invalid argument value" },
    };
    const req = makeRequest({
      status: "reviewed",
      items: [{ transaction_id: "11111111-1111-4111-8111-111111111111", expected_version: "1" }],
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid argument value");
  });

  it("returns 500 when RPC encounters an unexpected database error", async () => {
    mockRpcResult = {
      data: null,
      error: { code: "XX000", message: "disk corruption" },
    };
    const req = makeRequest({
      status: "reviewed",
      items: [{ transaction_id: "11111111-1111-4111-8111-111111111111", expected_version: "1" }],
    });
    const res = await PATCH(req);
    expect(res.status).toBe(500);
  });

  it("successfully updates review state, writes audit log, and sets Cache-Control: no-store", async () => {
    const txId = "11111111-1111-4111-8111-111111111111";
    const req = makeRequest({
      status: "reviewed",
      items: [{ transaction_id: txId, expected_version: "1" }],
    });
    const res = await PATCH(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");

    const json = await res.json();
    expect(json.updated).toBe(1);
    expect(json.items[0].transaction_id).toBe(txId);

    expect(mockRpc).toHaveBeenCalledWith("set_transaction_review_state_atomic", {
      p_user_id: "user-1",
      p_status: "reviewed",
      p_items: [{ transaction_id: txId, expected_version: "1" }],
    });

    expect(mockWriteAudit).toHaveBeenCalledWith({
      userId: "user-1",
      action: "transaction_reviewed",
      metadata: {
        updated: 1,
        unchanged: 0,
        count: 1,
        status: "reviewed",
      },
      ip: "127.0.0.1",
    });
  });

  it("records transaction_review_reopened audit action when reopening", async () => {
    const txId = "11111111-1111-4111-8111-111111111111";
    mockRpcResult = {
      data: {
        updated: 1,
        unchanged: 0,
        items: [
          {
            transaction_id: txId,
            status: "needs_review",
            version: "3",
            reviewed_at: null,
          },
        ],
      },
      error: null,
    };

    const req = makeRequest({
      status: "needs_review",
      items: [{ transaction_id: txId, expected_version: "2" }],
    });
    const res = await PATCH(req);
    expect(res.status).toBe(200);

    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "transaction_review_reopened",
        metadata: expect.objectContaining({
          status: "needs_review",
        }),
      }),
    );
  });

  it("handles Postgres error 22023 with fallback message when error.message is missing", async () => {
    mockRpcResult = {
      data: null,
      error: { code: "22023", message: null },
    };
    const req = makeRequest({
      status: "reviewed",
      items: [
        {
          transaction_id: "11111111-1111-4111-8111-111111111111",
          expected_version: "1",
        },
      ],
    });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid review request");
  });
});


describe("bounded review request streams", () => {
  it("counts UTF-8 bytes and cancels an oversized stream without reading its tail", async () => {
    featureEnabled = true;
    currentUser = { id: "user-1" };
    rateLimitAllowed = true;
    const cancel = vi.fn();
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { pulls++; controller.enqueue(new TextEncoder().encode("é".repeat(17000))); },
      cancel,
    }, { highWaterMark: 0 });
    const request = new NextRequest("http://localhost/api/transactions/review", {
      method: "PATCH", body: stream, duplex: "half",
      headers: { "content-length": "1" },
    } as ConstructorParameters<typeof NextRequest>[1]);
    const response = await PATCH(request);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Payload exceeds maximum size" });
    expect(cancel).toHaveBeenCalledOnce();
    expect(pulls).toBe(1);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("handles a missing body and an invalid UTF-8 stream without a write", async () => {
    featureEnabled = true; currentUser = { id: "user-1" }; rateLimitAllowed = true;
    for (const body of [null, new Uint8Array([255])]) {
      const response = await PATCH(new NextRequest("http://localhost/api/transactions/review", { method: "PATCH", body }));
      expect(response.status).toBe(400);
    }
  });
});
