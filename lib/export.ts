import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The privacy-safe export contract shared by the CSV and JSON endpoints:
 * date / merchant / amount / category only — no account numbers, tokens, or
 * identifiers. Queries run with the caller's RLS-scoped client and respect
 * the profile's ai_export_enabled opt-out.
 */

export interface ExportRow {
  date: string;
  merchant: string;
  amount: number;
  category: string;
}

export type ExportFetchResult =
  | { allowed: false }
  | { allowed: true; rows: ExportRow[] };

/**
 * Resolve the `ai_export_enabled` opt-out for a user, failing closed.
 *
 * A missing profile row or a failed profile read denies the export instead of
 * silently allowing it. The export routes already wrap their work in
 * try/catch, so a read error here surfaces as the route's explicit error
 * response; a missing profile returns `false` and the route answers 403.
 */
async function readExportPreference(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("ai_export_enabled")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!profile) return false;
  return profile.ai_export_enabled !== false;
}

/**
 * The `ai_export_enabled` opt-out on its own, for exports that build their own
 * row set (the Reports CSV filters the canonical projection rather than reading
 * `transactions` directly) but must still honour the same gate.
 */
export async function isExportAllowed(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  return readExportPreference(supabase, userId);
}

export async function fetchPrivacySafeRows(
  supabase: SupabaseClient,
  userId: string,
): Promise<ExportFetchResult> {
  if (!(await readExportPreference(supabase, userId))) {
    return { allowed: false };
  }

  // Explicit user scoping: redundant under the RLS-bound client, but this
  // function is also called with the service client for API-token requests,
  // where this filter is the only thing standing between users.
  const { data: txns, error } = await supabase
    .from("transactions")
    .select("date, merchant_name, name, amount, pfc_primary, pfc_detailed")
    .eq("user_id", userId)
    .order("date", { ascending: false });
  if (error) throw error;

  const rows: ExportRow[] = (txns ?? []).map((t) => ({
    date: t.date as string,
    merchant: (t.merchant_name ?? t.name ?? "") as string,
    amount: t.amount as number,
    category: (t.pfc_detailed ?? t.pfc_primary ?? "") as string,
  }));
  return { allowed: true, rows };
}
