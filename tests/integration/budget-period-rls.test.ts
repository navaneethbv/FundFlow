import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SECRET_KEY;
const run = Boolean(url && publishable && secret);
const suite = run ? describe : describe.skip;

suite("budget period RLS", () => {
  if (!run) return;

  const admin = createClient(url!, secret!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const stamp = Date.now();
  const credentials = {
    owner: {
      email: `budget-owner-${stamp}@example.com`,
      password: "Password123!",
    },
    member: {
      email: `budget-member-${stamp}@example.com`,
      password: "Password123!",
    },
    outsider: {
      email: `budget-outsider-${stamp}@example.com`,
      password: "Password123!",
    },
  };
  let ownerId = "";
  let memberId = "";
  let outsiderId = "";
  let privateBudgetId = "";
  let sharedBudgetId = "";
  let outsiderBudgetId = "";
  let privatePeriodId = "";
  let sharedPeriodId = "";
  let ownerClient: SupabaseClient;
  let memberClient: SupabaseClient;
  let outsiderClient: SupabaseClient;

  async function createUser(email: string, password: string) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    return data.user.id;
  }

  async function signIn(email: string, password: string) {
    const client = createClient(url!, publishable!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await client.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
    return client;
  }

  async function insertOne(
    table: string,
    value: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const { data, error } = await admin
      .from(table)
      .insert(value)
      .select("id")
      .single();
    if (error) throw error;
    return data as Record<string, unknown>;
  }

  beforeAll(async () => {
    ownerId = await createUser(
      credentials.owner.email,
      credentials.owner.password,
    );
    memberId = await createUser(
      credentials.member.email,
      credentials.member.password,
    );
    outsiderId = await createUser(
      credentials.outsider.email,
      credentials.outsider.password,
    );
    [ownerClient, memberClient, outsiderClient] = await Promise.all([
      signIn(credentials.owner.email, credentials.owner.password),
      signIn(credentials.member.email, credentials.member.password),
      signIn(credentials.outsider.email, credentials.outsider.password),
    ]);

    const household = await insertOne("households", {
      owner_user_id: ownerId,
      name: "Budget RLS household",
    });
    await insertOne("household_members", {
      household_id: household.id,
      user_id: memberId,
      role: "member",
      status: "active",
    });
    const privateBudget = await insertOne("budgets", {
      user_id: ownerId,
      category: `PRIVATE_${stamp}`,
      monthly_limit: 100,
    });
    const sharedBudget = await insertOne("budgets", {
      user_id: ownerId,
      category: `SHARED_${stamp}`,
      monthly_limit: 200,
      household_id: household.id,
    });
    const outsiderBudget = await insertOne("budgets", {
      user_id: outsiderId,
      category: `OUTSIDER_${stamp}`,
      monthly_limit: 300,
    });
    privateBudgetId = privateBudget.id as string;
    sharedBudgetId = sharedBudget.id as string;
    outsiderBudgetId = outsiderBudget.id as string;
    const privatePeriod = await insertOne("budget_periods", {
      user_id: ownerId,
      budget_id: privateBudgetId,
      month: "2026-07-01",
      planned: 100,
    });
    const sharedPeriod = await insertOne("budget_periods", {
      user_id: ownerId,
      budget_id: sharedBudgetId,
      month: "2026-07-01",
      planned: 200,
    });
    privatePeriodId = privatePeriod.id as string;
    sharedPeriodId = sharedPeriod.id as string;
  });

  afterAll(async () => {
    for (const userId of [ownerId, memberId, outsiderId]) {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  });

  it("lets the owner select, insert, update, and delete periods", async () => {
    const { data, error } = await ownerClient
      .from("budget_periods")
      .select("id")
      .in("id", [privatePeriodId, sharedPeriodId]);
    expect(error).toBeNull();
    expect(data?.map((row) => row.id).sort()).toEqual(
      [privatePeriodId, sharedPeriodId].sort(),
    );

    const { data: inserted, error: insertError } = await ownerClient
      .from("budget_periods")
      .insert({
        user_id: ownerId,
        budget_id: privateBudgetId,
        month: "2026-08-01",
        planned: 125,
      })
      .select("id")
      .single();
    expect(insertError).toBeNull();

    const { error: updateError } = await ownerClient
      .from("budget_periods")
      .update({ planned: 130 })
      .eq("id", inserted!.id);
    expect(updateError).toBeNull();
    const { error: deleteError } = await ownerClient
      .from("budget_periods")
      .delete()
      .eq("id", inserted!.id);
    expect(deleteError).toBeNull();
  });

  it("lets a household member read only the shared period", async () => {
    const { data, error } = await memberClient
      .from("budget_periods")
      .select("id")
      .in("id", [privatePeriodId, sharedPeriodId]);

    expect(error).toBeNull();
    expect(data).toEqual([{ id: sharedPeriodId }]);
  });

  it("denies household member writes to the owner's shared period", async () => {
    const { error: insertError } = await memberClient
      .from("budget_periods")
      .insert({
        user_id: memberId,
        budget_id: sharedBudgetId,
        month: "2026-08-01",
        planned: 1,
      });
    await memberClient
      .from("budget_periods")
      .update({ planned: 1 })
      .eq("id", sharedPeriodId);
    await memberClient
      .from("budget_periods")
      .delete()
      .eq("id", sharedPeriodId);
    const { data: unchanged, error: verifyError } = await admin
      .from("budget_periods")
      .select("id,planned")
      .eq("id", sharedPeriodId)
      .single();

    expect(insertError).not.toBeNull();
    expect(verifyError).toBeNull();
    expect(unchanged).toMatchObject({ id: sharedPeriodId, planned: 200 });
  });

  it("hides periods from an unrelated user and rejects cross-owner links", async () => {
    const { data, error } = await outsiderClient
      .from("budget_periods")
      .select("id")
      .in("id", [privatePeriodId, sharedPeriodId]);
    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { error: linkError } = await ownerClient
      .from("budget_periods")
      .insert({
        user_id: ownerId,
        budget_id: outsiderBudgetId,
        month: "2026-08-01",
        planned: 1,
      });
    expect(linkError).not.toBeNull();
  });

  it("keeps the atomic mutation owner-only", async () => {
    const { data: saved, error: ownerError } = await ownerClient.rpc(
      "update_budget_period",
      {
        p_budget_id: sharedBudgetId,
        p_month: "2026-07-01",
        p_planned: 225,
        p_group_name: "fixed",
        p_rollover_enabled: true,
        p_sort_order: 2,
      },
    );
    expect(ownerError).toBeNull();
    expect(saved).toEqual([
      expect.objectContaining({
        budget_id: sharedBudgetId,
        planned: 225,
        group_name: "fixed",
        rollover_enabled: true,
        sort_order: 2,
      }),
    ]);

    const { error: memberError } = await memberClient.rpc(
      "update_budget_period",
      {
        p_budget_id: sharedBudgetId,
        p_month: "2026-07-01",
        p_planned: 1,
        p_group_name: null,
        p_rollover_enabled: null,
        p_sort_order: null,
      },
    );
    expect(memberError?.code).toBe("P0002");
    const { data: unchanged } = await admin
      .from("budget_periods")
      .select("planned")
      .eq("id", sharedPeriodId)
      .single();
    expect(unchanged?.planned).toBe(225);
  });

  it("cascades period history when its budget is deleted", async () => {
    const cascadeBudget = await insertOne("budgets", {
      user_id: ownerId,
      category: `CASCADE_${stamp}`,
      monthly_limit: 50,
    });
    const cascadePeriod = await insertOne("budget_periods", {
      user_id: ownerId,
      budget_id: cascadeBudget.id,
      month: "2026-07-01",
      planned: 50,
    });

    const { error: deleteError } = await admin
      .from("budgets")
      .delete()
      .eq("id", cascadeBudget.id);
    expect(deleteError).toBeNull();
    const { data, error } = await admin
      .from("budget_periods")
      .select("id")
      .eq("id", cascadePeriod.id);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});
