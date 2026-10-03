import { beforeEach, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
const mocks = vi.hoisted(() => ({ enabled: true, authed: true, allowed: true, rpc: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/feature-flags", () => ({ isFeatureEnabled: () => mocks.enabled }));
vi.mock("@/lib/manual-asset-flags", () => ({ manualAssetsEnabled: () => mocks.enabled }));
vi.mock("@/lib/http", () => ({ requireUser: async () => mocks.authed ? { user: { id: "owner" } } : NextResponse.json({}, { status: 401 }), badRequest: (error: string) => NextResponse.json({ error }, { status: 400 }), errorResponse: () => NextResponse.json({}, { status: 500 }) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => mocks.allowed }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.audit, getClientIp: () => null }));
import { POST } from "@/app/api/portfolio-annotations/route";
const body = { kind: "basis", id: "91000000-0000-4000-8000-000000000001", version: 0, data: { amount: 0, quantity: 2, source: "manual" } };
const request = (input: unknown = body) => new Request("https://example.test/api/portfolio-annotations", { method: "POST", body: JSON.stringify(input) });
beforeEach(() => { vi.clearAllMocks(); mocks.enabled = mocks.authed = mocks.allowed = true; mocks.rpc.mockResolvedValue({ data: 7, error: null }); });
it("uses only authenticated identity, a bounded clean payload and an audit without amounts", async () => {
  const response = await POST(request({ ...body, user_id: "victim" })); expect(response.status).toBe(200); expect(await response.json()).toEqual({ version: 7 }); expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(mocks.rpc).toHaveBeenCalledWith("save_portfolio_annotation", { p_user_id: "owner", p_kind: "basis", p_id: body.id, p_version: 0, p_data: body.data });
  expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ metadata: { kind: "basis", id: body.id, reset: false } }));
});
it("requires authentication, flags and rate allowance", async () => {
  mocks.authed = false; expect((await POST(request())).status).toBe(401);
  mocks.authed = true; mocks.enabled = false; expect((await POST(request())).status).toBe(404);
  mocks.enabled = true; mocks.allowed = false; expect((await POST(request())).status).toBe(429); expect(mocks.rpc).not.toHaveBeenCalled();
});
it("bounds and validates requests", async () => {
  expect((await POST(request(null))).status).toBe(400); expect((await POST(request({ text: "x".repeat(9000) }))).status).toBe(413);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it.each([["P0002", 404], ["40001", 409], ["23505", 409], ["XX000", 500]])("maps %s without exposing internals", async (code, status) => {
  mocks.rpc.mockResolvedValue({ error: { code } }); expect((await POST(request())).status).toBe(status); expect(mocks.audit).not.toHaveBeenCalled();
});
it("supports explicit reset and rejects missing or thrown results", async () => {
  expect((await POST(request({ ...body, data: null }))).status).toBe(200);
  mocks.rpc.mockResolvedValue({ data: null }); expect((await POST(request())).status).toBe(500);
  mocks.rpc.mockRejectedValue(new Error("Unavailable")); expect((await POST(request())).status).toBe(500);
});
