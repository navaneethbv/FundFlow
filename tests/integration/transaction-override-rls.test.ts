import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SECRET_KEY;
const run = Boolean(url && publishable && secret);

const suite = run ? describe : describe.skip;

suite("transaction classification override RLS", () => {
  if (!run) return;

  const admin = createClient(url!, secret!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const stamp = Date.now();
  const userA = { email: `override-a-${stamp}@example.com`, password: "Password123!" };
  const userB = { email: `override-b-${stamp}@example.com`, password: "Password123!" };

  let idA = "";
  let idB = "";
  let clientA: SupabaseClient;
  let clientB: SupabaseClient;
  let itemDbId = "";
  let accountDbId = "";
  let txnDbId = "";

  async function makeUser(email: string, password: string): Promise<string> {
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    return data.user.id;
  }

  async function signIn(email: string, password: string): Promise<SupabaseClient> {
    const client = createClient(url!, publishable!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return client;
  }

  beforeAll(async () => {
    idA = await makeUser(userA.email, userA.password);
    idB = await makeUser(userB.email, userB.password);
    clientA = await signIn(userA.email, userA.password);
    clientB = await signIn(userB.email, userB.password);

    const { data: item } = await admin
      .from("plaid_items")
      .insert({
        user_id: idA,
        plaid_item_id: `override-item-${stamp}`,
        institution_name: "Override Bank",
        status: "active",
        access_token_ciphertext: "e2e",
        access_token_iv: "e2e",
        access_token_tag: "e2e",
      })
      .select("id")
      .single();
    itemDbId = item!.id;

    const { data: account } = await admin
      .from("accounts")
      .insert({
        user_id: idA,
        plaid_item_id: itemDbId,
        plaid_account_id: `override-acct-${stamp}`,
        name: "Override Checking",
        mask: "1111",
        type: "depository",
      })
      .select("id")
      .single();
    accountDbId = account!.id;

    const { data: txn } = await admin
      .from("transactions")
      .insert({
        user_id: idA,
        account_id: accountDbId,
        plaid_transaction_id: `override-txn-${stamp}`,
        amount: 500,
        date: "2026-08-01",
        name: "Jewelry",
        pfc_primary: "TRANSFER_OUT",
        pfc_detailed: "TRANSFER_OUT",
      })
      .select("id")
      .single();
    txnDbId = txn!.id;
  });

  afterAll(async () => {
    if (idA) await admin.auth.admin.deleteUser(idA);
    if (idB) await admin.auth.admin.deleteUser(idB);
  });

  it("lets the owner set an override on their own transaction", async () => {
    const { error } = await clientA
      .from("transaction_annotations")
      .upsert(
        {
          user_id: idA,
          transaction_id: txnDbId,
          display_category: "SHOPPING",
          cash_flow_classification: "expense",
        },
        { onConflict: "user_id,transaction_id" },
      );
    expect(error).toBeNull();
    const { data } = await clientA
      .from("transaction_annotations")
      .select("display_category")
      .eq("transaction_id", txnDbId)
      .single();
    expect(data.display_category).toBe("SHOPPING");
  });

  it("refuses user B from annotating user A's transaction", async () => {
    const { error } = await clientB
      .from("transaction_annotations")
      .insert({
        user_id: idB,
        transaction_id: txnDbId,
        display_category: "MALICIOUS",
        cash_flow_classification: "income",
      });
    expect(error).not.toBeNull();
  });

  it("refuses user B from updating or deleting user A's annotation", async () => {
    const updateError = await clientB
      .from("transaction_annotations")
      .update({ display_category: "HACKED" })
      .eq("transaction_id", txnDbId);
    expect(updateError.error).not.toBeNull();

    const deleteResult = await clientB
      .from("transaction_annotations")
      .delete()
      .eq("transaction_id", txnDbId);
    expect(deleteResult.error).not.toBeNull();

    // User A's override is still intact.
    const { data } = await clientA
      .from("transaction_annotations")
      .select("display_category")
      .eq("transaction_id", txnDbId)
      .single();
    expect(data.display_category).toBe("SHOPPING");
  });
});