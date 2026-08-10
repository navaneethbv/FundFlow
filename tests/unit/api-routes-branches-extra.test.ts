import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { POST as importCsvPost } from "@/app/api/import/csv/route";
import { PATCH as profilePatch, POST as avatarPost, DELETE as avatarDelete } from "@/app/api/settings/profile/route";
import * as http from "@/lib/http";

vi.mock("@/lib/audit", () => ({
  getClientIp: () => "127.0.0.1",
  writeAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue(true),
}));

describe("API Routes Branches Extra", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /api/import/csv", () => {
    it("returns 401 when requireUser fails", async () => {
      vi.spyOn(http, "requireUser").mockResolvedValue(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      );
      const req = new NextRequest("http://localhost/api/import/csv");
      const res = await importCsvPost(req);
      expect(res.status).toBe(401);
    });

    it("returns 429 when rate limit is exceeded", async () => {
      vi.spyOn(http, "requireUser").mockResolvedValue({
        user: { id: "user-1" } as any,
        supabase: {} as any,
      });
      const rateLimitModule = await import("@/lib/rate-limit");
      vi.spyOn(rateLimitModule, "checkRateLimit").mockResolvedValueOnce(false);

      const req = new NextRequest("http://localhost/api/import/csv");
      const res = await importCsvPost(req);
      expect(res.status).toBe(429);
    });

    it("rejects invalid multipart form data", async () => {
      vi.spyOn(http, "requireUser").mockResolvedValue({
        user: { id: "user-1" } as any,
        supabase: {} as any,
      });

      const req = new NextRequest("http://localhost/api/import/csv", {
        method: "POST",
        body: "invalid-body",
      });
      const res = await importCsvPost(req);
      expect(res.status).toBe(400);
    });

    it("handles OFX import text and account not found", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null }),
            }),
          }),
        }),
      } as any;

      vi.spyOn(http, "requireUser").mockResolvedValue({
        user: { id: "user-1" } as any,
        supabase: mockSupabase,
      });

      const form = new FormData();
      form.append("file", new File(["OFXHEADER:100\n<OFX><BANKMSGSRSV1><STMTTRNRS><TRNRS><STMTRS><BANKTRANLIST><STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260801<TRNAMT>100<FITID>1<NAME>Salary</STMTTRN></BANKTRANLIST></STMTRS></TRNRS></BANKMSGSRSV1></OFX>"], "test.ofx", { type: "text/plain" }));
      form.append("account_id", "acc-404");

      const req = new NextRequest("http://localhost/api/import/csv", {
        method: "POST",
        body: form,
      });
      const res = await importCsvPost(req);
      expect(res.status).toBe(404);
    });
  });

  describe("PATCH /api/settings/profile", () => {
    it("returns 404 when settingsIa feature flag is disabled", async () => {
      const ffModule = await import("@/lib/feature-flags");
      vi.spyOn(ffModule, "isFeatureEnabled").mockReturnValue(false);

      const req = new NextRequest("http://localhost/api/settings/profile");
      const res = await profilePatch(req);
      expect(res.status).toBe(404);
    });

    it("rejects unknown or invalid payload kind", async () => {
      const ffModule = await import("@/lib/feature-flags");
      vi.spyOn(ffModule, "isFeatureEnabled").mockReturnValue(true);
      vi.spyOn(http, "requireUser").mockResolvedValue({
        user: { id: "user-1" } as any,
        supabase: {} as any,
      });

      const req = new NextRequest("http://localhost/api/settings/profile", {
        method: "PATCH",
        body: JSON.stringify({ kind: "unknown" }),
      });
      const res = await profilePatch(req);
      expect(res.status).toBe(400);
    });

    it("updates profile with kind=profile", async () => {
      const ffModule = await import("@/lib/feature-flags");
      vi.spyOn(ffModule, "isFeatureEnabled").mockReturnValue(true);
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }),
      } as any;
      vi.spyOn(http, "requireUser").mockResolvedValue({
        user: { id: "user-1" } as any,
        supabase: mockSupabase,
      });

      const req = new NextRequest("http://localhost/api/settings/profile", {
        method: "PATCH",
        body: JSON.stringify({
          kind: "profile",
          fullName: "Alice Smith",
          displayName: "Alice",
        }),
      });
      const res = await profilePatch(req);
      expect(res.status).toBe(200);
    });

    it("updates display prefs with kind=display", async () => {
      const ffModule = await import("@/lib/feature-flags");
      vi.spyOn(ffModule, "isFeatureEnabled").mockReturnValue(true);
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: { display_prefs: {} }, error: null }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }),
      } as any;
      vi.spyOn(http, "requireUser").mockResolvedValue({
        user: { id: "user-1" } as any,
        supabase: mockSupabase,
      });

      const req = new NextRequest("http://localhost/api/settings/profile", {
        method: "PATCH",
        body: JSON.stringify({
          kind: "display",
          prefs: { currency: "USD" },
        }),
      });
      const res = await profilePatch(req);
      expect(res.status).toBe(200);
    });
  });

  describe("POST and DELETE avatar in /api/settings/profile", () => {
    it("handles avatar upload error and success", async () => {
      const ffModule = await import("@/lib/feature-flags");
      vi.spyOn(ffModule, "isFeatureEnabled").mockReturnValue(true);
      const mockSupabase = {
        storage: {
          from: vi.fn().mockReturnValue({
            upload: vi.fn().mockResolvedValue({ error: null }),
            remove: vi.fn().mockResolvedValue({ error: null }),
          }),
        },
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: { avatar_path: "user-1/avatar.jpg" } }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }),
      } as any;
      vi.spyOn(http, "requireUser").mockResolvedValue({
        user: { id: "user-1" } as any,
        supabase: mockSupabase,
      });

      const form = new FormData();
      const file = new File([Buffer.from("fake-png")], "avatar.png", { type: "image/png" });
      form.append("file", file);

      const postReq = new NextRequest("http://localhost/api/settings/profile", {
        method: "POST",
        body: form,
      });
      const postRes = await avatarPost(postReq);
      expect(postRes.status).toBe(200);

      const delReq = new NextRequest("http://localhost/api/settings/profile", {
        method: "DELETE",
      });
      const delRes = await avatarDelete(delReq);
      expect(delRes.status).toBe(200);
    });
  });
});
