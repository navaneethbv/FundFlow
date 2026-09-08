import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";

/**
 * Concurrency and lifecycle contract for persistent transaction review.
 *
 * Runs against a live Supabase project with the
 * `20260908040000_transaction_review_state.sql` migration applied (see
 * CLAUDE.md). Skipped automatically when credentials are absent, and
 * tests/setup.ts refuses to run it against a non-approved database.
 *
 * Covers: compare-and-set under real row contention (AC-09), material sync
 * change reopening in the same transaction as the fact change (AC-05/AC-06),
 * cross-user rejection (AC-08/AC-13), excluded-duplicate rejection, and
 * that a stale write cannot overwrite newer state.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SECRET_KEY;
const run = Boolean(url && publishable && secret);
const suite = run ? describe : describe.skip;

suite("transaction review concurrency and lifecycle", () => {
  if (!run) return;

  const admin = createClient(url!, secret!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const stamp = Date.now();
  const userA = { email: `review-conc-a-${stamp}@example.com`, password: "Password123!" };
  const userB = { email: `review-conc-b-${stamp}@example.com`, password: "Password123!" };

  let idA = "";
  let idB = "";
  let accountA = "";
  let accountB = "";

  async function makeUser(email: string, password: string): Promise<string> {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    return data.user.id;
  }

  async function makeManualAccount(userId: string): Promise<string> {
    const { data, error } = await admin
      .from("manual_accounts")
      .insert({ user_id: userId, name: "Checking", account_type: "cash", balance: 1000 })
      .select("id")
      .single();
    if (error) throw error;
    return data.id as string;
  }

  async function insertTransaction(
    userId: string,
    accountId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<string> {
    const { data, error } = await admin
      .from("transactions")
      .insert({
        user_id: userId,
        manual_account_id: accountId,
        plaid_transaction_id: `review-conc-${stamp}-${Math.random().toString(36).slice(2)}`,
        date: "2026-09-01",
        amount: 50,
        name: "Coffee",
        merchant_name: "Starbucks",
        pfc_primary: "FOOD_AND_DRINK",
        source: "manual",
        pending: false,
        ...overrides,
      })
      .select("id")
      .single();
    if (error) throw error;
    return data.id as string;
  }

  async function reviewState(transactionId: string) {
    const { data, error } = await admin
      .from("transaction_review_states")
      .select("status, version, reviewed_at")
      .eq("transaction_id", transactionId)
      .single();
    if (error) throw error;
    return data as { status: string; version: number; reviewed_at: string | null };
  }

  function setState(
    userId: string,
    status: "needs_review" | "reviewed",
    items: Array<{ transaction_id: string; expected_version: string }>,
  ) {
    return admin.rpc("set_transaction_review_state_atomic", {
      p_user_id: userId,
      p_status: status,
      p_items: items,
    });
  }

  beforeAll(async () => {
    idA = await makeUser(userA.email, userA.password);
    idB = await makeUser(userB.email, userB.password);
    accountA = await makeManualAccount(idA);
    accountB = await makeManualAccount(idB);
  });

  afterAll(async () => {
    // Account/user deletion cascades review state through the composite FK.
    if (idA) await admin.auth.admin.deleteUser(idA);
    if (idB) await admin.auth.admin.deleteUser(idB);
  });

  it("initializes every inserted transaction as needs_review via the trigger", async () => {
    const tx = await insertTransaction(idA, accountA);
    const state = await reviewState(tx);
    expect(state.status).toBe("needs_review");
    expect(state.version).toBe(1);
    expect(state.reviewed_at).toBeNull();
  });

  it("advances version on review and clears it on reopen", async () => {
    const tx = await insertTransaction(idA, accountA);

    const reviewed = await setState(idA, "reviewed", [
      { transaction_id: tx, expected_version: "1" },
    ]);
    expect(reviewed.error).toBeNull();
    expect(reviewed.data.updated).toBe(1);
    expect(reviewed.data.items[0].version).toBe("2");
    expect(reviewed.data.items[0].reviewed_at).not.toBeNull();

    const reopened = await setState(idA, "needs_review", [
      { transaction_id: tx, expected_version: "2" },
    ]);
    expect(reopened.error).toBeNull();
    const after = await reviewState(tx);
    expect(after.status).toBe("needs_review");
    expect(after.version).toBe(3);
    expect(after.reviewed_at).toBeNull();
  });

  it("treats a repeat request at the current state as a no-op", async () => {
    const tx = await insertTransaction(idA, accountA);
    await setState(idA, "reviewed", [{ transaction_id: tx, expected_version: "1" }]);
    const before = await reviewState(tx);

    const repeat = await setState(idA, "reviewed", [
      { transaction_id: tx, expected_version: "2" },
    ]);
    expect(repeat.error).toBeNull();
    expect(repeat.data.updated).toBe(0);
    expect(repeat.data.unchanged).toBe(1);

    const after = await reviewState(tx);
    expect(after.version).toBe(before.version);
    expect(after.reviewed_at).toBe(before.reviewed_at);
  });

  it("lets exactly one of two concurrent opposing writes win; the stale one gets REVIEW_STATE_CHANGED", async () => {
    const tx = await insertTransaction(idA, accountA);

    const results = await Promise.all([
      setState(idA, "reviewed", [{ transaction_id: tx, expected_version: "1" }]),
      setState(idA, "reviewed", [{ transaction_id: tx, expected_version: "1" }]),
    ]);

    const winners = results.filter((r) => !r.error && r.data.updated === 1);
    const losers = results.filter((r) => r.error);
    expect(winners).toHaveLength(1);
    for (const loser of losers) {
      expect(loser.error?.message).toMatch(/REVIEW_STATE_CHANGED/);
    }

    const state = await reviewState(tx);
    expect(state.status).toBe("reviewed");
    expect(state.version).toBe(2);
  });

  it("rejects a stale expected_version without overwriting newer state", async () => {
    const tx = await insertTransaction(idA, accountA);
    await setState(idA, "reviewed", [{ transaction_id: tx, expected_version: "1" }]);

    const stale = await setState(idA, "needs_review", [
      { transaction_id: tx, expected_version: "1" },
    ]);
    expect(stale.error).not.toBeNull();
    expect(stale.error?.message).toMatch(/REVIEW_STATE_CHANGED/);

    const state = await reviewState(tx);
    expect(state.status).toBe("reviewed");
    expect(state.version).toBe(2);
  });

  it("reopens a reviewed entry in the same transaction as a material bank fact change", async () => {
    const tx = await insertTransaction(idA, accountA);
    await setState(idA, "reviewed", [{ transaction_id: tx, expected_version: "1" }]);

    const { error } = await admin.from("transactions").update({ amount: 65 }).eq("id", tx);
    expect(error).toBeNull();

    const state = await reviewState(tx);
    expect(state.status).toBe("needs_review");
    expect(state.reviewed_at).toBeNull();
    expect(state.version).toBe(3);
  });

  it("does not reopen on a timestamp-only (non-material) update", async () => {
    const tx = await insertTransaction(idA, accountA);
    await setState(idA, "reviewed", [{ transaction_id: tx, expected_version: "1" }]);
    const before = await reviewState(tx);

    await admin
      .from("transactions")
      .update({ updated_at: new Date(Date.now() + 3600_000).toISOString() })
      .eq("id", tx);

    const after = await reviewState(tx);
    expect(after.status).toBe("reviewed");
    expect(after.version).toBe(before.version);
  });

  it("rejects a foreign transaction id without disclosing it (404-equivalent)", async () => {
    const foreign = await insertTransaction(idB, accountB);
    const res = await setState(idA, "reviewed", [
      { transaction_id: foreign, expected_version: "1" },
    ]);
    expect(res.error).not.toBeNull();
    expect(
      res.error?.code === "P0002" || /not_found/i.test(res.error?.message ?? ""),
    ).toBe(true);

    const state = await reviewState(foreign);
    expect(state.status).toBe("needs_review");
  });

  it("rejects a batch that includes an excluded duplicate, leaving valid ids unchanged", async () => {
    const kept = await insertTransaction(idA, accountA, { amount: 30, name: "Dup kept" });
    const excluded = await insertTransaction(idA, accountA, { amount: 30, name: "Dup excluded" });
    const { error: linkError } = await admin.from("linked_duplicates").insert({
      user_id: idA,
      subject_id: `${kept}:${excluded}`,
      kept_transaction_id: kept,
      excluded_transaction_id: excluded,
    });
    expect(linkError).toBeNull();

    const res = await setState(idA, "reviewed", [
      { transaction_id: kept, expected_version: "1" },
      { transaction_id: excluded, expected_version: "1" },
    ]);
    expect(res.error).not.toBeNull();
    expect(res.error?.message).toMatch(/REVIEW_STATE_CHANGED/);

    const keptState = await reviewState(kept);
    expect(keptState.status).toBe("needs_review");
    expect(keptState.version).toBe(1);
  });

  it("cascades review-state deletion when the transaction is deleted", async () => {
    const tx = await insertTransaction(idA, accountA);
    await admin.from("transactions").delete().eq("id", tx);
    const { data, error } = await admin
      .from("transaction_review_states")
      .select("transaction_id")
      .eq("transaction_id", tx);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });
});
