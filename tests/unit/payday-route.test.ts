import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { clientStub } from "../fixtures/supabase-query";
const mock = vi.hoisted(() => ({
  auth: vi.fn(),
  limit: vi.fn(),
  audit: vi.fn(),
  invalidate: vi.fn(),
  today: vi.fn(),
}));
vi.mock("@/lib/http", async (original) => ({
  ...(await original<object>()),
  requireUser: mock.auth,
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mock.limit }));
vi.mock("@/lib/audit", () => ({ writeAudit: mock.audit }));
vi.mock("@/lib/dashboard-cache", () => ({
  invalidateDashboardCache: mock.invalidate,
}));
vi.mock("@/lib/report-period", () => ({ resolveViewerToday: mock.today }));
import { POST, DELETE } from "@/app/api/settings/payday/route";
const value = {
  cadence: "monthly",
  anchorDate: "2026-10-31",
  amount: 2000,
  day1: 31,
  day2: null,
};
const request = (body: unknown) =>
  new NextRequest("http://localhost/api/settings/payday", {
    method: "POST",
    body: JSON.stringify(body),
  });
let db: ReturnType<typeof clientStub>;
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("FUNDFLOW_FEATURE_FLAGS", "paydaySettings");
  db = clientStub();
  mock.auth.mockResolvedValue({ user: { id: "owner" }, supabase: db });
  mock.limit.mockResolvedValue(true);
  mock.today.mockResolvedValue("2026-10-01");
});
afterEach(() => vi.unstubAllEnvs());
describe("payday confirmation", () => {
  it.each([POST, () => DELETE()])(
    "requires a session, flag, and available rate limit",
    async (run) => {
      mock.auth.mockResolvedValueOnce(NextResponse.json({}, { status: 401 }));
      expect((await run(request(value))).status).toBe(401);
      vi.stubEnv("FUNDFLOW_FEATURE_FLAGS", "");
      expect((await run(request(value))).status).toBe(404);
      vi.stubEnv("FUNDFLOW_FEATURE_FLAGS", "paydaySettings");
      mock.limit.mockResolvedValue(false);
      expect((await run(request(value))).status).toBe(429);
      expect(db.from).not.toHaveBeenCalled();
    },
  );
  it.each([
    null,
    {},
    { ...value, amount: 1.005 },
    { ...value, anchorDate: "2026-09-30" },
    { ...value, anchorDate: "2027-01-31" },
    { ...value, day1: 5 },
  ])("rejects invalid or inconsistent settings %j", async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(db.from).not.toHaveBeenCalled();
    expect(mock.audit).not.toHaveBeenCalled();
  });
  it("bounds the body and rejects broken JSON", async () => {
    expect((await POST(request({ long: "x".repeat(3000) }))).status).toBe(413);
    expect(
      (
        await POST(
          new NextRequest("http://localhost", { method: "POST", body: "{" }),
        )
      ).status,
    ).toBe(400);
  });
  it("stores only the caller's confirmed schedule and invalidates guidance", async () => {
    expect((await POST(request({ ...value, user_id: "other" }))).status).toBe(
      200,
    );
    expect(db.writtenTo("payday_settings")).toMatchObject({
      user_id: "owner",
      cadence: "monthly",
      anchor_date: "2026-10-31",
      amount: 2000,
      day1: 31,
      day2: null,
    });
    expect(mock.invalidate).toHaveBeenCalledWith("owner");
    expect(mock.audit).toHaveBeenCalledWith({
      userId: "owner",
      action: "payday_settings_updated",
      metadata: { cadence: "monthly" },
    });
  });
  it("clears only the caller's schedule", async () => {
    expect((await DELETE()).status).toBe(200);
    expect(db.scopedToUser("payday_settings", "owner")).toBe(true);
    expect(mock.invalidate).toHaveBeenCalledWith("owner");
    expect(mock.audit).toHaveBeenCalledWith({
      userId: "owner",
      action: "payday_settings_updated",
      metadata: { cleared: true },
    });
  });
  it.each([POST, () => DELETE()])(
    "does not report or audit successful confirmation after a database failure",
    async (run) => {
      db = clientStub({ payday_settings: { error: { message: "failure" } } });
      mock.auth.mockResolvedValue({ user: { id: "owner" }, supabase: db });
      expect((await run(request(value))).status).toBe(500);
      expect(mock.audit).not.toHaveBeenCalled();
      expect(mock.invalidate).not.toHaveBeenCalled();
    },
  );
});
