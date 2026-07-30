import type { SupabaseClient } from "@supabase/supabase-js";
import { isAiProviderConfigured } from "@/lib/ai-provider";

/**
 * Same double-consent gate as /api/ai/ask (ai_settings.enabled AND
 * profiles.ai_export_enabled), but two cheap column selects instead of
 * fetchPrivacySafeRows's full export-row query — this is only used to
 * decide whether to show a nav link, not to fetch AI grounding data.
 */
export async function isAskAiAvailable(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  if (!isAiProviderConfigured()) return false;

  const [{ data: settings }, { data: profile }] = await Promise.all([
    supabase.from("ai_settings").select("enabled").eq("user_id", userId).maybeSingle(),
    supabase.from("profiles").select("ai_export_enabled").eq("id", userId).maybeSingle(),
  ]);

  return settings?.enabled === true && profile?.ai_export_enabled !== false;
}
