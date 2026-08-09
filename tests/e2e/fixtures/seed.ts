import type { SupabaseClient } from "@supabase/supabase-js";

export interface SeededAccounts {
  checkingId: string;
  creditId: string;
  investmentId: string;
}

export class FinanceSeed {
  private accounts: SeededAccounts | null = null;

  constructor(
    private readonly admin: SupabaseClient,
    private readonly userId: string,
    private readonly stamp: string,
  ) {}

  async linkedAccounts(): Promise<SeededAccounts> {
    if (this.accounts) return this.accounts;
    const { data: item, error: itemError } = await this.admin
      .from("plaid_items")
      .insert({
        user_id: this.userId,
        plaid_item_id: `quality-${this.stamp}`,
        institution_name: "Quality Bank",
        status: "disconnected",
        access_token_ciphertext: "e2e",
        access_token_iv: "e2e",
        access_token_tag: "e2e",
      })
      .select("id")
      .single();
    if (itemError) throw itemError;
    const { data, error } = await this.admin
      .from("accounts")
      .insert([
        {
          user_id: this.userId,
          plaid_item_id: item.id,
          plaid_account_id: `checking-${this.stamp}`,
          name: "Quality Checking",
          mask: "1001",
          type: "depository",
          subtype: "checking",
          current_balance: 8200,
          available_balance: 8000,
          iso_currency_code: "USD",
        },
        {
          user_id: this.userId,
          plaid_item_id: item.id,
          plaid_account_id: `credit-${this.stamp}`,
          name: "Quality Card",
          mask: "2002",
          type: "credit",
          subtype: "credit card",
          current_balance: 2400,
          available_balance: 5600,
          credit_limit: 8000,
          apr: 19.99,
          iso_currency_code: "USD",
        },
        {
          user_id: this.userId,
          plaid_item_id: item.id,
          plaid_account_id: `investment-${this.stamp}`,
          name: "Quality Brokerage",
          mask: "3003",
          type: "investment",
          subtype: "brokerage",
          current_balance: 12500,
          iso_currency_code: "USD",
        },
      ])
      .select("id,type");
    if (error) throw error;
    this.accounts = {
      checkingId: String(data.find((row) => row.type === "depository")!.id),
      creditId: String(data.find((row) => row.type === "credit")!.id),
      investmentId: String(data.find((row) => row.type === "investment")!.id),
    };
    return this.accounts;
  }

  async dashboardAndInvestments(): Promise<void> {
    const accounts = await this.linkedAccounts();
    const month = "2026-08";
    const { error: transactionError } = await this.admin.from("transactions").insert([
      {
        user_id: this.userId,
        account_id: accounts.checkingId,
        plaid_transaction_id: `rent-${this.stamp}`,
        date: `${month}-03`,
        amount: 1800,
        name: "Rent",
        merchant_name: "Rent",
        pfc_primary: "RENT_AND_UTILITIES",
        pending: false,
      },
      {
        user_id: this.userId,
        account_id: accounts.creditId,
        plaid_transaction_id: `groceries-${this.stamp}`,
        date: `${month}-05`,
        amount: 320,
        name: "Market",
        merchant_name: "Market",
        pfc_primary: "FOOD_AND_DRINK",
        pending: false,
      },
      {
        user_id: this.userId,
        account_id: accounts.creditId,
        plaid_transaction_id: `flight-${this.stamp}`,
        date: `${month}-07`,
        amount: 450,
        name: "Airline",
        merchant_name: "Airline",
        pfc_primary: "TRAVEL",
        pending: false,
      },
    ]);
    if (transactionError) throw transactionError;
    const { error: budgetError } = await this.admin.from("budgets").insert([
      { user_id: this.userId, category: "RENT_AND_UTILITIES", monthly_limit: 2000, group_name: "fixed" },
      { user_id: this.userId, category: "FOOD_AND_DRINK", monthly_limit: 700, group_name: "flexible" },
      { user_id: this.userId, category: "TRAVEL", monthly_limit: 600, group_name: "non_monthly" },
    ]);
    if (budgetError) throw budgetError;
    const { data: security, error: securityError } = await this.admin
      .from("securities")
      .insert({ user_id: this.userId, ticker: "FFX", name: "FundFlow Index", security_type: "etf" })
      .select("id")
      .single();
    if (securityError) throw securityError;
    const { data: holding, error: holdingError } = await this.admin
      .from("holdings")
      .insert({
        user_id: this.userId,
        account_id: accounts.investmentId,
        security_id: security.id,
        quantity: 100,
        cost_basis: 9000,
        institution_price: 125,
        institution_value: 12500,
        as_of: "2026-08-09",
        source: "plaid",
      })
      .select("id")
      .single();
    if (holdingError) throw holdingError;
    const { error: snapshotError } = await this.admin.from("holding_snapshots").insert([
      { user_id: this.userId, holding_id: holding.id, snapshot_date: "2026-08-08", quantity: 100, price: 120, value: 12000 },
      { user_id: this.userId, holding_id: holding.id, snapshot_date: "2026-08-09", quantity: 100, price: 125, value: 12500 },
    ]);
    if (snapshotError) throw snapshotError;
  }

  async goal(): Promise<void> {
    const { error } = await this.admin.from("goals").insert({
      user_id: this.userId,
      name: "Emergency fund",
      target_amount: 10000,
      saved_amount: 3500,
      target_date: "2027-08-09",
      goal_type: "save_up",
      image_slug: "emergency-fund",
      monthly_contribution: 500,
    });
    if (error) throw error;
  }

  async duplicatePair(): Promise<void> {
    const accounts = await this.linkedAccounts();
    const { error } = await this.admin.from("transactions").insert([
      {
        user_id: this.userId,
        account_id: accounts.checkingId,
        plaid_transaction_id: `duplicate-a-${this.stamp}`,
        date: "2026-08-05",
        amount: 42.5,
        name: "Corner Cafe",
        merchant_name: "Corner Cafe",
        pfc_primary: "FOOD_AND_DRINK",
        pending: false,
      },
      {
        user_id: this.userId,
        account_id: accounts.creditId,
        plaid_transaction_id: `duplicate-b-${this.stamp}`,
        date: "2026-08-06",
        amount: 42.5,
        name: "CORNER CAFE",
        merchant_name: "Corner Cafe",
        pfc_primary: "FOOD_AND_DRINK",
        pending: false,
      },
    ]);
    if (error) throw error;
  }
}
