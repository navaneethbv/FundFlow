import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse, type NextRequest } from "next/server";

const mockRequireUser = vi.fn<(...args: unknown[]) => unknown>();
const mockBadRequest = vi.fn<(...args: unknown[]) => unknown>(
  (msg: unknown) => NextResponse.json({ error: String(msg) }, { status: 400 }),
);
vi.mock("@/lib/http", () => ({
  requireUser: (...args: unknown[]) => mockRequireUser(...args),
  badRequest: (...args: unknown[]) => mockBadRequest(...args),
}));

const mockGetItem = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/plaid-service", () => ({
  getItem: (...args: unknown[]) => mockGetItem(...args),
}));

const mockCheckRateLimit = vi.fn<(...args: unknown[]) => unknown>(() => true);
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

import { requireOwnedItem } from "@/lib/plaid-item-route";

function requestWithBody(body: unknown): NextRequest {
  return {
    json: () => Promise.resolve(body),
  } as unknown as NextRequest;
}

describe("requireOwnedItem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockReturnValue(true);
  });

  it("returns the auth failure response when authentication fails", async () => {
    mockRequireUser.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );

    const result = await requireOwnedItem(requestWithBody({}), {
      rateLimitKey: (id) => `reconnect:${id}`,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.response.status).toBe(401);
  });

  it("returns bad request when JSON is malformed", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
    const request = {
      json: () => Promise.reject(new Error("bad json")),
    } as unknown as NextRequest;

    const result = await requireOwnedItem(request, {
      rateLimitKey: (id) => `reconnect:${id}`,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.response.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith("Invalid JSON body");
  });

  it("returns bad request when the body is valid JSON null", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "u1" } });

    const result = await requireOwnedItem(requestWithBody(null), {
      rateLimitKey: (id) => `reconnect:${id}`,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.response.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith("Invalid JSON body");
  });

  it("returns bad request when the body is an array", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "u1" } });

    const result = await requireOwnedItem(requestWithBody([]), {
      rateLimitKey: (id) => `reconnect:${id}`,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.response.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith("Invalid JSON body");
  });

  it("returns bad request when item_id is missing", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "u1" } });

    const result = await requireOwnedItem(requestWithBody({}), {
      rateLimitKey: (id) => `reconnect:${id}`,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.response.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith("item_id is required");
  });

  it("returns bad request when item_id is not a non-empty string", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "u1" } });

    const result = await requireOwnedItem(
      requestWithBody({ item_id: 42 }),
      { rateLimitKey: (id) => `reconnect:${id}` },
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.response.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith("item_id is required");
  });

  it("returns 429 when the rate limit is exceeded", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
    mockCheckRateLimit.mockResolvedValue(false);

    const result = await requireOwnedItem(requestWithBody({ item_id: "item-1" }), {
      rateLimitKey: (id) => `reconnect:${id}`,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.response.status).toBe(429);
    expect(mockCheckRateLimit).toHaveBeenCalledWith("reconnect:u1", 10, 60);
    expect(mockGetItem).not.toHaveBeenCalled();
  });

  it("returns 404 when the item is not found", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
    mockGetItem.mockResolvedValue(null);

    const result = await requireOwnedItem(requestWithBody({ item_id: "item-1" }), {
      rateLimitKey: (id) => `reconnect:${id}`,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.response.status).toBe(404);
    expect(mockGetItem).toHaveBeenCalledWith("u1", "item-1");
  });

  it("returns the user and item on success", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
    const mockItem = { id: "item-1", institution_name: "Chase" };
    mockGetItem.mockResolvedValue(mockItem);

    const result = await requireOwnedItem(requestWithBody({ item_id: "item-1" }), {
      rateLimitKey: (id) => `reconnect:${id}`,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unexpected failure");
    expect(result.user).toEqual({ id: "u1" });
    expect(result.item).toEqual(mockItem);
  });
});