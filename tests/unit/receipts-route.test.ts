import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { clientStub } from "../fixtures/supabase-query";

const mockRequireUser = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  badRequest: (message: string) => NextResponse.json({ error: message }, { status: 400 }),
  errorResponse: (_context: string, error: unknown) =>
    NextResponse.json({ error: error instanceof Error ? error.message : "error" }, { status: 500 }),
}));

const mockCheckRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

const mockNormalize = vi.fn();
vi.mock("@/lib/receipt-image", () => ({
  normalizeReceiptImage: (...args: unknown[]) => mockNormalize(...args),
}));

const mockWriteAudit = vi.fn();
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
  getClientIp: () => "127.0.0.1",
}));

let service = makeService();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => service,
}));

import { GET, POST } from "@/app/api/receipts/route";
import { DELETE, PATCH } from "@/app/api/receipts/[id]/route";

const USER_ID = "user-1";
const RECEIPT = {
  id: "receipt-1",
  user_id: USER_ID,
  transaction_id: null,
  storage_path: `${USER_ID}/receipt-1.jpg`,
  merchant: "Cafe",
  purchase_date: "2026-08-09",
  total: 24.5,
  status: "unmatched",
  created_at: "2026-08-09T12:00:00Z",
};

function makeService(
  seeds: Record<string, { data?: unknown; error?: unknown }> = {},
  storageSeed: {
    uploadError?: unknown;
    removeError?: unknown;
    signedUrl?: string;
  } = {},
) {
  const db = clientStub(seeds);
  const upload = vi.fn().mockResolvedValue({ error: storageSeed.uploadError ?? null });
  const remove = vi.fn().mockResolvedValue({ error: storageSeed.removeError ?? null });
  const createSignedUrl = vi.fn().mockResolvedValue({
    data: { signedUrl: storageSeed.signedUrl ?? "https://signed.example/receipt" },
    error: null,
  });
  return {
    ...db,
    storage: {
      from: vi.fn(() => ({ upload, remove, createSignedUrl })),
    },
    upload,
    remove,
    createSignedUrl,
  };
}

function uploadRequest(file = new File([new Uint8Array([1])], "receipt.png", { type: "image/png" })) {
  const form = new FormData();
  form.set("file", file);
  form.set("merchant", "Cafe");
  form.set("purchaseDate", "2026-08-09");
  form.set("total", "24.50");
  return new NextRequest("http://localhost/api/receipts", { method: "POST", body: form });
}

function jsonRequest(method: string, body?: unknown) {
  return new NextRequest("http://localhost/api/receipts/receipt-1", {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const context = { params: Promise.resolve({ id: "receipt-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckRateLimit.mockResolvedValue(true);
  mockNormalize.mockResolvedValue({
    buffer: Buffer.from([1, 2, 3]),
    contentType: "image/jpeg",
    extension: "jpg",
    width: 10,
    height: 10,
  });
  mockRequireUser.mockResolvedValue({
    user: { id: USER_ID },
    supabase: clientStub({ transactions: { data: [] }, receipts: { data: RECEIPT } }),
  });
  service = makeService({ receipts: { data: RECEIPT } });
});

describe("POST /api/receipts", () => {
  it("returns the authentication response", async () => {
    const unauthorized = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    mockRequireUser.mockResolvedValue(unauthorized);

    await expect(POST(uploadRequest())).resolves.toBe(unauthorized);
  });

  it("rate limits before decoding an upload", async () => {
    mockCheckRateLimit.mockResolvedValue(false);

    const response = await POST(uploadRequest());

    expect(response.status).toBe(429);
    expect(mockNormalize).not.toHaveBeenCalled();
  });

  it("normalizes, uploads, inserts an owned row, and audits ids only", async () => {
    const response = await POST(uploadRequest());

    expect(response.status).toBe(201);
    expect(service.upload).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^${USER_ID}/.+\\.jpg$`)),
      expect.any(Buffer),
      { contentType: "image/jpeg", upsert: false },
    );
    expect(service.writtenTo("receipts")).toMatchObject({
      user_id: USER_ID,
      merchant: "Cafe",
      purchase_date: "2026-08-09",
      total: 24.5,
      status: "unmatched",
    });
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "receipt_uploaded",
        metadata: { receipt_id: "receipt-1" },
      }),
    );
  });

  it("returns 500 when storage upload returns error", async () => {
    service = makeService({}, { uploadError: { message: "Storage Upload Error" } });

    const response = await POST(uploadRequest());
    expect(response.status).toBe(500);
  });

  it("removes the uploaded object when row insertion fails", async () => {
    service = makeService({ receipts: { data: null, error: { message: "insert failed" } } });

    const response = await POST(uploadRequest());
    expect(response.status).toBe(500);
    expect(service.remove).toHaveBeenCalledWith([expect.stringMatching(new RegExp(`^${USER_ID}/`))]);
  });

  it.each([
    ["merchant too long", "merchant", "x".repeat(161), "merchant is too long"],
    ["invalid purchaseDate", "purchaseDate", "invalid-date", "purchaseDate is invalid"],
    ["negative total", "total", "-10", "total must be positive"],
  ])("rejects invalid form payload with 400 when %s", async (_name, field, value, expectedError) => {
    const form = new FormData();
    form.set("file", new File([new Uint8Array([1])], "receipt.png", { type: "image/png" }));
    form.set(field, value);
    const req = new NextRequest("http://localhost/api/receipts", { method: "POST", body: form });

    const response = await POST(req);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toBe(expectedError);
  });

  it("throws signedError when createSignedUrl fails", async () => {
    service = makeService();
    service.createSignedUrl.mockResolvedValueOnce({ data: null, error: new Error("Signed URL failed") });

    const response = await POST(uploadRequest());
    expect(response.status).toBe(500);
  });
});

describe("GET /api/receipts", () => {
  it("returns signed views without exposing storage paths", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER_ID },
      supabase: clientStub({ receipts: { data: [RECEIPT] }, transactions: { data: [] } }),
    });

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.receipts[0].imageUrl).toBe("https://signed.example/receipt");
    expect(payload.receipts[0].storage_path).toBeUndefined();
    expect(service.createSignedUrl).toHaveBeenCalledWith(RECEIPT.storage_path, 3600);
  });

  it("returns 500 when receipts list query fails", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER_ID },
      supabase: clientStub({ receipts: { data: null, error: { message: "List error" } } }),
    });

    const response = await GET();
    expect(response.status).toBe(500);
  });
});

describe("PATCH /api/receipts/[id]", () => {
  it("rejects an invalid action with 400", async () => {
    const response = await PATCH(jsonRequest("PATCH", { action: "invalid_action" }), context);
    expect(response.status).toBe(400);
  });

  it("404s when the target receipt is not found", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER_ID },
      supabase: clientStub({ receipts: { data: null } }),
    });

    const response = await PATCH(jsonRequest("PATCH", { action: "ignore" }), context);
    expect(response.status).toBe(404);
  });

  it("404s when attaching to a non-existent transaction", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER_ID },
      supabase: clientStub({ receipts: { data: RECEIPT }, transactions: { data: null } }),
    });

    const response = await PATCH(jsonRequest("PATCH", { action: "attach", transactionId: "missing-t" }), context);
    expect(response.status).toBe(404);
  });

  it("attaches only to an owned transaction and scopes the service update", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER_ID },
      supabase: clientStub({
        receipts: { data: RECEIPT },
        transactions: { data: { id: "transaction-1" } },
      }),
    });
    service = makeService({ receipts: { data: { ...RECEIPT, transaction_id: "transaction-1", status: "matched" } } });

    const response = await PATCH(jsonRequest("PATCH", { action: "attach", transactionId: "transaction-1" }), context);

    expect(response.status).toBe(200);
    expect(service.writtenTo("receipts")).toEqual({ transaction_id: "transaction-1", status: "matched" });
    expect(service.scopedToUser("receipts", USER_ID)).toBe(true);
  });

  it("rejects an attach action missing transactionId with 400", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER_ID },
      supabase: clientStub({ receipts: { data: RECEIPT } }),
    });

    const response = await PATCH(jsonRequest("PATCH", { action: "attach" }), context);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toBe("transactionId is required");
  });

  it("returns 500 when service update returns an error", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER_ID },
      supabase: clientStub({ receipts: { data: RECEIPT } }),
    });
    service = makeService({ receipts: { data: null, error: { message: "Update Error" } } });

    const response = await PATCH(jsonRequest("PATCH", { action: "ignore" }), context);
    expect(response.status).toBe(500);
  });

  it.each([
    ["ignore", { transaction_id: null, status: "ignored" }],
    ["restore", { transaction_id: null, status: "unmatched" }],
  ])("supports the %s state transition", async (action, expectedWrite) => {
    service = makeService({ receipts: { data: { ...RECEIPT, status: expectedWrite.status } } });

    const response = await PATCH(jsonRequest("PATCH", { action }), context);

    expect(response.status).toBe(200);
    expect(service.writtenTo("receipts")).toEqual(expectedWrite);
  });
});

describe("DELETE /api/receipts/[id]", () => {
  it("404s when deleting a non-existent receipt", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER_ID },
      supabase: clientStub({ receipts: { data: null } }),
    });

    const response = await DELETE(jsonRequest("DELETE"), context);
    expect(response.status).toBe(404);
  });

  it("removes the private object before deleting the owner-scoped row", async () => {
    service = makeService({ receipts: { error: null } });

    const response = await DELETE(jsonRequest("DELETE"), context);

    expect(response.status).toBe(200);
    expect(service.remove).toHaveBeenCalledWith([RECEIPT.storage_path]);
    expect(service.scopedToUser("receipts", USER_ID)).toBe(true);
  });

  it("leaves the database row recoverable when object removal fails", async () => {
    service = makeService({}, { removeError: { message: "storage down" } });

    const response = await DELETE(jsonRequest("DELETE"), context);
    expect(response.status).toBe(500);

    expect(service.callsOn("receipts")).toEqual([]);
  });
});
