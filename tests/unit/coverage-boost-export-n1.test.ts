import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse, NextRequest } from "next/server";
import { clientStub } from "../fixtures/supabase-query";

const mockRequireUser = vi.fn<(...args: unknown[]) => unknown>();
const mockErrorResponse = vi.fn<(...args: unknown[]) => unknown>(
  (_context: unknown, error: unknown) =>
    NextResponse.json(
      { error: error instanceof Error ? error.message : "error" },
      { status: 500 },
    ),
);
vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  errorResponse: (...args: unknown[]) => mockErrorResponse(...args),
}));

const mockVerifyApiToken = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/api-tokens", () => ({
  verifyApiToken: (...args: unknown[]) => mockVerifyApiToken(...args),
}));

const mockFetchPrivacySafeRows = vi.fn<(...args: unknown[]) => unknown>();
const mockIsExportAllowed = vi.fn<(...args: unknown[]) => unknown>();
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

let serviceClient = clientStub();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => serviceClient,
}));

let investmentsFlag = true;
vi.mock("@/lib/feature-flags", () => ({
  isFeatureEnabled: () => investmentsFlag,
}));

const mockBuildInvestmentsPage = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/investments", () => ({
  buildInvestmentsPage: (...args: unknown[]) => mockBuildInvestmentsPage(...args),
}));

const mockLoadHoldings = vi.fn<(...args: unknown[]) => unknown>();
const mockLoadHoldingSnapshots = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/investments-data", () => ({
  loadHoldings: (...args: unknown[]) => mockLoadHoldings(...args),
  loadHoldingSnapshots: (...args: unknown[]) => mockLoadHoldingSnapshots(...args),
}));

const mockGetWeeklyReportData = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/weekly-report-data", () => ({
  getWeeklyReportData: (...args: unknown[]) => mockGetWeeklyReportData(...args),
}));

const mockGenerateWeeklyReportPdf = vi.fn<(...args: unknown[]) => unknown>(() =>
  Buffer.from("pdf-bytes"),
);
vi.mock("@/lib/report-pdf", () => ({
  generateWeeklyReportPdf: (...args: unknown[]) =>
    mockGenerateWeeklyReportPdf(...args),
}));

const mockLoadReportData = vi.fn<(...args: unknown[]) => unknown>();
const mockResolveReportScope = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/reports-data", () => ({
  loadReportData: (...args: unknown[]) => mockLoadReportData(...args),
  resolveReportScope: (...args: unknown[]) => mockResolveReportScope(...args),
}));

import { GET as csvGet } from "@/app/api/export/csv/route";
import { GET as investmentsCsvGet } from "@/app/api/export/investments-csv/route";
import { GET as qifGet } from "@/app/api/export/qif/route";
import { GET as reportGet } from "@/app/api/export/report/route";
import { GET as reportCsvGet } from "@/app/api/export/report-csv/route";

const TOKEN_USER = "11111111-1111-1111-1111-111111111111";

function taxRequest() {
  return new NextRequest("http://localhost/api/export/csv?scope=tax");
}

describe("coverage-boost export routes (n1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serviceClient = clientStub({ data_exports: { error: null } });
    investmentsFlag = true;
    mockGetClientIp.mockReturnValue("127.0.0.1");
    mockGenerateWeeklyReportPdf.mockResolvedValue(Buffer.from("pdf-bytes"));
    mockLoadReportData.mockResolvedValue({
      transactions: [
        {
          id: "t1",
          sourceTransactionId: "s1",
          date: "2026-07-10",
          signedAmount: 42.5,
          flow: "expense",
          merchant: "Costco",
          groupKey: "FOOD_AND_DRINK",
          categoryKey: "FOOD_AND_DRINK_GROCERIES",
          accountId: "acct-1",
          manualAccountId: null,
          pending: false,
          source: "plaid",
        },
      ],
      currencyByAccountId: new Map([["acct-1", "USD"]]),
      truncated: false,
    });
    mockResolveReportScope.mockResolvedValue({
      scope: { kind: "mine", ownerUserId: "u1" },
      visibleHouseholdIds: [],
    });
    mockIsExportAllowed.mockResolvedValue(true);
  });

  describe("GET /api/export/csv?scope=tax", () => {
    beforeEach(() => {
      // Force the API-token path: no session, but a valid token.
      mockRequireUser.mockResolvedValue(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      );
      mockVerifyApiToken.mockResolvedValue(TOKEN_USER);
      mockFetchPrivacySafeRows.mockResolvedValue({
        allowed: true,
        rows: [{ date: "2026-07-01", merchant: "M", amount: 10, category: "C" }],
      });
    });

    it("coerces a null transaction_annotations result to an empty id list", async () => {
      serviceClient = clientStub({
        transaction_annotations: { data: null },
        data_exports: { error: null },
      });
      const res = await csvGet(taxRequest());
      expect(res.status).toBe(200);
      const text = await res.text();
      // No annotated ids, so only the header row is emitted.
      expect(text.split("\r\n")[0]).toBe("date,merchant,amount,category");
      expect(serviceClient.callsOn("transaction_annotations").length).toBeGreaterThan(0);
      expect(serviceClient.callsOn("transactions")).toHaveLength(0);
    });

    it("coerces a null tax transactions result to an empty row set", async () => {
      serviceClient = clientStub({
        transaction_annotations: { data: [{ transaction_id: "t1" }] },
        transactions: { data: null },
        data_exports: { error: null },
      });
      const res = await csvGet(taxRequest());
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text.split("\r\n")[0]).toBe("date,merchant,amount,category");
      expect(serviceClient.callsOn("transactions").length).toBeGreaterThan(0);
    });
  });

  describe("GET /api/export/investments-csv", () => {
    it("403s when the profile has export disabled", async () => {
      mockIsExportAllowed.mockResolvedValue(false);
      mockRequireUser.mockResolvedValue({
        user: { id: "u1" },
        supabase: {},
      });
      const res = await investmentsCsvGet(
        new NextRequest("http://localhost/api/export/investments-csv"),
      );
      expect(res.status).toBe(403);
      await expect(res.json()).resolves.toEqual({
        error: "Data export is disabled in your settings.",
      });
    });

    it("emits holdings grouped by asset class when export is allowed", async () => {
      mockRequireUser.mockResolvedValue({
        user: { id: "u1" },
        supabase: {},
      });
      mockLoadHoldings.mockResolvedValue([]);
      mockLoadHoldingSnapshots.mockResolvedValue([]);
      mockBuildInvestmentsPage.mockReturnValue({
        total: 1000,
        dayChange: null,
        byClass: [
          {
            label: "Stocks",
            holdings: [
              {
                securityName: "Apple",
                ticker: "AAPL",
                accountName: "Brokerage",
                quantity: 10,
                price: 100,
                value: 1000,
                weightPct: 100,
              },
            ],
            subtotal: 1000,
          },
        ],
        topMovers: null,
        balanceHistory: [],
      });
      const res = await investmentsCsvGet(
        new NextRequest("http://localhost/api/export/investments-csv"),
      );
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("asset_class,security,ticker,account");
      expect(text).toContain("Apple");
      expect(mockWriteAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "data_export",
          metadata: expect.objectContaining({ kind: "investments_csv" }),
        }),
      );
    });
  });

  describe("GET /api/export/qif", () => {
    it("returns 200 with a QIF body on success", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: {} });
      mockFetchPrivacySafeRows.mockResolvedValue({
        allowed: true,
        rows: [{ date: "2026-07-01", merchant: "M", amount: 10, category: "C" }],
      });
      const res = await qifGet(
        new NextRequest("http://localhost/api/export/qif"),
      );
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("!Type:Bank");
      expect(mockWriteAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "data_export" }),
      );
    });

    it("surfaces a fetch failure through exportError", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: {} });
      mockFetchPrivacySafeRows.mockRejectedValue(new Error("QIF export failed"));
      const res = await qifGet(
        new NextRequest("http://localhost/api/export/qif"),
      );
      expect(res.status).toBe(500);
      expect(mockErrorResponse).toHaveBeenCalledWith(
        "export.qif",
        expect.any(Error),
      );
    });
  });

  describe("GET /api/export/report", () => {
    it("403s when the profile has export disabled", async () => {
      mockIsExportAllowed.mockResolvedValue(false);
      mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
      const res = await reportGet(
        new NextRequest("http://localhost/api/export/report"),
      );
      expect(res.status).toBe(403);
      await expect(res.json()).resolves.toEqual({
        error: "Data export is disabled in your settings.",
      });
    });

    it("falls back to the default timezone when the profile has none", async () => {
      mockRequireUser.mockResolvedValue({ user: { id: "u1" } });
      serviceClient = clientStub({
        profiles: { data: null },
        data_exports: { error: null },
      });
      mockGetWeeklyReportData.mockResolvedValue({ some: "report" });
      const res = await reportGet(
        new NextRequest("http://localhost/api/export/report"),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/pdf");
      expect(mockGetWeeklyReportData).toHaveBeenCalledWith(
        serviceClient,
        "u1",
        expect.objectContaining({ start: expect.any(String) }),
      );
    });
  });

  describe("GET /api/export/report-csv", () => {
    it("exports an empty row set when the requested currency has no rows", async () => {
      mockRequireUser.mockResolvedValue({
        user: { id: "u1" },
        supabase: {},
      });
      const res = await reportCsvGet(
        new NextRequest(
          "http://localhost/api/export/report-csv?start=2026-07-01&end=2026-07-31&currency=EUR",
        ),
      );
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text.split("\r\n")[0]).toBe("date,merchant,amount,category");
      // Only the header exists — the EUR bucket is empty.
      expect(text.split("\r\n").filter(Boolean)).toHaveLength(1);
    });
  });
});