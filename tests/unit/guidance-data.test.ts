import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientStub } from "../fixtures/supabase-query";
import { loadPaydaySettings } from "@/lib/payday-data";
import { loadPaycheckPlan, planningCash } from "@/lib/paycheck-planner-data";
import {
  loadCarriedReviews,
  loadBalanceReviews,
} from "@/lib/balance-quality-data";
const cast = (db: ReturnType<typeof clientStub>) =>
  db as unknown as SupabaseClient;
const settings = {
  cadence: "weekly",
  anchor_date: "2026-10-05",
  amount: "100.00",
  day1: 5,
  day2: null,
};
const account = {
  id: "checking",
  type: "depository",
  current_balance: 250,
  iso_currency_code: "USD",
};
beforeEach(() =>
  vi.stubEnv(
    "FUNDFLOW_FEATURE_FLAGS",
    "paydaySettings,paycheckPlanner,balanceQualityReview",
  ),
);
afterEach(() => vi.unstubAllEnvs());
describe("guidance reads", () => {
  it("keeps every new read dark without flags", async () => {
    vi.stubEnv("FUNDFLOW_FEATURE_FLAGS", "");
    const db = clientStub();
    expect(await loadPaydaySettings(cast(db), "owner")).toBeNull();
    expect(await loadPaycheckPlan(cast(db), "owner", "2026-10-01")).toBeNull();
    expect(await loadCarriedReviews(cast(db), "owner", ["snapshot"])).toEqual(
      [],
    );
    expect(await loadBalanceReviews(cast(db), "owner")).toEqual({
      reviews: [],
      next: null,
    });
    expect(db.from).not.toHaveBeenCalled();
  });
  it("requires configuration and refuses corrupt stored settings", async () => {
    expect(
      await loadPaycheckPlan(cast(clientStub()), "owner", "2026-10-01"),
    ).toEqual({ configured: false });
    await expect(
      loadPaydaySettings(
        cast(clientStub({ payday_settings: { data: {} } })),
        "owner",
      ),
    ).rejects.toThrow("Invalid saved");
    await expect(
      loadPaydaySettings(
        cast(clientStub({ payday_settings: { error: "unavailable" } })),
        "owner",
      ),
    ).rejects.toBe("unavailable");
  });
  it("combines manual bills, pending debits, and card statements once, scoped to the owner", async () => {
    const db = clientStub({
      payday_settings: { data: settings },
      accounts: { data: [account] },
      manual_recurring_items: {
        data: [
          {
            id: "utility",
            name: "Utility",
            amount: 10,
            frequency: "monthly",
            next_date: "2026-10-06",
            item_type: "expense",
            enabled: true,
          },
          {
            id: "move",
            name: "Transfer",
            amount: 999,
            frequency: "monthly",
            next_date: "2026-10-06",
            item_type: "expense",
            enabled: true,
            category: "TRANSFER_OUT",
          },
        ],
      },
      credit_card_bills: {
        data: [
          { account_id: "card", statement_balance: 20, due_date: "2026-10-06" },
        ],
      },
      scheduled_transactions: {
        data: [
          {
            id: "planned",
            merchant: "Planned",
            scheduled_date: "2026-10-06",
            amount: 30,
          },
        ],
      },
    });
    const result = await loadPaycheckPlan(cast(db), "owner", "2026-10-01");
    expect(result).toMatchObject({
      configured: true,
      currencyUnsupported: false,
      cash: 250,
    });
    expect(result && "periods" in result && result.periods?.[1]).toMatchObject({
      due: 60,
      remaining: 40,
    });
    for (const table of [
      "accounts",
      "payday_settings",
      "credit_card_bills",
      "scheduled_transactions",
      "manual_recurring_items",
      "recurring_streams",
    ])
      expect(db.scopedToUser(table, "owner")).toBe(true);
    expect(db.callsOn("scheduled_transactions")).toContainEqual({
      method: "eq",
      args: ["kind", "debit"],
    });
  });
  it("refuses to combine unlike currencies or truncate a planning input", async () => {
    const rows = { payday_settings: { data: settings } };
    expect(
      await loadPaycheckPlan(
        cast(
          clientStub({
            ...rows,
            accounts: { data: [{ ...account, iso_currency_code: "EUR" }] },
          }),
        ),
        "owner",
        "2026-10-01",
      ),
    ).toMatchObject({ currencyUnsupported: true });
    await expect(
      loadPaycheckPlan(
        cast(
          clientStub({
            ...rows,
            credit_card_bills: { data: Array(1000).fill({}) },
          }),
        ),
        "owner",
        "2026-10-01",
      ),
    ).rejects.toThrow("Too many");
    await expect(
      loadPaycheckPlan(
        cast(clientStub({ ...rows, credit_card_bills: { error: "failure" } })),
        "owner",
        "2026-10-01",
      ),
    ).rejects.toBe("failure");
  });
  it("never calls unknown cash zero and ignores noncash assets", () => {
    expect(planningCash([])).toBeNull();
    expect(planningCash([{ ...account, current_balance: null }])).toBeNull();
    expect(planningCash([{ ...account, current_balance: "NaN" }])).toBeNull();
    expect(
      planningCash([
        account,
        { ...account, type: "credit", current_balance: 500 },
      ]),
    ).toBe(250);
    expect(planningCash([{ ...account, current_balance: 0 }])).toBe(0);
  });
  it("loads carried values only for the owner's visible snapshots and surfaces errors", async () => {
    const db = clientStub({
      balance_quality_reviews: { data: [{ id: "review" }] },
    });
    expect(await loadCarriedReviews(cast(db), "owner", [])).toEqual([]);
    expect(db.from).not.toHaveBeenCalled();
    expect(await loadCarriedReviews(cast(db), "owner", ["snapshot"])).toEqual([
      { id: "review" },
    ]);
    expect(db.scopedToUser("balance_quality_reviews", "owner")).toBe(true);
    expect(db.callsOn("balance_quality_reviews")).toContainEqual({
      method: "in",
      args: ["snapshot_id", ["snapshot"]],
    });
    await expect(
      loadCarriedReviews(
        cast(clientStub({ balance_quality_reviews: { error: "denied" } })),
        "owner",
        ["snapshot"],
      ),
    ).rejects.toBe("denied");
  });
});
it("excludes settled bills, card purchases, and transfer streams from the paycheck cash plan", async () => {
  const stream = {
    user_id: "owner",
    description: null,
    stream_type: "outflow",
    status: "MATURE",
    is_active: true,
    reviewed_at: null,
    dismissed_at: null,
    user_amount: null,
    average_amount: 20,
    last_amount: 20,
    frequency: "MONTHLY",
    first_date: "2026-09-05",
    last_date: "2026-09-05",
    predicted_next_date: "2026-10-05",
    account_id: "checking",
    category: "RENT_AND_UTILITIES",
  };
  const db = clientStub({
    payday_settings: { data: settings },
    accounts: { data: [account, { ...account, id: "card", type: "credit" }] },
    recurring_streams: {
      data: [
        { ...stream, id: "due", merchant_name: "Utility" },
        { ...stream, id: "settled", merchant_name: "Settled bill" },
        {
          ...stream,
          id: "purchase",
          merchant_name: "Card purchase",
          account_id: "card",
        },
        {
          ...stream,
          id: "transfer",
          merchant_name: "Internal transfer",
          category: "TRANSFER_OUT",
        },
      ],
    },
    recurring_stream_transactions: {
      data: [{ recurring_stream_id: "settled", transaction_id: "paid" }],
    },
    transactions: {
      data: [
        {
          id: "paid",
          user_id: "owner",
          account_id: "checking",
          date: "2026-10-05",
          amount: 20,
        },
      ],
    },
    credit_card_bills: {
      data: [
        { account_id: "card", statement_balance: 30, due_date: "2026-10-05" },
        { account_id: "empty", statement_balance: 0, due_date: "2026-10-06" },
        { account_id: "undated", statement_balance: 100, due_date: null },
      ],
    },
    scheduled_transactions: {
      data: [
        {
          id: "zero",
          merchant: "Zero",
          amount: 0,
          scheduled_date: "2026-10-05",
        },
      ],
    },
  });
  const result = await loadPaycheckPlan(cast(db), "owner", "2026-10-01");
  expect(result && "periods" in result && result.periods?.[1]).toMatchObject({
    due: 50,
    remaining: 50,
  });
  const names =
    result && "periods" in result
      ? result.periods?.flatMap((period) =>
          period.bills.map((bill) => bill.name),
        )
      : [];
  expect(names?.toSorted()).toEqual(["Card statement", "Utility"]);
});
