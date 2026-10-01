import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const mocks = vi.hoisted(() => ({ proof: vi.fn(), insert: vi.fn() }));
vi.mock("@/lib/http", () => ({ requireUser: async () => ({ user: { id: "owner" }, supabase: {} }), badRequest: (error: string) => NextResponse.json({ error }, { status: 400 }), errorResponse: () => NextResponse.json({}, { status: 500 }) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => true }));
vi.mock("@/lib/step-up", () => ({ verifyStepUp: mocks.proof }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({ from: () => ({ insert: mocks.insert }) }) }));
vi.mock("@/lib/request-audit", () => ({ requestAudits: { apiTokenCreated: async () => {} } }));
import { POST } from "@/app/api/tokens/route";
const request = (code?: string) => new NextRequest("https://app.test/api/tokens", { method: "POST", body: JSON.stringify({ name: "Export", code }) });
beforeEach(() => { vi.clearAllMocks(); mocks.proof.mockResolvedValue(false); mocks.insert.mockReturnValue({ select: () => ({ single: async () => ({ data: {}, error: null }) }) }); });
it("cannot mint without fresh reauthentication", async () => {
  expect((await POST(request())).status).toBe(403);
  expect((await POST(request("wrong"))).status).toBe(403);
  expect(mocks.insert).not.toHaveBeenCalled();
});
it("mints only an owner-scoped hashed credential with a 90-day expiry", async () => {
  mocks.proof.mockResolvedValue(true);
  const now = Date.now();
  const result = await POST(request("fresh"));
  expect(result.status).toBe(200);
  const written = mocks.insert.mock.calls[0][0];
  expect(written.user_id).toBe("owner");
  expect(Date.parse(written.expires_at) - now).toBeGreaterThanOrEqual(90 * 86_400_000);
  expect(Date.parse(written.expires_at) - now).toBeLessThan(90 * 86_400_000 + 1000);
  expect(written.token_hash).not.toBe((await result.json()).token);
});
