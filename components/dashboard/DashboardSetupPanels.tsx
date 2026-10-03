import OnboardingChecklist from "@/components/onboarding/OnboardingChecklist";
import WhatsNewPanel from "@/components/onboarding/WhatsNewPanel";
import { loadOnboardingPageData } from "@/lib/onboarding-data";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { hasSeenReleaseHighlights, RELEASE_HIGHLIGHTS } from "@/lib/release-highlights";
import type { SupabaseClient } from "@supabase/supabase-js";

async function OnboardingPanel({
  supabase,
  userId,
}: Readonly<{ supabase: SupabaseClient; userId: string }>) {
  const onboarding = await loadOnboardingPageData(supabase, userId);
  return <OnboardingChecklist initial={onboarding} />;
}

export default function DashboardSetupPanels({
  supabase,
  userId,
  dashboardPrefs,
}: Readonly<{
  supabase: SupabaseClient;
  userId?: string;
  dashboardPrefs: unknown;
}>) {
  if (!userId) return null;
  const onboardingEnabled = isFeatureEnabled("onboardingTour");
  const prefs = dashboardPrefs && typeof dashboardPrefs === "object" && !Array.isArray(dashboardPrefs)
    ? (dashboardPrefs as Record<string, unknown>)
    : null;
  const releaseHighlights = isFeatureEnabled("releaseHighlights") && !hasSeenReleaseHighlights(prefs)
    ? RELEASE_HIGHLIGHTS
    : null;
  if (!onboardingEnabled && !releaseHighlights) return null;
  return (
    <>
      {onboardingEnabled && <OnboardingPanel supabase={supabase} userId={userId} />}
      {releaseHighlights && <WhatsNewPanel highlights={releaseHighlights} />}
    </>
  );
}
