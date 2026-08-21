import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { POST as budgetPost, PUT as budgetPut } from "@/app/api/budget/route";
import { POST as annotatePost } from "@/app/api/transactions/annotate/route";
import { PATCH as advicePatch } from "@/app/api/advice/route";
import { GET as cronWeeklyGet } from "@/app/api/cron/weekly-report/route";
import { PATCH as receiptPatch, DELETE as receiptDelete } from "@/app/api/receipts/[id]/route";
import { clientStub } from "../fixtures/supabase-query";
import * as http from "@/lib/http";

describe("Budget Route Extra Branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("POST returns 401 when unauthorized", async () => {
    vi.spyOn(http, "requireUser").mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const req = new NextRequest("http://localhost/api/budget", { method: "POST" });
    expect((await budgetPost(req)).status).toBe(401);
  });

  it("POST validates invalid proposal items and fields", async () => {
    vi.spyOn(http, "requireUser").mockResolvedValue({
      user: { id: "u-1" } as never,
      supabase: {} as never,
    });

    const invalidItems = [
      { month: "invalid-month", items: [] },
      { month: "2026-08", items: "not-an-array" },
      { month: "2026-08", items: [{ category: "" }] },
      { month: "2026-08", items: [{ category: "Groceries", monthly_limit: -5 }] },
      { month: "2026-08", items: [{ category: "Groceries", monthly_limit: 10.999 }] },
      { month: "2026-08", items: [{ category: "Groceries", monthly_limit: 100, group_name: "invalid_group" }] },
      { month: "2026-08", items: [{ category: "Groceries", monthly_limit: 100, group_name: "flexible", rollover_enabled: "yes" }] },
      { month: "2026-08", items: [{ category: "Groceries", monthly_limit: 100, group_name: "flexible", rollover_enabled: true, sort_order: -1 }] },
    ];

    for (const body of invalidItems) {
      const req = new NextRequest("http://localhost/api/budget", {
        method: "POST",
        body: JSON.stringify(body),
      });
      const res = await budgetPost(req);
      expect(res.status).toBe(400);
    }
  });

  it("POST handles database read and insert errors", async () => {
    const client = clientStub({
      budgets: { error: { message: "Read error" } },
    });

    vi.spyOn(http, "requireUser").mockResolvedValue({
      user: { id: "u-1" } as never,
      supabase: client as never,
    });

    const req = new NextRequest("http://localhost/api/budget", {
      method: "POST",
      body: JSON.stringify({
        month: "2026-08",
        items: [
          {
            category: "Groceries",
            monthly_limit: 500,
            group_name: "flexible",
            rollover_enabled: false,
            sort_order: 0,
          },
        ],
      }),
    });
    expect((await budgetPost(req)).status).toBe(500);
  });

  it("PUT handles RPC errors and empty returns", async () => {
    const client = {
      ...clientStub(),
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "RPC failed" } }),
    };

    vi.spyOn(http, "requireUser").mockResolvedValue({
      user: { id: "u-1" } as never,
      supabase: client as never,
    });

    const req1 = new NextRequest("http://localhost/api/budget", {
      method: "PUT",
      body: JSON.stringify({
        budget_id: "123e4567-e89b-12d3-a456-426614174000",
        month: "2026-08",
        planned: 600,
        group_name: "flexible",
      }),
    });
    expect((await budgetPut(req1)).status).toBe(500);

    client.rpc = vi.fn().mockResolvedValue({ data: [], error: null }) as never;
    const req2 = new NextRequest("http://localhost/api/budget", {
      method: "PUT",
      body: JSON.stringify({
        budget_id: "123e4567-e89b-12d3-a456-426614174000",
        month: "2026-08",
        planned: 600,
        group_name: "flexible",
      }),
    });
    expect((await budgetPut(req2)).status).toBe(500);
  });
});

describe("Annotate Route Split and Tag Branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("POST deletes annotations and splits when empty or zero amount", async () => {
    const client = clientStub({
      transactions: {
        data: { id: "tx-1", amount: 100 },
      },
      transaction_annotations: { data: [] },
      transaction_splits: { data: [] },
    });

    vi.spyOn(http, "requireUser").mockResolvedValue({
      user: { id: "u-1" } as never,
      supabase: client as never,
    });

    const req = new NextRequest("http://localhost/api/transactions/annotate", {
      method: "POST",
      body: JSON.stringify({
        transaction_id: "tx-1",
        note: "",
        tags: [],
        splits: [],
      }),
    });
    const res = await annotatePost(req);
    expect(res.status).toBe(200);
  });

  it("POST rejects mismatched split totals", async () => {
    const client = clientStub({
      transactions: {
        data: { id: "tx-1", amount: 100 },
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
        splits: [{ category: "Groceries", amount: 40 }],
      }),
    });
    const res = await annotatePost(req);
    expect(res.status).toBe(400);
  });
});

describe("Receipts [id] Route Branches", () => {
  it("handles unauthorized calls on PATCH and DELETE", async () => {
    vi.spyOn(http, "requireUser").mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const req = new NextRequest("http://localhost/api/receipts/r-1");
    expect((await receiptPatch(req, { params: Promise.resolve({ id: "r-1" }) })).status).toBe(401);
    expect((await receiptDelete(req, { params: Promise.resolve({ id: "r-1" }) })).status).toBe(401);
  });

  it("handles receiptPatch with attach, ignore, restore, and validation errors", async () => {
    const client = clientStub({
      receipts: { data: { id: "r-1", storage_path: "u-1/r-1.jpg" } },
      transactions: { data: null }, // transaction not found
    });

    const service = await import("@/lib/supabase/service");
    vi.spyOn(service, "createServiceClient").mockReturnValue({
      from: vi.fn().mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: "r-1", status: "matched" },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }),
    } as never);

    vi.spyOn(http, "requireUser").mockResolvedValue({
      user: { id: "u-1" } as never,
      supabase: client as never,
    });

    // Invalid action
    const reqBadAction = new NextRequest("http://localhost/api/receipts/r-1", {
      method: "PATCH",
      body: JSON.stringify({ action: "invalid_action" }),
    });
    expect((await receiptPatch(reqBadAction, { params: Promise.resolve({ id: "r-1" }) })).status).toBe(400);

    // Attach missing transactionId
    const reqAttachNoTxn = new NextRequest("http://localhost/api/receipts/r-1", {
      method: "PATCH",
      body: JSON.stringify({ action: "attach" }),
    });
    expect((await receiptPatch(reqAttachNoTxn, { params: Promise.resolve({ id: "r-1" }) })).status).toBe(400);

    // Attach transaction not found
    const reqAttachTxnNotFound = new NextRequest("http://localhost/api/receipts/r-1", {
      method: "PATCH",
      body: JSON.stringify({ action: "attach", transactionId: "tx-404" }),
    });
    expect((await receiptPatch(reqAttachTxnNotFound, { params: Promise.resolve({ id: "r-1" }) })).status).toBe(404);

    // Ignore action
    const reqIgnore = new NextRequest("http://localhost/api/receipts/r-1", {
      method: "PATCH",
      body: JSON.stringify({ action: "ignore" }),
    });
    expect((await receiptPatch(reqIgnore, { params: Promise.resolve({ id: "r-1" }) })).status).toBe(200);

    // Restore action
    const reqRestore = new NextRequest("http://localhost/api/receipts/r-1", {
      method: "PATCH",
      body: JSON.stringify({ action: "restore" }),
    });
    expect((await receiptPatch(reqRestore, { params: Promise.resolve({ id: "r-1" }) })).status).toBe(200);
  });
});

describe("Advice and Cron Weekly Extra Branches", () => {
  it("handles advice unauthorized and missing params", async () => {
    vi.spyOn(http, "requireUser").mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const req = new NextRequest("http://localhost/api/advice", { method: "PATCH" });
    expect((await advicePatch(req)).status).toBe(401);

    vi.spyOn(http, "requireUser").mockResolvedValue({
      user: { id: "u-1" } as never,
      supabase: {} as never,
    });
    const reqNoKind = new NextRequest("http://localhost/api/advice", {
      method: "PATCH",
      body: JSON.stringify({}),
    });
    expect((await advicePatch(reqNoKind)).status).toBe(400);

    const reqUnknownKind = new NextRequest("http://localhost/api/advice", {
      method: "PATCH",
      body: JSON.stringify({ kind: "unknown_kind" }),
    });
    expect((await advicePatch(reqUnknownKind)).status).toBe(400);
  });

  it("handles toggle_task, set_priorities, and update_profile", async () => {
    const service = await import("@/lib/supabase/service");
    vi.spyOn(service, "createServiceClient").mockReturnValue({
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "advice_progress") {
          return {
            upsert: vi.fn().mockResolvedValue({ error: null }),
            delete: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockResolvedValue({ error: null }),
                }),
              }),
            }),
          };
        }
        if (table === "profiles") {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null }),
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
      supabase: {} as never,
    });

    // Unknown advice or task id
    const reqBadTask = new NextRequest("http://localhost/api/advice", {
      method: "PATCH",
      body: JSON.stringify({
        kind: "toggle_task",
        adviceId: "unknown",
        taskId: "unknown",
        completed: true,
      }),
    });
    expect((await advicePatch(reqBadTask)).status).toBe(400);

    // Valid advice task toggle true
    const reqToggleTrue = new NextRequest("http://localhost/api/advice", {
      method: "PATCH",
      body: JSON.stringify({
        kind: "toggle_task",
        adviceId: "emergency-fund",
        taskId: "compare-savings-to-one-month",
        completed: true,
      }),
    });
    expect((await advicePatch(reqToggleTrue)).status).toBe(200);

    // Valid advice task toggle false
    const reqToggleFalse = new NextRequest("http://localhost/api/advice", {
      method: "PATCH",
      body: JSON.stringify({
        kind: "toggle_task",
        adviceId: "emergency-fund",
        taskId: "compare-savings-to-one-month",
        completed: false,
      }),
    });
    expect((await advicePatch(reqToggleFalse)).status).toBe(200);

    // set_priorities invalid
    const reqBadPriorities = new NextRequest("http://localhost/api/advice", {
      method: "PATCH",
      body: JSON.stringify({
        kind: "set_priorities",
        priorities: "not-an-array",
      }),
    });
    expect((await advicePatch(reqBadPriorities)).status).toBe(400);

    // set_priorities valid
    const reqValidPriorities = new NextRequest("http://localhost/api/advice", {
      method: "PATCH",
      body: JSON.stringify({
        kind: "set_priorities",
        priorities: ["emergency-fund"],
      }),
    });
    expect((await advicePatch(reqValidPriorities)).status).toBe(200);

    // update_profile invalid
    const reqBadProfile = new NextRequest("http://localhost/api/advice", {
      method: "PATCH",
      body: JSON.stringify({
        kind: "update_profile",
        profile: "not-an-object",
      }),
    });
    expect((await advicePatch(reqBadProfile)).status).toBe(400);

    // update_profile valid
    const reqValidProfile = new NextRequest("http://localhost/api/advice", {
      method: "PATCH",
      body: JSON.stringify({
        kind: "update_profile",
        profile: {
          hasDependents: true,
          employmentStatus: "employed",
          homeownership: "own",
        },
      }),
    });
    expect((await advicePatch(reqValidProfile)).status).toBe(200);
  });

  it("handles cron weekly authorization header mismatch", async () => {
    const origSecret = process.env.CRON_SECRET;
    try {
      process.env.CRON_SECRET = "super-secret";
      const req = new NextRequest("http://localhost/api/cron/weekly-report", {
        headers: { authorization: "Bearer wrong-secret" },
      });
      const res = await cronWeeklyGet(req);
      expect(res.status).toBe(401);
    } finally {
      process.env.CRON_SECRET = origSecret;
    }
  });
});

