import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/export/report-csv/route";
import { writeAudit } from "@/lib/audit";
import { requireUser } from "@/lib/http";
import { isExportAllowed } from "@/lib/export";
import { loadReportData, resolveReportScope } from "@/lib/reports-data";
import { createServiceClient } from "@/lib/supabase/service";
import type { CanonicalFinanceTransaction } from "@/lib/finance-domain";
import { clientStub } from "../fixtures/supabase-query";

vi.mock("@/lib/http", async () => {
  const actual = await vi.importActual<typeof import("@/lib/http")>("@/lib/http");
  return { ...actual, requireUser: vi.fn() };
});
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(), getClientIp: vi.fn(() => null) }));
vi.mock("@/lib/export", () => ({ isExportAllowed: vi.fn() }));
vi.mock("@/lib/reports-data", () => ({
  loadReportData: vi.fn(),
  resolveReportScope: vi.fn(),
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: vi.fn() }));

function txn(
  partial: Partial<CanonicalFinanceTransaction>,
): CanonicalFinanceTransaction {
  return {
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
    ...partial,
  };
}

function get(query = "?start=2026-07-01&end=2026-07-31") {
  return new NextRequest(`http://localhost/api/export/report-csv${query}`);
}

describe("report CSV export route", () => {
  let service: ReturnType<typeof clientStub>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = clientStub();
    vi.mocked(createServiceClient).mockReturnValue(service as never);
    vi.mocked(requireUser).mockResolvedValue({
      user: { id: "user-1", email: "test@example.com" },
      supabase: clientStub() as never,
    } as never);
    vi.mocked(isExportAllowed).mockResolvedValue(true);
    vi.mocked(resolveReportScope).mockResolvedValue({
      scope: { kind: "mine", ownerUserId: "user-1" },
      visibleHouseholdIds: [],
    });
    vi.mocked(loadReportData).mockResolvedValue({
      transactions: [txn({})],
      currencyByAccountId: new Map([["acct-1", "USD"]]),
      truncated: false,
    });
  });

  it("403s when the profile has export disabled", async () => {
    vi.mocked(isExportAllowed).mockResolvedValue(false);
    const response = await GET(get());
    expect(response.status).toBe(403);
    expect(loadReportData).not.toHaveBeenCalled();
  });

  it("emits only the four privacy-safe columns", async () => {
    const response = await GET(get());
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body.split("\r\n")[0]).toBe("date,merchant,amount,category");
    expect(body).toContain("2026-07-10,Costco,42.5,FOOD_AND_DRINK_GROCERIES");
    // Nothing identifying may appear.
    expect(body).not.toContain("acct-1");
    expect(body).not.toContain("plaid");
    expect(body).not.toContain("s1");
  });

  it("neutralizes a spreadsheet formula in a bank-supplied merchant name", async () => {
    vi.mocked(loadReportData).mockResolvedValue({
      transactions: [txn({ merchant: "=cmd|'/c calc'!A1" })],
      currencyByAccountId: new Map(),
      truncated: false,
    });
    const body = await (await GET(get())).text();
    expect(body).toContain("'=cmd");
  });

  it("falls back to Unknown for a blank merchant or category", async () => {
    vi.mocked(loadReportData).mockResolvedValue({
      transactions: [txn({ merchant: "", categoryKey: "" })],
      currencyByAccountId: new Map(),
      truncated: false,
    });
    const body = await (await GET(get())).text();
    expect(body).toContain("Unknown");
    expect(body).toContain("UNCATEGORIZED");
  });

  it("records the export and audits it with the report source", async () => {
    await GET(get());
    expect(service.writtenTo("data_exports")).toMatchObject({
      user_id: "user-1",
      format: "csv",
      row_count: 1,
    });
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "data_export",
        metadata: expect.objectContaining({ source: "report", row_count: 1 }),
      }),
    );
  });

  it("names the file after the range and forbids caching", async () => {
    const response = await GET(get());
    expect(response.headers.get("content-disposition")).toContain(
      "fundflow-report-2026-07-01-to-2026-07-31.csv",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toContain("text/csv");
  });

  it("flags a truncated read in a header so scripted callers can tell", async () => {
    vi.mocked(loadReportData).mockResolvedValue({
      transactions: [txn({})],
      currencyByAccountId: new Map(),
      truncated: true,
    });
    const response = await GET(get());
    expect(response.headers.get("x-fundflow-truncated")).toBe("true");
  });

  it("keeps every repeated merchant filter rather than collapsing to the first", async () => {
    await GET(get("?start=2026-07-01&end=2026-07-31&merchant=Costco&merchant=Target"));
    expect(loadReportData).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        filters: expect.objectContaining({ merchants: ["Costco", "Target"] }),
      }),
    );
  });

  it("falls back to the current month when the range is missing", async () => {
    await GET(get("?tab=spending"));
    const call = vi.mocked(loadReportData).mock.calls[0]![1];
    expect(call.filters.start).toMatch(/^\d{4}-\d{2}-01$/);
    expect(call.filters.tab).toBe("spending");
  });

  it("returns the 401 from requireUser untouched", async () => {
    const { NextResponse } = await import("next/server");
    vi.mocked(requireUser).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    expect((await GET(get())).status).toBe(401);
  });

  it("surfaces a loader failure as an error response, not a partial CSV", async () => {
    vi.mocked(loadReportData).mockRejectedValue(new Error("boom"));
    const response = await GET(get());
    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toContain("application/json");
  });
});
