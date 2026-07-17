import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetWeeklyReportPeriod = vi.fn();
vi.mock("@/lib/report-period", () => ({
  getWeeklyReportPeriod: (...args: unknown[]) =>
    mockGetWeeklyReportPeriod(...args),
  isWeeklyReportDue: () => true,
  normalizeReportTimezone: (tz: string | null) => tz || "UTC",
}));

const mockGetEligibleWeeklyReportUsers = vi.fn();
vi.mock("@/lib/report-delivery", () => ({
  getEligibleWeeklyReportUsers: (...args: unknown[]) =>
    mockGetEligibleWeeklyReportUsers(...args),
  claimWeeklyDelivery: vi.fn(),
  markWeeklyDeliveryFailed: vi.fn(),
  markWeeklyDeliverySent: vi.fn(),
  safeDeliveryError: (e: { message: string }) => e.message,
}));

const mockGetWeeklyReportData = vi.fn();
vi.mock("@/lib/weekly-report-data", () => ({
  getWeeklyReportData: (...args: unknown[]) => mockGetWeeklyReportData(...args),
}));

const mockRenderWeeklyReportPdf = vi.fn();
vi.mock("@/lib/report-pdf", () => ({
  renderWeeklyReportPdf: (...args: unknown[]) =>
    mockRenderWeeklyReportPdf(...args),
  generateWeeklyReportPdf: (...args: unknown[]) =>
    mockRenderWeeklyReportPdf(...args),
}));

const mockSendWeeklyReportEmail = vi.fn();
vi.mock("@/lib/reporting", () => ({
  sendWeeklyReportEmail: (...args: unknown[]) =>
    mockSendWeeklyReportEmail(...args),
}));

const mockServiceClient = {
  from: vi.fn(),
};
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => mockServiceClient,
}));

const mockSafeEqual = vi.fn();
vi.mock("@/lib/crypto", () => ({
  safeEqual: (...args: unknown[]) => mockSafeEqual(...args),
}));

vi.mock("@/lib/env.server", () => ({
  serverEnv: { cronSecret: "test-secret" },
}));

const mockLogError = vi.fn();
vi.mock("@/lib/log", () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
}));

const mockAlertCronFailure = vi.fn();
vi.mock("@/lib/cron-alert", () => ({
  alertCronFailure: (...args: unknown[]) => mockAlertCronFailure(...args),
}));

const mockErrorResponse = vi.fn((context, err) => {
  console.error("MOCKED CRON WEEKLY ERROR:", context, err);
  return new Response("error", { status: 500 });
});
vi.mock("@/lib/http", () => ({
  errorResponse: (context: string, err: unknown) => mockErrorResponse(context, err),
}));

import { GET } from "@/app/api/cron/weekly-report/route";
import { NextRequest } from "next/server";

describe("GET /api/cron/weekly-report", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 if secret does not match", async () => {
    mockSafeEqual.mockReturnValue(false);
    const request = new NextRequest("http://localhost/api/cron/weekly-report", {
      headers: { authorization: "Bearer wrong" },
    });
    const res = await GET(request);
    expect(res.status).toBe(401);
  });

  it("runs weekly reports successfully", async () => {
    mockSafeEqual.mockReturnValue(true);
    const request = new NextRequest("http://localhost/api/cron/weekly-report", {
      headers: { authorization: "Bearer test-secret" },
    });

    mockServiceClient.from.mockImplementation((table) => {
      let data: unknown[] = [];
      if (table === "profiles") {
        data = [{ id: "u1", timezone: "America/New_York" }];
      }
      const query = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        then: undefined as unknown as (onfulfilled: (value: { data: unknown[]; error: unknown }) => unknown) => unknown,
      };
      query.then = (onfulfilled) =>
        Promise.resolve({ data, error: null }).then(onfulfilled);
      return query;
    });

    mockGetWeeklyReportPeriod.mockReturnValue({ start: "2026-07-06" });
    mockGetEligibleWeeklyReportUsers.mockResolvedValue(["u1"]);
    const { claimWeeklyDelivery } = await import("@/lib/report-delivery");
    vi.mocked(claimWeeklyDelivery).mockResolvedValue({
      claimed: true,
      deliveryId: "d1",
    });

    mockGetWeeklyReportData.mockResolvedValue({ id: "r1" });
    mockRenderWeeklyReportPdf.mockResolvedValue(Buffer.from("pdf"));
    mockSendWeeklyReportEmail.mockResolvedValue({ messageId: "msg1" });

    const res = await GET(request);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      users: 1,
      due: 1,
      reports_sent: 1,
      reports_skipped: 0,
      reports_failed: 0,
    });
  });

  it("handles PDF render failure by failing that user but continuing", async () => {
    mockSafeEqual.mockReturnValue(true);
    const request = new NextRequest("http://localhost/api/cron/weekly-report", {
      headers: { authorization: "Bearer test-secret" },
    });

    mockServiceClient.from.mockImplementation((table) => {
      let data: unknown[] = [];
      if (table === "profiles") {
        data = [{ id: "u1", timezone: "America/New_York" }];
      }
      const query = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        then: undefined as unknown as (onfulfilled: (value: { data: unknown[]; error: unknown }) => unknown) => unknown,
      };
      query.then = (onfulfilled) =>
        Promise.resolve({ data, error: null }).then(onfulfilled);
      return query;
    });

    mockGetWeeklyReportPeriod.mockReturnValue({ start: "2026-07-06" });
    mockGetEligibleWeeklyReportUsers.mockResolvedValue(["u1"]);
    const { claimWeeklyDelivery } = await import("@/lib/report-delivery");
    vi.mocked(claimWeeklyDelivery).mockResolvedValue({
      claimed: true,
      deliveryId: "d1",
    });

    mockGetWeeklyReportData.mockResolvedValue({ id: "r1" });
    mockRenderWeeklyReportPdf.mockRejectedValue(new Error("PDF Error"));

    const res = await GET(request);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      users: 1,
      due: 1,
      reports_sent: 0,
      reports_skipped: 0,
      reports_failed: 1,
      first_error: "pdf_render_failed",
    });
    expect(mockLogError).toHaveBeenCalledWith(
      "cron.weekly-report.pdf",
      expect.any(Error),
    );
  });

  it("alerts the admin when reports failed", async () => {
    mockSafeEqual.mockReturnValue(true);
    const request = new NextRequest("http://localhost/api/cron/weekly-report", {
      headers: { authorization: "Bearer test-secret" },
    });

    mockServiceClient.from.mockImplementation((table) => {
      let data: unknown[] = [];
      if (table === "profiles") {
        data = [{ id: "u1", timezone: "America/New_York" }];
      }
      const query = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        then: undefined as unknown as (onfulfilled: (value: { data: unknown[]; error: unknown }) => unknown) => unknown,
      };
      query.then = (onfulfilled) =>
        Promise.resolve({ data, error: null }).then(onfulfilled);
      return query;
    });

    mockGetWeeklyReportPeriod.mockReturnValue({ start: "2026-07-06" });
    mockGetEligibleWeeklyReportUsers.mockResolvedValue(["u1"]);
    const { claimWeeklyDelivery } = await import("@/lib/report-delivery");
    vi.mocked(claimWeeklyDelivery).mockResolvedValue({
      claimed: true,
      deliveryId: "d1",
    });

    mockGetWeeklyReportData.mockResolvedValue({ id: "r1" });
    mockRenderWeeklyReportPdf.mockRejectedValue(new Error("PDF Error"));

    const res = await GET(request);
    expect(res.status).toBe(200);
    expect(mockAlertCronFailure).toHaveBeenCalledWith("weekly-report", {
      failed: 1,
      total: 1,
      firstError: "pdf_render_failed",
    });
  });
});
