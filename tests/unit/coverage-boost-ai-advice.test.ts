import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { clientStub } from "../fixtures/supabase-query";

const mocks = vi.hoisted(() => ({
  mockMessagesCreate: vi.fn(),
  mockIsAiProviderConfigured: vi.fn(),
  mockGenerateInsightsWithProvider: vi.fn(),
  mockFetchPrivacySafeRows: vi.fn(),
  mockCheckRateLimit: vi.fn<(...args: unknown[]) => Promise<boolean>>(async () => true),
  mockLogError: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: (...args: unknown[]) => mocks.mockMessagesCreate(...args) };
    constructor() {}
  },
}));

vi.mock("@/lib/ai-provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai-provider")>();
  return {
    ...actual,
    isAiProviderConfigured: () => mocks.mockIsAiProviderConfigured(),
    generateInsightsWithProvider: (...a: unknown[]) => mocks.mockGenerateInsightsWithProvider(...a),
  };
});

vi.mock("@/lib/export", () => ({
  fetchPrivacySafeRows: (...args: unknown[]) => mocks.mockFetchPrivacySafeRows(...args),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mocks.mockCheckRateLimit(...(args as [string, number, number])),
}));

vi.mock("@/lib/log", () => ({
  logError: (...args: unknown[]) => mocks.mockLogError(...args),
}));

vi.mock("@/lib/env.server", () => ({
  serverEnv: { anthropicApiKey: "test-key" },
}));

const mockRequireUser = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/http", () => ({
  requireUser: (...args: unknown[]) => mockRequireUser(...args),
  badRequest: (msg: unknown) => NextResponse.json({ error: String(msg) }, { status: 400 }),
  errorResponse: (_ctx: unknown, error: unknown) =>
    NextResponse.json({ error: String(error) }, { status: 500 }),
}));

const mockWriteAudit = vi.fn<(...args: unknown[]) => Promise<undefined>>(async () => undefined);
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...(args as [unknown])),
  getClientIp: () => "127.0.0.1",
}));

const mockServiceClient = { from: vi.fn(), rpc: vi.fn() };
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => mockServiceClient,
}));

function chainable(error: unknown) {
  return {
    then: (resolve: (v: unknown) => unknown) => resolve({ error }),
    eq: () => chainable(error),
  };
}

import { PATCH as advicePatch } from "@/app/api/advice/route";
import { POST as aiAskPost } from "@/app/api/ai/ask/route";
import { POST as aiInsightsPost } from "@/app/api/ai/insights/route";
import { POST as aiReceiptPost } from "@/app/api/ai/receipt/route";

function authed(supabase: unknown) {
  mockRequireUser.mockResolvedValue({ user: { id: "u1" }, supabase: supabase as never });
}

function jsonRequest(url: string, method: string, body: unknown, reject = false) {
  return {
    url,
    method,
    json: () => (reject ? Promise.reject(new Error("boom")) : Promise.resolve(body)),
  } as unknown as NextRequest;
}

function formRequest(parts: [string, unknown][], reject = false) {
  const form = new FormData();
  for (const [key, value] of parts) form.set(key, value as Blob);
  return {
    url: "https://x.local",
    formData: () => (reject ? Promise.reject(new Error("boom")) : Promise.resolve(form)),
  } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mockCheckRateLimit.mockResolvedValue(true);
  mocks.mockIsAiProviderConfigured.mockReturnValue(true);
  mocks.mockFetchPrivacySafeRows.mockResolvedValue({ allowed: true, rows: [] });
});

describe("advice route", () => {
  it("returns the auth response when unauthenticated", async () => {
    mockRequireUser.mockResolvedValue(new NextResponse("x", { status: 401 }));
    const res = await advicePatch({} as NextRequest);
    expect(res.status).toBe(401);
  });

  it("rejects a missing kind and an unknown kind", async () => {
    authed(clientStub());
    expect((await advicePatch(jsonRequest("x", "PATCH", null))).status).toBe(400);
    expect((await advicePatch(jsonRequest("x", "PATCH", null, true))).status).toBe(400);
    expect((await advicePatch(jsonRequest("x", "PATCH", { kind: "nope" }))).status).toBe(400);
  });

  it("rejects malformed toggle_task fields", async () => {
    authed(clientStub());
    const res = await advicePatch(
      jsonRequest("x", "PATCH", { kind: "toggle_task", adviceId: "a", taskId: 1, completed: true }),
    );
    expect(res.status).toBe(400);
  });

  it("toggles a task on and off, including delete errors", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    mockServiceClient.from.mockReturnValue({ upsert, delete: () => chainable(null), eq: () => ({}) });
    const ok = await advicePatch(
      jsonRequest("x", "PATCH", {
        kind: "toggle_task",
        adviceId: "emergency-fund",
        taskId: "automate-a-transfer",
        completed: true,
      }),
    );
    expect(ok.status).toBe(200);
    expect(upsert).toHaveBeenCalled();
    // delete path succeeds
    const off = await advicePatch(
      jsonRequest("x", "PATCH", {
        kind: "toggle_task",
        adviceId: "emergency-fund",
        taskId: "automate-a-transfer",
        completed: false,
      }),
    );
    expect(off.status).toBe(200);
    // delete error -> 500
    mockServiceClient.from.mockReturnValue({ upsert, delete: () => chainable(new Error("del fail")), eq: () => ({}) });
    const errRes = await advicePatch(
      jsonRequest("x", "PATCH", {
        kind: "toggle_task",
        adviceId: "emergency-fund",
        taskId: "automate-a-transfer",
        completed: false,
      }),
    );
    expect(errRes.status).toBe(500);
  });

  it("rejects an unknown adviceId or taskId", async () => {
    authed(clientStub());
    const res = await advicePatch(
      jsonRequest("x", "PATCH", {
        kind: "toggle_task",
        adviceId: "emergency-fund",
        taskId: "nope",
        completed: true,
      }),
    );
    expect(res.status).toBe(400);
  });

  it("sets priorities and profile, covering their update-error branches", async () => {
    const update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    const updateErr = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: new Error("up") }) });
    mockServiceClient.from.mockReturnValue({ update: updateErr, eq: () => ({}) });
    expect(
      (await advicePatch(jsonRequest("x", "PATCH", { kind: "set_priorities", priorities: ["emergency-fund"] }))).status,
    ).toBe(500);
    expect(
      (await advicePatch(jsonRequest("x", "PATCH", { kind: "update_profile", profile: { hasDependents: true } }))).status,
    ).toBe(500);

    mockServiceClient.from.mockReturnValue({ update, eq: () => ({}) });
    expect(
      (await advicePatch(jsonRequest("x", "PATCH", { kind: "set_priorities", priorities: ["emergency-fund"] }))).status,
    ).toBe(200);
    expect(
      (await advicePatch(jsonRequest("x", "PATCH", { kind: "update_profile", profile: { hasDependents: true } }))).status,
    ).toBe(200);
    expect(
      (await advicePatch(jsonRequest("x", "PATCH", { kind: "set_priorities", priorities: "not-an-array" }))).status,
    ).toBe(400);
    expect(
      (await advicePatch(jsonRequest("x", "PATCH", { kind: "update_profile", profile: { bogus: 1 } }))).status,
    ).toBe(400);
  });
});

describe("ai/ask route", () => {
  it("returns the auth response when unauthenticated", async () => {
    mockRequireUser.mockResolvedValue(new NextResponse("x", { status: 401 }));
    expect((await aiAskPost({} as NextRequest)).status).toBe(401);
  });

  it("returns 503 when the provider is not configured", async () => {
    authed(clientStub());
    mocks.mockIsAiProviderConfigured.mockReturnValue(false);
    expect((await aiAskPost(jsonRequest("x", "POST", { question: "hi" }))).status).toBe(503);
  });

  it("validates the question and the AI consent gate", async () => {
    const supabase = clientStub({ ai_settings: { data: { enabled: false }, error: null } });
    authed(supabase);
    expect((await aiAskPost(jsonRequest("x", "POST", { question: "" }))).status).toBe(400);
    expect((await aiAskPost(jsonRequest("x", "POST", null))).status).toBe(400);
    expect((await aiAskPost(jsonRequest("x", "POST", null, true))).status).toBe(400);
    expect((await aiAskPost(jsonRequest("x", "POST", { question: "a".repeat(301) }))).status).toBe(400);
    expect((await aiAskPost(jsonRequest("x", "POST", { question: "hi" }))).status).toBe(403);
  });

  it("rate limits, answers, handles refusal, and covers the catch", async () => {
    const supabase = clientStub({ ai_settings: { data: { enabled: true }, error: null } });
    mocks.mockFetchPrivacySafeRows.mockResolvedValue({
      allowed: true,
      rows: [
        { date: "2026-07-01", merchant: "Starbucks", category: "Dining", amount: 5.5 },
        { date: "2026-07-01", merchant: "Paycheck", category: "Income", amount: -100 },
      ],
    });
    authed(supabase);
    mocks.mockCheckRateLimit.mockResolvedValue(false);
    expect((await aiAskPost(jsonRequest("x", "POST", { question: "hi" }))).status).toBe(429);

    mocks.mockCheckRateLimit.mockResolvedValue(true);
    mocks.mockMessagesCreate.mockResolvedValue({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "You spent $5.50." }],
    });
    const okRes = await aiAskPost(jsonRequest("x", "POST", { question: "how much?" }));
    expect(okRes.status).toBe(200);
    await expect(okRes.json()).resolves.toMatchObject({ answer: "You spent $5.50." });

    mocks.mockMessagesCreate.mockResolvedValue({
      stop_reason: "refusal",
      content: [],
    });
    expect((await aiAskPost(jsonRequest("x", "POST", { question: "hi" }))).status).toBe(200);

    mocks.mockMessagesCreate.mockResolvedValue({
      stop_reason: "end_turn",
      content: [{ type: "other", other: true }],
    });
    await expect(aiAskPost(jsonRequest("x", "POST", { question: "hi" }))).resolves.toMatchObject({});

    mocks.mockMessagesCreate.mockRejectedValue(new Error("anthropic down"));
    const catchRes = await aiAskPost(jsonRequest("x", "POST", { question: "hi" }));
    expect(catchRes.status).toBe(500);
  });
});

describe("ai/insights route", () => {
  it("returns the auth response when unauthenticated", async () => {
    mockRequireUser.mockResolvedValue(new NextResponse("x", { status: 401 }));
    expect((await aiInsightsPost()).status).toBe(401);
  });

  it("returns an empty list when AI consent is off", async () => {
    const supabase = clientStub({ ai_settings: { data: { enabled: false }, error: null } });
    authed(supabase);
    const res = await aiInsightsPost();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ insights: [] });
  });

  it("falls back to built-in summaries when provider is rate-limited or fails", async () => {
    const supabase = clientStub({ ai_settings: { data: { enabled: true }, error: null } });
    authed(supabase);
    mockServiceClient.from.mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: null }) });
    mocks.mockFetchPrivacySafeRows.mockResolvedValue({
      allowed: true,
      rows: [
        { date: "2026-07-01", merchant: "Starbucks", category: "Dining", amount: 5.5 },
        { date: "2026-07-01", merchant: "Paycheck", category: "Income", amount: -100 },
      ],
    });
    mocks.mockCheckRateLimit.mockResolvedValue(false);
    const res = await aiInsightsPost();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.insights)).toBe(true);
  });

  it("uses provider insights and covers the provider-error fallback and insert error", async () => {
    const supabase = clientStub({ ai_settings: { data: { enabled: true }, error: null } });
    authed(supabase);
    mocks.mockFetchPrivacySafeRows.mockResolvedValue({
      allowed: true,
      rows: [{ date: "2026-07-01", merchant: "Starbucks", category: "Dining", amount: 5.5 }],
    });
    mocks.mockCheckRateLimit.mockResolvedValue(true);
    mocks.mockGenerateInsightsWithProvider.mockResolvedValue([
      { insightType: "spend_leader", sourceMonth: "2026-07", summary: "Coffee." },
    ]);
    mockServiceClient.from.mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: null }),
    });
    const ok = await aiInsightsPost();
    expect(ok.status).toBe(200);

    mocks.mockGenerateInsightsWithProvider.mockRejectedValue(new Error("provider boom"));
    const fallback = await aiInsightsPost();
    expect(fallback.status).toBe(200);
    expect(mocks.mockLogError).toHaveBeenCalled();

    mockServiceClient.from.mockReturnValue({
      insert: vi.fn().mockResolvedValue({ error: new Error("insert boom") }),
    });
    expect((await aiInsightsPost()).status).toBe(500);
  });
});

describe("ai/receipt route", () => {
  function pngFile(bytes = 100, type = "image/png") {
    return new File([new Uint8Array(bytes)], "receipt.png", { type });
  }

  it("returns the auth response when unauthenticated", async () => {
    mockRequireUser.mockResolvedValue(new NextResponse("x", { status: 401 }));
    expect((await aiReceiptPost({} as NextRequest)).status).toBe(401);
  });

  it("returns 503 when not configured and 403 when consent is off", async () => {
    mocks.mockIsAiProviderConfigured.mockReturnValue(false);
    authed(clientStub());
    expect((await aiReceiptPost(formRequest([["file", pngFile()]]))).status).toBe(503);
    mocks.mockIsAiProviderConfigured.mockReturnValue(true);
    authed(clientStub({ ai_settings: { data: { enabled: false }, error: null } }));
    expect((await aiReceiptPost(formRequest([["file", pngFile()]]))).status).toBe(403);
  });

  it("validates the upload and rate limit", async () => {
    authed(clientStub({ ai_settings: { data: { enabled: true }, error: null } }));
    expect((await aiReceiptPost(formRequest([]))).status).toBe(400);
    expect((await aiReceiptPost(formRequest([], true))).status).toBe(400);
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "r.png", { type: "image/png" });
    expect((await aiReceiptPost(formRequest([["file", big]]))).status).toBe(400);
    const gif = new File([new Uint8Array(10)], "r.bmp", { type: "image/bmp" });
    expect((await aiReceiptPost(formRequest([["file", gif]]))).status).toBe(400);
    mocks.mockCheckRateLimit.mockResolvedValue(false);
    expect((await aiReceiptPost(formRequest([["file", pngFile()]]))).status).toBe(429);
  });

  it("scans a receipt, matches a transaction, and covers the catch", async () => {
    const supabase = clientStub({
      ai_settings: { data: { enabled: true }, error: null },
      transactions: {
        data: [{ id: "t1", date: "2026-07-10", amount: 5.5, merchant_name: "Starbucks", name: "SB" }],
      },
    });
    authed(supabase);
    mocks.mockCheckRateLimit.mockResolvedValue(true);
    mocks.mockMessagesCreate.mockResolvedValue({
      stop_reason: "end_turn",
      content: [
        {
          type: "text",
          text: JSON.stringify({
            merchant: "Starbucks",
            amount: 5.5,
            date: "2026-07-10",
            line_items: ["Latte"],
          }),
        },
      ],
    });
    const ok = await aiReceiptPost(formRequest([["file", pngFile()]]));
    expect(ok.status).toBe(200);
    await expect(ok.json()).resolves.toMatchObject({ matchedTransactionId: "t1" });

    mocks.mockMessagesCreate.mockResolvedValue({
      stop_reason: "refusal",
      content: [],
    });
    expect((await aiReceiptPost(formRequest([["file", pngFile()]]))).status).toBe(422);

    mocks.mockMessagesCreate.mockRejectedValue(new Error("vision down"));
    expect((await aiReceiptPost(formRequest([["file", pngFile()]]))).status).toBe(500);
  });
});