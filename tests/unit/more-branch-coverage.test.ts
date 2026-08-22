import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST as annotatePost } from "@/app/api/transactions/annotate/route";
import {
  buildAccountsPageData,
  applyAccountsPageView,
  type UnifiedAccountSummary,
} from "@/lib/accounts-page";
import { clientStub } from "../fixtures/supabase-query";
import * as http from "@/lib/http";

describe("Annotate Route Goal and Split Deep Branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("links transaction to spending_reduces goal and upserts progress event", async () => {
    const client = clientStub({
      transactions: {
        data: {
          id: "tx-1",
          amount: 75.0, // positive = expense
          date: "2026-08-10",
        },
      },
      goals: {
        data: {
          id: "goal-1",
          spending_reduces: true,
        },
      },
      transaction_annotations: {
        data: {},
      },
      goal_progress_events: {
        data: {},
      },
      transaction_splits: {
        data: [],
      },
    });

    vi.spyOn(http, "requireUser").mockResolvedValue({
      user: { id: "u-1" } as never,
      supabase: client as never,
    });

    const req = new NextRequest("http://localhost/api/transactions/annotate", {
      method: "POST",
      body: JSON.stringify({
        transaction_id: "tx-1",
        note: "Dinner with friends",
        tags: ["dining"],
        goal_id: "goal-1",
        splits: [
          { category: "FOOD", amount: 50 },
          { category: "ENTERTAINMENT", amount: 25 },
        ],
      }),
    });

    const res = await annotatePost(req);
    expect(res.status).toBe(200);
  });

  it("handles empty note and empty tags in annotation payload", async () => {
    const client = clientStub({
      transactions: {
        data: {
          id: "tx-2",
          amount: -50.0, // income
          date: "2026-08-11",
        },
      },
      transaction_annotations: { data: {} },
      transaction_splits: { data: [] },
    });

    vi.spyOn(http, "requireUser").mockResolvedValue({
      user: { id: "u-1" } as never,
      supabase: client as never,
    });

    const req = new NextRequest("http://localhost/api/transactions/annotate", {
      method: "POST",
      body: JSON.stringify({
        transaction_id: "tx-2",
        note: "",
        tags: [],
      }),
    });

    const res = await annotatePost(req);
    expect(res.status).toBe(200);
  });
});

describe("Accounts Page View Deep Coverage", () => {
  it("builds page data with mixed currencies, hidden rows, and null history", () => {
    const accounts: UnifiedAccountSummary[] = [
      {
        id: "acc-usd",
        name: "USD Checking",
        mask: "1111",
        type: "depository",
        subtype: "checking",
        currency: "USD",
        currentBalance: 5000,
        availableBalance: 4900,
        institution: "Chase",
        institutionLogo: null,
        institutionBrandColor: null,
        source: "plaid",
        ownerUserId: "u-1",
        includeInNetWorth: true,
        updatedAt: "2026-08-20T10:00:00Z",
      },
      {
        id: "acc-eur",
        name: "EUR Savings",
        mask: "2222",
        type: "depository",
        subtype: "savings",
        currency: "EUR",
        currentBalance: 3000,
        availableBalance: 3000,
        institution: "BNP",
        institutionLogo: null,
        institutionBrandColor: null,
        source: "plaid",
        ownerUserId: "u-2",
        includeInNetWorth: true,
        updatedAt: "2026-08-20T10:00:00Z",
      },
      {
        id: "acc-excluded",
        name: "Hidden Asset",
        mask: "3333",
        type: "investment",
        subtype: "brokerage",
        currency: "USD",
        currentBalance: null,
        availableBalance: null,
        institution: "Vanguard",
        institutionLogo: null,
        institutionBrandColor: null,
        source: "manual",
        ownerUserId: "u-1",
        includeInNetWorth: false,
        updatedAt: "2026-08-20T10:00:00Z",
      },
    ];

    const data = buildAccountsPageData(accounts, [], new Date("2026-08-20T12:00:00Z"));
    expect(data.summary.currencyMismatch).toBe(true);
    expect(data.summary.currencies).toEqual(["EUR", "USD"]);
    expect(data.historyStartsOn).toBeNull();

    // Filter by owner u-1
    const ownerFiltered = applyAccountsPageView(data, {
      ownerUserId: "u-1",
      groupKey: "cash",
    });
    expect(ownerFiltered.groups.cash.rows).toHaveLength(1);
    expect(ownerFiltered.groups.investment.rows).toHaveLength(0);

    // Filter by visibility: "hidden"
    const hiddenFiltered = applyAccountsPageView(data, {
      hiddenIds: ["acc-usd"],
      visibility: "hidden",
    });
    expect(hiddenFiltered.groups.cash.rows).toHaveLength(1);
    expect(hiddenFiltered.groups.cash.rows[0]?.id).toBe("acc-usd");
  });
});
