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

  it("user A can do full CRUD on their own goals", async () => {
    const clientA = await signIn(userA.email, userA.password);

    // Create a goal
    const { data: goal, error: insertError } = await clientA
      .from("goals")
      .insert({
        user_id: idA,
        name: "Savings Target A",
        target_amount: 5000,
        saved_amount: 1000,
      })
      .select("id, name, target_amount, saved_amount")
      .single();

    expect(insertError).toBeNull();
    expect(goal).toBeTruthy();
    expect(goal!.name).toBe("Savings Target A");

    // Read the goal
    const { data: readGoals, error: readError } = await clientA
      .from("goals")
      .select("id")
      .eq("id", goal!.id);

    expect(readError).toBeNull();
    expect(readGoals).toHaveLength(1);

    // Update the goal
    const { error: updateError } = await clientA
      .from("goals")
      .update({ saved_amount: 2000 })
      .eq("id", goal!.id);

    expect(updateError).toBeNull();

    // Delete the goal
    const { error: deleteError } = await clientA
      .from("goals")
      .delete()
      .eq("id", goal!.id);

    expect(deleteError).toBeNull();
  });

  it("user B cannot read, update, or delete user A's goals", async () => {
    // Seed goal for user A
    const { data: goal } = await admin
      .from("goals")
      .insert({
        user_id: idA,
        name: "Secret Goal A",
        target_amount: 10000,
        saved_amount: 500,
      })
      .select("id")
      .single();

    expect(goal).toBeTruthy();

    // User B tries to read
    const { data: readGoals } = await clientB
      .from("goals")
      .select("id")
      .eq("id", goal!.id);
    expect(readGoals ?? []).toHaveLength(0);

    // User B tries to update
    const { error: updateError } = await clientB
      .from("goals")
      .update({ saved_amount: 9999 })
      .eq("id", goal!.id);
    // Since RLS policies apply using policy filters (using user_id = auth.uid()),
    // updating another user's goal will either return no rows updated or throw an error.
    // In Supabase, update without RLS write access returns success but updates 0 rows,
    // let's verify if user B can actually mutate it.
    
    // User B tries to delete
    const { error: deleteError } = await clientB
      .from("goals")
      .delete()
      .eq("id", goal!.id);

    // Verify the goal is still intact with its original saved_amount
    const { data: checkGoal } = await admin
      .from("goals")
      .select("saved_amount")
      .eq("id", goal!.id)
      .single();
    expect(checkGoal!.saved_amount).toBe(500);

    // Clean up
    await admin.from("goals").delete().eq("id", goal!.id);
  });
});
