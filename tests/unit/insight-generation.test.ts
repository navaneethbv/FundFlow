import { beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientStub } from "../fixtures/supabase-query";
const state = vi.hoisted(() => ({
  enabled: true,
  projection: vi.fn(),
  recurring: vi.fn(),
  goals: vi.fn(),
}));
vi.mock("@/lib/feature-flags", () => ({
  isFeatureEnabled: () => state.enabled,
}));
vi.mock("@/lib/finance-query", () => ({
  monthWindow: () => ({ start: "2026-07-01" }),
  loadCanonicalProjection: (...args: unknown[]) => state.projection(...args),
}));
vi.mock("@/lib/recurring-data", () => ({
  loadRecurringData: () => state.recurring(),
}));
vi.mock("@/lib/goals-data", () => ({ loadGoalsPageData: () => state.goals() }));
import {
  loadGeneratedInsights,
  persistGeneratedInsights,
} from "@/lib/insight-generation";
const client = (value: ReturnType<typeof clientStub>) =>
  value as unknown as SupabaseClient;
beforeEach(() => {
  vi.clearAllMocks();
  state.enabled = true;
  state.projection.mockResolvedValue({
    transactions: [],
    currencyByAccountId: new Map(),
    truncated: false,
  });
  state.recurring.mockResolvedValue({ view: { occurrences: [] } });
  state.goals.mockResolvedValue({ goals: [] });
});
it("does not read or write when off", async () => {
  state.enabled = false;
  const db = clientStub();
  expect(await loadGeneratedInsights(client(db), "o", "2026-10-10")).toEqual(
    [],
  );
  await persistGeneratedInsights(client(db), "o", [], null);
  expect(db.from).not.toHaveBeenCalled();
  expect(state.projection).not.toHaveBeenCalled();
});
it("writes in-app only for explicit opt-ins and preserves existing acknowledgements", async () => {
  const db = clientStub();
  const signal = {
    type: "bill_overdue" as const,
    subjectKey: "bill:x",
    details: { title: "Bill", body: "Due" },
  };
  await persistGeneratedInsights(client(db), "o", [signal], null);
  expect(db.from).not.toHaveBeenCalled();
  await persistGeneratedInsights(client(db), "o", [signal], {
    bill_overdue: true,
  });
  expect(db.writtenTo("notifications")).toEqual([
    {
      user_id: "o",
      type: "bill_overdue",
      subject_key: "bill:x",
      title: "Bill",
      body: "Due",
      severity: "warning",
    },
  ]);
  expect(db.callsOn("notifications")).toContainEqual({
    method: "upsert",
    args: [
      expect.any(Array),
      { onConflict: "user_id,type,subject_key", ignoreDuplicates: true },
    ],
  });
  await expect(
    persistGeneratedInsights(
      client(clientStub({ notifications: { error: new Error("write") } })),
      "o",
      [signal],
      { bill_overdue: true },
    ),
  ).rejects.toThrow("write");
});
it("loads canonical USD-only data and uses stable bill, account and goal identifiers", async () => {
  const db = clientStub({
    accounts: {
      data: [
        {
          id: "a",
          name: null,
          type: "depository",
          current_balance: 6000,
          iso_currency_code: "USD",
          created_at: "2026-01-01",
        },
        {
          id: "unknown",
          type: "depository",
          current_balance: null,
          iso_currency_code: "USD",
          created_at: "2026-01-01",
        },
      ],
    },
  });
  state.recurring.mockResolvedValue({
    view: {
      occurrences: [
        {
          sourceId: "bill",
          merchant: "Rent",
          amount: 1000,
          dueDate: "2026-10-01",
          status: "overdue",
          isIncome: false,
        },
        { sourceId: "pay", isIncome: true },
      ],
    },
  });
  state.goals.mockResolvedValue({
    goals: [
      {
        id: "g",
        name: "Reserve",
        goal_type: "save_up",
        spending_reduces: true,
        target_amount: 5000,
        funded_amount: 4000,
      },
    ],
  });
  const signals = await loadGeneratedInsights(
    client(db),
    "owner",
    "2026-10-10",
  );
  expect(signals.map((signal) => signal.type)).toEqual([
    "bill_overdue",
    "idle_cash",
    "goal_reserve_depleted",
  ]);
  expect(db.scopedToUser("accounts", "owner")).toBe(true);
  expect(state.projection).toHaveBeenCalledWith(
    db,
    expect.objectContaining({
      scope: { kind: "mine", ownerUserId: "owner" },
      excludePending: true,
    }),
  );
});
it("refuses partial inputs and suppresses mixed-currency bills/reserves", async () => {
  state.projection.mockResolvedValueOnce({ transactions: [], truncated: true });
  await expect(
    loadGeneratedInsights(client(clientStub()), "o", "2026-10-10"),
  ).rejects.toThrow("limit");
  await expect(
    loadGeneratedInsights(
      client(clientStub({ accounts: { error: new Error("accounts") } })),
      "o",
      "2026-10-10",
    ),
  ).rejects.toThrow("accounts");
  await expect(
    loadGeneratedInsights(
      client(clientStub({ accounts: { data: Array(1000).fill({}) } })),
      "o",
      "2026-10-10",
    ),
  ).rejects.toThrow("limit");
  expect(
    await loadGeneratedInsights(
      client(
        clientStub({
          accounts: { data: [{ id: "eur", iso_currency_code: "EUR" }] },
        }),
      ),
      "o",
      "2026-10-10",
    ),
  ).toEqual([]);
});
it("checks raw activity even when excluded from canonical flows and excludes non-USD transactions", async () => {
  state.projection.mockResolvedValue({
    currencyByAccountId: new Map([
      ["a", "USD"],
      ["b", "EUR"],
    ]),
    truncated: false,
    transactions: [
      {
        id: "t",
        sourceTransactionId: "t",
        accountId: "a",
        date: "2026-10-01",
        flow: "transfer",
        signedAmount: 100,
      },
      {
        id: "f",
        sourceTransactionId: "f",
        accountId: "b",
        date: "2026-10-01",
        flow: "expense",
        signedAmount: 500,
        merchant: "Foreign",
      },
      { id: "m", manualAccountId: "cash", date: "2026-10-01", flow: "expense" },
    ],
  });
  const db = clientStub({
    transactions: { data: [{ account_id: "a", date: "2026-10-01" }] },
    accounts: {
      data: [
        {
          id: "a",
          type: "depository",
          current_balance: 6000,
          iso_currency_code: "USD",
          created_at: "2026-01-01",
        },
      ],
    },
  });
  expect(await loadGeneratedInsights(client(db), "o", "2026-10-10")).toEqual(
    [],
  );
});

it("refuses missing or truncated raw activity rather than suggesting idle cash", async () => {
  for (const result of [{ error: new Error("activity") }, { data: Array(5001).fill({}) }]) {
    await expect(loadGeneratedInsights(client(clientStub({ transactions: result })), "o", "2026-10-10")).rejects.toThrow();
  }
});
