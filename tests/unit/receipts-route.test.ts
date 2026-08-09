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

  it("removes the uploaded object when row insertion fails", async () => {
    service = makeService({ receipts: { data: null, error: new Error("insert failed") } });

    await expect(POST(uploadRequest())).rejects.toThrow("insert failed");

    expect(service.remove).toHaveBeenCalledWith([expect.stringMatching(new RegExp(`^${USER_ID}/`))]);
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
});

describe("PATCH /api/receipts/[id]", () => {
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
  it("removes the private object before deleting the owner-scoped row", async () => {
    service = makeService({ receipts: { error: null } });

    const response = await DELETE(jsonRequest("DELETE"), context);

    expect(response.status).toBe(200);
    expect(service.remove).toHaveBeenCalledWith([RECEIPT.storage_path]);
    expect(service.scopedToUser("receipts", USER_ID)).toBe(true);
  });

  it("leaves the database row recoverable when object removal fails", async () => {
    service = makeService({}, { removeError: new Error("storage down") });

    await expect(DELETE(jsonRequest("DELETE"), context)).rejects.toThrow("storage down");

    expect(service.callsOn("receipts")).toEqual([]);
  });
});
