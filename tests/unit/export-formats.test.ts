import { describe, it, expect, vi, beforeEach } from "vitest";
import { toQif, toLedgerCli, toTaxCsv } from "@/lib/export-formats";
import { GET as qifGet } from "@/app/api/export/qif/route";
import { NextRequest } from "next/server";

const mockFetchPrivacySafeRows = vi.fn();
const mockRecordExport = vi.fn();
const mockResolveExportContext = vi.fn();

vi.mock("@/lib/export", () => ({
  fetchPrivacySafeRows: (...args: unknown[]) => mockFetchPrivacySafeRows(...args),
}));

vi.mock("@/lib/export-route", () => ({
  resolveExportContext: (...args: unknown[]) => mockResolveExportContext(...args),
  recordExport: (...args: unknown[]) => mockRecordExport(...args),
  exportError: (_label: string, err: unknown) => {
    throw err;
  },
}));

describe("lib/export-formats", () => {
  const sampleRows = [
    { date: "2026-08-14", merchant: "Whole Foods", amount: 54.25, category: "GROCERIES" },
    { date: "2026-08-13", merchant: "Employer Payroll", amount: -2500.0, category: "INCOME" },
  ];

  it("converts rows to valid QIF format", () => {
    const qif = toQif(sampleRows);
    expect(qif).toContain("!Type:Bank");
    expect(qif).toContain("D2026-08-14");
    expect(qif).toContain("T-54.25");
    expect(qif).toContain("PWhole Foods");
    expect(qif).toContain("LGROCERIES");
    expect(qif).toContain("^");
    expect(qif).toContain("D2026-08-13");
    expect(qif).toContain("T2500.00");
  });

  it("converts rows to Ledger CLI plain text format", () => {
    const ledger = toLedgerCli(sampleRows, "Assets:Checking");
    expect(ledger).toContain("2026-08-14 Whole Foods");
    expect(ledger).toContain("Expenses:GROCERIES");
    expect(ledger).toContain("$54.25");
    expect(ledger).toContain("Assets:Checking");
    expect(ledger).toContain("Income:Other");
  });

  it("converts rows to Tax CSV format", () => {
    const csv = toTaxCsv(sampleRows);
    expect(csv).toContain("Date,Description,Category,Amount,Type");
    expect(csv).toContain("2026-08-14,Whole Foods,GROCERIES,54.25,Expense");
    expect(csv).toContain("2026-08-13,Employer Payroll,INCOME,-2500,Income");
  });
});

describe("GET /api/export/qif", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 with QIF attachment when allowed", async () => {
    mockResolveExportContext.mockResolvedValue({
      userId: "user-123",
      supabase: {},
    });
    mockFetchPrivacySafeRows.mockResolvedValue({
      allowed: true,
      rows: [{ date: "2026-08-14", merchant: "Store", amount: 10, category: "SHOPS" }],
    });

    const req = new NextRequest("http://localhost/api/export/qif");
    const res = await qifGet(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/x-qif; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toContain("fundflow-transactions.qif");

    const text = await res.text();
    expect(text).toContain("!Type:Bank");
    expect(text).toContain("PStore");
  });

  it("returns 403 when export is disabled", async () => {
    mockResolveExportContext.mockResolvedValue({
      userId: "user-123",
      supabase: {},
    });
    mockFetchPrivacySafeRows.mockResolvedValue({
      allowed: false,
    });

    const req = new NextRequest("http://localhost/api/export/qif");
    const res = await qifGet(req);

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe("Data export is disabled in your settings.");
  });
});
