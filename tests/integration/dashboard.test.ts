import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { getDashboardData } from "@/lib/dashboard";
import { storeItem } from "@/lib/plaid-service";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SECRET_KEY;
const run = Boolean(url && publishable && secret);
const suite = run ? describe : describe.skip;

suite("dashboard data DB integration", () => {
  if (!run) return;

  const admin = createClient(url!, secret!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const stamp = Date.now();
  let userId = "";
  let itemDbId = "";
  let checkingId = "";
  let creditId = "";
  let userClient: ReturnType<typeof createClient>;

  beforeAll(async () => {
    // Create temporary user
    const { data, error } = await admin.auth.admin.createUser({
      email: `dash-${stamp}@example.com`,
      password: "Password123!",
      email_confirm: true,
    });
    if (error) throw error;
    userId = data.user.id;

    // Login as user to get user-scoped client
    userClient = createClient(url!, publishable!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: signInError } = await userClient.auth.signInWithPassword({
      email: `dash-${stamp}@example.com`,
      password: "Password123!",
    });
    if (signInError) throw signInError;

    // Create item
    itemDbId = await storeItem({
      userId,
      plaidItemId: `item-dash-${stamp}`,
      accessToken: "x",
    });

    // Seed budget
    await admin.from("budgets").insert([
      {
        user_id: userId,
        category: "FOOD_AND_DRINK",
        monthly_limit: 200.0,
      },
    ]);
  });

  afterAll(async () => {
    if (userId) {
      await admin.auth.admin.deleteUser(userId);
    }
  });

  it("calculates accurate dashboard stats from seeded data", async () => {
    // 1. Seed accounts
    const { data: accounts } = await admin
      .from("accounts")
      .insert([
        {
          user_id: userId,
          plaid_item_id: itemDbId,
          plaid_account_id: `acct1-${stamp}`,
          name: "Checking",
          type: "depository",
          current_balance: 1000.0,
        },
        {
          user_id: userId,
          plaid_item_id: itemDbId,
          plaid_account_id: `acct2-${stamp}`,
          name: "Visa Credit Card",
          type: "credit",
          current_balance: 500.0,
        },
      ])
      .select("id");

    checkingId = accounts![0].id;
    creditId = accounts![1].id;

    // Get current month YYYY-MM
    const now = new Date();
    const currentMonthStr = now.toISOString().slice(0, 7);
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15);
    const lastMonthStr = lastMonth.toISOString().slice(0, 7);

    // 2. Seed transactions
    await admin.from("transactions").insert([
      // Current month spending
      {
        user_id: userId,
        account_id: checkingId,
        plaid_transaction_id: `t1-${stamp}`,
        amount: 50.0, // spending (positive)
        date: `${currentMonthStr}-05`,
        merchant_name: "Whole Foods",
        pfc_primary: "FOOD_AND_DRINK",
      },
      {
        user_id: userId,
        account_id: checkingId,
        plaid_transaction_id: `t2-${stamp}`,
        amount: 25.0, // spending
        date: `${currentMonthStr}-10`,
        merchant_name: "Trader Joes",
        pfc_primary: "FOOD_AND_DRINK",
      },
      {
        user_id: userId,
        account_id: creditId,
        plaid_transaction_id: `t3-${stamp}`,
        amount: 15.0, // spending
        date: `${currentMonthStr}-12`,
        merchant_name: "Netflix",
        pfc_primary: "ENTERTAINMENT",
      },
      // Current month income
      {
        user_id: userId,
        account_id: checkingId,
        plaid_transaction_id: `t4-${stamp}`,
        amount: -1200.0, // income (negative)
        date: `${currentMonthStr}-01`,
        merchant_name: "Direct Deposit",
        pfc_primary: "INCOME",
      },
      // Transfer to exclude
      {
        user_id: userId,
        account_id: checkingId,
        plaid_transaction_id: `t5-${stamp}`,
        amount: 100.0,
        date: `${currentMonthStr}-15`,
        pfc_primary: "TRANSFER_OUT",
      },
      // Last month spending
      {
        user_id: userId,
        account_id: checkingId,
        plaid_transaction_id: `t6-${stamp}`,
        amount: 40.0,
        date: `${lastMonthStr}-15`,
        merchant_name: "Shell Gas",
        pfc_primary: "TRANSPORTATION",
      },
    ]);

    // 3. Seed recurring streams
    await admin.from("recurring_streams").insert([
      {
        user_id: userId,
        plaid_item_id: itemDbId,
        stream_id: `s1-${stamp}`,
        stream_type: "outflow",
        merchant_name: "Netflix",
        average_amount: 15.49,
        frequency: "monthly",
        category: "ENTERTAINMENT",
        is_active: true,
      },
      {
        user_id: userId,
        plaid_item_id: itemDbId,
        stream_id: `s2-${stamp}`,
        stream_type: "inflow",
        merchant_name: "Salary",
        average_amount: 1200.0,
        frequency: "monthly",
        is_active: true,
      },
    ]);

    // 4. Retrieve dashboard data
    const data = await getDashboardData(userClient);

    expect(data.accounts).toHaveLength(2);
    expect(data.creditAccounts).toHaveLength(1);
    expect(data.creditAccounts[0].name).toBe("Visa Credit Card");

    // Monthly spending includes current month and last month
    expect(data.monthlySpending.length).toBeGreaterThanOrEqual(2);
    const currMonthSp = data.monthlySpending.find((m) => m.month === currentMonthStr);
    const lastMonthSp = data.monthlySpending.find((m) => m.month === lastMonthStr);

    expect(currMonthSp).toBeTruthy();
    // 50 (Whole Foods) + 25 (Trader Joes) + 15 (Netflix) = 90.00
    // Transfer (100) and Income (-1200) excluded.
    expect(currMonthSp!.amount).toBe(90.0);

    expect(lastMonthSp).toBeTruthy();
    expect(lastMonthSp!.amount).toBe(40.0);

    // Current month breakdowns
    expect(data.currentMonthExpenses).toBe(90.0);
    expect(data.currentMonthIncome).toBe(1200.0);

    // Categories
    const foodAndDrink = data.categoryBreakdown.find((c) => c.category === "FOOD_AND_DRINK");
    expect(foodAndDrink).toBeTruthy();
    expect(foodAndDrink!.amount).toBe(75.0);

    const entertainment = data.categoryBreakdown.find((c) => c.category === "ENTERTAINMENT");
    expect(entertainment).toBeTruthy();
    expect(entertainment!.amount).toBe(15.0);

    // Merchants
    expect(data.merchantBreakdown[0].merchant).toBe("Whole Foods");
    expect(data.merchantBreakdown[0].amount).toBe(50.0);

    // Streams
    expect(data.subscriptions).toHaveLength(1);
    expect(data.subscriptions[0].merchant).toBe("Netflix");
    expect(data.subscriptions[0].amount).toBe(15.49);

    expect(data.incomeStreams).toHaveLength(1);
    expect(data.incomeStreams[0].merchant).toBe("Salary");
    expect(data.incomeStreams[0].amount).toBe(1200.0);

    // Budget, pacing, card/bank breakdowns, and cash flow
    expect(data.totalBudget).toBe(200.0);
    expect(data.lastMonthProratedSpent).toBeGreaterThanOrEqual(0);

    expect(data.spendPerCard.find((c) => c.name.includes("Checking"))!.amount).toBe(75.0);
    expect(data.spendPerCard.find((c) => c.name.includes("Visa"))!.amount).toBe(15.0);

    expect(data.spendPerBank[0].name).toBe("Other Bank");
    expect(data.spendPerBank[0].amount).toBe(90.0);

    expect(data.cashFlow.deposits).toBe(1200.0);
    expect(data.cashFlow.withdrawals).toBe(175.0);
    expect(data.cashFlow.net).toBe(1025.0);
  });

  it("filters dashboard stats by account and month correctly", async () => {
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15);
    const lastMonthStr = lastMonth.toISOString().slice(0, 7);

    // 1. Filter by Credit Card account (creditId)
    const creditData = await getDashboardData(userClient, creditId);
    expect(creditData.currentMonthExpenses).toBe(15.0);
    expect(creditData.currentMonthIncome).toBe(0.0);

    // 2. Filter by Checking account (checkingId)
    const checkingData = await getDashboardData(userClient, checkingId);
    expect(checkingData.currentMonthExpenses).toBe(75.0);
    expect(checkingData.currentMonthIncome).toBe(1200.0);

    // 3. Filter by last month (lastMonthStr)
    const lastMonthData = await getDashboardData(userClient, undefined, lastMonthStr);
    expect(lastMonthData.selectedMonth).toBe(lastMonthStr);
    expect(lastMonthData.currentMonthExpenses).toBe(40.0);
    expect(lastMonthData.currentMonthIncome).toBe(0.0);

    // 4. Filter by both credit card and last month
    const combinedData = await getDashboardData(userClient, creditId, lastMonthStr);
    expect(combinedData.currentMonthExpenses).toBe(0.0);
  });
});
