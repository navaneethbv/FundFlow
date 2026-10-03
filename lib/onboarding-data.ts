import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { parseOnboardingPrefs, type OnboardingPrefs, type OnboardingStatus } from "@/lib/onboarding";
import { loadPaydaySettings } from "@/lib/payday-data";

export interface OnboardingStepData {
  key: keyof OnboardingStatus;
  label: string;
  description: string;
  href: string;
  complete: boolean;
  available: boolean;
}

export interface OnboardingPageData {
  prefs: OnboardingPrefs;
  status: OnboardingStatus;
  steps: OnboardingStepData[];
}

/**
 * Read only the bounded rows needed to decide whether first-run setup is
 * complete. No transaction rows or provider secrets are loaded.
 */
export async function loadOnboardingPageData(
  client: SupabaseClient,
  userId: string,
): Promise<OnboardingPageData> {
  const paydayEnabled = isFeatureEnabled("paydaySettings");
  const [{ data: profile }, { data: plaidItems }, { data: budgets }, { data: alerts }, payday] = await Promise.all([
    client.from("profiles").select("dashboard_prefs,mfa_enrolled").eq("id", userId).maybeSingle(),
    client.from("plaid_items").select("id").eq("user_id", userId).limit(1),
    client.from("budgets").select("id").eq("user_id", userId).limit(1),
    client.from("alert_preferences").select("user_id").eq("user_id", userId).maybeSingle(),
    paydayEnabled ? loadPaydaySettings(client, userId) : Promise.resolve(null),
  ]);

  const status: OnboardingStatus = {
    connectBank: (plaidItems ?? []).length > 0,
    confirmPayday: payday !== null,
    seedBudget: (budgets ?? []).length > 0,
    chooseAlerts: alerts !== null,
    enableMfa: profile?.mfa_enrolled === true,
  };
  const prefs = parseOnboardingPrefs(profile?.dashboard_prefs && typeof profile.dashboard_prefs === "object"
    ? (profile.dashboard_prefs as Record<string, unknown>).onboarding
    : null);

  return {
    prefs,
    status,
    steps: [
      {
        key: "connectBank",
        label: "Connect a bank",
        description: "Bring in balances and transactions through Plaid.",
        href: "/accounts",
        complete: status.connectBank,
        available: true,
      },
      {
        key: "confirmPayday",
        label: "Confirm your payday",
        description: "Use an expected pay schedule for planning guidance.",
        href: paydayEnabled ? "/settings/payday" : "/settings?section=institutions",
        complete: status.confirmPayday,
        available: paydayEnabled,
      },
      {
        key: "seedBudget",
        label: "Seed a budget",
        description: "Give each month a plan before spending starts.",
        href: "/budget",
        complete: status.seedBudget,
        available: true,
      },
      {
        key: "chooseAlerts",
        label: "Choose alerts",
        description: "Keep the planning signals that matter to you.",
        href: "/notifications",
        complete: status.chooseAlerts,
        available: true,
      },
      {
        key: "enableMfa",
        label: "Enable MFA",
        description: "Protect financial data with an authenticator.",
        href: "/settings?section=security",
        complete: status.enableMfa,
        available: true,
      },
    ],
  };
}
