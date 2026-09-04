import type { SupabaseClient } from "@supabase/supabase-js";

export interface AccountsPagePreferences {
  hiddenIds?: string[];
  order?: string[];
}

/** Persist account visibility and ordering without clobbering sibling preferences. */
export async function persistAccountPreferences(
  supabase: SupabaseClient,
  prefs: AccountsPagePreferences,
): Promise<void> {
  const { data, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!data.user) throw new Error("Sign in again to save account preferences.");

  const { error } = await supabase.rpc("update_account_preferences", {
    p_accounts_page: prefs,
  });
  if (error) throw error;
}
