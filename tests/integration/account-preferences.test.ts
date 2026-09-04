import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { persistAccountPreferences } from "@/lib/account-preferences";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SECRET_KEY;
const run = Boolean(
  url &&
    publishable &&
    secret &&
    process.env.RUN_ACCOUNT_PREFERENCES_INTEGRATION === "1",
);
const suite = run ? describe : describe.skip;

suite("AccountPreferences JSONB persistence", () => {
  if (!run) return;

  const admin = createClient(url!, secret!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const stamp = Date.now();
  const email = `account-preferences-${stamp}@example.com`;
  const password = "Password123!";
  let userId = "";
  let ownerClient: SupabaseClient;

  beforeAll(async () => {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    userId = data.user.id;

    ownerClient = createClient(url!, publishable!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: signInError } = await ownerClient.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError) throw signInError;

    const { error: seedError } = await admin
      .from("profiles")
      .update({
        dashboard_prefs: {
          sidebarCollapsed: true,
          hideDebt: false,
        },
      })
      .eq("id", userId);
    if (seedError) throw seedError;
  });

  afterAll(async () => {
    if (userId) await admin.auth.admin.deleteUser(userId);
  });

  it("atomically updates accountsPage without clobbering sibling preferences", async () => {
    await persistAccountPreferences(ownerClient, {
      hiddenIds: ["account-2"],
      order: ["account-2", "account-1"],
    });

    const { data, error } = await ownerClient
      .from("profiles")
      .select("dashboard_prefs")
      .eq("id", userId)
      .single();
    expect(error).toBeNull();
    expect(data?.dashboard_prefs).toEqual({
      sidebarCollapsed: true,
      hideDebt: false,
      accountsPage: {
        hiddenIds: ["account-2"],
        order: ["account-2", "account-1"],
      },
    });
  });
});
