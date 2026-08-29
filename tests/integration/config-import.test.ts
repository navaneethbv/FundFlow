import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { POST } from "@/app/api/import/config/route";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SECRET_KEY;
const run = Boolean(url && publishable && secret);

let authContext:
  | { user: { id: string }; supabase: SupabaseClient }
  | NextResponse = { user: { id: "" }, supabase: undefined as unknown as SupabaseClient };
vi.mock("@/lib/http", () => ({
  requireUser: () => authContext,
  badRequest: (msg: string) => NextResponse.json({ error: msg }, { status: 400 }),
  errorResponse: (_c: string, e: unknown) =>
    NextResponse.json({ error: String((e as Error)?.message ?? e) }, { status: 500 }),
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => Promise.resolve(true) }));

const MONARCH_BUDGETS = JSON.stringify({
  groups: [{ name: "Needs", type: "fixed", categories: [{ name: "Config Import Rent", amount: 2000 }] }],
});
const MONARCH_GOALS = JSON.stringify({
  goals: [{ id: "config-goal-1", name: "Config Import Fund", type: "save_up", target_amount: 15000, target_date: "2027-12-31" }],
});

const suite = run ? describe : describe.skip;

suite("config import DB integration", () => {
  if (!run) return;

  const admin = createClient(url!, secret!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const stamp = Date.now();
  let idA = "";
  let idB = "";
  let clientA: SupabaseClient;
  let clientB: SupabaseClient;

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
    idA = await mk(`config-a-${stamp}@example.com`);
    idB = await mk(`config-b-${stamp}@example.com`);
    clientA = await signIn(`config-a-${stamp}@example.com`, "Password123!");
    clientB = await signIn(`config-b-${stamp}@example.com`, "Password123!");
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (idA) await admin.auth.admin.deleteUser(idA);
    if (idB) await admin.auth.admin.deleteUser(idB);
  });

  it("imports budgets and goals for the authenticated owner only", async () => {
    authContext = { user: { id: idA }, supabase: clientA };
    const budgetRes = await POST({
      json: () =>
        Promise.resolve({ kind: "budget", text: MONARCH_BUDGETS, mode: "apply", decisions: { "Config Import Rent": "merge" } }),
    } as never);
    expect(budgetRes.status).toBe(200);

    const goalRes = await POST({
      json: () =>
        Promise.resolve({ kind: "goal", text: MONARCH_GOALS, mode: "apply", decisions: { "Config Import Fund": "create" } }),
    } as never);
    expect(goalRes.status).toBe(200);

    const { data: aBudgets } = await admin
      .from("budgets")
      .select("category, monthly_limit, group_name")
      .eq("user_id", idA)
      .eq("category", "Config Import Rent");
    expect(aBudgets).toHaveLength(1);
    expect(Number(aBudgets![0].monthly_limit)).toBe(2000);

    const { data: aGoals } = await admin
      .from("goals")
      .select("name, import_ref")
      .eq("user_id", idA)
      .eq("import_ref", "config-goal-1");
    expect(aGoals).toHaveLength(1);
  });

  it("re-import is idempotent and never creates duplicates", async () => {
    authContext = { user: { id: idA }, supabase: clientA };
    await POST({
      json: () =>
        Promise.resolve({ kind: "budget", text: MONARCH_BUDGETS, mode: "apply", decisions: { "Config Import Rent": "merge" } }),
    } as never);
    const { data: rows } = await admin
      .from("budgets")
      .select("id")
      .eq("user_id", idA)
      .eq("category", "Config Import Rent");
    expect(rows).toHaveLength(1);
  });

  it("never lets user B touch user A's budgets or goals", async () => {
    authContext = { user: { id: idB }, supabase: clientB };
    await POST({
      json: () =>
        Promise.resolve({ kind: "budget", text: MONARCH_BUDGETS, mode: "apply", decisions: { "Config Import Rent": "merge" } }),
    } as never);

    const { data: aRows } = await admin
      .from("budgets")
      .select("category")
      .eq("user_id", idA)
      .eq("category", "Config Import Rent");
    // User A's budget still belongs to A; B got a fresh row of their own.
    expect(aRows).toHaveLength(1);
    const { data: bRows } = await admin
      .from("budgets")
      .select("category")
      .eq("user_id", idB)
      .eq("category", "Config Import Rent");
    expect(bRows).toHaveLength(1);
  });
});