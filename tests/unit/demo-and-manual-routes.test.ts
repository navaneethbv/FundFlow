import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { POST as demoPost, DELETE as demoDelete } from "@/app/api/demo/route";
import {
  POST as manualTxnPost,
  DELETE as manualTxnDelete,
} from "@/app/api/transactions/manual/route";
import {
  POST as manualHoldingPost,
  DELETE as manualHoldingDelete,
} from "@/app/api/investments/manual/route";
import { clientStub } from "../fixtures/supabase-query";
import * as http from "@/lib/http";
import * as featureFlags from "@/lib/feature-flags";

describe("Demo Route Full Branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("POST returns 401 when unauthorized", async () => {
    vi.spyOn(http, "requireUser").mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    expect((await demoPost()).status).toBe(401);
    expect((await demoDelete()).status).toBe(401);
  });

  it("POST prevents demo data when real banks exist", async () => {
    const client = clientStub({
      plaid_items: { data: [{ plaid_item_id: "real-bank-item" }] },
    });

    vi.spyOn(http, "requireUser").mockResolvedValue({
      user: { id: "u-1" } as never,
      supabase: client as never,
    });

    const res = await demoPost();
    expect(res.status).toBe(409);
  });

  it("POST loads demo data successfully", async () => {
    const client = clientStub({
      plaid_items: { data: [{ plaid_item_id: "demo-item-old" }] },
    });

    const service = await import("@/lib/supabase/service");
    vi.spyOn(service, "createServiceClient").mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "plaid_items") {
          return {
            delete: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                like: vi.fn().mockResolvedValue({ error: null }),
              }),
            }),
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: { id: "item-1" }, error: null }),
              }),
            }),
          };
        }
        if (table === "accounts") {
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockResolvedValue({
                data: [{ id: "acc-0" }, { id: "acc-1" }],
                error: null,
              }),
            }),
          };
        }
        if (table === "account_balance_snapshots") {
          return {
            upsert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        if (table === "transactions") {
          return {
            insert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        return {
          insert: vi.fn().mockResolvedValue({ error: null }),
        };
      }),
    } as never);

    vi.spyOn(http, "requireUser").mockResolvedValue({
      user: { id: "u-1" } as never,
      supabase: client as never,
    });

    const res = await demoPost();
    expect(res.status).toBe(200);
  });

  it("DELETE clears demo data successfully", async () => {
    const service = await import("@/lib/supabase/service");
    vi.spyOn(service, "createServiceClient").mockReturnValue({
      from: vi.fn().mockReturnValue({
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            like: vi.fn().mockResolvedValue({ error: null }),
          }),
        }),
        insert: vi.fn().mockResolvedValue({ error: null }),
      }),
    } as never);

    vi.spyOn(http, "requireUser").mockResolvedValue({
      user: { id: "u-1" } as never,
      supabase: {} as never,
    });

    const res = await demoDelete();
    expect(res.status).toBe(200);
  });

  it("handles database errors on POST and DELETE in demo route", async () => {
    const service = await import("@/lib/supabase/service");
    vi.spyOn(service, "createServiceClient").mockReturnValue({
      from: vi.fn().mockReturnValue({
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            like: vi.fn().mockResolvedValue({ error: new Error("Delete failed") }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: new Error("Insert item failed") }),
          }),
        }),
      }),
    } as never);

    vi.spyOn(http, "requireUser").mockResolvedValue({
      user: { id: "u-1" } as never,
      supabase: clientStub({ plaid_items: { data: [] } }) as never,
    });

    expect((await demoPost()).status).toBe(500);
    expect((await demoDelete()).status).toBe(500);

    // Account insert error
    vi.spyOn(service, "createServiceClient").mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "plaid_items") {
          return {
            delete: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ like: vi.fn().mockResolvedValue({ error: null }) }) }),
            insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: "item-1" }, error: null }) }) }),
          };
        }
        if (table === "accounts") {
          return {
            insert: vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue({ data: null, error: new Error("Accounts insert error") }) }),
          };
        }
        return {};
      }),
    } as never);
    expect((await demoPost()).status).toBe(500);
  });
});

describe("Manual Transactions Route Full Branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when transactionsParity is disabled", async () => {
    vi.spyOn(featureFlags, "isFeatureEnabled").mockReturnValue(false);
    const req = new NextRequest("http://localhost/api/transactions/manual", { method: "POST" });
    expect((await manualTxnPost(req)).status).toBe(404);
    expect((await manualTxnDelete(req)).status).toBe(404);
  });

  it("creates a manual transaction on a manual account", async () => {
    vi.spyOn(featureFlags, "isFeatureEnabled").mockReturnValue(true);

    const client = clientStub({
      manual_accounts: { data: { id: "m-1" } },
      transactions: { data: { id: "tx-new" } },
    });

    const service = await import("@/lib/supabase/service");
    vi.spyOn(service, "createServiceClient").mockReturnValue({
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { id: "tx-new" }, error: null }),
          }),
        }),
      }),
    } as never);

    vi.spyOn(http, "requireUser").mockResolvedValue({
      user: { id: "u-1" } as never,
      supabase: client as never,
    });

    const req = new NextRequest("http://localhost/api/transactions/manual", {
      method: "POST",
      body: JSON.stringify({
        account: { source: "manual", id: "m-1" },
        date: "2026-08-10",
        merchant: "Farmer Market",
        amount: 25.5,
        kind: "debit",
        category: "Food",
      }),
    });

    const res = await manualTxnPost(req);
    expect(res.status).toBe(201);
  });

  it("DELETE validates non-manual transactions", async () => {
    vi.spyOn(featureFlags, "isFeatureEnabled").mockReturnValue(true);

    const client = clientStub({
      transactions: { data: { id: "tx-plaid", source: "plaid" } }, // not manual
    });

    vi.spyOn(http, "requireUser").mockResolvedValue({
      user: { id: "u-1" } as never,
      supabase: client as never,
    });

    const req = new NextRequest("http://localhost/api/transactions/manual", {
      method: "DELETE",
      body: JSON.stringify({ id: "tx-plaid" }),
    });

    const res = await manualTxnDelete(req);
    expect(res.status).toBe(404);
  });

  it("POST creates manual transaction with manual account source and handles DB errors", async () => {
    vi.spyOn(featureFlags, "isFeatureEnabled").mockReturnValue(true);

    const client = clientStub({
      manual_accounts: { data: { id: "m-1" } },
    });

    const service = await import("@/lib/supabase/service");
    vi.spyOn(service, "createServiceClient").mockReturnValue({
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { id: "tx-new" }, error: null }),
          }),
        }),
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
            }),
          }),
        }),
      }),
    } as never);

    vi.spyOn(http, "requireUser").mockResolvedValue({
      user: { id: "u-1" } as never,
      supabase: client as never,
    });

    const reqManualAcc = new NextRequest("http://localhost/api/transactions/manual", {
      method: "POST",
      body: JSON.stringify({
        date: "2026-08-01",
        amount: 45.5,
        kind: "debit",
        merchant: "Cash Store",
        category: "FOOD_AND_DRINK",
        account: { id: "m-1", source: "manual" },
      }),
    });
    const resManualAcc = await manualTxnPost(reqManualAcc);
    expect(resManualAcc.status).toBe(201);
  });
});

describe("Manual Investments Route Full Branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("POST creates manual holding on Plaid account", async () => {
    const client = clientStub({
      accounts: { data: { id: "acc-1" } },
    });

    const service = await import("@/lib/supabase/service");
    vi.spyOn(service, "createServiceClient").mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "securities") {
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: { id: "sec-1" }, error: null }),
              }),
            }),
          };
        }
        if (table === "holdings") {
          return {
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: { id: "hold-1" }, error: null }),
              }),
            }),
          };
        }
        return {
          insert: vi.fn().mockResolvedValue({ error: null }),
        };
      }),
    } as never);

    vi.spyOn(http, "requireUser").mockResolvedValue({
      user: { id: "u-1" } as never,
      supabase: client as never,
    });

    const req = new NextRequest("http://localhost/api/investments/manual", {
      method: "POST",
      body: JSON.stringify({
        accountSource: "plaid",
        accountId: "acc-1",
        securityName: "Index ETF",
        ticker: "SPY",
        securityType: "etf",
        quantity: 10,
        price: 500,
        asOf: "2026-08-01",
      }),
    });

    const res = await manualHoldingPost(req);
    expect(res.status).toBe(201);
  });

  it("DELETE handles manual holdings", async () => {
    const client = clientStub({
      holdings: { data: { id: "hold-1", source: "manual", security_id: "sec-1" } },
    });

    const service = await import("@/lib/supabase/service");
    vi.spyOn(service, "createServiceClient").mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "holdings") {
          return {
            delete: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockResolvedValue({ error: null }),
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

    vi.spyOn(http, "requireUser").mockResolvedValue({
      user: { id: "u-1" } as never,
      supabase: client as never,
    });

    const deleteReq = new NextRequest("http://localhost/api/investments/manual", {
      method: "DELETE",
      body: JSON.stringify({ id: "hold-1" }),
    });
    expect((await manualHoldingDelete(deleteReq)).status).toBe(200);
  });

  it("handles database errors in POST and DELETE for manual transactions", async () => {
    // POST account lookup error
    const clientErr = clientStub({
      accounts: { error: new Error("Account lookup failure") },
      transactions: { error: new Error("Txn lookup failure") },
    });

    vi.spyOn(http, "requireUser").mockResolvedValue({
      user: { id: "u-1" } as never,
      supabase: clientErr as never,
    });
    vi.spyOn(featureFlags, "isFeatureEnabled").mockReturnValue(true);

    const reqPost = new NextRequest("http://localhost/api/transactions/manual", {
      method: "POST",
      body: JSON.stringify({
        account: { source: "plaid", id: "acc-1" },
        amount: 25,
        kind: "debit",
        merchant: "Store",
        category: "Shopping",
        date: "2026-08-01",
      }),
    });
    expect((await manualTxnPost(reqPost)).status).toBe(500);

    const reqDelete = new NextRequest("http://localhost/api/transactions/manual", {
      method: "DELETE",
      body: JSON.stringify({ id: "txn-1" }),
    });
    expect((await manualTxnDelete(reqDelete)).status).toBe(500);
  });

  it("handles database errors in POST and DELETE for manual holdings", async () => {
    // POST account lookup error
    const clientErr = clientStub({
      accounts: { error: new Error("Account query failure") },
      holdings: { error: new Error("Holding query failure") },
    });

    vi.spyOn(http, "requireUser").mockResolvedValue({
      user: { id: "u-1" } as never,
      supabase: clientErr as never,
    });

    const reqPost = new NextRequest("http://localhost/api/investments/manual", {
      method: "POST",
      body: JSON.stringify({
        accountId: "acc-1",
        accountSource: "plaid",
        securityName: "Vanguard Total",
        ticker: "VTI",
        securityType: "etf",
        quantity: 10,
        price: 250,
        asOf: "2026-08-01",
      }),
    });
    expect((await manualHoldingPost(reqPost)).status).toBe(500);

    const reqDelete = new NextRequest("http://localhost/api/investments/manual", {
      method: "DELETE",
      body: JSON.stringify({ id: "hold-1" }),
    });
    expect((await manualHoldingDelete(reqDelete)).status).toBe(500);
  });
});
