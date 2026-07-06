import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Cross-user isolation: RLS must prevent one user from reading another user's
 * financial data. Runs against the live FundFlow project (requires migrations
 * applied). Skipped automatically if env is not configured.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SECRET_KEY;
const run = Boolean(url && publishable && secret);

const suite = run ? describe : describe.skip;

suite("RLS cross-user isolation", () => {
  if (!run) return;

  const admin = createClient(url!, secret!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const stamp = Date.now();
  const userA = { email: `rls-a-${stamp}@example.com`, password: "Password123!" };
  const userB = { email: `rls-b-${stamp}@example.com`, password: "Password123!" };

  let idA = "";
  let idB = "";
  let clientB: SupabaseClient;

  async function makeUser(email: string, password: string): Promise<string> {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
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

    // Seed an encrypted item + a transaction for user A via the service client.
    await admin.from("plaid_items").insert({
      user_id: idA,
      plaid_item_id: `item-${stamp}`,
      institution_name: "Test Bank",
      access_token_ciphertext: "x",
      access_token_iv: "y",
      access_token_tag: "z",
    });

    clientB = await signIn(userB.email, userB.password);
  });

  afterAll(async () => {
    if (idA) await admin.auth.admin.deleteUser(idA);
    if (idB) await admin.auth.admin.deleteUser(idB);
  });

  it("user A can read their own plaid_items", async () => {
    const clientA = await signIn(userA.email, userA.password);
    const { data } = await clientA.from("plaid_items").select("id");
    expect((data ?? []).length).toBe(1);
  });

  it("user B cannot read user A's plaid_items", async () => {
    const { data } = await clientB.from("plaid_items").select("id");
    expect(data ?? []).toHaveLength(0);
  });

  it("user B cannot insert a row impersonating user A", async () => {
    const { error } = await clientB.from("budgets").insert({
      user_id: idA, // attempt to write for another user
      category: "HACK",
      monthly_limit: 1,
    });
    expect(error).not.toBeNull(); // RLS check violation
  });
});
