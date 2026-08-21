import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { clientStub } from "../fixtures/supabase-query";

const mockRequireUser = vi.fn<(...args: unknown[]) => unknown>();
const mockErrorResponse = vi.fn<(...args: unknown[]) => unknown>(
  (_context: unknown, error: unknown) =>
    NextResponse.json(
      { error: error instanceof Error ? error.message : "error" },
      { status: 500 },
    ),
);
const mockBadRequest = vi.fn<(...args: unknown[]) => unknown>(
  (msg: unknown) => NextResponse.json({ error: String(msg) }, { status: 400 }),
);
const mockCurrentSessionId = vi.fn<(...args: unknown[]) => unknown>(() => "active-sess");
vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  errorResponse: (...args: unknown[]) => mockErrorResponse(...args),
  badRequest: (...args: unknown[]) => mockBadRequest(...args),
  currentSessionId: (...args: unknown[]) => mockCurrentSessionId(...args),
}));

const mockWriteAudit = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
  getClientIp: () => "127.0.0.1",
}));

const mockBuildAuditLogPage = vi.fn<(...args: unknown[]) => unknown>((rows) => ({
  rows,
  nextCursor: null,
}));
vi.mock("@/lib/security-account", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/security-account")
  >("@/lib/security-account");
  return {
    ...actual,
    buildAuditLogPage: (...args: unknown[]) => mockBuildAuditLogPage(...args),
  };
});

const mockListPasskeys = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    auth: {
      admin: {
        passkey: {
          listPasskeys: (...args: unknown[]) => mockListPasskeys(...args),
        },
      },
    },
  }),
}));

let flagEnabled = true;
vi.mock("@/lib/feature-flags", () => ({
  isFeatureEnabled: () => flagEnabled,
}));

import { GET as auditGet } from "@/app/api/settings/audit/route";
import { POST as mfaPost } from "@/app/api/settings/mfa/route";
import { POST as passkeysPost } from "@/app/api/settings/passkeys/route";
import { GET as sessionsGet } from "@/app/api/settings/sessions/route";
import { PATCH as tagsPatch } from "@/app/api/settings/tags/route";

const USER = "user-1";

function jsonReq(url: string, method: string, payload: unknown) {
  return new NextRequest(url, {
    method,
    body: JSON.stringify(payload),
    headers: { "content-type": "application/json" },
  });
}

function authWith(supabase: unknown) {
  mockRequireUser.mockResolvedValue({
    user: { id: USER },
    supabase: supabase as never,
  } as never);
}

describe("coverage-boost export routes (n3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    flagEnabled = true;
    mockCurrentSessionId.mockResolvedValue("active-sess");
  });

  describe("settings/audit GET", () => {
    it("returns the auth response when signed out", async () => {
      mockRequireUser.mockResolvedValue(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      );
      const res = await auditGet(
        new NextRequest("http://localhost/api/settings/audit"),
      );
      expect(res.status).toBe(401);
    });

    it("coerces a null metadata cell to an empty object", async () => {
      const client = clientStub({
        audit_logs: {
          data: [
            { user_id: USER, action: "login", created_at: "2026-07-01", metadata: null },
          ],
          error: null,
        },
      });
      authWith(client);
      const res = await auditGet(
        new NextRequest("http://localhost/api/settings/audit"),
      );
      expect(res.status).toBe(200);
      expect(mockBuildAuditLogPage).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ metadata: {}, action: "login" }),
        ]),
        USER,
        expect.any(Number),
      );
    });
  });

  describe("settings/mfa POST", () => {
    it("handles a null listFactors payload during enroll", async () => {
      const listFactors = vi.fn().mockResolvedValue({ data: null, error: null });
      const supabase = { ...clientStub(), auth: { mfa: { listFactors } } };
      authWith(supabase);
      const res = await mfaPost(
        jsonReq("http://localhost/api/settings/mfa", "POST", {
          action: "enroll",
          factorId: "f1",
        }),
      );
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith(
        "MFA factor does not belong to this user",
      );
    });

    it("reads phone factors when verifying enrollment", async () => {
      const listFactors = vi.fn().mockResolvedValue({
        data: { phone: [{ id: "f1", status: "verified" }] },
        error: null,
      });
      const userClient = clientStub({ profiles: { data: { id: USER }, error: null } });
      const supabase = { ...userClient, auth: { mfa: { listFactors } } };
      authWith(supabase);
      const res = await mfaPost(
        jsonReq("http://localhost/api/settings/mfa", "POST", {
          action: "verify",
          factorId: "f1",
        }),
      );
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({
        success: true,
        mfa_enrolled: true,
      });
    });

    it("surfaces a profile flag write error as a 500", async () => {
      const listFactors = vi.fn().mockResolvedValue({
        data: { totp: [{ id: "f1", status: "verified" }] },
        error: null,
      });
      const userClient = clientStub({
        profiles: { data: null, error: new Error("profile update failed") },
      });
      const supabase = { ...userClient, auth: { mfa: { listFactors } } };
      authWith(supabase);
      const res = await mfaPost(
        jsonReq("http://localhost/api/settings/mfa", "POST", {
          action: "verify",
          factorId: "f1",
        }),
      );
      expect(res.status).toBe(500);
      expect(mockErrorResponse).toHaveBeenCalledWith(
        "api/settings/mfa",
        expect.any(Error),
      );
    });

    it("surfaces a listFactors error during enroll as a 500", async () => {
      const listFactors = vi.fn().mockResolvedValue({
        data: null,
        error: new Error("auth down"),
      });
      const supabase = { ...clientStub(), auth: { mfa: { listFactors } } };
      authWith(supabase);
      const res = await mfaPost(
        jsonReq("http://localhost/api/settings/mfa", "POST", {
          action: "enroll",
          factorId: "f1",
        }),
      );
      expect(res.status).toBe(500);
      expect(mockErrorResponse).toHaveBeenCalledWith(
        "api/settings/mfa",
        expect.any(Error),
      );
    });
  });

  describe("settings/passkeys POST", () => {
    it("treats a null passkey list as empty", async () => {
      mockListPasskeys.mockResolvedValue({ data: null, error: null });
      authWith({});
      const res = await passkeysPost(
        jsonReq("http://localhost/api/settings/passkeys", "POST", {
          action: "rename",
          passkeyId: "p1",
        }),
      );
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("Passkey not found");
    });
  });

  describe("settings/sessions GET", () => {
    it("marks a session non-current when its id differs from the active one", async () => {
      const client = clientStub({
        user_session_records: {
          data: [
            {
              id: "s1",
              session_id: "active-sess",
              user_agent: "Chrome",
              revoked_at: null,
              last_seen_at: "2026-07-13",
            },
            {
              id: "s2",
              session_id: "other-sess",
              user_agent: null,
              revoked_at: null,
              last_seen_at: "2026-07-12",
            },
          ],
          error: null,
        },
      });
      authWith(client);
      const res = await sessionsGet();
      expect(res.status).toBe(200);
      const body = await res.json();
      const byId = Object.fromEntries(
        (body.sessions as { id: string; current: boolean }[]).map((s) => [s.id, s]),
      );
      expect(byId["s1"]?.current).toBe(true);
      expect(byId["s2"]?.current).toBe(false);
      expect(byId["s2"]?.label).toBe("Unknown device");
    });
  });

  describe("settings/tags PATCH", () => {
    it("treats a null existing-tags list as empty", async () => {
      const client = clientStub({ user_tags: { data: null, error: null } });
      authWith(client);
      const res = await tagsPatch(
        jsonReq("http://localhost/api/settings/tags", "PATCH", {
          oldName: "travel",
          newName: "vacation",
        }),
      );
      expect(res.status).toBe(400);
      expect(mockBadRequest).toHaveBeenCalledWith("tag not found");
    });

    it("surfaces an RPC failure as a 500", async () => {
      const client = clientStub({ user_tags: { data: [{ name: "travel" }], error: null } });
      client.rpc = vi.fn().mockResolvedValue({ error: new Error("rpc failed") });
      authWith(client);
      const res = await tagsPatch(
        jsonReq("http://localhost/api/settings/tags", "PATCH", {
          oldName: "travel",
          newName: "vacation",
        }),
      );
      expect(res.status).toBe(500);
      expect(mockErrorResponse).toHaveBeenCalledWith(
        "settings.tags.rename",
        expect.any(Error),
      );
    });
  });
});