import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { clientStub } from "../fixtures/supabase-query";

const mockRequireUser = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  badRequest: (message: string) =>
    NextResponse.json({ error: message }, { status: 400 }),
  errorResponse: (_context: string, error: unknown) =>
    NextResponse.json({ error: error instanceof Error ? error.message : "error" }, { status: 500 }),
}));

let serviceClient = clientStub();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => serviceClient,
}));

const mockWriteAudit = vi.fn();
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
  getClientIp: () => "127.0.0.1",
}));

import { POST } from "@/app/api/sinking-funds/route";
import {
  DELETE,
  PATCH,
} from "@/app/api/sinking-funds/[id]/route";

const USER_ID = "user-1";
const FUND = {
  id: "fund-1",
  name: "Car insurance",
  target_amount: 600,
  due_date: "2027-01-31",
  cadence: "semiannual",
  custom_interval_months: null,
  cycle_anchor_date: "2027-01-31",
};

function request(method: string, body?: unknown) {
  return new NextRequest("http://localhost/api/sinking-funds", {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const context = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  serviceClient = clientStub();
  mockRequireUser.mockResolvedValue({
    user: { id: USER_ID },
    supabase: clientStub(),
  });
});

describe("POST /api/sinking-funds", () => {
  it.each([
    ["blank name", { name: " ", targetAmount: 1, dueDate: "2027-01-01", cadence: "one_time" }],
    ["zero amount", { name: "Trip", targetAmount: 0, dueDate: "2027-01-01", cadence: "one_time" }],
    ["invalid date", { name: "Trip", targetAmount: 1, dueDate: "2027-02-30", cadence: "one_time" }],
    ["unsupported cadence", { name: "Trip", targetAmount: 1, dueDate: "2027-01-01", cadence: "monthly" }],
    ["missing custom interval", { name: "Trip", targetAmount: 1, dueDate: "2027-01-01", cadence: "custom" }],
    ["custom interval on fixed cadence", { name: "Trip", targetAmount: 1, dueDate: "2027-01-01", cadence: "annual", customIntervalMonths: 2 }],
  ])("rejects %s", async (_label, body) => {
    const response = await POST(request("POST", body));

    expect(response.status).toBe(400);
    expect(serviceClient.callsOn("sinking_funds")).toEqual([]);
  });

  it("creates an owned recurring fund and audits ids only", async () => {
    serviceClient = clientStub({ sinking_funds: { data: FUND } });

    const response = await POST(request("POST", {
      name: "  Car insurance  ",
      targetAmount: 600,
      dueDate: "2027-01-31",
      cadence: "semiannual",
    }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ fund: FUND });
    expect(serviceClient.writtenTo("sinking_funds")).toEqual({
      user_id: USER_ID,
      name: "Car insurance",
      target_amount: 600,
      due_date: "2027-01-31",
      cadence: "semiannual",
      custom_interval_months: null,
      cycle_anchor_date: "2027-01-31",
    });
    expect(mockWriteAudit).toHaveBeenCalledWith({
      userId: USER_ID,
      action: "sinking_fund_created",
      metadata: { sinking_fund_id: "fund-1" },
      ip: "127.0.0.1",
    });
  });

  it("returns 500 when insert fails", async () => {
    serviceClient = clientStub({ sinking_funds: { data: null, error: { message: "Insert error" } } });
    const response = await POST(request("POST", {
      name: "Car insurance",
      targetAmount: 600,
      dueDate: "2027-01-31",
      cadence: "semiannual",
    }));
    expect(response.status).toBe(500);
  });

  it("returns 500 when insert returns no row and no error", async () => {
    serviceClient = clientStub({ sinking_funds: { data: null, error: null } });
    const response = await POST(request("POST", {
      name: "Car insurance",
      targetAmount: 600,
      dueDate: "2027-01-31",
      cadence: "semiannual",
    }));
    expect(response.status).toBe(500);
  });
});

describe("PATCH /api/sinking-funds/[id]", () => {
  it("returns 400 when id param is empty", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER_ID },
      supabase: clientStub({ sinking_funds: { data: null } }),
    });
    const response = await PATCH(
      request("PATCH", { name: "X", targetAmount: 1, dueDate: "2027-01-01", cadence: "one_time" }),
      context(""),
    );
    expect(response.status).toBe(400);
  });

  it("returns 500 when ownership query throws", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER_ID },
      supabase: clientStub({ sinking_funds: { data: null, error: { message: "DB down" } } }),
    });
    const response = await PATCH(
      request("PATCH", { name: "X", targetAmount: 1, dueDate: "2027-01-01", cadence: "one_time" }),
      context(FUND.id),
    );
    expect(response.status).toBe(500);
  });

  it("rejects invalid input body with 400", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER_ID },
      supabase: clientStub({ sinking_funds: { data: { id: FUND.id } } }),
    });
    const response = await PATCH(
      request("PATCH", { name: " ", targetAmount: -5, dueDate: "bad", cadence: "annual" }),
      context(FUND.id),
    );
    expect(response.status).toBe(400);
  });

  it("returns 404 when the owned row is not visible", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER_ID },
      supabase: clientStub({ sinking_funds: { data: null } }),
    });

    const response = await PATCH(
      request("PATCH", {
        name: "Trip",
        targetAmount: 1000,
        dueDate: "2027-05-31",
        cadence: "annual",
      }),
      context("someone-elses"),
    );

    expect(response.status).toBe(404);
    expect(serviceClient.callsOn("sinking_funds")).toEqual([]);
  });

  it("updates by id and user id while resetting the cycle anchor", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER_ID },
      supabase: clientStub({ sinking_funds: { data: { id: FUND.id } } }),
    });
    serviceClient = clientStub({ sinking_funds: { data: { ...FUND, cadence: "annual" } } });

    const response = await PATCH(
      request("PATCH", {
        name: "Car insurance",
        targetAmount: 600,
        dueDate: "2027-02-28",
        cadence: "annual",
      }),
      context(FUND.id),
    );

    expect(response.status).toBe(200);
    expect(serviceClient.writtenTo("sinking_funds")).toEqual({
      name: "Car insurance",
      target_amount: 600,
      due_date: "2027-02-28",
      cadence: "annual",
      custom_interval_months: null,
      cycle_anchor_date: "2027-02-28",
    });
    expect(serviceClient.scopedToUser("sinking_funds", USER_ID)).toBe(true);
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "sinking_fund_updated",
        metadata: { sinking_fund_id: FUND.id },
      }),
    );
  });

  it("returns 500 when service update fails", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER_ID },
      supabase: clientStub({ sinking_funds: { data: { id: FUND.id } } }),
    });
    serviceClient = clientStub({ sinking_funds: { data: null, error: { message: "Update error" } } });

    const response = await PATCH(
      request("PATCH", {
        name: "Car insurance",
        targetAmount: 600,
        dueDate: "2027-02-28",
        cadence: "annual",
      }),
      context(FUND.id),
    );
    expect(response.status).toBe(500);
  });

  it("returns 500 when service update returns no row and no error", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER_ID },
      supabase: clientStub({ sinking_funds: { data: { id: FUND.id } } }),
    });
    serviceClient = clientStub({ sinking_funds: { data: null, error: null } });

    const response = await PATCH(
      request("PATCH", {
        name: "Car insurance",
        targetAmount: 600,
        dueDate: "2027-02-28",
        cadence: "annual",
      }),
      context(FUND.id),
    );
    expect(response.status).toBe(500);
  });
});

describe("DELETE /api/sinking-funds/[id]", () => {
  it("returns 400 when id param is empty", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER_ID },
      supabase: clientStub({ sinking_funds: { data: null } }),
    });
    const response = await DELETE(request("DELETE"), context(""));
    expect(response.status).toBe(400);
  });

  it("returns 500 when ownership query throws", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER_ID },
      supabase: clientStub({ sinking_funds: { data: null, error: { message: "DB down" } } }),
    });
    const response = await DELETE(request("DELETE"), context(FUND.id));
    expect(response.status).toBe(500);
  });

  it("404s when the fund is not found", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER_ID },
      supabase: clientStub({ sinking_funds: { data: null } }),
    });

    const response = await DELETE(request("DELETE"), context("missing-id"));
    expect(response.status).toBe(404);
  });

  it("deletes by id and user id and audits the action", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER_ID },
      supabase: clientStub({ sinking_funds: { data: { id: FUND.id } } }),
    });
    serviceClient = clientStub({ sinking_funds: { error: null } });

    const response = await DELETE(request("DELETE"), context(FUND.id));

    expect(response.status).toBe(200);
    expect(serviceClient.scopedToUser("sinking_funds", USER_ID)).toBe(true);
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "sinking_fund_deleted",
        metadata: { sinking_fund_id: FUND.id },
      }),
    );
  });

  it("returns 500 when service delete fails", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER_ID },
      supabase: clientStub({ sinking_funds: { data: { id: FUND.id } } }),
    });
    serviceClient = clientStub({ sinking_funds: { error: { message: "Delete error" } } });

    const response = await DELETE(request("DELETE"), context(FUND.id));
    expect(response.status).toBe(500);
  });
});
