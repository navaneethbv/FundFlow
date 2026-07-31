import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRequireUser = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  errorResponse: (_context: string, error: unknown) => {
    throw error;
  },
}));

const mockWriteAudit = vi.fn();
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
  getClientIp: () => "127.0.0.1",
}));

let flagEnabled = true;
vi.mock("@/lib/feature-flags", () => ({
  isFeatureEnabled: () => flagEnabled,
}));

const mockLoadHoldings = vi.fn();
const mockLoadHoldingSnapshots = vi.fn();
vi.mock("@/lib/investments-data", () => ({
  loadHoldings: (...args: unknown[]) => mockLoadHoldings(...args),
  loadHoldingSnapshots: (...args: unknown[]) => mockLoadHoldingSnapshots(...args),
}));

import { GET } from "@/app/api/export/investments-csv/route";
import { NextRequest, NextResponse } from "next/server";

function request() {
  return new NextRequest("http://localhost/api/export/investments-csv");
}

beforeEach(() => {
  vi.clearAllMocks();
  flagEnabled = true;
  mockLoadHoldings.mockResolvedValue([]);
  mockLoadHoldingSnapshots.mockResolvedValue([]);
});

describe("GET /api/export/investments-csv", () => {
  it("404s while investmentsPage is off", async () => {
    flagEnabled = false;
    const res = await GET(request());
    expect(res.status).toBe(404);
  });

  it("returns the auth response when not signed in", async () => {
    const unauthorized = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    mockRequireUser.mockResolvedValue(unauthorized);
    await expect(GET(request())).resolves.toBe(unauthorized);
  });

  it("exports holdings grouped by asset class as CSV and audits it", async () => {
    mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: {} });
    mockLoadHoldings.mockResolvedValue([
      {
        id: "h1",
        accountId: "a1",
        manualAccountId: null,
        accountName: "Brokerage",
        securityName: "Vanguard Total Stock",
        ticker: "VTI",
        securityType: "etf",
        quantity: 10,
        price: 100,
        value: 1000,
        source: "plaid",
        isActive: true,
      },
    ]);

    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const body = await res.text();
    expect(body).toContain("Vanguard Total Stock");
    expect(body).toContain("Funds");
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "data_export", metadata: expect.objectContaining({ kind: "investments_csv" }) }),
    );
  });
});
