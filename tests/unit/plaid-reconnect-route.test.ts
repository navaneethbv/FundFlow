import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRequireUser = vi.fn();
const mockErrorResponse = vi.fn();
const mockBadRequest = vi.fn((msg) => new Response(msg, { status: 400 }));
vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  errorResponse: (...args: unknown[]) => mockErrorResponse(...args),
  badRequest: (msg: string) => mockBadRequest(msg),
}));

const mockGetItem = vi.fn();
const mockSetItemStatus = vi.fn();
vi.mock("@/lib/plaid-service", () => ({
  getItem: (...args: unknown[]) => mockGetItem(...args),
  setItemStatus: (...args: unknown[]) => mockSetItemStatus(...args),
}));

const mockSyncItemTransactions = vi.fn();
vi.mock("@/lib/sync", () => ({
  syncItemTransactions: (...args: unknown[]) =>
    mockSyncItemTransactions(...args),
}));

const mockWriteAudit = vi.fn();
const mockGetClientIp = vi.fn(() => "127.0.0.1");
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
  getClientIp: (...args: unknown[]) => mockGetClientIp(...args),
}));

const mockLogError = vi.fn();
vi.mock("@/lib/log", () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
}));

import { POST } from "@/app/api/plaid/reconnect/route";
import { NextRequest } from "next/server";

describe("POST /api/plaid/reconnect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns bad request if JSON is invalid", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
    const request = {
      json: () => Promise.reject(new Error("bad json")),
    } as unknown as NextRequest;

    const res = await POST(request);
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith("Invalid JSON body");
  });

  it("returns bad request if item_id is missing", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
    const request = {
      json: () => Promise.resolve({}),
    } as unknown as NextRequest;

    const res = await POST(request);
    expect(res.status).toBe(400);
    expect(mockBadRequest).toHaveBeenCalledWith("item_id is required");
  });

  it("returns 404 if item is not found", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
    const request = {
      json: () => Promise.resolve({ item_id: "item-1" }),
    } as unknown as NextRequest;
    mockGetItem.mockResolvedValue(null);

    const res = await POST(request);
    expect(res.status).toBe(404);
  });

  it("sets status to active, triggers sync, writes audit log, and returns success", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
    const request = {
      json: () => Promise.resolve({ item_id: "item-1" }),
    } as unknown as NextRequest;

    const mockItem = { id: "item-1", institution_name: "Chase" };
    mockGetItem.mockResolvedValue(mockItem);

    const res = await POST(request);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });

    expect(mockSetItemStatus).toHaveBeenCalledWith("item-1", "active", null);
    expect(mockSyncItemTransactions).toHaveBeenCalledWith({
      ...mockItem,
      status: "active",
    });
    expect(mockWriteAudit).toHaveBeenCalledWith({
      userId: "u1",
      action: "plaid_reconnect",
      metadata: { institution_name: "Chase" },
      ip: "127.0.0.1",
    });
  });

  it("proceeds successfully even if immediate sync throws an error", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
    const request = {
      json: () => Promise.resolve({ item_id: "item-1" }),
    } as unknown as NextRequest;

    const mockItem = { id: "item-1", institution_name: "Chase" };
    mockGetItem.mockResolvedValue(mockItem);
    mockSyncItemTransactions.mockRejectedValue(new Error("Sync Failed"));

    const res = await POST(request);
    expect(res.status).toBe(200);
    expect(mockLogError).toHaveBeenCalledWith(
      "plaid.reconnect.sync",
      expect.any(Error),
    );
  });
});
