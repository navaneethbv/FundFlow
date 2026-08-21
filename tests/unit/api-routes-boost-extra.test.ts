import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  POST as manualAccountPost,
  PATCH as manualAccountPatch,
  DELETE as manualAccountDelete,
} from "@/app/api/manual-accounts/route";
import {
  POST as manualRecurringPost,
  PATCH as manualRecurringPatch,
  DELETE as manualRecurringDelete,
} from "@/app/api/recurring/manual/route";
import { clientStub } from "../fixtures/supabase-query";
import * as http from "@/lib/http";

describe("Manual Accounts Route Extra Branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handles validation errors on POST", async () => {
    vi.spyOn(http, "requireUser").mockResolvedValue({
      user: { id: "u-1" } as never,
      supabase: {} as never,
    });

    const invalidBodies = [
      {}, // missing name
      { name: "a".repeat(200), accountType: "cash", balance: 100 }, // name > 120
      { name: "My Cash", accountType: "unsupported", balance: 100 }, // bad accountType
      { name: "My Cash", accountType: "cash", balance: "not-a-number" }, // bad balance
      { name: "My Cash", accountType: "cash", balance: 100, includeInNetWorth: "yes" }, // bad inclusion
    ];

    for (const body of invalidBodies) {
      const req = new NextRequest("http://localhost/api/manual-accounts", {
        method: "POST",
        body: JSON.stringify(body),
      });
      const res = await manualAccountPost(req);
      expect(res.status).toBe(400);
    }
  });

  it("handles validation and not found on PATCH", async () => {
    const client = clientStub({
      manual_accounts: { data: null }, // not found
    });

    vi.spyOn(http, "requireUser").mockResolvedValue({
      user: { id: "u-1" } as never,
      supabase: client as never,
    });

    // Invalid id
    const reqNoId = new NextRequest("http://localhost/api/manual-accounts", {
      method: "PATCH",
      body: JSON.stringify({ balance: 100 }),
    });
    expect((await manualAccountPatch(reqNoId)).status).toBe(400);

    // Invalid balance
    const reqBadBal = new NextRequest("http://localhost/api/manual-accounts", {
      method: "PATCH",
      body: JSON.stringify({ id: "acc-1", balance: "abc" }),
    });
    expect((await manualAccountPatch(reqBadBal)).status).toBe(400);

    // Invalid includeInNetWorth
    const reqBadInc = new NextRequest("http://localhost/api/manual-accounts", {
      method: "PATCH",
      body: JSON.stringify({ id: "acc-1", balance: 100, includeInNetWorth: 123 }),
    });
    expect((await manualAccountPatch(reqBadInc)).status).toBe(400);

    // Account not found
    const reqNotFound = new NextRequest("http://localhost/api/manual-accounts", {
      method: "PATCH",
      body: JSON.stringify({ id: "acc-1", balance: 100, includeInNetWorth: true }),
    });
    expect((await manualAccountPatch(reqNotFound)).status).toBe(404);
  });

  it("handles validation and not found on DELETE", async () => {
    const client = clientStub({
      manual_accounts: { data: null },
    });

    vi.spyOn(http, "requireUser").mockResolvedValue({
      user: { id: "u-1" } as never,
      supabase: client as never,
    });

    const reqNoId = new NextRequest("http://localhost/api/manual-accounts", {
      method: "DELETE",
      body: JSON.stringify({}),
    });
    expect((await manualAccountDelete(reqNoId)).status).toBe(400);

    const reqNotFound = new NextRequest("http://localhost/api/manual-accounts", {
      method: "DELETE",
      body: JSON.stringify({ id: "acc-404" }),
    });
    expect((await manualAccountDelete(reqNotFound)).status).toBe(404);
  });

  it("handles database errors and exceptions in POST, PATCH, and DELETE for manual accounts", async () => {
    const errorDb = clientStub({
      manual_accounts: { error: new Error("DB failure") },
    });

    vi.spyOn(http, "requireUser").mockResolvedValue({
      user: { id: "u-1" } as never,
      supabase: errorDb as never,
    });

    const service = await import("@/lib/supabase/service");
    vi.spyOn(service, "createServiceClient").mockReturnValue({
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: new Error("Service insert error") }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: null, error: new Error("Service update error") }),
              }),
            }),
          }),
        }),
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: new Error("Service delete error") }),
          }),
        }),
      }),
    } as never);

    // POST error
    const reqPost = new NextRequest("http://localhost/api/manual-accounts", {
      method: "POST",
      body: JSON.stringify({ name: "Cash", accountType: "cash", balance: 100 }),
    });
    expect((await manualAccountPost(reqPost)).status).toBe(500);

    // PATCH ownership error
    const reqPatch = new NextRequest("http://localhost/api/manual-accounts", {
      method: "PATCH",
      body: JSON.stringify({ id: "acc-1", balance: 200 }),
    });
    expect((await manualAccountPatch(reqPatch)).status).toBe(500);

    // DELETE ownership error
    const reqDelete = new NextRequest("http://localhost/api/manual-accounts", {
      method: "DELETE",
      body: JSON.stringify({ id: "acc-1" }),
    });
    expect((await manualAccountDelete(reqDelete)).status).toBe(500);
  });
});

describe("Manual Recurring Route Extra Branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handles POST validation for all create fields", async () => {
    vi.spyOn(http, "requireUser").mockResolvedValue({
      user: { id: "u-1" } as never,
      supabase: {} as never,
    });

    const invalidBodies = [
      null,
      {},
      { name: "" },
      { name: "Gym", amount: -10 },
      { name: "Gym", amount: 50, frequency: "daily" },
      { name: "Gym", amount: 50, frequency: "monthly", next_date: "invalid-date" },
      { name: "Gym", amount: 50, frequency: "monthly", next_date: "2026-08-01", item_type: "investment" },
      { name: "Gym", amount: 50, frequency: "monthly", next_date: "2026-08-01", item_type: "expense", category: 123 },
      { name: "a".repeat(145), amount: 50, frequency: "monthly", next_date: "2026-08-01", item_type: "expense" },
    ];

    for (const body of invalidBodies) {
      const req = new NextRequest("http://localhost/api/recurring/manual", {
        method: "POST",
        body: JSON.stringify(body),
      });
      const res = await manualRecurringPost(req);
      expect(res.status).toBe(400);
    }
  });

  it("handles PATCH validation for all patch field parsers", async () => {
    const client = clientStub({
      manual_recurring_items: { data: null },
    });

    vi.spyOn(http, "requireUser").mockResolvedValue({
      user: { id: "u-1" } as never,
      supabase: client as never,
    });

    const invalidPatches = [
      null,
      {},
      { id: "not-a-uuid" },
      { id: "123e4567-e89b-12d3-a456-426614174000", name: "" },
      { id: "123e4567-e89b-12d3-a456-426614174000", name: "a".repeat(145) },
      { id: "123e4567-e89b-12d3-a456-426614174000", amount: -5 },
      { id: "123e4567-e89b-12d3-a456-426614174000", frequency: "hourly" },
      { id: "123e4567-e89b-12d3-a456-426614174000", next_date: "2026/08/01" },
      { id: "123e4567-e89b-12d3-a456-426614174000", item_type: "transfer" },
      { id: "123e4567-e89b-12d3-a456-426614174000", category: 123 },
      { id: "123e4567-e89b-12d3-a456-426614174000", enabled: "true" },
    ];

    for (const body of invalidPatches) {
      const req = new NextRequest("http://localhost/api/recurring/manual", {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      const res = await manualRecurringPatch(req);
      expect(res.status).toBe(400);
    }
  });

  it("handles DELETE validation and database errors", async () => {
    const client = clientStub({
      manual_recurring_items: { error: { message: "DB Error" } },
    });

    vi.spyOn(http, "requireUser").mockResolvedValue({
      user: { id: "u-1" } as never,
      supabase: client as never,
    });

    const reqBadId = new NextRequest("http://localhost/api/recurring/manual", {
      method: "DELETE",
      body: JSON.stringify({ id: "invalid" }),
    });
    expect((await manualRecurringDelete(reqBadId)).status).toBe(400);

    const reqDbError = new NextRequest("http://localhost/api/recurring/manual", {
      method: "DELETE",
      body: JSON.stringify({ id: "123e4567-e89b-12d3-a456-426614174000" }),
    });
    expect((await manualRecurringDelete(reqDbError)).status).toBe(500);
  });
});
