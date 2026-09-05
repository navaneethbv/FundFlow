import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRequireUser = vi.fn<(...args: unknown[]) => unknown>();
const mockErrorResponse = vi.fn<(...args: unknown[]) => unknown>(() => new Response("error", { status: 500 }));
vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  errorResponse: (...args: unknown[]) => mockErrorResponse(...args),
  badRequest: (message: string) => new Response(message, { status: 400 }),
}));

const mockFetchPrivacySafeRows = vi.fn<(...args: unknown[]) => unknown>();
const mockIsExportAllowed = vi.fn<(...args: unknown[]) => unknown>(() => true);
vi.mock("@/lib/export", () => ({
  fetchPrivacySafeRows: (...args: unknown[]) => mockFetchPrivacySafeRows(...args),
  isExportAllowed: (...args: unknown[]) => mockIsExportAllowed(...args),
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

let takeoutInvestmentsEnabled = true;
vi.mock("@/lib/feature-flags", () => ({
  isFeatureEnabled: () => takeoutInvestmentsEnabled,
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
import { GET as csvGet } from "@/app/api/export/csv/route";
import { GET as accountsCsvGet } from "@/app/api/export/accounts-csv/route";
import { GET as takeoutGet } from "@/app/api/export/takeout/route";
import { GET as reportGet } from "@/app/api/export/report/route";
import { NextResponse, NextRequest } from "next/server";

describe("Export API Routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    takeoutInvestmentsEnabled = true;
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

    it("returns 500 when fetchPrivacySafeRows throws in json export", async () => {
      const request = new NextRequest("http://localhost/api/export/json");
      mockRequireUser.mockResolvedValue({
        user: { id: "u1" },
        supabase: {},
      });
      mockFetchPrivacySafeRows.mockRejectedValue(new Error("Export failure"));

      const res = await jsonGet(request);
      expect(res.status).toBe(500);
    });
  });

  describe("GET /api/export/takeout", () => {
    function takeoutClient(
      seed: (table: string) => { data?: unknown; error?: unknown },
    ) {
      return {
        from: vi.fn((table: string) => ({
          select: vi.fn(() => {
            const chain = {
              eq: vi.fn(() => chain),
              or: vi.fn(() => chain),
              order: vi.fn(() => chain),
              range: vi.fn(() => Promise.resolve(seed(table))),
              then: (resolve: (v: unknown) => unknown) =>
                Promise.resolve(seed(table)).then(resolve),
            };
            return chain;
          }),
        })),
      };
    }

    it("returns early if not authenticated", async () => {
      mockRequireUser.mockResolvedValue(new NextResponse("unauthorized", { status: 401 }));
      const res = await takeoutGet();
      expect(res.status).toBe(401);
    });

    it("returns data takeout payload scoped to the caller", async () => {
      // Tables with a household-shared read policy must be filtered by
      // user_id, or takeout hands the caller a household member's records.
      // Household-owned tables are scoped differently (ownership/involvement)
      // and asserted separately below.
      const scopedTables = new Set([
        "accounts",
        "transactions",
        "account_balance_snapshots",
        "budget_periods",
        "transaction_splits",
        "transaction_annotations",
        "linked_refunds",
        "linked_duplicates",
        "receipts",
        "user_tags",
        "sinking_funds",
        "recurring_streams",
        "recurring_stream_transactions",
        "milestones",
        "goal_accounts",
        "goal_progress_events",
        "advice_progress",
        "category_overrides",
        "net_worth_snapshots",
      ]);
      const eqCalls: Array<[string, string, string]> = [];
      const orCalls: Array<[string, string, string]> = [];
      const mockSupabase = {
        from: vi.fn((table: string) => ({
          select: vi.fn(() => {
            const result = { data: [] };
            const chain = {
              eq: vi.fn((column: string, value: string) => {
                eqCalls.push([table, column, value]);
                return chain;
              }),
              or: vi.fn((filter: string) => {
                orCalls.push([table, "or", filter]);
                return chain;
              }),
              order: vi.fn(() => chain),
              range: vi.fn(() => Promise.resolve(result)),
              then: (resolve: (value: { data: never[] }) => unknown) =>
                Promise.resolve(result).then(resolve),
            };
            return chain;
          }),
        })),
      };
      mockRequireUser.mockResolvedValue({
        user: { id: "u1" },
        supabase: mockSupabase,
      });

      const res = await takeoutGet();
      expect(res.status).toBe(200);
      for (const table of scopedTables) {
        expect(eqCalls).toContainEqual([table, "user_id", "u1"]);
      }
      // Household-owned tables: the caller's own households and their share of
      // shared expenses — never the whole household.
      expect(eqCalls).toContainEqual(["households", "owner_user_id", "u1"]);
      expect(orCalls).toContainEqual(["shared_expenses", "or", "paid_by.eq.u1,owed_user_id.eq.u1"]);
      const body = await res.json();
      expect(body).toHaveProperty("takeout");
      expect(mockSupabase.from).toHaveBeenCalledWith(
        "account_balance_snapshots",
      );
      expect(mockBuildDataTakeout).toHaveBeenCalledWith(
        expect.objectContaining({
          account_balance_snapshots: [],
          budget_periods: [],
          transaction_splits: [],
        }),
      );
    });

    it("fails the takeout when budget history cannot be read", async () => {
      const mockSupabase = {
        from: vi.fn((table: string) => ({
          select: vi.fn(() => {
            const result =
              table === "budget_periods"
                ? { data: null, error: { code: "42501" } }
                : { data: [], error: null };
            const chain = {
              eq: vi.fn(() => chain),
              or: vi.fn(() => chain),
              order: vi.fn(() => chain),
              range: vi.fn(() => Promise.resolve(result)),
              then: (resolve: (v: unknown) => unknown) =>
                Promise.resolve(result).then(resolve),
            };
            return chain;
          }),
        })),
      };
      mockRequireUser.mockResolvedValue({
        user: { id: "u1" },
        supabase: mockSupabase,
      });

      const res = await takeoutGet();

      expect(res.status).toBe(500);
      expect(mockBuildDataTakeout).not.toHaveBeenCalled();
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

    it("uses empty placeholders for investment tables while the feature is off", async () => {
      takeoutInvestmentsEnabled = false;
      mockRequireUser.mockResolvedValue({
        user: { id: "u1" },
        supabase: takeoutClient(() => ({ data: [], error: null })),
      });

      const res = await takeoutGet();
      expect(res.status).toBe(200);
      expect(mockBuildDataTakeout).toHaveBeenCalledWith(
        expect.objectContaining({
          holdings: [],
          holding_snapshots: [],
          securities: [],
          investment_transactions: [],
        }),
      );
    });

    it("coerces null query data to empty arrays", async () => {
      takeoutInvestmentsEnabled = true;
      mockRequireUser.mockResolvedValue({
        user: { id: "u1" },
        supabase: takeoutClient(() => ({ data: null, error: null })),
      });

      const res = await takeoutGet();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.takeout.accounts).toEqual([]);
      expect(body.takeout.transactions).toEqual([]);
      expect(body.takeout.households).toEqual([]);
    });

    it("fails the takeout when any owned query errors", async () => {
      takeoutInvestmentsEnabled = true;
      mockRequireUser.mockResolvedValue({
        user: { id: "u1" },
        supabase: takeoutClient((table) =>
          table === "accounts"
            ? { data: null, error: { message: "select failed" } }
            : { data: [], error: null },
        ),
      });

      const res = await takeoutGet();
      expect(res.status).toBe(500);
      expect(mockBuildDataTakeout).not.toHaveBeenCalled();
    });
  });

  describe("GET /api/export/report", () => {
    const request = new Request(
      "http://localhost/api/export/report?month=2026-08",
    ) as NextRequest;

    it("returns 400 for an invalid month parameter", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
      const invalid = await reportGet(
        new Request(
          "http://localhost/api/export/report?month=2026-13",
        ) as NextRequest,
      );
      expect(invalid.status).toBe(400);
      expect(mockGetWeeklyReportData).not.toHaveBeenCalled();
    });

    it("falls back to the current week's report when no month is given", async () => {
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

      const res = await reportGet(
        new Request("http://localhost/api/export/report") as NextRequest,
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/pdf");
      expect(mockGetWeeklyReportData).toHaveBeenCalledWith(
        expect.anything(),
        "u1",
        expect.objectContaining({ kind: "weekly" }),
      );
    });

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

    it("returns pdf report for the selected month and logs audit on success", async () => {
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
      expect(res.headers.get("Content-Disposition")).toContain(
        'attachment; filename="fundflow-report-2026-08.pdf"',
      );
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(mockGetWeeklyReportData).toHaveBeenCalledWith(
        expect.anything(),
        "u1",
        expect.objectContaining({
          kind: "monthly",
          start: "2026-08-01",
          end: "2026-08-31",
        }),
      );
      expect(mockWriteAudit).toHaveBeenCalledWith({
        userId: "u1",
        action: "data_export",
        metadata: { format: "pdf_report", period: "2026-08" },
        ip: "127.0.0.1",
      });
    });

    it("returns early if unauthenticated or error thrown", async () => {
      mockRequireUser.mockResolvedValueOnce(new NextResponse("unauthorized", { status: 401 }));
      expect((await reportGet(request)).status).toBe(401);

      mockRequireUser.mockResolvedValueOnce({ user: { id: "u1" } });
      const selectMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { timezone: "America/New_York" },
          }),
        }),
      });
      mockServiceClient.from.mockReturnValue({ select: selectMock });
      mockGetWeeklyReportData.mockRejectedValueOnce(new Error("Report Error"));
      const res = await reportGet(request);
      expect(res.status).toBe(500);
    });
  });

  describe("GET /api/export/csv", () => {
    const request = new NextRequest("http://localhost/api/export/csv");

    it("returns early if not authenticated", async () => {
      mockRequireUser.mockResolvedValue(new NextResponse("unauthorized", { status: 401 }));
      const res = await csvGet(request);
      expect(res.status).toBe(401);
    });

    it("returns 403 if export is disabled", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: {} });
      mockFetchPrivacySafeRows.mockResolvedValue({ allowed: false });

      const res = await csvGet(request);
      expect(res.status).toBe(403);
    });

    it("returns csv export, inserts export record, and logs audit on success", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: {} });
      mockFetchPrivacySafeRows.mockResolvedValue({
        allowed: true,
        rows: [
          { date: "2026-07-01", amount: 50, merchant: "Coffee", category: "Food" },
        ],
      });

      const insertMock = vi.fn().mockResolvedValue({ error: null });
      mockServiceClient.from.mockReturnValue({ insert: insertMock });

      const res = await csvGet(request);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/csv");
      const text = await res.text();
      expect(text).toContain("Coffee");
    });
  });

  describe("GET /api/export/accounts-csv", () => {
    const request = new Request("http://localhost/api/export/accounts-csv") as NextRequest;

    it("returns early if not authenticated", async () => {
      mockRequireUser.mockResolvedValue(new NextResponse("unauthorized", { status: 401 }));
      const res = await accountsCsvGet(request);
      expect(res.status).toBe(401);
    });
  });
});
