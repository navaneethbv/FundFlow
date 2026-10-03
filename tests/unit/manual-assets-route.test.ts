import { beforeEach, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
const mocks = vi.hoisted(() => ({ enabled: true, authed: true, allowed: true, rpc: vi.fn(), audit: vi.fn(), invalidate: vi.fn() }));
vi.mock("@/lib/manual-asset-flags", () => ({ manualAssetsEnabled: () => mocks.enabled }));
vi.mock("@/lib/http", () => ({ requireUser: async () => mocks.authed ? { user: { id: "owner" }, supabase: {} } : NextResponse.json({}, { status: 401 }),
  badRequest: (error: string) => NextResponse.json({ error }, { status: 400 }), errorResponse: () => NextResponse.json({}, { status: 500 }) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => mocks.allowed }));
vi.mock("@/lib/report-period", () => ({ resolveViewerToday: async () => "2026-10-02" }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.audit, getClientIp: () => null }));
vi.mock("@/lib/dashboard-cache", () => ({ invalidateDashboardCache: mocks.invalidate }));
import { POST } from "@/app/api/manual-assets/route";
const body = { name: "Car", assetKind: "vehicle", value: 10000, valuationDate: "2026-10-01", valueSource: "Entry", ownershipPercentage: 50 };
const request = (input: unknown = body) => new Request("https://example.test/api/manual-assets", { method: "POST", body: JSON.stringify(input) });
beforeEach(() => { vi.clearAllMocks(); mocks.enabled = mocks.authed = mocks.allowed = true; mocks.rpc.mockResolvedValue({ data: "asset-id", error: null }); });
it("saves only for the session owner, ignoring a supplied user id", async () => {
  const response = await POST(request({ ...body, user_id: "victim" }));
  expect(response.status).toBe(201); expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(mocks.rpc).toHaveBeenCalledWith("save_manual_asset", expect.objectContaining({ p_user_id: "owner", p_today: "2026-10-02" }));
  expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ metadata: { account_id: "asset-id", asset_kind: "vehicle" } }));
  expect(mocks.invalidate).toHaveBeenCalledWith("owner");
});
it("requires flags, authentication, and rate-limit allowance before writes", async () => {
  mocks.enabled = false; expect((await POST(request())).status).toBe(404);
  mocks.enabled = true; mocks.authed = false; expect((await POST(request())).status).toBe(401);
  mocks.authed = true; mocks.allowed = false; expect((await POST(request())).status).toBe(429);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("bounds bodies and rejects malformed input", async () => {
  expect((await POST(request(null))).status).toBe(400);
  expect((await POST(request({ ...body, name: "x".repeat(17000) }))).status).toBe(413);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it.each([["P0002", 404], ["40001", 409], ["22023", 400], ["XX000", 500]])("maps %s safely", async (code, status) => {
  mocks.rpc.mockResolvedValue({ data: null, error: { code } });
  expect((await POST(request())).status).toBe(status); expect(mocks.audit).not.toHaveBeenCalled();
});
it("handles missing results and thrown failures", async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: null }); expect((await POST(request())).status).toBe(500);
  mocks.rpc.mockRejectedValue(new Error("unavailable")); expect((await POST(request())).status).toBe(500);
});
it("accepts a versioned update", async () => {
  expect((await POST(request({ ...body, id: "91000000-0000-4000-8000-000000000001", version: 1 }))).status).toBe(200);
  expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "manual_account_updated" }));
});
