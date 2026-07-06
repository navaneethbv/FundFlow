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

export async function fetchPrivacySafeRows(
  supabase: SupabaseClient,
  userId: string,
): Promise<ExportFetchResult> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("ai_export_enabled")
    .eq("id", userId)
    .single();
  if (profile && profile.ai_export_enabled === false) {
    return { allowed: false };
  }

  const { data: txns, error } = await supabase
    .from("transactions")
    .select("date, merchant_name, name, amount, pfc_primary, pfc_detailed")
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
