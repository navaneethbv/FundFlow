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

import { PATCH as profilePatch, POST as profilePost, DELETE as profileDelete } from "@/app/api/settings/profile/route";

function supabaseWith(profilesSeed: unknown, storageResolvers: { upload?: unknown; remove?: unknown } = {}) {
  const supabase = clientStub({ profiles: profilesSeed });
  supabase.storage = {
    from: vi.fn().mockReturnValue({
      upload: storageResolvers.upload ?? vi.fn().mockResolvedValue({ error: null }),
      remove: storageResolvers.remove ?? vi.fn().mockResolvedValue({ error: null }),
    }),
  };
  return supabase;
}

function jsonRequest(body: unknown) {
  return { url: "https://x.local", json: async () => body } as unknown as NextRequest;
}

function rejectingJsonRequest() {
  return { url: "https://x.local", json: () => Promise.reject(new Error("json fail")) } as unknown as NextRequest;
}

function formRequest(formData: FormData | (() => Promise<FormData>)) {
  return {
    url: "https://x.local",
    formData: typeof formData === "function" ? formData : async () => formData,
  } as unknown as NextRequest;
}

const png = new File(["fake-png-bytes"], "avatar.png", { type: "image/png" });

describe("coverage boost r6 n1: settings/profile route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsFeatureEnabled.mockReturnValue(true);
    mockGetClientIp.mockReturnValue("127.0.0.1");
  });

  describe("PATCH /api/settings/profile", () => {
    it("returns 404 when settingsIa is off (L11 false, L12, B@11)", async () => {
      mockIsFeatureEnabled.mockReturnValue(false);
      const res = await profilePatch(jsonRequest({ kind: "profile" }));
      expect(res.status).toBe(404);
      expect(mockRequireUser).not.toHaveBeenCalled();
    });

    it("returns 401 when not authenticated (L94 true, B@94)", async () => {
      mockRequireUser.mockResolvedValue(new NextResponse("unauthorized", { status: 401 }));
      const res = await profilePatch(jsonRequest({ kind: "profile" }));
      expect(res.status).toBe(401);
    });

    it("rejects when json() rejects (L98 catch arrow, L100 false, L102 false, L111)", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: supabaseWith({ data: null, error: null }) });
      const res = await profilePatch(rejectingJsonRequest());
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("kind must be 'profile' or 'display'");
    });

    it("rejects an invalid profile patch (L34 true, B@34)", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: supabaseWith({ data: null, error: null }) });
      const res = await profilePatch(jsonRequest({ kind: "profile", fullName: 123 }));
      expect(res.status).toBe(400);
    });

    it("patches only full_name when the others are absent (L36 true, L37/38 false)", async () => {
      const supabase = supabaseWith({ data: null, error: null });
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
      const res = await profilePatch(jsonRequest({ kind: "profile", fullName: "  Alice  " }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true });
      expect(supabase.writtenTo("profiles")).toEqual({ full_name: "Alice" });
      expect(supabase.callsOn("profiles")).toContainEqual({ method: "eq", args: ["id", "u1"] });
      expect(mockWriteAudit).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "u1", action: "profile_updated", metadata: { fields: ["full_name"] } }),
      );
    });

    it("patches displayName and a null birthday (L36 false, L37 true, L38 true)", async () => {
      const supabase = supabaseWith({ data: null, error: null });
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
      const res = await profilePatch(jsonRequest({ kind: "profile", displayName: "Bobby", birthday: null }));
      expect(res.status).toBe(200);
      expect(supabase.writtenTo("profiles")).toEqual({ display_name: "Bobby", birthday: null });
    });

    it("returns 500 when the profiles update throws (L40 true, L113)", async () => {
      const supabase = supabaseWith({ data: null, error: new Error("update boom") });
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
      const res = await profilePatch(jsonRequest({ kind: "profile", fullName: "Alice" }));
      expect(res.status).toBe(500);
      expect(mockErrorResponse).toHaveBeenCalledWith("settings.profile.patch", expect.any(Error));
    });

    it("merges display prefs and writes back (L60, L61 false, L68, L80, L102 true)", async () => {
      const supabase = supabaseWith({ data: { display_prefs: { density: "compact" } }, error: null });
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
      const res = await profilePatch(jsonRequest({ kind: "display", prefs: { theme: "dark" } }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({
        ok: true,
        prefs: { theme: "dark", density: "compact", defaultPrivacyBlur: false, reducedMotion: "system" },
      });
      expect(mockWriteAudit).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "u1", action: "display_prefs_updated", metadata: { fields: ["theme"] } }),
      );
    });

    it("rejects an invalid display prefs patch (L61 true, B@61)", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: supabaseWith({ data: null, error: null }) });
      const res = await profilePatch(jsonRequest({ kind: "display", prefs: { theme: "bogus" } }));
      expect(res.status).toBe(400);
    });

    it("returns 500 when reading display prefs fails (L67 true, B@67)", async () => {
      const supabase = supabaseWith({ data: null, error: new Error("read boom") });
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
      const res = await profilePatch(jsonRequest({ kind: "display", prefs: { theme: "dark" } }));
      expect(res.status).toBe(500);
      expect(mockErrorResponse).toHaveBeenCalledWith("settings.profile.patch", expect.any(Error));
    });

    it("returns 500 when writing display prefs fails (L73 true, B@73)", async () => {
      const readChain = {
        select: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }),
      };
      const supabase = clientStub({});
      supabase.from = vi.fn().mockImplementation((table: string) => {
        if (table === "profiles") return readChain;
        return { update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: new Error("write boom") }) }) };
      });
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
      const res = await profilePatch(jsonRequest({ kind: "display", prefs: { theme: "dark" } }));
      expect(res.status).toBe(500);
      expect(mockErrorResponse).toHaveBeenCalledWith("settings.profile.patch", expect.any(Error));
    });
  });

  describe("POST /api/settings/profile (avatar upload)", () => {
    it("returns 404 when settingsIa is off (L119, L120 true)", async () => {
      mockIsFeatureEnabled.mockReturnValue(false);
      const res = await profilePost(formRequest(new FormData()));
      expect(res.status).toBe(404);
    });

    it("returns 401 when not authenticated (L122 true, B@122)", async () => {
      mockRequireUser.mockResolvedValue(new NextResponse("unauthorized", { status: 401 }));
      const res = await profilePost(formRequest(new FormData()));
      expect(res.status).toBe(401);
    });

    it("rejects when formData rejects (L126 catch arrow, L128 true)", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: supabaseWith({ data: null, error: null }) });
      const res = await profilePost(formRequest(() => Promise.reject(new Error("form fail"))));
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("file is required");
    });

    it("rejects a missing file (L127)", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: supabaseWith({ data: null, error: null }) });
      const form = new FormData();
      const res = await profilePost(formRequest(form));
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("file is required");
    });

    it("rejects an oversized file (L129 true, B@129)", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: supabaseWith({ data: null, error: null }) });
      const big = new File(["x"], "big.png", { type: "image/png" });
      Object.defineProperty(big, "size", { value: 3 * 1024 * 1024 + 1 });
      const form = new FormData();
      form.set("file", big);
      const res = await profilePost(formRequest(form));
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("Image too large (3 MB max)");
    });

    it("rejects an unsupported image type (L130, L131 true)", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: supabaseWith({ data: null, error: null }) });
      const weird = new File(["x"], "x.bin", { type: "application/octet-stream" });
      const form = new FormData();
      form.set("file", weird);
      const res = await profilePost(formRequest(form));
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("Unsupported image type");
    });

    it("uploads the avatar and updates the profile path (L128-151 happy path)", async () => {
      const upload = vi.fn().mockResolvedValue({ error: null });
      const supabase = supabaseWith({ data: null, error: null }, { upload });
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
      const form = new FormData();
      form.set("file", png);
      const res = await profilePost(formRequest(form));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true, path: "u1/avatar.png" });
      expect(upload).toHaveBeenCalledWith("u1/avatar.png", png, { contentType: "image/png", upsert: true });
      expect(mockWriteAudit).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "u1", action: "avatar_updated", metadata: {} }),
      );
    });

    it("returns 500 when the storage upload throws (L137 true, L153)", async () => {
      const supabase = supabaseWith({ data: null, error: null }, { upload: vi.fn().mockResolvedValue({ error: new Error("upload boom") }) });
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
      const form = new FormData();
      form.set("file", png);
      const res = await profilePost(formRequest(form));
      expect(res.status).toBe(500);
      expect(mockErrorResponse).toHaveBeenCalledWith("settings.profile.avatar.upload", expect.any(Error));
    });

    it("returns 500 when the profile update throws (L143 true)", async () => {
      const upload = vi.fn().mockResolvedValue({ error: null });
      const update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: new Error("update boom") }) });
      const supabase = clientStub({});
      supabase.storage = { from: vi.fn().mockReturnValue({ upload }) };
      supabase.from = vi.fn().mockReturnValue({ update });
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
      const form = new FormData();
      form.set("file", png);
      const res = await profilePost(formRequest(form));
      expect(res.status).toBe(500);
      expect(mockErrorResponse).toHaveBeenCalledWith("settings.profile.avatar.upload", expect.any(Error));
    });
  });

  describe("DELETE /api/settings/profile (avatar removal)", () => {
    it("returns 404 when settingsIa is off (L158, L159 true)", async () => {
      mockIsFeatureEnabled.mockReturnValue(false);
      const res = await profileDelete({ url: "https://x.local" } as unknown as NextRequest);
      expect(res.status).toBe(404);
    });

    it("returns 401 when not authenticated (L161 true, B@161)", async () => {
      mockRequireUser.mockResolvedValue(new NextResponse("unauthorized", { status: 401 }));
      const res = await profileDelete({ url: "https://x.local" } as unknown as NextRequest);
      expect(res.status).toBe(401);
    });

    it("clears avatar_path when none is stored (L170 false, L172 false, L185)", async () => {
      const supabase = supabaseWith({ data: null, error: null });
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
      const res = await profileDelete({ url: "https://x.local" } as unknown as NextRequest);
      expect(res.status).toBe(200);
      expect(supabase.writtenTo("profiles")).toEqual({ avatar_path: null });
      expect(supabase.storage.from).not.toHaveBeenCalled();
      expect(mockWriteAudit).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "u1", action: "avatar_updated", metadata: { removed: true } }),
      );
    });

    it("removes the stored avatar then clears the path (L172 true, L173)", async () => {
      const remove = vi.fn().mockResolvedValue({ error: null });
      const supabase = supabaseWith({ data: { avatar_path: "u1/avatar.jpg" }, error: null }, { remove });
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
      const res = await profileDelete({ url: "https://x.local" } as unknown as NextRequest);
      expect(res.status).toBe(200);
      expect(remove).toHaveBeenCalledWith(["u1/avatar.jpg"]);
      expect(supabase.writtenTo("profiles")).toEqual({ avatar_path: null });
    });

    it("returns 500 when reading avatar_path throws (L170 true, L187)", async () => {
      const supabase = supabaseWith({ data: null, error: new Error("read boom") });
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
      const res = await profileDelete({ url: "https://x.local" } as unknown as NextRequest);
      expect(res.status).toBe(500);
      expect(mockErrorResponse).toHaveBeenCalledWith("settings.profile.avatar.delete", expect.any(Error));
    });

    it("returns 500 when clearing avatar_path throws (L177 true)", async () => {
      const update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: new Error("update boom") }) });
      const supabase = clientStub({});
      supabase.storage = { from: vi.fn().mockReturnValue({ remove: vi.fn().mockResolvedValue({ error: null }) }) };
      supabase.from = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: { avatar_path: "u1/avatar.jpg" }, error: null }) }),
        update,
      });
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase });
      const res = await profileDelete({ url: "https://x.local" } as unknown as NextRequest);
      expect(res.status).toBe(500);
      expect(mockErrorResponse).toHaveBeenCalledWith("settings.profile.avatar.delete", expect.any(Error));
    });
  });
});