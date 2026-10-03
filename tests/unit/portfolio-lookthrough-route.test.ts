import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({ enabled: true, authed: true, allowed: true, rpc: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/feature-flags", () => ({ isFeatureEnabled: () => mocks.enabled }));
vi.mock("@/lib/http", () => ({
  requireUser: async () => mocks.authed ? { user: { id: "owner" } } : NextResponse.json({}, { status: 401 }),
  badRequest: (error: string) => NextResponse.json({ error }, { status: 400 }),
  errorResponse: () => NextResponse.json({}, { status: 500 }),
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => mocks.allowed }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/audit", () => ({ writeAudit: mocks.audit, getClientIp: () => null }));
import { POST } from "@/app/api/portfolio-lookthrough/route";

const holdingId = "91000000-0000-4000-8000-000000000001";
const body = {
  holdingId,
  version: 0,
  data: {
    asOfDate: "2026-01-01",
    weights: [{ key: "ticker:AAPL", name: "Apple", sector: "Technology", region: "North America", weight: 1 }],
  },
};
const request = (input: unknown = body) => new Request("https://example.test/api/portfolio-lookthrough", { method: "POST", body: JSON.stringify(input) });

describe("POST /api/portfolio-lookthrough", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.enabled = mocks.authed = mocks.allowed = true; mocks.rpc.mockResolvedValue({ data: 7, error: null }); });

  it("uses the authenticated owner and never audits constituent values", async () => {
    const response = await POST(request({ ...body, user_id: "victim" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ version: 7 });
    expect(mocks.rpc).toHaveBeenCalledWith("save_holding_constituent_weights", { p_user_id: "owner", p_holding_id: holdingId, p_version: 0, p_data: body.data });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ metadata: { holding_id: holdingId, reset: false } }));
  });

  it("enforces authentication, the release flag, and rate allowance", async () => {
    mocks.authed = false; expect((await POST(request())).status).toBe(401);
    mocks.authed = true; mocks.enabled = false; expect((await POST(request())).status).toBe(404);
    mocks.enabled = true; mocks.allowed = false; expect((await POST(request())).status).toBe(429);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("bounds and validates requests", async () => {
    expect((await POST(request(null))).status).toBe(400);
    expect((await POST(request({ ...body, version: -1 }))).status).toBe(400);
    expect((await POST(request({ ...body, data: { ...body.data, weights: [{ ...body.data.weights[0], weight: 0.2 }] } }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([["P0002", 404], ["40001", 409], ["22023", 400], ["XX000", 500]])("maps %s safely", async (code, status) => {
    mocks.rpc.mockResolvedValue({ error: { code } });
    expect((await POST(request())).status).toBe(status);
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("supports explicit reset and rejects a missing version", async () => {
    mocks.rpc.mockResolvedValue({ data: 0, error: null });
    expect((await POST(request({ ...body, data: null }))).status).toBe(200);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ metadata: { holding_id: holdingId, reset: true } }));
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    expect((await POST(request())).status).toBe(500);
  });
});
