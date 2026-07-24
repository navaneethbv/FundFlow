import { describe, it, expect, vi, beforeEach } from "vitest";
import { clientStub } from "../fixtures/supabase-query";

const mockRequireUser = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/http", () => ({
  requireUser: () => mockRequireUser(),
  badRequest: (msg: unknown) =>
    Response.json({ error: String(msg) }, { status: 400 }),
  errorResponse: (_context: unknown, error: unknown) => {
    throw error;
  },
}));

const mockCheckRateLimit = vi.fn<(...args: unknown[]) => unknown>(() => true);
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

const mockIsConfigured = vi.fn<() => boolean>(() => true);
vi.mock("@/lib/ai-provider", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, isAiProviderConfigured: () => mockIsConfigured() };
});

const mockFetchRows = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/export", () => ({
  fetchPrivacySafeRows: (...args: unknown[]) => mockFetchRows(...args),
}));

vi.mock("@/lib/env.server", () => ({
  serverEnv: { anthropicApiKey: "sk-test" },
}));

const mockWriteAudit = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => mockWriteAudit(...args),
  getClientIp: () => "127.0.0.1",
}));

const mockMessagesCreate = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: (...args: unknown[]) => mockMessagesCreate(...args) };
  },
}));

let serviceClient = clientStub();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => serviceClient,
}));

const mockLogError = vi.fn();
vi.mock("@/lib/log", () => ({ logError: (...a: unknown[]) => mockLogError(...a) }));

const mockSetVapidDetails = vi.fn();
const mockSendNotification = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: (...a: unknown[]) => mockSetVapidDetails(...a),
    sendNotification: (...a: unknown[]) => mockSendNotification(...a),
  },
}));

import { POST as askPost } from "@/app/api/ai/ask/route";
import { POST as receiptPost } from "@/app/api/ai/receipt/route";
import { isPushConfigured, sendPushToUser } from "@/lib/push";
import { getRecentTransactions } from "@/lib/recent-transactions";
import { NextResponse, NextRequest } from "next/server";

const USER = "user-1";

function askRequest(question: unknown) {
  return new NextRequest("http://localhost/api/ai/ask", {
    method: "POST",
    body: JSON.stringify({ question }),
    headers: { "content-type": "application/json" },
  });
}

/** Signed-in caller with AI consent on and some exportable rows. */
function consentingUser() {
  mockRequireUser.mockResolvedValue({
    user: { id: USER },
    supabase: clientStub({ ai_settings: { data: { enabled: true } } }),
  });
  mockFetchRows.mockResolvedValue({
    allowed: true,
    rows: [
      { date: "2026-07-01", merchant: "Cafe", category: "FOOD", amount: 12 },
    ],
  });
}

function textResponse(text: string) {
  return { stop_reason: "end_turn", content: [{ type: "text", text }] };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsConfigured.mockReturnValue(true);
  mockCheckRateLimit.mockResolvedValue(true);
  serviceClient = clientStub();
});

describe("POST /api/ai/ask", () => {
  it("returns the auth response when not signed in", async () => {
    mockRequireUser.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const res = await askPost(askRequest("where did it go?"));
    expect(res.status).toBe(401);
  });

  it("503s when no provider key is configured", async () => {
    mockIsConfigured.mockReturnValue(false);
    mockRequireUser.mockResolvedValue({ user: { id: USER }, supabase: clientStub() });

    const res = await askPost(askRequest("where did it go?"));

    expect(res.status).toBe(503);
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it.each([
    ["blank", "   "],
    ["over 300 characters", "x".repeat(301)],
  ])("rejects a question that is %s", async (_label, question) => {
    mockRequireUser.mockResolvedValue({ user: { id: USER }, supabase: clientStub() });
    const res = await askPost(askRequest(question));
    expect(res.status).toBe(400);
  });

  it("403s when the AI setting is off", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER },
      supabase: clientStub({ ai_settings: { data: { enabled: false } } }),
    });
    mockFetchRows.mockResolvedValue({ allowed: true, rows: [] });

    const res = await askPost(askRequest("where did it go?"));

    expect(res.status).toBe(403);
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it("403s when the export consent is off, even with the AI setting on", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER },
      supabase: clientStub({ ai_settings: { data: { enabled: true } } }),
    });
    mockFetchRows.mockResolvedValue({ allowed: false, rows: [] });

    const res = await askPost(askRequest("where did it go?"));

    expect(res.status).toBe(403);
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it("429s once the daily question limit is spent", async () => {
    consentingUser();
    mockCheckRateLimit.mockResolvedValue(false);

    const res = await askPost(askRequest("where did it go?"));

    expect(res.status).toBe(429);
    expect(mockCheckRateLimit).toHaveBeenCalledWith(`ai-ask:${USER}`, 10, 24 * 3600);
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it("answers from aggregates and never sends raw rows", async () => {
    consentingUser();
    mockMessagesCreate.mockResolvedValue(textResponse("You spent $12 at Cafe."));

    const res = await askPost(askRequest("how much on coffee?"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ answer: "You spent $12 at Cafe." });

    const sent = JSON.stringify(mockMessagesCreate.mock.calls[0][0]);
    expect(sent).toContain("how much on coffee?");
    // Aggregates only — no per-transaction date/amount pairs.
    expect(sent).not.toContain("2026-07-01");
    expect(mockWriteAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ai_question" }),
    );
  });

  it("passes a refusal through as a plain answer", async () => {
    consentingUser();
    mockMessagesCreate.mockResolvedValue({ stop_reason: "refusal", content: [] });

    const res = await askPost(askRequest("something off-limits"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      answer: "I can't help with that question.",
    });
  });

  it("falls back when the model returns no text block", async () => {
    consentingUser();
    mockMessagesCreate.mockResolvedValue({ stop_reason: "end_turn", content: [] });

    const res = await askPost(askRequest("how much on coffee?"));
    await expect(res.json()).resolves.toEqual({ answer: "No answer produced." });
  });
});

describe("POST /api/ai/receipt", () => {
  function receiptRequest(file?: File) {
    const form = new FormData();
    if (file) form.set("file", file);
    return new NextRequest("http://localhost/api/ai/receipt", {
      method: "POST",
      body: form,
    });
  }

  const image = (type = "image/png", size = 10) =>
    new File([new Uint8Array(size)], "receipt.png", { type });

  function scanningUser(transactions: unknown[] = []) {
    mockRequireUser.mockResolvedValue({
      user: { id: USER },
      supabase: clientStub({
        ai_settings: { data: { enabled: true } },
        transactions: { data: transactions },
      }),
    });
  }

  it("503s when no provider key is configured", async () => {
    mockIsConfigured.mockReturnValue(false);
    mockRequireUser.mockResolvedValue({ user: { id: USER }, supabase: clientStub() });

    const res = await receiptPost(receiptRequest(image()));
    expect(res.status).toBe(503);
  });

  it("403s when the AI setting is off", async () => {
    mockRequireUser.mockResolvedValue({
      user: { id: USER },
      supabase: clientStub({ ai_settings: { data: { enabled: false } } }),
    });

    const res = await receiptPost(receiptRequest(image()));
    expect(res.status).toBe(403);
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it("429s once the daily scan limit is spent", async () => {
    scanningUser();
    mockCheckRateLimit.mockResolvedValue(false);

    const res = await receiptPost(receiptRequest(image()));

    expect(res.status).toBe(429);
    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      `ai-receipt:${USER}`,
      10,
      24 * 3600,
    );
  });

  it("requires a file", async () => {
    scanningUser();
    const res = await receiptPost(receiptRequest());
    expect(res.status).toBe(400);
  });

  it("rejects an oversized image", async () => {
    scanningUser();
    const res = await receiptPost(receiptRequest(image("image/png", 5 * 1024 * 1024 + 1)));
    expect(res.status).toBe(400);
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it("rejects an unsupported type", async () => {
    scanningUser();
    const res = await receiptPost(
      receiptRequest(new File([new Uint8Array(4)], "r.pdf", { type: "application/pdf" })),
    );
    expect(res.status).toBe(400);
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it("extracts the receipt and matches it to a ledger row", async () => {
    scanningUser([{ id: "txn-1", date: "2026-07-02", amount: 24.5 }]);
    mockMessagesCreate.mockResolvedValue(
      textResponse(
        JSON.stringify({
          merchant: "Cafe",
          amount: 24.5,
          date: "2026-07-02",
          line_items: Array.from({ length: 20 }, (_, i) => `item ${i}`),
        }),
      ),
    );

    const res = await receiptPost(receiptRequest(image()));
    const payload = (await res.json()) as {
      merchant: string;
      lineItems: string[];
      matchedTransactionId: string | null;
    };

    expect(res.status).toBe(200);
    expect(payload.merchant).toBe("Cafe");
    expect(payload.matchedTransactionId).toBe("txn-1");
    // Line items are capped at 15.
    expect(payload.lineItems).toHaveLength(15);
  });

  it("returns no match when the extracted date is unusable", async () => {
    scanningUser([{ id: "txn-1" }]);
    mockMessagesCreate.mockResolvedValue(
      textResponse(
        JSON.stringify({
          merchant: "Cafe",
          amount: 24.5,
          date: "unknown",
          line_items: [],
        }),
      ),
    );

    const res = await receiptPost(receiptRequest(image()));
    await expect(res.json()).resolves.toMatchObject({ matchedTransactionId: null });
  });

  it("422s when the model refuses the image", async () => {
    scanningUser();
    mockMessagesCreate.mockResolvedValue({ stop_reason: "refusal", content: [] });

    const res = await receiptPost(receiptRequest(image()));
    expect(res.status).toBe(422);
  });
});

describe("lib/push", () => {
  const OLD_ENV = { ...process.env };

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
  });

  it("is not configured without both VAPID keys", () => {
    expect(isPushConfigured()).toBe(false);
    process.env.VAPID_PUBLIC_KEY = "pub";
    expect(isPushConfigured()).toBe(false);
    process.env.VAPID_PRIVATE_KEY = "priv";
    expect(isPushConfigured()).toBe(true);
  });

  it("is a silent no-op when push is unconfigured", async () => {
    await sendPushToUser(USER, { title: "t", body: "b" });
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it("sends to every subscription, truncating the payload", async () => {
    process.env.VAPID_PUBLIC_KEY = "pub";
    process.env.VAPID_PRIVATE_KEY = "priv";
    serviceClient = clientStub({
      push_subscriptions: {
        data: [
          { id: "s1", endpoint: "https://push/1", p256dh: "p1", auth: "a1" },
          { id: "s2", endpoint: "https://push/2", p256dh: "p2", auth: "a2" },
        ],
      },
    });

    await sendPushToUser(USER, { title: "T".repeat(200), body: "B".repeat(400) });

    expect(mockSendNotification).toHaveBeenCalledTimes(2);
    expect(serviceClient.scopedToUser("push_subscriptions", USER)).toBe(true);
    const payload = JSON.parse(mockSendNotification.mock.calls[0][1] as string);
    expect(payload.title).toHaveLength(120);
    expect(payload.body).toHaveLength(240);
  });

  it.each([404, 410])("prunes a subscription that returns %i", async (statusCode) => {
    process.env.VAPID_PUBLIC_KEY = "pub";
    process.env.VAPID_PRIVATE_KEY = "priv";
    serviceClient = clientStub({
      push_subscriptions: {
        data: [{ id: "dead", endpoint: "https://push/1", p256dh: "p", auth: "a" }],
      },
    });
    mockSendNotification.mockRejectedValueOnce(Object.assign(new Error("gone"), { statusCode }));

    await sendPushToUser(USER, { title: "t", body: "b" });

    expect(
      serviceClient
        .callsOn("push_subscriptions")
        .some(({ method }) => method === "delete"),
    ).toBe(true);
  });

  it("logs but keeps the subscription on a transient failure", async () => {
    process.env.VAPID_PUBLIC_KEY = "pub";
    process.env.VAPID_PRIVATE_KEY = "priv";
    serviceClient = clientStub({
      push_subscriptions: {
        data: [{ id: "s1", endpoint: "https://push/1", p256dh: "p", auth: "a" }],
      },
    });
    mockSendNotification.mockRejectedValueOnce(
      Object.assign(new Error("boom"), { statusCode: 500 }),
    );

    await sendPushToUser(USER, { title: "t", body: "b" });

    expect(mockLogError).toHaveBeenCalledWith("push.send", expect.anything());
    expect(
      serviceClient
        .callsOn("push_subscriptions")
        .some(({ method }) => method === "delete"),
    ).toBe(false);
  });
});

describe("getRecentTransactions", () => {
  it("bounds the query to the month and caps it at five rows", async () => {
    const supabase = clientStub({ transactions: { data: [{ id: "t1" }] } });

    const rows = await getRecentTransactions({
      supabase: supabase as never,
      month: "2026-07",
    });

    expect(rows).toEqual([{ id: "t1" }]);
    const calls = supabase.callsOn("transactions");
    expect(calls.some(({ method, args }) => method === "gte" && args[1] === "2026-07-01")).toBe(true);
    expect(calls.some(({ method, args }) => method === "lt" && args[1] === "2026-08-01")).toBe(true);
    expect(calls.some(({ method, args }) => method === "limit" && args[0] === 5)).toBe(true);
  });

  it("rolls December over into the next January", async () => {
    const supabase = clientStub({ transactions: { data: [] } });

    await getRecentTransactions({ supabase: supabase as never, month: "2026-12" });

    expect(
      supabase
        .callsOn("transactions")
        .some(({ method, args }) => method === "lt" && args[1] === "2027-01-01"),
    ).toBe(true);
  });

  it("filters by account when one is given", async () => {
    const supabase = clientStub({ transactions: { data: [] } });

    await getRecentTransactions({
      supabase: supabase as never,
      month: "2026-07",
      accountId: "acc-1",
    });

    expect(
      supabase
        .callsOn("transactions")
        .some(({ method, args }) => method === "eq" && args[0] === "account_id"),
    ).toBe(true);
  });
});
