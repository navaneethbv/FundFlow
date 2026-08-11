import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { clientStub, type QueryResult } from "../fixtures/supabase-query";

const mockRequireUser = vi.fn<(...args: unknown[]) => unknown>();
const mockErrorResponse = vi.fn();
vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  badRequest: (message: string) => NextResponse.json({ error: message }, { status: 400 }),
  errorResponse: (...args: unknown[]) => mockErrorResponse(...args),
}));

const mockWriteAudit = vi.fn();
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
  getClientIp: () => "127.0.0.1",
}));

let flagEnabled = true;
vi.mock("@/lib/feature-flags", () => ({
  isFeatureEnabled: () => flagEnabled,
}));

import { PATCH, POST, DELETE } from "@/app/api/settings/profile/route";

const USER_ID = "user-1";

function jsonRequest(method: string, body: unknown) {
  return new NextRequest("http://localhost/api/settings/profile", {
    method,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function formRequest(file: File | null) {
  const form = new FormData();
  if (file) form.set("file", file);
  return new NextRequest("http://localhost/api/settings/profile", { method: "POST", body: form });
}

function supabaseWith(overrides: Record<string, QueryResult> = {}) {
  const client = clientStub(overrides) as ReturnType<typeof clientStub> & {
    storage: { from: (bucket: string) => { upload: (...a: unknown[]) => unknown; remove: (...a: unknown[]) => unknown } };
  };
  const upload = vi.fn().mockResolvedValue({ error: null });
  const remove = vi.fn().mockResolvedValue({ error: null });
  client.storage = { from: () => ({ upload, remove }) };
  return { client, upload, remove };
}

beforeEach(() => {
  vi.clearAllMocks();
  flagEnabled = true;
  mockErrorResponse.mockImplementation((_context: string, error: unknown) => {
    throw error;
  });
});

describe("PATCH /api/settings/profile", () => {
  it("404s while settingsIa is off, before touching auth", async () => {
    flagEnabled = false;
    const res = await PATCH(jsonRequest("PATCH", { kind: "profile" }));
    expect(res.status).toBe(404);
    expect(mockRequireUser).not.toHaveBeenCalled();
  });

  it("returns the auth response when not signed in", async () => {
    const unauthorized = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    mockRequireUser.mockResolvedValue(unauthorized);
    await expect(PATCH(jsonRequest("PATCH", {}))).resolves.toBe(unauthorized);
  });

  it("400s an unknown kind", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: USER_ID }, supabase: supabaseWith().client });
    const res = await PATCH(jsonRequest("PATCH", { kind: "nonsense" }));
    expect(res.status).toBe(400);
  });

  it("updates profile fields and audits it", async () => {
    const { client } = supabaseWith({ profiles: { data: null, error: null } });
    mockRequireUser.mockResolvedValue({ user: { id: USER_ID }, supabase: client });
    const res = await PATCH(jsonRequest("PATCH", { kind: "profile", fullName: "Ada Lovelace" }));
    expect(res.status).toBe(200);
    expect(client.writtenTo("profiles")).toEqual({ full_name: "Ada Lovelace" });
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "profile_updated" }));
  });

  it("400s an invalid profile patch", async () => {
    const { client } = supabaseWith();
    mockRequireUser.mockResolvedValue({ user: { id: USER_ID }, supabase: client });
    const res = await PATCH(jsonRequest("PATCH", { kind: "profile", fullName: "a".repeat(200) }));
    expect(res.status).toBe(400);
  });

  it("read-merge-writes display prefs rather than overwriting the column", async () => {
    const { client } = supabaseWith({
      profiles: { data: { display_prefs: { theme: "dark", density: "compact" } }, error: null },
    });
    mockRequireUser.mockResolvedValue({ user: { id: USER_ID }, supabase: client });
    const res = await PATCH(jsonRequest("PATCH", { kind: "display", prefs: { reducedMotion: "reduce" } }));
    expect(res.status).toBe(200);
    const written = client.writtenTo("profiles") as { display_prefs: Record<string, unknown> };
    expect(written.display_prefs).toMatchObject({ theme: "dark", density: "compact", reducedMotion: "reduce" });
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "display_prefs_updated" }));
  });

  it("400s an invalid display prefs patch", async () => {
    const { client } = supabaseWith();
    mockRequireUser.mockResolvedValue({ user: { id: USER_ID }, supabase: client });
    const res = await PATCH(jsonRequest("PATCH", { kind: "display", prefs: { theme: "purple" } }));
    expect(res.status).toBe(400);
  });

  it("writes every provided profile field (name, birthday, display name)", async () => {
    const { client } = supabaseWith({ profiles: { data: null, error: null } });
    mockRequireUser.mockResolvedValue({ user: { id: USER_ID }, supabase: client });
    const res = await PATCH(jsonRequest("PATCH", {
      kind: "profile",
      displayName: "Ada",
      birthday: "1990-01-15",
    }));
    expect(res.status).toBe(200);
    expect(client.writtenTo("profiles")).toEqual({
      display_name: "Ada",
      birthday: "1990-01-15",
    });
  });

  it("500s when the profile update fails", async () => {
    mockErrorResponse.mockReturnValue(NextResponse.json({ error: "boom" }, { status: 500 }));
    mockRequireUser.mockResolvedValue({
      user: { id: USER_ID },
      supabase: supabaseWith({ profiles: { data: null, error: { message: "update failed" } } }).client,
    });
    const res = await PATCH(jsonRequest("PATCH", { kind: "profile", fullName: "Ada" }));
    expect(res.status).toBe(500);
  });

  it("500s when the display prefs read fails", async () => {
    mockErrorResponse.mockReturnValue(NextResponse.json({ error: "boom" }, { status: 500 }));
    mockRequireUser.mockResolvedValue({
      user: { id: USER_ID },
      supabase: supabaseWith({ profiles: { data: null, error: { message: "read failed" } } }).client,
    });
    const res = await PATCH(jsonRequest("PATCH", { kind: "display", prefs: { theme: "dark" } }));
    expect(res.status).toBe(500);
  });

  it("500s when the display prefs update fails", async () => {
    mockErrorResponse.mockReturnValue(NextResponse.json({ error: "boom" }, { status: 500 }));
    const { client } = supabaseWith({
      profiles: { data: { display_prefs: { theme: "dark" } }, error: null },
    });
    const updateMock = vi.fn().mockResolvedValue({ error: { message: "update failed" } });
    client.from = vi.fn().mockImplementation((table: string) => {
      if (table !== "profiles") throw new Error("unexpected table");
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: { display_prefs: { theme: "dark" } }, error: null }),
          }),
        }),
        update: vi.fn().mockReturnValue({ eq: updateMock }),
      };
    });
    mockRequireUser.mockResolvedValue({ user: { id: USER_ID }, supabase: client });
    const res = await PATCH(jsonRequest("PATCH", { kind: "display", prefs: { theme: "dark" } }));
    expect(res.status).toBe(500);
  });
});

describe("POST /api/settings/profile (avatar upload)", () => {
  it("404s while settingsIa is off, before touching auth", async () => {
    flagEnabled = false;
    const res = await POST(formRequest(null));
    expect(res.status).toBe(404);
    expect(mockRequireUser).not.toHaveBeenCalled();
  });

  it("returns the auth response when not signed in", async () => {
    const unauthorized = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    mockRequireUser.mockResolvedValue(unauthorized);
    await expect(POST(formRequest(null))).resolves.toBe(unauthorized);
  });

  it("400s a missing file", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: USER_ID }, supabase: supabaseWith().client });
    const res = await POST(formRequest(null));
    expect(res.status).toBe(400);
  });

  it("400s an unsupported image type", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: USER_ID }, supabase: supabaseWith().client });
    const file = new File(["x"], "a.gif", { type: "image/gif" });
    const res = await POST(formRequest(file));
    expect(res.status).toBe(400);
  });

  it("400s an oversized file", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: USER_ID }, supabase: supabaseWith().client });
    const big = new Uint8Array(3 * 1024 * 1024 + 1);
    const file = new File([big], "a.png", { type: "image/png" });
    const res = await POST(formRequest(file));
    expect(res.status).toBe(400);
  });

  it("uploads to a user-prefixed path and stores it on the profile", async () => {
    const { client, upload } = supabaseWith({ profiles: { data: null, error: null } });
    mockRequireUser.mockResolvedValue({ user: { id: USER_ID }, supabase: client });
    const file = new File(["x"], "a.png", { type: "image/png" });
    const res = await POST(formRequest(file));
    expect(res.status).toBe(200);
    expect(upload).toHaveBeenCalledWith(
      `${USER_ID}/avatar.png`,
      expect.objectContaining({ name: "a.png", type: "image/png" }),
      expect.objectContaining({ contentType: "image/png" }),
    );
    expect(client.writtenTo("profiles")).toEqual({ avatar_path: `${USER_ID}/avatar.png` });
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "avatar_updated" }));
  });

  it("500s when the avatar upload fails", async () => {
    mockErrorResponse.mockReturnValue(NextResponse.json({ error: "boom" }, { status: 500 }));
    const { client } = supabaseWith();
    client.storage.from = vi.fn().mockReturnValue({
      upload: vi.fn().mockResolvedValue({ error: { message: "storage down" } }),
      remove: vi.fn().mockResolvedValue({ error: null }),
    });
    mockRequireUser.mockResolvedValue({ user: { id: USER_ID }, supabase: client });
    const res = await POST(formRequest(new File(["x"], "a.png", { type: "image/png" })));
    expect(res.status).toBe(500);
  });

  it("500s when the avatar_path update fails", async () => {
    mockErrorResponse.mockReturnValue(NextResponse.json({ error: "boom" }, { status: 500 }));
    const { client } = supabaseWith({ profiles: { data: null, error: { message: "update failed" } } });
    mockRequireUser.mockResolvedValue({ user: { id: USER_ID }, supabase: client });
    const res = await POST(formRequest(new File(["x"], "a.png", { type: "image/png" })));
    expect(res.status).toBe(500);
  });
});

describe("DELETE /api/settings/profile (avatar removal)", () => {
  it("404s while settingsIa is off, before touching auth", async () => {
    flagEnabled = false;
    const res = await DELETE(jsonRequest("DELETE", {}));
    expect(res.status).toBe(404);
    expect(mockRequireUser).not.toHaveBeenCalled();
  });

  it("returns the auth response when not signed in", async () => {
    const unauthorized = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    mockRequireUser.mockResolvedValue(unauthorized);
    await expect(DELETE(jsonRequest("DELETE", {}))).resolves.toBe(unauthorized);
  });

  it("removes the stored object and clears avatar_path", async () => {
    const { client, remove } = supabaseWith({ profiles: { data: { avatar_path: "user-1/avatar.png" }, error: null } });
    mockRequireUser.mockResolvedValue({ user: { id: USER_ID }, supabase: client });
    const res = await DELETE(jsonRequest("DELETE", {}));
    expect(res.status).toBe(200);
    expect(remove).toHaveBeenCalledWith(["user-1/avatar.png"]);
    expect(client.writtenTo("profiles")).toEqual({ avatar_path: null });
  });

  it("clears avatar_path without a storage call when there was no avatar", async () => {
    const { client, remove } = supabaseWith({ profiles: { data: { avatar_path: null }, error: null } });
    mockRequireUser.mockResolvedValue({ user: { id: USER_ID }, supabase: client });
    const res = await DELETE(jsonRequest("DELETE", {}));
    expect(res.status).toBe(200);
    expect(remove).not.toHaveBeenCalled();
  });

  it("500s when the avatar_path read fails", async () => {
    mockErrorResponse.mockReturnValue(NextResponse.json({ error: "boom" }, { status: 500 }));
    const { client } = supabaseWith({ profiles: { data: null, error: { message: "read failed" } } });
    mockRequireUser.mockResolvedValue({ user: { id: USER_ID }, supabase: client });
    const res = await DELETE(jsonRequest("DELETE", {}));
    expect(res.status).toBe(500);
  });

  it("500s when the avatar_path clear fails", async () => {
    mockErrorResponse.mockReturnValue(NextResponse.json({ error: "boom" }, { status: 500 }));
    const { client } = supabaseWith({
      profiles: { data: { avatar_path: "user-1/avatar.png" }, error: null },
    });
    const updateMock = vi.fn().mockResolvedValue({ error: { message: "update failed" } });
    client.from = vi.fn().mockImplementation((table: string) => {
      if (table !== "profiles") throw new Error("unexpected table");
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { avatar_path: "user-1/avatar.png" },
              error: null,
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({ eq: updateMock }),
      };
    });
    mockRequireUser.mockResolvedValue({ user: { id: USER_ID }, supabase: client });
    const res = await DELETE(jsonRequest("DELETE", {}));
    expect(res.status).toBe(500);
  });
});
