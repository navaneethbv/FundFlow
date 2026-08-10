import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { clientStub } from "../fixtures/supabase-query";

const mockRequireUser = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  badRequest: (message: string) =>
    NextResponse.json({ error: message }, { status: 400 }),
  errorResponse: (_context: string, error: unknown) => {
    throw error;
  },
}));

let serviceClient = clientStub();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => serviceClient,
}));

const mockWriteDailyAccountSnapshots = vi.fn();
vi.mock("@/lib/account-history", () => ({
  writeDailyAccountSnapshots: (...args: unknown[]) =>
    mockWriteDailyAccountSnapshots(...args),
  tryWriteDailyAccountSnapshots: (...args: unknown[]) =>
    mockWriteDailyAccountSnapshots(...args),
}));

const mockWriteAudit = vi.fn();
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
  getClientIp: () => "127.0.0.1",
}));

import {
  DELETE,
  PATCH,
  POST,
} from "@/app/api/manual-accounts/route";

const USER_ID = "user-1";
const ACCOUNT = {
  id: "manual-1",
  name: "Brokerage",
  account_type: "investment",
  balance: 1000,
  include_in_net_worth: true,
};

function request(method: string, body: unknown) {
  return new NextRequest("http://localhost/api/manual-accounts", {
    method,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  serviceClient = clientStub();
  mockWriteDailyAccountSnapshots.mockResolvedValue({
    written: 1,
    snapshotDate: "2026-07-29",
  });
});

describe("POST /api/manual-accounts", () => {
  it("returns the authentication response", async () => {
    const unauthorized = NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
    mockRequireUser.mockResolvedValue(unauthorized);

    await expect(
      POST(request("POST", {})),
    ).resolves.toBe(unauthorized);
  });

  it.each([
    ["blank name", { name: " ", accountType: "asset", balance: 1 }],
    [
      "long name",
      { name: "a".repeat(121), accountType: "asset", balance: 1 },
    ],
    ["bad type", { name: "Account", accountType: "crypto", balance: 1 }],
    ["string balance", { name: "Account", accountType: "asset", balance: "1" }],
    [
      "bad inclusion",
      {
        name: "Account",
        accountType: "asset",
        balance: 1,
        includeInNetWorth: "yes",
      },
    ],
  ])("rejects %s", async (_label, body) => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER_ID },
      supabase: clientStub(),
    });

    const response = await POST(request("POST", body));

    expect(response.status).toBe(400);
    expect(serviceClient.callsOn("manual_accounts")).toEqual([]);
  });

  it("creates an owned account, captures history, and audits without a balance", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER_ID },
      supabase: clientStub(),
    });
    serviceClient = clientStub({ manual_accounts: { data: ACCOUNT } });

    const response = await POST(
      request("POST", {
        name: "  Brokerage  ",
        accountType: "investment",
        balance: 1000,
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ account: ACCOUNT });
    expect(serviceClient.writtenTo("manual_accounts")).toEqual({
      user_id: USER_ID,
      name: "Brokerage",
      account_type: "investment",
      balance: 1000,
      include_in_net_worth: true,
    });
    expect(mockWriteDailyAccountSnapshots).toHaveBeenCalledWith(
      USER_ID,
      "manual-accounts.create.snapshot",
    );
    expect(mockWriteAudit).toHaveBeenCalledWith({
      userId: USER_ID,
      action: "manual_account_created",
      metadata: { account_id: "manual-1" },
      ip: "127.0.0.1",
    });
  });
});

describe("PATCH /api/manual-accounts", () => {
  it.each([
    ["missing id", { balance: 10 }],
    ["string balance", { id: "manual-1", balance: "10" }],
    [
      "bad inclusion",
      { id: "manual-1", balance: 10, includeInNetWorth: "yes" },
    ],
  ])("rejects %s", async (_label, body) => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER_ID },
      supabase: clientStub(),
    });

    const response = await PATCH(request("PATCH", body));

    expect(response.status).toBe(400);
  });

  it("returns 404 when RLS cannot resolve the account", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER_ID },
      supabase: clientStub({ manual_accounts: { data: null } }),
    });

    const response = await PATCH(
      request("PATCH", { id: "someone-elses", balance: 10 }),
    );

    expect(response.status).toBe(404);
    expect(serviceClient.callsOn("manual_accounts")).toEqual([]);
  });

  it("updates by id and user id, then captures history", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER_ID },
      supabase: clientStub({ manual_accounts: { data: { id: ACCOUNT.id } } }),
    });
    serviceClient = clientStub({
      manual_accounts: { data: { ...ACCOUNT, balance: 1250 } },
    });

    const response = await PATCH(
      request("PATCH", {
        id: ACCOUNT.id,
        balance: 1250,
        includeInNetWorth: true,
      }),
    );

    expect(response.status).toBe(200);
    expect(serviceClient.writtenTo("manual_accounts")).toEqual({
      balance: 1250,
      include_in_net_worth: true,
    });
    expect(serviceClient.scopedToUser("manual_accounts", USER_ID)).toBe(true);
    expect(mockWriteDailyAccountSnapshots).toHaveBeenCalledWith(
      USER_ID,
      "manual-accounts.update.snapshot",
    );
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "manual_account_updated",
        metadata: {
          account_id: ACCOUNT.id,
          changed_fields: ["balance", "include_in_net_worth"],
        },
      }),
    );
  });
});

describe("DELETE /api/manual-accounts", () => {
  it("returns 404 when RLS cannot resolve the account", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER_ID },
      supabase: clientStub({ manual_accounts: { data: null } }),
    });

    const response = await DELETE(
      request("DELETE", { id: "someone-elses" }),
    );

    expect(response.status).toBe(404);
  });

  it("deletes by id and user id without writing a new snapshot", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER_ID },
      supabase: clientStub({ manual_accounts: { data: { id: ACCOUNT.id } } }),
    });
    serviceClient = clientStub({ manual_accounts: { error: null } });

    const response = await DELETE(
      request("DELETE", { id: ACCOUNT.id }),
    );

    expect(response.status).toBe(200);
    expect(serviceClient.scopedToUser("manual_accounts", USER_ID)).toBe(true);
    expect(mockWriteDailyAccountSnapshots).not.toHaveBeenCalled();
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "manual_account_deleted",
        metadata: { account_id: ACCOUNT.id },
      }),
    );
  });

  it("handles auth response and missing id on DELETE", async () => {
    const unauthorized = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    mockRequireUser.mockResolvedValue(unauthorized);
    await expect(DELETE(request("DELETE", {}))).resolves.toBe(unauthorized);

    mockRequireUser.mockResolvedValue({
      user: { id: USER_ID },
      supabase: clientStub(),
    });
    const badReqRes = await DELETE(request("DELETE", {}));
    expect(badReqRes.status).toBe(400);
  });

  it("handles auth response on PATCH", async () => {
    const unauthorized = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    mockRequireUser.mockResolvedValue(unauthorized);
    await expect(PATCH(request("PATCH", {}))).resolves.toBe(unauthorized);
  });
});
