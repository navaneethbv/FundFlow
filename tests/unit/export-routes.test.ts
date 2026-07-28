import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRequireUser = vi.fn<(...args: unknown[]) => unknown>();
const mockErrorResponse = vi.fn<(...args: unknown[]) => unknown>(() => new Response("error", { status: 500 }));
vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  errorResponse: (...args: unknown[]) => mockErrorResponse(...args),
}));

const mockFetchPrivacySafeRows = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/export", () => ({
  fetchPrivacySafeRows: (...args: unknown[]) => mockFetchPrivacySafeRows(...args),
}));

const mockWriteAudit = vi.fn<(...args: unknown[]) => unknown>();
const mockGetClientIp = vi.fn<(...args: unknown[]) => unknown>(() => "127.0.0.1");
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
  getClientIp: (...args: unknown[]) => mockGetClientIp(...args),
}));

const mockServiceClient = {
  from: vi.fn<(...args: unknown[]) => unknown>(),
};
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => mockServiceClient,
}));

const mockBuildDataTakeout = vi.fn<(...args: unknown[]) => unknown>((data) => ({ takeout: data }));
vi.mock("@/lib/security-account", () => ({
  buildDataTakeout: (data: unknown) => mockBuildDataTakeout(data),
}));

const mockGetWeeklyReportData = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/weekly-report-data", () => ({
  getWeeklyReportData: (...args: unknown[]) => mockGetWeeklyReportData(...args),
}));

const mockGenerateWeeklyReportPdf = vi.fn<(...args: unknown[]) => unknown>(() => Buffer.from("pdf-data"));
vi.mock("@/lib/report-pdf", () => ({
  generateWeeklyReportPdf: (...args: unknown[]) => mockGenerateWeeklyReportPdf(...args),
}));

import { GET as jsonGet } from "@/app/api/export/json/route";
import { GET as takeoutGet } from "@/app/api/export/takeout/route";
import { GET as reportGet } from "@/app/api/export/report/route";
import { NextResponse, NextRequest } from "next/server";

describe("Export API Routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/export/json", () => {
    const request = new Request(
      "http://localhost/api/export/json",
    ) as NextRequest;

    it("returns early if not authenticated", async () => {
      mockRequireUser.mockResolvedValue(
        new NextResponse("unauthorized", { status: 401 }),
      );
      const res = await jsonGet(request);
      expect(res.status).toBe(401);
    });

    it("returns 403 if export is disabled", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: {} });
      mockFetchPrivacySafeRows.mockResolvedValue({ allowed: false });

      const res = await jsonGet(request);
      expect(res.status).toBe(403);
    });

    it("returns json export, inserts export record, and logs audit on success", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: {} });
      mockFetchPrivacySafeRows.mockResolvedValue({
        allowed: true,
        rows: [
          { date: "2026-07-01", amount: 50, merchant: "M", category: "C" },
        ],
      });

      const insertMock = vi.fn().mockResolvedValue({ error: null });
      mockServiceClient.from.mockReturnValue({ insert: insertMock });

      const res = await jsonGet(request);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Disposition")).toContain(
        'attachment; filename="fundflow-transactions.json"',
      );

      const body = await res.json();
      expect(body).toHaveLength(1);

      expect(insertMock).toHaveBeenCalledWith({
        user_id: "u1",
        format: "json",
        row_count: 1,
      });
      expect(mockWriteAudit).toHaveBeenCalledWith({
        userId: "u1",
        action: "data_export",
        metadata: { format: "json", row_count: 1 },
        ip: "127.0.0.1",
      });
    });
  });

  describe("GET /api/export/takeout", () => {
    it("returns data takeout payload", async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({ data: [] }),
        }),
      };
      mockRequireUser.mockResolvedValue({
        user: { id: "u1" },
        supabase: mockSupabase,
      });

      const res = await takeoutGet();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty("takeout");
      expect(mockBuildDataTakeout).toHaveBeenCalled();
    });

    it("returns 500 when database call throws an error", async () => {
      const mockSupabase = {
        from: vi.fn().mockImplementation(() => {
          throw new Error("DB Error");
        }),
      };
      mockRequireUser.mockResolvedValue({
        user: { id: "u1" },
        supabase: mockSupabase,
      });

      const res = await takeoutGet();
      expect(res.status).toBe(500);
    });
  });

  describe("GET /api/export/report", () => {
    const request = new Request(
      "http://localhost/api/export/report",
    ) as NextRequest;

    it("returns 404 if no report data available", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
      const selectMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { timezone: "America/New_York" },
          }),
        }),
      });
      mockServiceClient.from.mockReturnValue({ select: selectMock });
      mockGetWeeklyReportData.mockResolvedValue(null);

      const res = await reportGet(request);
      expect(res.status).toBe(404);
    });

    it("returns pdf report and logs audit on success", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
      const selectMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { timezone: "America/New_York" },
          }),
        }),
      });
      mockServiceClient.from.mockReturnValue({ select: selectMock });
      mockGetWeeklyReportData.mockResolvedValue({ some: "data" });

      const res = await reportGet(request);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/pdf");
      expect(mockWriteAudit).toHaveBeenCalledWith({
        userId: "u1",
        action: "data_export",
        metadata: { format: "pdf_report" },
        ip: "127.0.0.1",
      });
    });
  });
});
