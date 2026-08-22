import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { clientStub } from "@/tests/fixtures/supabase-query";

const mockRequireUser = vi.fn<(...args: unknown[]) => unknown>();
const mockErrorResponse = vi.fn<(...args: unknown[]) => unknown>(
  (_context: unknown, error: unknown) => NextResponse.json({ error: String(error) }, { status: 500 }),
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
const mockGetClientIp = vi.fn<(...args: unknown[]) => unknown>(() => "127.0.0.1");
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
  getClientIp: (...args: unknown[]) => mockGetClientIp(...args),
}));

const mockIsFeatureEnabled = vi.fn<(...args: unknown[]) => boolean>(() => true);
vi.mock("@/lib/feature-flags", () => ({
  isFeatureEnabled: (...args: unknown[]) => mockIsFeatureEnabled(...args),
}));

import { POST as tagsPost, PATCH as tagsPatch, DELETE as tagsDelete } from "@/app/api/settings/tags/route";

function jsonRequest(body: unknown) {
  return { url: "https://x.local", json: async () => body } as unknown as NextRequest;
}

function rejectingJsonRequest() {
  return { url: "https://x.local", json: () => Promise.reject(new Error("json fail")) } as unknown as NextRequest;
}

describe("coverage boost r6 n2: settings/tags route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsFeatureEnabled.mockReturnValue(true);
  });

  describe("POST /api/settings/tags", () => {
    it("returns 404 when settingsIa is off (L10 false, L11, B@10)", async () => {
      mockIsFeatureEnabled.mockReturnValue(false);
      const res = await tagsPost(jsonRequest({ name: "Groceries" }));
      expect(res.status).toBe(404);
      expect(mockRequireUser).not.toHaveBeenCalled();
    });

    it("returns 401 when not authenticated (L18 true, B@18)", async () => {
      mockRequireUser.mockResolvedValue(new NextResponse("unauthorized", { status: 401 }));
      const res = await tagsPost(jsonRequest({ name: "Groceries" }));
      expect(res.status).toBe(401);
    });

    it("rejects when json() rejects (L22 catch arrow, L24 true, B@24)", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: clientStub({}) });
      const res = await tagsPost(rejectingJsonRequest());
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("name must be a string");
    });

    it("rejects a non-string name", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: clientStub({}) });
      const res = await tagsPost(jsonRequest({ name: 42 }));
      expect(res.status).toBe(400);
    });

    it("creates a tag and returns 201 (L24 false, L31 false, L36)", async () => {
      const supabase = clientStub({ user_tags: { data: { id: "t1", name: "Groceries", color_slot: 2 }, error: null } });
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
      const res = await tagsPost(jsonRequest({ name: "  Groceries  " }));
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body).toEqual({ tag: { id: "t1", name: "Groceries", color_slot: 2 } });
      expect(supabase.writtenTo("user_tags")).toEqual({ user_id: "u1", name: "Groceries" });
    });

    it("maps a 23505 unique violation to a duplicate-name bad request (L31 true, L32 true, B@31, B@32)", async () => {
      const supabase = clientStub({ user_tags: { data: null, error: { code: "23505", message: "duplicate" } } });
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
      const res = await tagsPost(jsonRequest({ name: "Groceries" }));
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("That tag already exists.");
    });

    it("throws on a non-duplicate insert error (L32 false, L33, L38)", async () => {
      const supabase = clientStub({ user_tags: { data: null, error: { code: "PGRST301", message: "boom" } } });
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
      const res = await tagsPost(jsonRequest({ name: "Groceries" }));
      expect(res.status).toBe(500);
      expect(mockErrorResponse).toHaveBeenCalledWith("settings.tags.create", expect.any(Object));
    });
  });

  describe("PATCH /api/settings/tags", () => {
    it("returns 404 when settingsIa is off (L43, L44 true)", async () => {
      mockIsFeatureEnabled.mockReturnValue(false);
      const res = await tagsPatch(jsonRequest({ oldName: "A", newName: "B" }));
      expect(res.status).toBe(404);
    });

    it("returns 401 when not authenticated (L46 true, B@46)", async () => {
      mockRequireUser.mockResolvedValue(new NextResponse("unauthorized", { status: 401 }));
      const res = await tagsPatch(jsonRequest({ oldName: "A", newName: "B" }));
      expect(res.status).toBe(401);
    });

    it("rejects when json() rejects (L50 catch arrow, L61 true)", async () => {
      const supabase = clientStub({ user_tags: { data: [], error: null } });
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
      const res = await tagsPatch(rejectingJsonRequest());
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith(expect.stringContaining("old name"));
    });

    it("throws when listing existing tags fails (L58 true, L78)", async () => {
      const supabase = clientStub({ user_tags: { data: null, error: new Error("list boom") } });
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
      const res = await tagsPatch(jsonRequest({ oldName: "A", newName: "B" }));
      expect(res.status).toBe(500);
      expect(mockErrorResponse).toHaveBeenCalledWith("settings.tags.rename", expect.any(Error));
    });

    it("renames a tag via RPC (L60 map, L61 false, L67 false, L71 false, L76)", async () => {
      const supabase = clientStub({ user_tags: { data: [{ name: "Groceries" }, { name: "Dining" }], error: null } });
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
      const res = await tagsPatch(jsonRequest({ oldName: "Groceries", newName: "Shopping" }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true, merged: false });
      expect(supabase.rpc).toHaveBeenCalledWith("rename_user_tag", {
        p_old_name: "Groceries",
        p_new_name: "Shopping",
      });
      expect(mockWriteAudit).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "u1", action: "tag_renamed", metadata: { old_name: "Groceries", new_name: "Shopping" } }),
      );
    });

    it("merges when the target name already exists (L71 true, L76 merged)", async () => {
      const supabase = clientStub({ user_tags: { data: [{ name: "Groceries" }, { name: "Dining" }], error: null } });
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
      const res = await tagsPatch(jsonRequest({ oldName: "Groceries", newName: "Dining" }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true, merged: true });
      expect(mockWriteAudit).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "u1", action: "tag_merged" }),
      );
    });

    it("throws when the RPC fails (L67 true)", async () => {
      const supabase = clientStub({ user_tags: { data: [{ name: "Groceries" }], error: null } });
      supabase.rpc = vi.fn(() => ({ then: (resolve: (v: unknown) => unknown) => resolve({ error: new Error("rpc boom") }) })) as unknown as typeof supabase.rpc;
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
      const res = await tagsPatch(jsonRequest({ oldName: "Groceries", newName: "Shopping" }));
      expect(res.status).toBe(500);
      expect(mockErrorResponse).toHaveBeenCalledWith("settings.tags.rename", expect.any(Error));
    });
  });

  describe("DELETE /api/settings/tags", () => {
    it("returns 404 when settingsIa is off (L83, L84 true)", async () => {
      mockIsFeatureEnabled.mockReturnValue(false);
      const res = await tagsDelete(jsonRequest({ name: "Groceries" }));
      expect(res.status).toBe(404);
    });

    it("returns 401 when not authenticated (L86 true, B@86)", async () => {
      mockRequireUser.mockResolvedValue(new NextResponse("unauthorized", { status: 401 }));
      const res = await tagsDelete(jsonRequest({ name: "Groceries" }));
      expect(res.status).toBe(401);
    });

    it("rejects when json() rejects (L90 catch arrow, L92 true, B@92)", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: clientStub({}) });
      const res = await tagsDelete(rejectingJsonRequest());
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("name must be a string");
    });

    it("deletes a tag and audits (L92 false, L99 false, L108)", async () => {
      const supabase = clientStub({ user_tags: { data: null, error: null } });
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
      const res = await tagsDelete(jsonRequest({ name: "Groceries" }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true });
      expect(supabase.callsOn("user_tags")).toContainEqual({ method: "eq", args: ["name", "Groceries"] });
      expect(mockWriteAudit).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "u1", action: "tag_deleted", metadata: { name: "Groceries" } }),
      );
    });

    it("throws when the delete fails (L99 true, L110)", async () => {
      const supabase = clientStub({ user_tags: { data: null, error: new Error("delete boom") } });
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
      const res = await tagsDelete(jsonRequest({ name: "Groceries" }));
      expect(res.status).toBe(500);
      expect(mockErrorResponse).toHaveBeenCalledWith("settings.tags.delete", expect.any(Error));
    });
  });
});