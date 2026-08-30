import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SECRET_KEY;
const run = Boolean(url && publishable && secret);

const suite = run ? describe : describe.skip;

suite("credit card bill RLS", () => {
  if (!run) return;

  const admin = createClient(url!, secret!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const stamp = Date.now();
  let idA = "";
  let idB = "";
  let clientA: SupabaseClient;
  let clientB: SupabaseClient;
  let itemDbId = "";
  let creditDbId = "";
  let paymentAccountBId = "";

  async function signIn(email: string, password: string): Promise<SupabaseClient> {
    const client = createClient(url!, publishable!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return client;
  }

  beforeAll(async () => {
    const mk = async (email: string) => {
      const { data, error } = await admin.auth.admin.createUser({ email, password: "Password123!", email_confirm: true });
      if (error) throw error;
      return data.user.id;
    };
    idA = await mk(`bill-a-${stamp}@example.com`);
    idB = await mk(`bill-b-${stamp}@example.com`);
    clientA = await signIn(`bill-a-${stamp}@example.com`, "Password123!");
    clientB = await signIn(`bill-b-${stamp}@example.com`, "Password123!");

    const { data: item } = await admin.from("plaid_items").insert({
      user_id: idA,
      plaid_item_id: `bill-item-${stamp}`,
      institution_name: "Bill Bank",
      status: "active",
      access_token_ciphertext: "e2e",
      access_token_iv: "e2e",
      access_token_tag: "e2e",
    }).select("id").single();
    itemDbId = item!.id;
    const { data: credit } = await admin.from("accounts").insert({
      user_id: idA,
      plaid_item_id: itemDbId,
      plaid_account_id: `bill-credit-${stamp}`,
      name: "Bill Card",
      mask: "4444",
      type: "credit",
      subtype: "credit card",
    }).select("id").single();
    creditDbId = credit!.id;

    const { data: itemB } = await admin.from("plaid_items").insert({
      user_id: idB,
      plaid_item_id: `bill-item-b-${stamp}`,
      institution_name: "Payment Bank",
      status: "active",
      access_token_ciphertext: "e2e",
      access_token_iv: "e2e",
      access_token_tag: "e2e",
    }).select("id").single();
    const { data: paymentAccountB } = await admin.from("accounts").insert({
      user_id: idB,
      plaid_item_id: itemB!.id,
      plaid_account_id: `bill-payment-b-${stamp}`,
      name: "Payment Account",
      mask: "5555",
      type: "depository",
      subtype: "checking",
    }).select("id").single();
    paymentAccountBId = paymentAccountB!.id;
  });

  afterAll(async () => {
    if (idA) await admin.auth.admin.deleteUser(idA);
    if (idB) await admin.auth.admin.deleteUser(idB);
  });

  it("lets the owner upsert a bill for their own credit account", async () => {
    const { error } = await clientA.from("credit_card_bills").upsert(
      {
        user_id: idA,
        account_id: creditDbId,
        statement_balance: 1200,
        minimum_payment: 25,
        due_date: "2026-08-25",
      },
      { onConflict: "user_id,account_id" },
    );
    expect(error).toBeNull();
    const { data } = await clientA.from("credit_card_bills").select("statement_balance").eq("account_id", creditDbId).single();
    expect(Number((data as { statement_balance: number }).statement_balance)).toBe(1200);
  });

  it("refuses user B from writing a bill against user A's credit account", async () => {
    const { error } = await clientB.from("credit_card_bills").insert({
      user_id: idB,
      account_id: creditDbId,
      statement_balance: 99999,
    });
    expect(error).not.toBeNull();
    // User A's bill is untouched.
    const { data } = await clientA.from("credit_card_bills").select("statement_balance").eq("account_id", creditDbId).single();
    expect(Number((data as { statement_balance: number }).statement_balance)).toBe(1200);
  });

  it("refuses an owned bill that references another user's payment account", async () => {
    const { error } = await clientA.from("credit_card_bills").upsert(
      {
        user_id: idA,
        account_id: creditDbId,
        payment_account_id: paymentAccountBId,
        statement_balance: 1200,
      },
      { onConflict: "user_id,account_id" },
    );
    expect(error).not.toBeNull();
  });
});
