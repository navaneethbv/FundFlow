import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { parsePaydaySettings, type PaydaySettings } from "@/lib/payday";
export async function loadPaydaySettings(
  client: SupabaseClient,
  userId: string,
): Promise<PaydaySettings | null> {
  if (!isFeatureEnabled("paydaySettings")) return null;
  const { data, error } = await client
    .from("payday_settings")
    .select("cadence,anchor_date,amount,day1,day2")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const settings = parsePaydaySettings({
    cadence: data.cadence,
    anchorDate: data.anchor_date,
    amount: Number(data.amount),
    day1: data.day1,
    day2: data.day2,
  });
  if (!settings) throw new Error("Invalid saved payday settings");
  return settings;
}
