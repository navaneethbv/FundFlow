import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const mock = vi.hoisted(() => ({
  auth: vi.fn(),
  rpc: vi.fn(),
  limit: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("@/lib/http", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requireUser: mock.auth,
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ rpc: mock.rpc }),
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mock.limit }));
vi.mock("@/lib/audit", () => ({ writeAudit: mock.audit }));
import { POST } from "@/app/api/accounts/balance-review/route";
const reviewId = "00000000-0000-4000-8000-000000000001",
  version = "00000000-0000-4000-8000-000000000002";
const request = (body: unknown) =>
  new NextRequest("http://localhost/api/accounts/balance-review", {
    method: "POST",
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("FUNDFLOW_FEATURE_FLAGS", "balanceQualityReview");
  mock.auth.mockResolvedValue({ user: { id: "owner" } });
  mock.limit.mockResolvedValue(true);
  mock.rpc.mockResolvedValue({ error: null });
});
afterEach(() => vi.unstubAllEnvs());
describe("balance review decisions", () => {
  it("requires a session and keeps the off state dark", async () => {
    mock.auth.mockResolvedValueOnce(NextResponse.json({}, { status: 401 }));
    expect((await POST(request({}))).status).toBe(401);
    vi.stubEnv("FUNDFLOW_FEATURE_FLAGS", "");
    expect((await POST(request({}))).status).toBe(404);
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("rate limits before processing a decision", async () => {
    mock.limit.mockResolvedValue(false);
    expect((await POST(request({}))).status).toBe(429);
  });
  it.each([
    null,
    [],
    {},
    { reviewId: 1 },
    { reviewId, version, decision: "delete" },
    { reviewId: "bad", version, decision: "accepted" },
    { reviewId, version: 5, decision: "accepted" },
  ])("rejects malformed input %j", async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("bounds and validates JSON", async () => {
    const invalid = new NextRequest("http://localhost", {
      method: "POST",
      body: "{",
    });
    expect((await POST(invalid)).status).toBe(400);
    expect((await POST(request({ text: "x".repeat(3000) }))).status).toBe(413);
  });
  it.each(["accepted", "carried"])(
    "atomically saves %s for this owner and audits identifiers only",
    async (decision) => {
      expect(
        (await POST(request({ reviewId, version, decision }))).status,
      ).toBe(200);
      expect(mock.rpc).toHaveBeenCalledWith("resolve_balance_quality_review", {
        p_user_id: "owner",
        p_review_id: reviewId,
        p_version: version,
        p_decision: decision,
      });
      expect(mock.audit).toHaveBeenCalledWith({
        userId: "owner",
        action: "balance_quality_reviewed",
        metadata: { reviewId, decision },
      });
    },
  );
  it.each([
    ["40001", 409],
    ["P0002", 404],
    ["22023", 400],
    ["unknown", 500],
  ])(
    "maps database error %s without auditing success",
    async (code, status) => {
      mock.rpc.mockResolvedValue({ error: { code } });
      expect(
        (await POST(request({ reviewId, version, decision: "accepted" })))
          .status,
      ).toBe(status);
      expect(mock.audit).not.toHaveBeenCalled();
    },
  );
});
