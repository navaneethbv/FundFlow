/**
 * Pure onboarding contracts. The persisted value lives beside the existing
 * dashboard preferences so this checklist does not need a new migration.
 */

export const ONBOARDING_VERSION = "2026-10-03";

export const ONBOARDING_STEP_KEYS = [
  "connectBank",
  "confirmPayday",
  "seedBudget",
  "chooseAlerts",
  "enableMfa",
] as const;

export type OnboardingStepKey = (typeof ONBOARDING_STEP_KEYS)[number];

export interface OnboardingPrefs {
  dismissed?: boolean;
  tourStep?: number;
}

export interface OnboardingStatus {
  connectBank: boolean;
  confirmPayday: boolean;
  seedBudget: boolean;
  chooseAlerts: boolean;
  enableMfa: boolean;
}

export function parseOnboardingPrefs(raw: unknown): OnboardingPrefs {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const value = raw as Record<string, unknown>;
  const tourStep = value.tourStep;
  return {
    dismissed: value.dismissed === true,
    ...(typeof tourStep === "number" && Number.isInteger(tourStep) && tourStep >= 0
      ? { tourStep }
      : {}),
  };
}

export function mergeOnboardingPrefs(
  existing: unknown,
  patch: OnboardingPrefs,
): Record<string, unknown> {
  const root =
    typeof existing === "object" && existing !== null && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};
  const current = parseOnboardingPrefs(root.onboarding);
  return {
    ...root,
    onboarding: { ...current, ...patch },
  };
}

export function completedOnboardingCount(status: OnboardingStatus): number {
  return ONBOARDING_STEP_KEYS.filter((key) => status[key]).length;
}

export function onboardingTourIndex(
  prefs: OnboardingPrefs,
  status: OnboardingStatus,
): number {
  const firstIncomplete = ONBOARDING_STEP_KEYS.findIndex((key) => !status[key]);
  const fallback = firstIncomplete === -1 ? 0 : firstIncomplete;
  return Math.min(
    Math.max(prefs.tourStep ?? fallback, 0),
    ONBOARDING_STEP_KEYS.length - 1,
  );
}
