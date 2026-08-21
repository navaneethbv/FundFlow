import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { parseLedgerQuery, ledgerQueryEntries, ledgerHref } from "@/lib/ledger-query";
import { GET as calendarGet } from "@/app/api/calendar/[token]/route";
import * as rateLimit from "@/lib/rate-limit";

describe("Ledger Query Full Branches", () => {
  it("parses ledger search params with all filter keys and invalid values", () => {
    const invalidQuery = parseLedgerQuery({
      month: "invalid-month",
      accountId: "not-a-uuid",
      category: "invalid category with spaces!",
      sub: "invalid sub!",
      flow: "invalid_flow",
      accountType: "unknown_type",
      sort: "invalid_sort",
      direction: "invalid_dir",
      page: "-5",
      colsSubmitted: "1",
      col: ["date", "merchant"],
    });

    expect(invalidQuery.month).toBe("");
    expect(invalidQuery.accountId).toBe("");
    expect(invalidQuery.category).toBe("");
    expect(invalidQuery.flow).toBe("");
    expect(invalidQuery.accountType).toBe("");
    expect(invalidQuery.sort).toBe("date");
    expect(invalidQuery.direction).toBe("desc");
    expect(invalidQuery.page).toBe(1);
    expect(invalidQuery.columnsSubmitted).toBe(true);

    const validQuery = parseLedgerQuery({
      month: "2026-08",
      accountId: "123e4567-e89b-12d3-a456-426614174000",
      category: "FOOD_AND_DRINK",
      sub: "GROCERIES",
      flow: "out",
      accountType: "credit",
      sort: "amount",
      direction: "asc",
      page: "3",
    });

    expect(validQuery.month).toBe("2026-08");
    expect(validQuery.sort).toBe("amount");
    expect(validQuery.direction).toBe("asc");
    expect(validQuery.page).toBe(3);
  });

  it("converts ledger state to entries and builds href", () => {
    const state = parseLedgerQuery({
      month: "2026-08",
      sort: "amount",
      direction: "asc",
      page: "2",
      colsSubmitted: "1",
      col: ["date"],
    });

    const entries = ledgerQueryEntries(state);
    expect(entries.length).toBeGreaterThan(0);

    const href = ledgerHref(entries, {
      category: "TRAVEL",
      col: ["date", "amount"],
      merchant: null,
      page: "",
    }, { resetPage: true });

    expect(href).toContain("/transactions?");
    expect(href).toContain("category=TRAVEL");

    const emptyHref = ledgerHref([], { page: null }, { resetPage: false });
    expect(emptyHref).toBe("/transactions");
  });

  it("projects, filters, and sorts ledger rows across all fields and directions", async () => {
    const {
      toLedgerFacetRow,
      resolvedLedgerAccountId,
      sortLedgerRows,
      filterProjectedLedgerRows,
    } = await import("@/lib/ledger-projection");

    expect(toLedgerFacetRow({ pfc_primary: "FOOD", pfc_detailed: "GROCERIES", merchant_name: null, name: null }).merchant).toBe("");
    expect(resolvedLedgerAccountId({ account_id: null, manual_account_id: "m1" })).toBe("m1");
    expect(resolvedLedgerAccountId({ account_id: null, manual_account_id: null })).toBe("");

    const rows = [
      {
        id: "r1",
        date: "2026-08-01",
        displayedAmount: 100,
        merchant: "Acme Store",
        category: "GENERAL_SERVICES",
        pfc_detailed: "OTHER",
        accountLabel: "Checking A",
      },
      {
        id: "r2",
        date: "2026-08-05",
        displayedAmount: 50,
        merchant: "   ",
        category: null,
        pfc_detailed: null,
        accountLabel: "",
      },
      {
        id: "r3",
        date: "2026-08-05",
        displayedAmount: 50,
        merchant: "Zeta Cafe",
        category: "FOOD_AND_DRINK",
        pfc_detailed: "COFFEE",
        accountLabel: "Checking B",
      },
    ];

    // Sort by merchant asc and desc
    const sortedByMerchantAsc = sortLedgerRows(rows as never, "merchant", "asc");
    expect(sortedByMerchantAsc).toHaveLength(3);

    const sortedByCategoryDesc = sortLedgerRows(rows as never, "category", "desc");
    expect(sortedByCategoryDesc).toHaveLength(3);

    const sortedByAccountAsc = sortLedgerRows(rows as never, "account", "asc");
    expect(sortedByAccountAsc).toHaveLength(3);

    const sortedByAmountAsc = sortLedgerRows(rows as never, "amount", "asc");
    expect(sortedByAmountAsc[0]?.displayedAmount).toBe(50);

    // Filters
    const filteredByCategory = filterProjectedLedgerRows(rows as never, { category: "FOOD_AND_DRINK" });
    expect(filteredByCategory).toHaveLength(1);

    const filteredBySub = filterProjectedLedgerRows(rows as never, { sub: "COFFEE" });
    expect(filteredBySub).toHaveLength(1);

    const filteredByMerchant = filterProjectedLedgerRows(rows as never, { merchant: "acme store" });
    expect(filteredByMerchant).toHaveLength(1);
  });
});

describe("Calendar Token Route Extra Branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handles short token or rate limit exceeded", async () => {
    const req = new NextRequest("http://localhost/api/calendar/short");
    const resShort = await calendarGet(req, { params: Promise.resolve({ token: "short" }) });
    expect(resShort.status).toBe(404);

    vi.spyOn(rateLimit, "checkRateLimit").mockResolvedValue(false);
    const validToken = "a".repeat(32);
    const resRateLimit = await calendarGet(req, { params: Promise.resolve({ token: validToken }) });
    expect(resRateLimit.status).toBe(429);
  });

  it("renders calendar feed with quarterly, yearly, and biweekly recurring streams", async () => {
    vi.spyOn(rateLimit, "checkRateLimit").mockResolvedValue(true);

    const validToken = "b".repeat(32);
    const service = await import("@/lib/supabase/service");
    vi.spyOn(service, "createServiceClient").mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "calendar_tokens") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockReturnValue({
                  gt: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: { user_id: "u-1", include_amounts: true },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "recurring_streams") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  data: [
                    {
                      id: "s1",
                      merchant_name: null,
                      description: null,
                      average_amount: null,
                      last_amount: null,
                      frequency: "bi-weekly",
                      stream_type: "inflow",
                      is_active: true,
                    },
                    {
                      id: "s2",
                      merchant_name: "Taxes",
                      description: "Quarterly Tax",
                      average_amount: 500,
                      last_amount: 500,
                      frequency: "quarterly",
                      stream_type: "outflow",
                      is_active: true,
                    },
                    {
                      id: "s3",
                      merchant_name: "Annual Sub",
                      description: "Annual Sub",
                      average_amount: 100,
                      last_amount: 100,
                      frequency: "yearly",
                      stream_type: "outflow",
                      is_active: true,
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          };
        }
        return {
          insert: vi.fn().mockResolvedValue({ error: null }),
        };
      }),
    } as never);

    const req = new NextRequest(`http://localhost/api/calendar/${validToken}`);
    const res = await calendarGet(req, { params: Promise.resolve({ token: validToken }) });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("BEGIN:VCALENDAR");
    expect(text).toContain("Recurring");
  });
});
