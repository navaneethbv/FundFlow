import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";

/**
 * Transaction sync idempotency: applying the same Plaid transaction twice (as
 * happens when a sync re-runs from a prior cursor) must NOT create duplicates.
 * The guarantee is the unique plaid_transaction_id + upsert used by lib/sync.ts;
 * this test exercises that DB behavior directly.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
const run = Boolean(url && secret);
const suite = run ? describe : describe.skip;

suite("sync idempotency", () => {
  const admin = createClient(url!, secret!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const stamp = Date.now();
  let userId = "";
  let accountId = "";
  const plaidTxnId = `txn-${stamp}`;

  beforeAll(async () => {
    const { data, error } = await admin.auth.admin.createUser({
      email: `idem-${stamp}@example.com`,
      password: "Password123!",
      email_confirm: true,
    });
    if (error) throw error;
    userId = data.user.id;

    const { data: item } = await admin
      .from("plaid_items")
      .insert({
        user_id: userId,
        plaid_item_id: `item-${stamp}`,
        access_token_ciphertext: "x",
        access_token_iv: "y",
        access_token_tag: "z",
      })
      .select("id")
      .single();

    const { data: account } = await admin
      .from("accounts")
      .insert({
        user_id: userId,
        plaid_item_id: item!.id,
        plaid_account_id: `acct-${stamp}`,
        name: "Checking",
      })
      .select("id")
      .single();
    accountId = account!.id;
  });

  afterAll(async () => {
    if (userId) await admin.auth.admin.deleteUser(userId);
  });

  it("upserting the same transaction twice yields exactly one row", async () => {
    const row = {
      user_id: userId,
      account_id: accountId,
      plaid_transaction_id: plaidTxnId,
      amount: 12.34,
      date: "2026-06-01",
      merchant_name: "Coffee Shop",
    };

    await admin.from("transactions").upsert(row, {
      onConflict: "plaid_transaction_id",
    });
    // Re-apply the same page (modified amount) to simulate a re-run.
    await admin.from("transactions").upsert(
      { ...row, amount: 99.99 },
      { onConflict: "plaid_transaction_id" },
    );

    const { data } = await admin
      .from("transactions")
      .select("id, amount")
      .eq("plaid_transaction_id", plaidTxnId);

    expect(data ?? []).toHaveLength(1);
    expect(Number(data![0].amount)).toBe(99.99); // last write wins, no dupe
  });
});
