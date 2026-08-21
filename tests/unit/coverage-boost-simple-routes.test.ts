import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { clientStub, queryStub } from "../fixtures/supabase-query";

const mockRequireUser = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/http", () => ({
  requireUser: (...args: unknown[]) => mockRequireUser(...args),
  badRequest: (msg: unknown) => NextResponse.json({ error: String(msg) }, { status: 400 }),
  errorResponse: (_ctx: unknown, error: unknown) =>
    NextResponse.json({ error: String(error) }, { status: 500 }),
}));

const mockWriteAudit = vi.fn(async () => undefined);
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
  getClientIp: () => "127.0.0.1",
}));

const mockServiceClient = { from: vi.fn() };
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => mockServiceClient,
}));

const mockTrySnapshot = vi.fn(async () => undefined);
vi.mock("@/lib/account-history", () => ({
  tryWriteDailyAccountSnapshots: (...args: unknown[]) => mockTrySnapshot(...args),
}));

import { POST as calTokenPost, DELETE as calTokenDelete } from "@/app/api/calendar/token/route";
import { POST as sfPost } from "@/app/api/sinking-funds/route";
import { PATCH as sfPatch, DELETE as sfDelete } from "@/app/api/sinking-funds/[id]/route";
import {
  POST as manualPost,
  PATCH as manualPatch,
  DELETE as manualDelete,
} from "@/app/api/manual-accounts/route";

function authed(supabase: unknown) {
  mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: supabase as never });
}

function jsonRequest(body: unknown, reject = false) {
  return {
    url: "https://x.local",
    json: () => (reject ? Promise.reject(new Error("boom")) : Promise.resolve(body)),
  } as unknown as NextRequest;
}

const VALID_FUND = { name: "Vacation", targetAmount: 1000, dueDate: "2026-12-31", cadence: "quarterly" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("calendar/token route", () => {
  it("creates and revokes tokens, covering json-reject and error paths", async () => {
    authed(clientStub({ calendar_tokens: { data: { id: "t1", include_amounts: false, created_at: "x" }, error: null } }));
    const ok = await calTokenPost(jsonRequest({ includeAmounts: true }));
    expect(ok.status).toBe(200);
    await expect(ok.json()).resolves.toMatchObject({ row: { id: "t1" } });

    authed(clientStub({ calendar_tokens: { data: { id: "t2", include_amounts: false, created_at: "y" }, error: null } }));
    await calTokenPost(jsonRequest(null, true));
    await calTokenDelete(jsonRequest({ id: "t1" }));
    await calTokenDelete(jsonRequest({}));
    await calTokenDelete(jsonRequest(null, true));

    authed(clientStub({ calendar_tokens: { data: null, error: new Error("create boom") } }));
    expect((await calTokenPost(jsonRequest({}))).status).toBe(500);

    authed(clientStub({ calendar_tokens: { data: null, error: new Error("revoke boom") } }));
    expect((await calTokenDelete(jsonRequest({ id: "t1" }))).status).toBe(500);

    mockRequireUser.mockResolvedValue(new NextResponse("x", { status: 401 }));
    expect((await calTokenPost({} as NextRequest)).status).toBe(401);
    expect((await calTokenDelete({} as NextRequest)).status).toBe(401);
  });
});

describe("sinking-funds route", () => {
  it("creates a fund, rejects invalid input, and surfaces errors", async () => {
    authed(clientStub());
    mockServiceClient.from.mockReturnValue(queryStub({ data: { id: "f1" }, error: null }));
    const ok = await sfPost(jsonRequest(VALID_FUND));
    expect(ok.status).toBe(201);

    expect((await sfPost(jsonRequest({ name: "x", targetAmount: -1, dueDate: "bad", cadence: "nope" }))).status).toBe(400);
    expect((await sfPost(jsonRequest(null, true))).status).toBe(400);
    expect((await sfPost(jsonRequest({ ...VALID_FUND, cadence: "custom" }))).status).toBe(400);
    expect((await sfPost(jsonRequest({ ...VALID_FUND, cadence: "custom", customIntervalMonths: 0 }))).status).toBe(400);

    mockServiceClient.from.mockReturnValue(queryStub({ data: null, error: null }));
    expect((await sfPost(jsonRequest(VALID_FUND))).status).toBe(500);

    mockServiceClient.from.mockReturnValue(queryStub({ data: null, error: new Error("create boom") }));
    expect((await sfPost(jsonRequest(VALID_FUND))).status).toBe(500);

    mockRequireUser.mockResolvedValue(new NextResponse("x", { status: 401 }));
    expect((await sfPost({} as NextRequest)).status).toBe(401);
  });
});

describe("sinking-funds [id] route", () => {
  const ctx = () => ({ params: Promise.resolve({ id: "f1" }) }) as never;

  it("patches and deletes a fund, covering ownership, invalid, and error paths", async () => {
    authed(clientStub({ sinking_funds: { data: { id: "f1" }, error: null } }));
    mockServiceClient.from.mockReturnValue(queryStub({ data: { id: "f1" }, error: null }));
    expect((await sfPatch(jsonRequest({ ...VALID_FUND, cadence: "custom", customIntervalMonths: 3 }), ctx())).status).toBe(200);
    expect((await sfDelete(jsonRequest({}), ctx())).status).toBe(200);

    mockServiceClient.from.mockReturnValue(queryStub({ data: null, error: null }));
    expect((await sfPatch(jsonRequest(VALID_FUND), ctx())).status).toBe(500);

    authed(clientStub({ sinking_funds: { data: null, error: null } }));
    expect((await sfPatch(jsonRequest(VALID_FUND), ctx())).status).toBe(404);
    expect((await sfDelete(jsonRequest({}), ctx())).status).toBe(404);

    authed(clientStub({ sinking_funds: { data: { id: "f1" }, error: null } }));
    mockServiceClient.from.mockReturnValue(queryStub({ data: { id: "f1" }, error: new Error("update boom") }));
    expect((await sfPatch(jsonRequest(VALID_FUND), ctx())).status).toBe(500);
    mockServiceClient.from.mockReturnValue(queryStub({ error: new Error("delete boom") }));
    expect((await sfDelete(jsonRequest({}), ctx())).status).toBe(500);

    authed(clientStub({ sinking_funds: { data: { id: "f1" }, error: null } }));
    mockServiceClient.from.mockReturnValue(queryStub({ data: { id: "f1" }, error: null }));
    expect((await sfPatch(jsonRequest({ name: "" }), ctx())).status).toBe(400);
    expect((await sfPatch(jsonRequest(null, true), ctx())).status).toBe(400);

    mockRequireUser.mockResolvedValue(new NextResponse("x", { status: 401 }));
    expect((await sfPatch({} as NextRequest, ctx())).status).toBe(401);
    expect((await sfDelete({} as NextRequest, ctx())).status).toBe(401);
  });
});

describe("manual-accounts route", () => {
  it("covers POST, PATCH, DELETE success, validation, json-reject, and error paths", async () => {
    mockServiceClient.from.mockReturnValue(queryStub({ data: { id: "a1" }, error: null }));
    authed(clientStub({ manual_accounts: { data: { id: "a1" }, error: null } }));
    const ok = await manualPost(jsonRequest({ name: "Cash", accountType: "cash", balance: 100, includeInNetWorth: false }));
    expect(ok.status).toBe(201);
    expect((await manualPatch(jsonRequest({ id: "a1", balance: 150, includeInNetWorth: true }))).status).toBe(200);
    expect((await manualDelete(jsonRequest({ id: "a1" }))).status).toBe(200);

    // json-reject arrows
    await manualPost(jsonRequest(null, true));
    await manualPatch(jsonRequest(null, true));
    await manualDelete(jsonRequest(null, true));

    // validation failures
    expect((await manualPost(jsonRequest({ name: "", accountType: "cash", balance: 1 }))).status).toBe(400);
    expect((await manualPost(jsonRequest({ name: "x", accountType: "bogus", balance: 1 }))).status).toBe(400);
    expect((await manualPost(jsonRequest({ name: "x", accountType: "cash", balance: NaN }))).status).toBe(400);
    expect((await manualPost(jsonRequest({ name: "x", accountType: "cash", balance: 1, includeInNetWorth: "yes" }))).status).toBe(400);
    expect((await manualPatch(jsonRequest({ balance: 1 }))).status).toBe(400);
    expect((await manualPatch(jsonRequest({ id: "a1", balance: NaN }))).status).toBe(400);
    expect((await manualDelete(jsonRequest({}))).status).toBe(400);

    // ownership 404 and write errors
    authed(clientStub({ manual_accounts: { data: null, error: null } }));
    expect((await manualPatch(jsonRequest({ id: "a1", balance: 1 }))).status).toBe(404);
    expect((await manualDelete(jsonRequest({ id: "a1" }))).status).toBe(404);

    authed(clientStub({ manual_accounts: { data: { id: "a1" }, error: null } }));
    mockServiceClient.from.mockReturnValue(queryStub({ data: null, error: new Error("write boom") }));
    expect((await manualPost(jsonRequest({ name: "x", accountType: "cash", balance: 1 }))).status).toBe(500);
    expect((await manualPatch(jsonRequest({ id: "a1", balance: 1 }))).status).toBe(500);
    expect((await manualDelete(jsonRequest({ id: "a1" }))).status).toBe(500);

    mockRequireUser.mockResolvedValue(new NextResponse("x", { status: 401 }));
    expect((await manualPost({} as NextRequest)).status).toBe(401);
    expect((await manualPatch({} as NextRequest)).status).toBe(401);
    expect((await manualDelete({} as NextRequest)).status).toBe(401);
  });
});