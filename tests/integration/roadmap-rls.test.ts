import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SECRET_KEY;
const run = Boolean(url && publishable && secret);

const suite = run ? describe : describe.skip;

suite("roadmap feature RLS", () => {
  if (!run) return;

  const admin = createClient(url!, secret!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const stamp = Date.now();
  const userA = { email: `roadmap-a-${stamp}@example.com`, password: "Password123!" };
  const userB = { email: `roadmap-b-${stamp}@example.com`, password: "Password123!" };

  let idA = "";
  let idB = "";
  let clientA: SupabaseClient;
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
    clientA = await signIn(userA.email, userA.password);
    clientB = await signIn(userB.email, userB.password);
  });

  afterAll(async () => {
    if (idA) await admin.auth.admin.deleteUser(idA);
    if (idB) await admin.auth.admin.deleteUser(idB);
  });

  it("isolates user-owned roadmap tables", async () => {
    const inserts = [
      clientA.from("merchant_rules").insert({
        user_id: idA,
        match_type: "keyword",
        pattern: "COFFEE",
        display_name: "Coffee",
        category: "FOOD_AND_DRINK",
      }),
      clientA.from("manual_accounts").insert({
        user_id: idA,
        name: "Brokerage",
        account_type: "asset",
        balance: 12345,
      }),
      clientA.from("net_worth_snapshots").insert({
        user_id: idA,
        snapshot_month: "2026-07-01",
        assets: 20000,
        liabilities: 5000,
      }),
      clientA.from("notifications").insert({
        user_id: idA,
        type: "goal_completed",
        severity: "success",
        title: "Goal complete",
        body: "Emergency fund is fully funded.",
      }),
      clientA.from("alert_preferences").insert({
        user_id: idA,
        budget_exceeded: true,
      }),
      clientA.from("ai_settings").insert({
        user_id: idA,
        enabled: true,
      }),
      clientA.from("ai_insights").insert({
        user_id: idA,
        insight_type: "monthly_review",
        summary: "Spending fell this month.",
      }),
      clientA.from("manual_recurring_items").insert({
        user_id: idA,
        name: "Rent",
        amount: 2500,
        frequency: "monthly",
        next_date: "2026-08-01",
        item_type: "expense",
      }),
    ];

    for (const insert of inserts) {
      const { error } = await insert;
      expect(error).toBeNull();
    }

    for (const table of [
      "merchant_rules",
      "manual_accounts",
      "net_worth_snapshots",
      "notifications",
      "alert_preferences",
      "ai_settings",
      "ai_insights",
      "manual_recurring_items",
    ]) {
      const { data: ownRows, error: ownError } = await clientA.from(table).select("*");
      expect(ownError, `${table} own read`).toBeNull();
      expect(ownRows?.length, `${table} own rows`).toBeGreaterThan(0);

      const { data: otherRows, error: otherError } = await clientB.from(table).select("*");
      expect(otherError, `${table} other read`).toBeNull();
      expect(otherRows ?? []).toHaveLength(0);
    }
  });

  it("prevents impersonating another user on roadmap writes", async () => {
    const { error } = await clientB.from("merchant_rules").insert({
      user_id: idA,
      match_type: "keyword",
      pattern: "HACK",
    });

    expect(error).not.toBeNull();
  });

  it("isolates import review batches and rows", async () => {
    const { data: batch, error: batchError } = await clientA
      .from("import_review_batches")
      .insert({
        user_id: idA,
        file_name: "checking.csv",
        status: "pending",
      })
      .select("id")
      .single();

    expect(batchError).toBeNull();

    const { error: rowError } = await clientA.from("import_review_rows").insert({
      user_id: idA,
      batch_id: batch!.id,
      row_hash: `row-${stamp}`,
      date: "2026-07-01",
      description: "Coffee",
      amount: 4.5,
      status: "pending",
    });
    expect(rowError).toBeNull();

    const { data: otherBatches } = await clientB.from("import_review_batches").select("id");
    const { data: otherRows } = await clientB.from("import_review_rows").select("id");
    expect(otherBatches ?? []).toHaveLength(0);
    expect(otherRows ?? []).toHaveLength(0);
  });

  it("lets household members see their membership without exposing other households", async () => {
    const { data: household, error: householdError } = await clientA
      .from("households")
      .insert({
        owner_user_id: idA,
        name: "Home",
      })
      .select("id")
      .single();
    expect(householdError).toBeNull();

    const { error: memberError } = await clientA.from("household_members").insert({
      household_id: household!.id,
      user_id: idA,
      role: "owner",
      status: "active",
    });
    expect(memberError).toBeNull();

    const { data: ownMemberships } = await clientA.from("household_members").select("id");
    const { data: otherMemberships } = await clientB.from("household_members").select("id");
    expect(ownMemberships ?? []).toHaveLength(1);
    expect(otherMemberships ?? []).toHaveLength(0);
  });

  it("lets owners read weekly delivery status without allowing client writes", async () => {
    const { error: insertError } = await admin
      .from("weekly_report_deliveries")
      .insert({
        user_id: idA,
        period_start: "2026-07-06",
        period_end: "2026-07-12",
        status: "sent",
        sent_at: "2026-07-13T15:00:00Z",
      });
    expect(insertError).toBeNull();

    const { data: ownRows, error: ownError } = await clientA
      .from("weekly_report_deliveries")
      .select("period_start, status");
    expect(ownError).toBeNull();
    expect(ownRows).toEqual([
      { period_start: "2026-07-06", status: "sent" },
    ]);

    const { data: otherRows, error: otherError } = await clientB
      .from("weekly_report_deliveries")
      .select("period_start, status");
    expect(otherError).toBeNull();
    expect(otherRows ?? []).toHaveLength(0);

    const { error: clientWriteError } = await clientA
      .from("weekly_report_deliveries")
      .insert({
        user_id: idA,
        period_start: "2026-07-13",
        period_end: "2026-07-19",
        status: "processing",
      });
    expect(clientWriteError).not.toBeNull();
  });
});
