import { afterEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientStub, queryStub } from "../fixtures/supabase-query";
import { getDashboardData } from "@/lib/dashboard";
const account = {
  id: "a",
  user_id: "owner",
  name: "Checking",
  type: "depository",
  current_balance: 500,
  iso_currency_code: "USD",
  plaid_item_id: "item",
};
const txn = (id: string, amount: number, pfc: string) => ({
  id,
  user_id: "owner",
  account_id: "a",
  date: "2026-10-01",
  amount,
  name: id,
  merchant_name: id,
  iso_currency_code: "USD",
  pfc_primary: pfc,
  pfc_detailed: pfc,
  pending: false,
});
function database() {
  const db = clientStub({
    accounts: { data: [account] },
    budgets: {
      data: [
        {
          category: "FOOD_AND_DRINK",
          group_name: "expenses",
          monthly_limit: 1000,
          rollover_enabled: false,
        },
      ],
    },
    transactions: {
      data: [
        txn("purchase", 100, "FOOD_AND_DRINK"),
        txn("refund", -20, "FOOD_AND_DRINK"),
        txn("transfer", 900, "TRANSFER_OUT"),
        txn("card-payment", 500, "LOAN_PAYMENTS"),
      ],
    },
    payday_settings: {
      data: {
        cadence: "weekly",
        anchor_date: "2026-10-05",
        amount: 100,
        day1: 5,
        day2: null,
      },
    },
  });
  const original = db.from.getMockImplementation()!;
  db.from.mockImplementation((table) => {
    if (table !== "transactions") return original(table);
    const query = queryStub({
      data: [
        txn("purchase", 100, "FOOD_AND_DRINK"),
        txn("refund", -20, "FOOD_AND_DRINK"),
        txn("transfer", 900, "TRANSFER_OUT"),
        txn("card-payment", 500, "LOAN_PAYMENTS"),
      ],
    });
    query.maybeSingle = () =>
      Promise.resolve({ data: { date: "2026-09-01" }, error: null });
    return query;
  });
  return db;
}
const dashboard = (
  db: ReturnType<typeof database>,
  month = "2026-10",
  accountId?: string,
) =>
  getDashboardData(db as unknown as SupabaseClient, accountId, month, "owner", {
    today: "2026-10-01",
  });
afterEach(() => vi.unstubAllEnvs());
it("keeps new guidance fields and database reads absent with flags off", async () => {
  vi.stubEnv("FUNDFLOW_FEATURE_FLAGS", "");
  const db = database();
  const data = await dashboard(db);
  expect(data.insights).not.toHaveProperty("confirmedPayday");
  expect(data.insights).not.toHaveProperty("budgetAllowance");
  expect(db.from).not.toHaveBeenCalledWith("payday_settings");
});
it("uses only confirmed paydays and keeps the allowance separate from spendable cash", async () => {
  vi.stubEnv("FUNDFLOW_FEATURE_FLAGS", "paydaySettings,budgetDailyAllowance");
  const db = database();
  const data = await dashboard(db);
  expect(data.insights.confirmedPayday).toEqual({
    nextDate: "2026-10-05",
    amount: 100,
  });
  expect(data.insights.safeToSpend).toMatchObject({
    amount: 500,
    horizonEnd: "2026-10-05",
    anchor: "paycheck",
  });
  expect(data.insights.budgetAllowance).toMatchObject({
    budget: 1000,
    spent: 80,
    left: 920,
    daily: 29.67,
    daysLeft: 31,
  });
  expect(db.scopedToUser("payday_settings", "owner")).toBe(true);
});
it("does not turn detected income into confirmation when settings are absent", async () => {
  vi.stubEnv("FUNDFLOW_FEATURE_FLAGS", "paydaySettings");
  const db = clientStub({ accounts: { data: [account] } });
  const data = await dashboard(db);
  expect(data.insights.confirmedPayday).toEqual({
    nextDate: null,
    amount: null,
  });
  expect(data.insights.safeToSpend?.anchor).toBe("window");
});
it("does not pace a historical month or filtered account against the full budget", async () => {
  vi.stubEnv("FUNDFLOW_FEATURE_FLAGS", "budgetDailyAllowance");
  expect(
    (await dashboard(database(), "2026-09")).insights.budgetAllowance,
  ).toBeNull();
  expect(
    (await dashboard(database(), "2026-10", "a")).insights.budgetAllowance,
  ).toBeNull();
});
