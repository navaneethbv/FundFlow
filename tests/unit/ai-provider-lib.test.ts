import { describe, it, expect, vi, beforeEach } from "vitest";
import { clientStub } from "../fixtures/supabase-query";

const { env } = vi.hoisted(() => ({ env: { anthropicApiKey: "sk-test" } }));
vi.mock("@/lib/env.server", () => ({ serverEnv: env }));

const mockMessagesCreate = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: (...args: unknown[]) => mockMessagesCreate(...args) };
  },
}));

const mockCheckRateLimit = vi.fn<(...args: unknown[]) => unknown>(() => true);
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

const mockSendLoginAlertEmail = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/reporting", () => ({
  sendLoginAlertEmail: (...args: unknown[]) => mockSendLoginAlertEmail(...args),
}));

const mockLogError = vi.fn();
vi.mock("@/lib/log", () => ({ logError: (...a: unknown[]) => mockLogError(...a) }));

let serviceClient = clientStub();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => serviceClient,
}));

const mockLiabilitiesGet = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@/lib/plaid", () => ({
  getPlaidClient: () => ({
    liabilitiesGet: (...args: unknown[]) => mockLiabilitiesGet(...args),
  }),
}));

const mockListActiveItems = vi.fn<(...args: unknown[]) => unknown>(() => []);
const mockDecryptItemToken = vi.fn<(...args: unknown[]) => unknown>(() => "access-token");
vi.mock("@/lib/plaid-service", () => ({
  listActiveItems: (...args: unknown[]) => mockListActiveItems(...args),
  decryptItemToken: (...args: unknown[]) => mockDecryptItemToken(...args),
}));

import {
  isAiProviderConfigured,
  buildInsightPayload,
  generateInsightsWithProvider,
} from "@/lib/ai-provider";
import { notifyNewDeviceLogin, summarizeUserAgent } from "@/lib/login-alert";
import { syncCardAprsForUser } from "@/lib/liabilities";

const USER = "user-1";

beforeEach(() => {
  vi.clearAllMocks();
  env.anthropicApiKey = "sk-test";
  mockCheckRateLimit.mockResolvedValue(true);
  mockListActiveItems.mockResolvedValue([]);
  mockDecryptItemToken.mockReturnValue("access-token");
  serviceClient = clientStub();
});

describe("isAiProviderConfigured", () => {
  it("tracks whether a key is present", () => {
    expect(isAiProviderConfigured()).toBe(true);
    env.anthropicApiKey = "";
    expect(isAiProviderConfigured()).toBe(false);
  });
});

describe("buildInsightPayload", () => {
  it("keeps spending only and drops income", () => {
    const payload = buildInsightPayload([
      { month: "2026-07", category: "FOOD", merchant: "Cafe", amount: 30 },
      { month: "2026-07", category: "INCOME", merchant: "Employer", amount: -2000 },
    ]);

    const merchants = payload.top_merchants.map((m) => m.merchant);
    expect(merchants).toContain("Cafe");
    expect(merchants).not.toContain("Employer");
  });

  it("sums repeated month/category pairs", () => {
    const payload = buildInsightPayload([
      { month: "2026-07", category: "FOOD", amount: 10 },
      { month: "2026-07", category: "FOOD", amount: 15 },
    ]);

    const food = payload.monthly_category_spend.find(
      (row) => row.category === "FOOD" && row.month === "2026-07",
    );
    expect(food?.amount).toBe(25);
  });

  it("keeps only the most recent six months", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      month: `2026-${String(i + 1).padStart(2, "0")}`,
      category: "FOOD",
      amount: 10,
    }));

    const months = new Set(
      buildInsightPayload(rows).monthly_category_spend.map((row) => row.month),
    );

    expect(months.size).toBe(6);
    expect(months.has("2026-10")).toBe(true);
    expect(months.has("2026-01")).toBe(false);
  });

  it("caps the merchant list at 25, keeping the biggest spenders", () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({
      month: "2026-07",
      category: "FOOD",
      merchant: `m${i}`,
      amount: i + 1,
    }));

    const payload = buildInsightPayload(rows);

    expect(payload.top_merchants).toHaveLength(25);
    expect(payload.top_merchants[0].merchant).toBe("m39");
  });

  it("never carries a raw date or amount-per-row through", () => {
    const payload = buildInsightPayload([
      { month: "2026-07", category: "FOOD", merchant: "Cafe", amount: 12.34 },
    ]);
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("2026-07-01");
  });
});

describe("generateInsightsWithProvider", () => {
  const rows = [{ month: "2026-07", category: "FOOD", merchant: "Cafe", amount: 30 }];

  function modelReturns(insights: unknown) {
    mockMessagesCreate.mockResolvedValue({
      stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify({ insights }) }],
    });
  }

  it("maps the model output and stamps the latest month", async () => {
    modelReturns([
      { insight_type: "what_changed", summary: "Food spend rose." },
      { insight_type: "save_100", summary: "Cut Cafe visits." },
    ]);

    const result = await generateInsightsWithProvider({
      rows: [
        { month: "2026-06", category: "FOOD", amount: 10 },
        { month: "2026-07", category: "FOOD", amount: 30 },
      ],
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      insightType: "what_changed",
      sourceMonth: "2026-07",
      summary: "Food spend rose.",
    });
  });

  it("truncates an over-long summary", async () => {
    modelReturns([{ insight_type: "what_changed", summary: "x".repeat(2000) }]);
    const result = await generateInsightsWithProvider({ rows });
    expect(result[0].summary).toHaveLength(1200);
  });

  it("throws on a refusal so the caller can fall back", async () => {
    mockMessagesCreate.mockResolvedValue({ stop_reason: "refusal", content: [] });
    await expect(generateInsightsWithProvider({ rows })).rejects.toThrow("refusal");
  });

  it("throws when the response carries no text block", async () => {
    mockMessagesCreate.mockResolvedValue({ stop_reason: "end_turn", content: [] });
    await expect(generateInsightsWithProvider({ rows })).rejects.toThrow(
      "empty response",
    );
  });
});

describe("summarizeUserAgent", () => {
  it.each([
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari/605.1", "Safari on macOS"],
    ["Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537", "Chrome on Windows"],
    ["Mozilla/5.0 (Windows NT 10.0) Edg/120.0 Chrome/120", "Edge on Windows"],
    ["Mozilla/5.0 (X11; Linux x86_64) Firefox/121.0", "Firefox on Linux"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604", "Safari on iOS"],
    ["Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile", "Chrome on Android"],
    ["curl/8.4.0", "Unknown browser on Unknown OS"],
  ])("summarizes %s", (userAgent, expected) => {
    expect(summarizeUserAgent(userAgent)).toBe(expected);
  });

  it("emits no raw user-agent detail", () => {
    const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15";
    expect(summarizeUserAgent(ua)).not.toContain("10_15_7");
  });
});

describe("notifyNewDeviceLogin", () => {
  it.each([
    ["no email", null, "Mozilla/5.0 Safari/605"],
    ["no user agent", "u@example.com", null],
  ])("does nothing with %s", async (_label, email, userAgent) => {
    await notifyNewDeviceLogin(USER, email, userAgent);
    expect(mockSendLoginAlertEmail).not.toHaveBeenCalled();
  });

  it("stays quiet for a device already seen on the account", async () => {
    serviceClient = clientStub({ user_session_records: { count: 3 } });

    await notifyNewDeviceLogin(USER, "u@example.com", "Mozilla/5.0 Safari/605");

    expect(mockSendLoginAlertEmail).not.toHaveBeenCalled();
  });

  it("emails a coarse device label for a first-seen device", async () => {
    serviceClient = clientStub({ user_session_records: { count: 0 } });

    await notifyNewDeviceLogin(
      USER,
      "u@example.com",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari/605.1",
    );

    expect(mockSendLoginAlertEmail).toHaveBeenCalledWith(
      "u@example.com",
      "Safari on macOS",
    );
    expect(serviceClient.scopedToUser("user_session_records", USER)).toBe(true);
  });

  it("respects the daily alert limit", async () => {
    serviceClient = clientStub({ user_session_records: { count: 0 } });
    mockCheckRateLimit.mockResolvedValue(false);

    await notifyNewDeviceLogin(USER, "u@example.com", "Mozilla/5.0 Safari/605");

    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      `login-alert:${USER}`,
      3,
      24 * 3600,
    );
    expect(mockSendLoginAlertEmail).not.toHaveBeenCalled();
  });

  it("swallows and logs a failure rather than breaking the request", async () => {
    serviceClient = clientStub({ user_session_records: { count: 0 } });
    mockSendLoginAlertEmail.mockRejectedValueOnce(new Error("smtp down"));

    await expect(
      notifyNewDeviceLogin(USER, "u@example.com", "Mozilla/5.0 Safari/605"),
    ).resolves.toBeUndefined();
    expect(mockLogError).toHaveBeenCalledWith("login-alert", expect.anything());
  });
});

describe("syncCardAprsForUser", () => {
  const OLD_ENV = { ...process.env };

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    delete process.env.PLAID_LIABILITIES_ENABLED;
  });

  it("is a no-op unless the paid product is explicitly enabled", async () => {
    await expect(syncCardAprsForUser(USER)).resolves.toBe(0);
    expect(mockListActiveItems).not.toHaveBeenCalled();
  });

  it("writes the purchase APR keyed on plaid_account_id, scoped to the user", async () => {
    process.env.PLAID_LIABILITIES_ENABLED = "1";
    mockListActiveItems.mockResolvedValue([{ id: "item-1" }]);
    mockLiabilitiesGet.mockResolvedValue({
      data: {
        liabilities: {
          credit: [
            {
              account_id: "plaid-acc-1",
              aprs: [
                { apr_type: "balance_transfer_apr", apr_percentage: 5 },
                { apr_type: "purchase_apr", apr_percentage: 21.239 },
              ],
            },
          ],
        },
      },
    });
    serviceClient = clientStub({ accounts: { error: null } });

    await expect(syncCardAprsForUser(USER)).resolves.toBe(1);

    expect(serviceClient.writtenTo("accounts")).toEqual({ apr: 21.24 });
    const calls = serviceClient.callsOn("accounts");
    expect(
      calls.some(
        ({ method, args }) =>
          method === "eq" && args[0] === "plaid_account_id" && args[1] === "plaid-acc-1",
      ),
    ).toBe(true);
    expect(serviceClient.scopedToUser("accounts", USER)).toBe(true);
  });

  it("skips cards with no purchase APR", async () => {
    process.env.PLAID_LIABILITIES_ENABLED = "1";
    mockListActiveItems.mockResolvedValue([{ id: "item-1" }]);
    mockLiabilitiesGet.mockResolvedValue({
      data: {
        liabilities: {
          credit: [
            { account_id: "a1", aprs: [{ apr_type: "cash_apr", apr_percentage: 25 }] },
            { account_id: null, aprs: [] },
          ],
        },
      },
    });

    await expect(syncCardAprsForUser(USER)).resolves.toBe(0);
  });

  it("isolates a per-item failure and keeps going", async () => {
    process.env.PLAID_LIABILITIES_ENABLED = "1";
    mockListActiveItems.mockResolvedValue([{ id: "item-1" }, { id: "item-2" }]);
    mockLiabilitiesGet
      .mockRejectedValueOnce(new Error("product not enabled"))
      .mockResolvedValueOnce({
        data: {
          liabilities: {
            credit: [
              {
                account_id: "a2",
                aprs: [{ apr_type: "purchase_apr", apr_percentage: 18 }],
              },
            ],
          },
        },
      });
    serviceClient = clientStub({ accounts: { error: null } });

    await expect(syncCardAprsForUser(USER)).resolves.toBe(1);
    expect(mockLogError).toHaveBeenCalledWith("liabilities.item", expect.anything());
  });
});
