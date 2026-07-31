import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { clientStub, type QueryResult } from "../fixtures/supabase-query";

const mockRequireUser = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  badRequest: (message: string) => NextResponse.json({ error: message }, { status: 400 }),
  errorResponse: (_context: string, error: unknown) => {
    throw error;
  },
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

import { POST, PATCH, DELETE } from "@/app/api/settings/tags/route";

const USER_ID = "user-1";

function request(method: string, body: unknown) {
  return new NextRequest("http://localhost/api/settings/tags", {
    method,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function supabaseWith(overrides: Record<string, QueryResult> = {}) {
  const client = clientStub(overrides) as ReturnType<typeof clientStub> & {
    rpc: (...args: unknown[]) => unknown;
  };
  client.rpc = vi.fn().mockResolvedValue({ error: null });
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  flagEnabled = true;
});

describe("POST /api/settings/tags", () => {
  it("404s while settingsIa is off, before touching auth", async () => {
    flagEnabled = false;
    const res = await POST(request("POST", { name: "travel" }));
    expect(res.status).toBe(404);
    expect(mockRequireUser).not.toHaveBeenCalled();
  });

  it("returns the auth response when not signed in", async () => {
    const unauthorized = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    mockRequireUser.mockResolvedValue(unauthorized);
    await expect(POST(request("POST", {}))).resolves.toBe(unauthorized);
  });

  it("400s an invalid name", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: USER_ID }, supabase: supabaseWith() });
    const res = await POST(request("POST", { name: "" }));
    expect(res.status).toBe(400);
  });

  it("creates a tag scoped to the caller", async () => {
    const supabase = supabaseWith({ user_tags: { data: { id: "t1", name: "travel", color_slot: 0 }, error: null } });
    mockRequireUser.mockResolvedValue({ user: { id: USER_ID }, supabase });
    const res = await POST(request("POST", { name: "travel" }));
    expect(res.status).toBe(201);
    expect(supabase.writtenTo("user_tags")).toMatchObject({ user_id: USER_ID, name: "travel" });
  });

  it("400s a duplicate tag name (unique violation)", async () => {
    const supabase = supabaseWith({ user_tags: { data: null, error: { code: "23505" } } });
    mockRequireUser.mockResolvedValue({ user: { id: USER_ID }, supabase });
    const res = await POST(request("POST", { name: "travel" }));
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/settings/tags", () => {
  it("400s a rename of a tag that does not exist", async () => {
    const supabase = supabaseWith({ user_tags: { data: [{ name: "work" }], error: null } });
    mockRequireUser.mockResolvedValue({ user: { id: USER_ID }, supabase });
    const res = await PATCH(request("PATCH", { oldName: "ghost", newName: "vacation" }));
    expect(res.status).toBe(400);
  });

  it("renames a tag via the rename_user_tag RPC and audits it", async () => {
    const supabase = supabaseWith({ user_tags: { data: [{ name: "travel" }], error: null } });
    mockRequireUser.mockResolvedValue({ user: { id: USER_ID }, supabase });
    const res = await PATCH(request("PATCH", { oldName: "travel", newName: "vacation" }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, merged: false });
    expect(supabase.rpc).toHaveBeenCalledWith("rename_user_tag", {
      p_old_name: "travel",
      p_new_name: "vacation",
    });
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "tag_renamed" }));
  });

  it("reports a merge when the target name already exists and audits tag_merged", async () => {
    const supabase = supabaseWith({ user_tags: { data: [{ name: "travel" }, { name: "work" }], error: null } });
    mockRequireUser.mockResolvedValue({ user: { id: USER_ID }, supabase });
    const res = await PATCH(request("PATCH", { oldName: "travel", newName: "work" }));
    await expect(res.json()).resolves.toEqual({ ok: true, merged: true });
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "tag_merged" }));
  });
});

describe("DELETE /api/settings/tags", () => {
  it("deletes a tag scoped to the caller and audits it", async () => {
    const supabase = supabaseWith();
    mockRequireUser.mockResolvedValue({ user: { id: USER_ID }, supabase });
    const res = await DELETE(request("DELETE", { name: "travel" }));
    expect(res.status).toBe(200);
    expect(supabase.scopedToUser("user_tags", USER_ID)).toBe(true);
    expect(mockWriteAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "tag_deleted" }));
  });
});
