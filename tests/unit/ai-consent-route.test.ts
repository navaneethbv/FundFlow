import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { clientStub } from "../fixtures/supabase-query";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), limit: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/http", () => ({
  requireUser: mocks.auth,
  badRequest: (error: string) => NextResponse.json({ error }, { status: 400 }),
  errorResponse: () => NextResponse.json({ error: "Unable to save" }, { status: 500 }),
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.limit }));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.audit, getClientIp: () => null }));

import { PATCH } from "@/app/api/settings/ai/route";

function request(body: unknown) {
  return new NextRequest("http://localhost/api/settings/ai", { method: "PATCH", body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.limit.mockResolvedValue(true);
});

describe("AI consent settings", () => {
  it("returns the authentication gate without writing", async () => {
    mocks.auth.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    expect((await PATCH(request({ enabled: true }))).status).toBe(401);
    expect(mocks.limit).not.toHaveBeenCalled();
  });
  it.each([true, false])("persists explicit %s for only the authenticated owner", async (enabled) => {
    const client = clientStub({ ai_settings: { error: null } });
    mocks.auth.mockResolvedValue({ user: { id: "owner" }, supabase: client });
    const response = await PATCH(request({ enabled, user_id: "someone-else" }));
    expect(response.status).toBe(200);
    expect(client.writtenTo("ai_settings")).toEqual({ user_id: "owner", enabled });
    expect(client.from).toHaveBeenCalledTimes(1);
    expect(mocks.limit).toHaveBeenCalledWith("ai-consent:owner", 20, 3600, { failClosed: true });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ userId: "owner", action: "ai_consent_updated", metadata: { enabled } }));
  });
  it.each([null, {}, [], { enabled: "true" }, { enabled: 1 }])("rejects malformed preferences %j", async (body) => {
    const client = clientStub();
    mocks.auth.mockResolvedValue({ user: { id: "owner" }, supabase: client });
    expect((await PATCH(request(body))).status).toBe(400);
    expect(client.from).not.toHaveBeenCalled();
  });
  it("rejects invalid JSON", async () => {
    const client = clientStub();
    mocks.auth.mockResolvedValue({ user: { id: "owner" }, supabase: client });
    expect((await PATCH(new NextRequest("http://localhost/api/settings/ai", { method: "PATCH", body: "{" }))).status).toBe(400);
    expect(client.from).not.toHaveBeenCalled();
  });
  it("fails closed when the rate limiter denies the write", async () => {
    const client = clientStub();
    mocks.auth.mockResolvedValue({ user: { id: "owner" }, supabase: client });
    mocks.limit.mockResolvedValue(false);
    expect((await PATCH(request({ enabled: true }))).status).toBe(429);
    expect(client.from).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("does not report or audit success when persistence fails", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "owner" }, supabase: clientStub({ ai_settings: { error: new Error("write denied") } }) });
    expect((await PATCH(request({ enabled: false }))).status).toBe(500);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
