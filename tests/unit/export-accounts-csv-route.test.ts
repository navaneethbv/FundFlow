import { describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { GET } from "@/app/api/export/accounts-csv/route";
import * as http from "@/lib/http";
import * as exportLib from "@/lib/export";

vi.mock("@/lib/audit", () => ({
  getClientIp: () => "127.0.0.1",
  writeAudit: vi.fn().mockResolvedValue(undefined),
}));

describe("GET /api/export/accounts-csv", () => {
  it("returns auth response if user is not authenticated", async () => {
    vi.spyOn(http, "requireUser").mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const req = new NextRequest("http://localhost/api/export/accounts-csv");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns 403 if data export is disabled", async () => {
    const mockSupabase = {} as never;
    vi.spyOn(http, "requireUser").mockResolvedValue({
      user: { id: "user-123" } as never,
      supabase: mockSupabase,
    });
    vi.spyOn(exportLib, "isExportAllowed").mockResolvedValue(false);

    const req = new NextRequest("http://localhost/api/export/accounts-csv");
    const res = await GET(req);
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toBe("Data export is disabled in your settings.");
  });

  it("handles household fetch error", async () => {
    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === "households") {
          return {
            select: vi.fn().mockResolvedValue({ data: null, error: new Error("Household DB Error") }),
          };
        }
        return {};
      }),
    } as never;

    vi.spyOn(http, "requireUser").mockResolvedValue({
      user: { id: "user-123" } as never,
      supabase: mockSupabase,
    });
    vi.spyOn(exportLib, "isExportAllowed").mockResolvedValue(true);

    const req = new NextRequest("http://localhost/api/export/accounts-csv");
    const res = await GET(req);
    expect(res.status).toBe(500);
  });

  it("exports accounts to CSV with Plaid, manual, and hidden accounts filtering", async () => {
    const plaidData = [
      {
        id: "acc-1",
        user_id: "user-123",
        name: " Checking ",
        mask: "1234",
        type: "depository",
        subtype: "checking",
        current_balance: "100.50",
        iso_currency_code: "usd",
        updated_at: "2026-08-10T00:00:00Z",
      },
      {
        id: "acc-2-hidden",
        user_id: "user-123",
        name: "Hidden Savings",
        mask: "5678",
        type: "depository",
        subtype: "savings",
        current_balance: "500",
        iso_currency_code: null,
        updated_at: "2026-08-10T00:00:00Z",
      },
      {
        id: "acc-3-credit",
        user_id: "user-123",
        name: "Card",
        mask: null,
        type: "credit",
        subtype: "credit card",
        current_balance: "-250.75",
        iso_currency_code: "USD",
        updated_at: "2026-08-10T00:00:00Z",
      },
      {
        id: "acc-4-nullbal",
        user_id: "user-123",
        name: "Null Bal",
        mask: null,
        type: "depository",
        subtype: "checking",
        current_balance: null,
        iso_currency_code: null,
        updated_at: "2026-08-10T00:00:00Z",
      },
    ];

    const manualData = [
      {
        id: "manual-1",
        user_id: "user-123",
        name: "Cash Wallet",
        account_type: "cash",
        balance: 50,
        updated_at: "2026-08-10T00:00:00Z",
      },
      {
        id: "manual-2-null",
        user_id: "user-123",
        name: "Invalid Bal",
        account_type: "other",
        balance: "invalid-num",
        updated_at: "2026-08-10T00:00:00Z",
      },
    ];

    const profileData = {
      dashboard_prefs: {
        accountsPage: {
          hiddenIds: ["acc-2-hidden"],
        },
      },
    };

    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === "households") {
          return {
            select: vi.fn().mockResolvedValue({ data: [{ id: "hh-1" }], error: null }),
          };
        }
        if (table === "accounts") {
          return {
            select: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ data: plaidData, error: null }),
              }),
            }),
          };
        }
        if (table === "manual_accounts") {
          return {
            select: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ data: manualData, error: null }),
              }),
            }),
          };
        }
        if (table === "profiles") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: profileData, error: null }),
              }),
            }),
          };
        }
        return {};
      }),
    } as never;

    vi.spyOn(http, "requireUser").mockResolvedValue({
      user: { id: "user-123" } as never,
      supabase: mockSupabase,
    });
    vi.spyOn(exportLib, "isExportAllowed").mockResolvedValue(true);

    const req = new NextRequest("http://localhost/api/export/accounts-csv?scope=personal");
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const text = await res.text();
    expect(text).toContain("Checking (...1234)");
    expect(text).not.toContain("acc-2-hidden");
    expect(text).toContain("Cash Wallet");
  });
});
