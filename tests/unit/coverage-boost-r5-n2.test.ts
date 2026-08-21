import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const mockRequireUser = vi.fn<(...args: unknown[]) => unknown>();
const mockErrorResponse = vi.fn<(...args: unknown[]) => unknown>(
  (_ctx: unknown, error: unknown) =>
    NextResponse.json({ error: String((error as Error)?.message ?? error) }, { status: 500 }),
);
const mockBadRequest = vi.fn<(...args: unknown[]) => unknown>(
  (msg: unknown) => NextResponse.json({ error: String(msg) }, { status: 400 }),
);
vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  errorResponse: (...args: unknown[]) => mockErrorResponse(...args),
  badRequest: (...args: unknown[]) => mockBadRequest(...args),
}));

const mockWriteAudit = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
}));

import { clientStub } from "../fixtures/supabase-query";
import { DELETE, PATCH, POST } from "@/app/api/recurring/manual/route";

const ITEM_ID = "123e4567-e89b-12d3-a456-426614174000";
const validCreate = {
  name: "Piano lessons",
  amount: 80,
  frequency: "monthly",
  next_date: "2026-08-05",
  item_type: "expense",
  category: "Education",
};

function req(method: string, body: unknown, rejectJson = false): Request {
  return {
    url: "https://x.local/api/recurring/manual",
    json: rejectJson
      ? () => Promise.reject(new Error("bad json"))
      : () => Promise.resolve(body),
  } as unknown as Request;
}

function authFor(supabase: unknown) {
  mockRequireUser.mockResolvedValue({
    user: { id: "user-1", email: "test@example.com" },
    supabase,
  });
}

function rejectChain(...builders: string[]) {
  const chain: Record<string, vi.Mock> = { then: vi.fn() };
  for (const b of builders) chain[b] = vi.fn(() => chain);
  chain.then = (_resolve: (v: unknown) => unknown, reject: (e: Error) => unknown) =>
    reject(new Error("boom"));
  return chain;
}

describe("coverage-boost-r5-n2 recurring/manual/route.ts", () => {
  let client: ReturnType<typeof clientStub>;

  beforeEach(() => {
    vi.clearAllMocks();
    client = clientStub({
      manual_recurring_items: { data: { id: ITEM_ID }, error: null },
    });
    authFor(client);
  });

  describe("POST", () => {
    it("returns the auth response when unauthenticated", async () => {
      mockRequireUser.mockResolvedValue(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      );
      const res = await POST(req("POST", validCreate));
      expect(res.status).toBe(401);
    });

    it("rejects with Invalid JSON payload when json() rejects", async () => {
      const res = await POST(req("POST", validCreate, true));
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("Invalid JSON payload");
    });

    it("rejects a non-object payload", async () => {
      const res = await POST(req("POST", "not-an-object"));
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("Invalid JSON payload");
    });

    it("rejects an array payload", async () => {
      const res = await POST(req("POST", [validCreate]));
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("Invalid JSON payload");
    });

    it("rejects a non-string name", async () => {
      const res = await POST(req("POST", { ...validCreate, name: 123 }));
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("Invalid name");
    });

    it("rejects an empty or whitespace-only name", async () => {
      const res = await POST(req("POST", { ...validCreate, name: "   " }));
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("Invalid name");
    });

    it("rejects a name over 140 characters", async () => {
      const res = await POST(req("POST", { ...validCreate, name: "a".repeat(141) }));
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("Invalid name");
    });

    it("rejects a non-number amount", async () => {
      const res = await POST(req("POST", { ...validCreate, amount: "80" }));
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("Invalid amount");
    });

    it("rejects a non-finite amount", async () => {
      const res = await POST(req("POST", { ...validCreate, amount: NaN }));
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("Invalid amount");
    });

    it("rejects a zero or negative amount", async () => {
      expect((await POST(req("POST", { ...validCreate, amount: 0 }))).status).toBe(400);
      expect((await POST(req("POST", { ...validCreate, amount: -5 }))).status).toBe(400);
    });

    it("rejects a non-string frequency", async () => {
      const res = await POST(req("POST", { ...validCreate, frequency: 5 }));
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("Invalid frequency");
    });

    it("rejects an unknown frequency", async () => {
      const res = await POST(req("POST", { ...validCreate, frequency: "daily" }));
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("Invalid frequency");
    });

    it("rejects a non-string next_date", async () => {
      const res = await POST(req("POST", { ...validCreate, next_date: 8 }));
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("Invalid next_date");
    });

    it("rejects a malformed next_date", async () => {
      const res = await POST(req("POST", { ...validCreate, next_date: "08-05-2026" }));
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("Invalid next_date");
    });

    it("rejects a non-string item_type", async () => {
      const res = await POST(req("POST", { ...validCreate, item_type: 1 }));
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("Invalid item_type");
    });

    it("rejects an unknown item_type", async () => {
      const res = await POST(req("POST", { ...validCreate, item_type: "other" }));
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("Invalid item_type");
    });

    it("rejects a category that is neither null nor a string", async () => {
      const res = await POST(req("POST", { ...validCreate, category: 123 }));
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("Invalid category");
    });

    it("creates the item with a string category", async () => {
      const res = await POST(req("POST", validCreate));
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ id: ITEM_ID });
      expect(client.writtenTo("manual_recurring_items")).toEqual(
        expect.objectContaining({
          user_id: "user-1",
          name: "Piano lessons",
          amount: 80,
          frequency: "monthly",
          next_date: "2026-08-05",
          item_type: "expense",
          category: "Education",
          enabled: true,
        }),
      );
      expect(mockWriteAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "manual_recurring_item_created" }),
      );
    });

    it("creates the item with a null category", async () => {
      const res = await POST(req("POST", { ...validCreate, category: null }));
      expect(res.status).toBe(200);
      expect(client.writtenTo("manual_recurring_items")).toEqual(
        expect.objectContaining({ category: null }),
      );
    });

    it("creates the item when the category is omitted", async () => {
      const res = await POST(req("POST", { ...validCreate, category: undefined }));
      expect(res.status).toBe(200);
      expect(client.writtenTo("manual_recurring_items")).toEqual(
        expect.objectContaining({ category: null }),
      );
    });

    it("returns errorResponse when the insert fails", async () => {
      client = clientStub({
        manual_recurring_items: { data: null, error: { message: "db" } },
      });
      authFor(client);
      const res = await POST(req("POST", validCreate));
      expect(res.status).toBe(500);
      expect(mockErrorResponse).toHaveBeenCalledWith("recurring.manual.create", {
        message: "db",
      });
    });

    it("returns errorResponse when the insert chain rejects", async () => {
      authFor({ from: () => rejectChain("insert", "select", "single") });
      const res = await POST(req("POST", validCreate));
      expect(res.status).toBe(500);
      expect(mockErrorResponse).toHaveBeenCalledWith("recurring.manual.create", expect.any(Error));
    });
  });

  describe("PATCH", () => {
    it("returns the auth response when unauthenticated", async () => {
      mockRequireUser.mockResolvedValue(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      );
      const res = await PATCH(req("PATCH", { id: ITEM_ID, amount: 90 }));
      expect(res.status).toBe(401);
    });

    it("rejects with Invalid JSON payload when json() rejects", async () => {
      const res = await PATCH(req("PATCH", { id: ITEM_ID }, true));
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("Invalid JSON payload");
    });

    it("rejects a missing id", async () => {
      const res = await PATCH(req("PATCH", { amount: 90 }));
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("Invalid id");
    });

    it("rejects a non-string id", async () => {
      const res = await PATCH(req("PATCH", { id: 123 }));
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("Invalid id");
    });

    it("rejects a malformed id", async () => {
      const res = await PATCH(req("PATCH", { id: "invalid-uuid" }));
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("Invalid id");
    });

    it("accepts a patch with no fields", async () => {
      const res = await PATCH(req("PATCH", { id: ITEM_ID }));
      expect(res.status).toBe(200);
      expect(client.writtenTo("manual_recurring_items")).toEqual({});
    });

    it("updates only the provided field", async () => {
      const res = await PATCH(req("PATCH", { id: ITEM_ID, amount: 90 }));
      expect(res.status).toBe(200);
      expect(client.writtenTo("manual_recurring_items")).toEqual({ amount: 90 });
      expect(client.scopedToUser("manual_recurring_items", "user-1")).toBe(true);
      expect(mockWriteAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "manual_recurring_item_updated",
          metadata: { id: ITEM_ID, changed_fields: ["amount"] },
        }),
      );
    });

    it("updates every supported field", async () => {
      const res = await PATCH(
        req("PATCH", {
          id: ITEM_ID,
          name: "  Gym  ",
          amount: 45.5,
          frequency: "weekly",
          next_date: "2026-09-01",
          item_type: "income",
          category: "Salary",
          enabled: false,
        }),
      );
      expect(res.status).toBe(200);
      expect(client.writtenTo("manual_recurring_items")).toEqual({
        name: "Gym",
        amount: 45.5,
        frequency: "weekly",
        next_date: "2026-09-01",
        item_type: "income",
        category: "Salary",
        enabled: false,
      });
    });

    it("rejects an invalid name", async () => {
      expect((await PATCH(req("PATCH", { id: ITEM_ID, name: "" }))).status).toBe(400);
      expect((await PATCH(req("PATCH", { id: ITEM_ID, name: "  " }))).status).toBe(400);
      expect((await PATCH(req("PATCH", { id: ITEM_ID, name: "a".repeat(141) }))).status).toBe(400);
      expect((await PATCH(req("PATCH", { id: ITEM_ID, name: 123 }))).status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("Invalid name");
    });

    it("rejects an invalid amount", async () => {
      expect((await PATCH(req("PATCH", { id: ITEM_ID, amount: 0 }))).status).toBe(400);
      expect((await PATCH(req("PATCH", { id: ITEM_ID, amount: -50 }))).status).toBe(400);
      expect((await PATCH(req("PATCH", { id: ITEM_ID, amount: NaN }))).status).toBe(400);
      expect((await PATCH(req("PATCH", { id: ITEM_ID, amount: "90" }))).status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("Invalid amount");
    });

    it("rejects an invalid frequency", async () => {
      expect((await PATCH(req("PATCH", { id: ITEM_ID, frequency: "yearly-plus" }))).status).toBe(400);
      expect((await PATCH(req("PATCH", { id: ITEM_ID, frequency: 5 }))).status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("Invalid frequency");
    });

    it("rejects an invalid next_date", async () => {
      expect((await PATCH(req("PATCH", { id: ITEM_ID, next_date: "invalid" }))).status).toBe(400);
      expect((await PATCH(req("PATCH", { id: ITEM_ID, next_date: 9 }))).status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("Invalid next_date");
    });

    it("rejects an invalid item_type", async () => {
      expect((await PATCH(req("PATCH", { id: ITEM_ID, item_type: "invalid" }))).status).toBe(400);
      expect((await PATCH(req("PATCH", { id: ITEM_ID, item_type: 1 }))).status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("Invalid item_type");
    });

    it("accepts a null category and rejects a non-string one", async () => {
      const ok = await PATCH(req("PATCH", { id: ITEM_ID, category: null }));
      expect(ok.status).toBe(200);
      expect(client.writtenTo("manual_recurring_items")).toEqual({ category: null });
      const bad = await PATCH(req("PATCH", { id: ITEM_ID, category: 123 }));
      expect(bad.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("Invalid category");
    });

    it("rejects an invalid enabled value and accepts a boolean", async () => {
      const bad = await PATCH(req("PATCH", { id: ITEM_ID, enabled: "yes" }));
      expect(bad.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("Invalid enabled");
      const ok = await PATCH(req("PATCH", { id: ITEM_ID, enabled: true }));
      expect(ok.status).toBe(200);
      expect(client.writtenTo("manual_recurring_items")).toEqual({ enabled: true });
    });

    it("returns errorResponse when the update fails", async () => {
      client = clientStub({
        manual_recurring_items: { data: null, error: { message: "db" } },
      });
      authFor(client);
      const res = await PATCH(req("PATCH", { id: ITEM_ID, amount: 90 }));
      expect(res.status).toBe(500);
      expect(mockErrorResponse).toHaveBeenCalledWith("recurring.manual.update", {
        message: "db",
      });
    });

    it("returns 404 when the owner filter matches nothing", async () => {
      client = clientStub({
        manual_recurring_items: { data: null, error: null },
      });
      authFor(client);
      const res = await PATCH(req("PATCH", { id: ITEM_ID, amount: 90 }));
      expect(res.status).toBe(404);
      await expect(res.json()).resolves.toEqual({ error: "Manual item not found" });
    });

    it("returns errorResponse when the update chain rejects", async () => {
      authFor({ from: () => rejectChain("update", "eq", "select", "maybeSingle") });
      const res = await PATCH(req("PATCH", { id: ITEM_ID, amount: 90 }));
      expect(res.status).toBe(500);
      expect(mockErrorResponse).toHaveBeenCalledWith("recurring.manual.update", expect.any(Error));
    });
  });

  describe("DELETE", () => {
    it("returns the auth response when unauthenticated", async () => {
      mockRequireUser.mockResolvedValue(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      );
      const res = await DELETE(req("DELETE", { id: ITEM_ID }));
      expect(res.status).toBe(401);
    });

    it("rejects with Invalid id when json() rejects", async () => {
      const res = await DELETE(req("DELETE", { id: ITEM_ID }, true));
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("Invalid id");
    });

    it("rejects a missing id", async () => {
      const res = await DELETE(req("DELETE", {}));
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("Invalid id");
    });

    it("rejects a non-string id", async () => {
      const res = await DELETE(req("DELETE", { id: 123 }));
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("Invalid id");
    });

    it("rejects a malformed id", async () => {
      const res = await DELETE(req("DELETE", { id: "invalid-uuid" }));
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("Invalid id");
    });

    it("deletes the item and audits it", async () => {
      const res = await DELETE(req("DELETE", { id: ITEM_ID }));
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ id: ITEM_ID });
      expect(client.scopedToUser("manual_recurring_items", "user-1")).toBe(true);
      expect(mockWriteAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "manual_recurring_item_deleted",
          metadata: { id: ITEM_ID },
        }),
      );
    });

    it("returns errorResponse when the delete fails", async () => {
      client = clientStub({
        manual_recurring_items: { data: null, error: { message: "db" } },
      });
      authFor(client);
      const res = await DELETE(req("DELETE", { id: ITEM_ID }));
      expect(res.status).toBe(500);
      expect(mockErrorResponse).toHaveBeenCalledWith("recurring.manual.delete", {
        message: "db",
      });
    });

    it("returns errorResponse when the delete chain rejects", async () => {
      authFor({ from: () => rejectChain("delete", "eq") });
      const res = await DELETE(req("DELETE", { id: ITEM_ID }));
      expect(res.status).toBe(500);
      expect(mockErrorResponse).toHaveBeenCalledWith("recurring.manual.delete", expect.any(Error));
    });
  });
});