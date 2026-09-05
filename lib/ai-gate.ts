import type { SupabaseClient } from "@supabase/supabase-js";
import { isAiProviderConfigured } from "@/lib/ai-provider";

export type AiConsentResult =
  | { allowed: true }
  | { allowed: false; reason: "unconfigured" | "disabled" | "unavailable" };

/**
 * Evaluates double-consent for AI features (ai_settings.enabled AND
 * profiles.ai_export_enabled), strictly failing closed on missing profile or query error.
 */
export async function resolveAiConsent(
  supabase: SupabaseClient,
  userId: string,
): Promise<AiConsentResult> {
  if (!isAiProviderConfigured()) {
    return { allowed: false, reason: "unconfigured" };
  }

  try {
    const [{ data: settings, error: settingsError }, { data: profile, error: profileError }] =
      await Promise.all([
        supabase.from("ai_settings").select("enabled").eq("user_id", userId).maybeSingle(),
        supabase.from("profiles").select("ai_export_enabled").eq("id", userId).maybeSingle(),
      ]);

    if (settingsError || profileError) {
      return { allowed: false, reason: "unavailable" };
    }

    if (settings?.enabled !== true || !profile || profile.ai_export_enabled === false) {
      return { allowed: false, reason: "disabled" };
    }

    return { allowed: true };
  } catch {
    return { allowed: false, reason: "unavailable" };
  }
}

/**
 * Same double-consent gate for navigation links, failing closed.
 */
export async function isAskAiAvailable(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const result = await resolveAiConsent(supabase, userId);
  return result.allowed;
}
