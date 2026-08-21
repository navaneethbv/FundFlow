import { describe, expect, it, vi, beforeEach } from "vitest";
import { clientStub } from "../fixtures/supabase-query";

const { env } = vi.hoisted(() => ({ env: { anthropicApiKey: "sk-test" } }));
vi.mock("@/lib/env.server", () => ({ serverEnv: env }));

let serviceClient = clientStub();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => serviceClient,
}));

vi.mock("@/lib/finance-query", () => ({
  loadCanonicalProjection: () =>
    Promise.resolve({
      transactions: [],
      currencyByAccountId: new Map(),
      truncated: false,
    }),
}));

const mockMessagesCreate = vi.fn<(...args: unknown[]) => unknown>();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: (...args: unknown[]) => mockMessagesCreate(...args) };
  },
}));

import { loadAdvicePageData } from "@/lib/advice-data";
import {
  buildInsightPayload,
  generateInsightsWithProvider,
} from "@/lib/ai-provider";

const baseSeed = {
  accounts: { data: [] },
  manual_accounts: { data: [] },
  budgets: { data: [] },
  goals: { data: [] },
  profiles: { data: null },
  advice_progress: { data: [] },
  transactions: { data: [] },
  merchant_rules: { data: [] },
  category_overrides: { data: [] },
  transaction_splits: { data: [] },
  linked_refunds: { data: [] },
};

beforeEach(() => {
  vi.clearAllMocks();
  env.anthropicApiKey = "sk-test";
});

describe("loadAdvicePageData branch coverage", () => {
  it("throws when the accounts query fails (accounts error branch)", async () => {
    const supabase = clientStub({
      ...baseSeed,
      accounts: { error: new Error("accounts boom") },
    });
    await expect(
      loadAdvicePageData(supabase as never, "user-1", "2026-07-15"),
    ).rejects.toThrow("accounts boom");
  });

  it("drives the credit balance nullish fallback to zero", async () => {
    const supabase = clientStub({
      ...baseSeed,
      accounts: {
        data: [
          { type: "credit", subtype: "credit card", current_balance: null },
        ],
      },
    });
    const data = await loadAdvicePageData(supabase as never, "user-1", "2026-07-15");
    expect(data.ctx.creditCardCarry).toBe(false);
  });

  it("drives the manual accounts data nullish fallback", async () => {
    const supabase = clientStub({
      ...baseSeed,
      manual_accounts: { data: null },
    });
    const data = await loadAdvicePageData(supabase as never, "user-1", "2026-07-15");
    expect(data.ctx.hasInvestments).toBe(false);
  });
});

describe("buildInsightPayload branch coverage", () => {
  it("falls back amount, month, and category when a row omits them", () => {
    const payload = buildInsightPayload([
      { amount: 5 },
      { month: "2026-07", category: "FOOD" },
      { month: "2026-07", merchant: "Cafe", amount: 5 },
      { month: "2026-07", category: "FOOD", amount: 3 },
    ]);

    expect(payload.monthly_category_spend).toContainEqual({
      month: "unknown",
      category: "UNCATEGORIZED",
      amount: 5,
    });
    expect(payload.top_merchants).toContainEqual({
      merchant: "Cafe",
      amount: 5,
    });
  });
});

describe("generateInsightsWithProvider branch coverage", () => {
  it("sets sourceMonth null when there is no spend payload", async () => {
    mockMessagesCreate.mockResolvedValue({
      stop_reason: "end_turn",
      content: [
        { type: "text", text: JSON.stringify({ insights: [{ insight_type: "what_changed", summary: "hi" }] }) },
      ],
    });
    const result = await generateInsightsWithProvider({
      rows: [
        { month: "2026-07", category: "INCOME", amount: -2000 },
        { month: "2026-07", category: "INCOME", amount: 0 },
      ],
    });
    expect(result[0].sourceMonth).toBeNull();
    expect(mockMessagesCreate).toHaveBeenCalled();
  });
});

describe("account-history nullish data branches", () => {
  it("falls back to empty arrays when both account reads return null data", async () => {
    serviceClient = clientStub({
      accounts: { data: null },
      manual_accounts: { data: null },
    });
    const { writeDailyAccountSnapshots } = await import("@/lib/account-history");
    await expect(
      writeDailyAccountSnapshots("user-1", "2026-07-29"),
    ).resolves.toEqual({ written: 0, snapshotDate: "2026-07-29" });
  });
});
