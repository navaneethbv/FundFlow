/**
 * Server-evaluated flags for pages that are built but not yet released.
 *
 * A flag only ever decides whether a finished surface is reachable. It must
 * never gate authentication, MFA, RLS scoping, or audit writes — those run
 * identically whether a flag is on or off, so a stray flag can never widen
 * access.
 */

/** Every known flag and its shipped default. */
export const FEATURE_FLAG_DEFAULTS = {
  accountsPage: true,
  cashFlowPage: true,
  budgetPage: true,
  recurringPage: true,
  reportsPage: true,
  goalsV2: true,
  dashboardWidgets: true,
  investmentsPage: true,
  forecastingPage: true,
  advicePage: true,
  transactionsParity: true,
  settingsIa: true,
} as const;

export type FeatureFlag = keyof typeof FEATURE_FLAG_DEFAULTS;

export const FEATURE_FLAG_ENV = "FUNDFLOW_FEATURE_FLAGS";

/** Only the one variable is read, so tests can pass a bare object. */
export type FeatureFlagEnv = Record<string, string | undefined>;

function enabledSet(env: FeatureFlagEnv): Set<string> {
  return new Set(
    (env[FEATURE_FLAG_ENV] ?? "")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean),
  );
}

/**
 * True when the flag is on for this deployment. Unknown names in the env var
 * are ignored rather than throwing, so a typo cannot take a deployment down.
 */
export function isFeatureEnabled(flag: FeatureFlag, env: FeatureFlagEnv = process.env): boolean {
  return FEATURE_FLAG_DEFAULTS[flag] || enabledSet(env).has(flag);
}

/** The full resolved map, for pages that branch on several flags at once. */
export function resolveFeatureFlags(env: FeatureFlagEnv = process.env): Record<FeatureFlag, boolean> {
  const on = enabledSet(env);
  const resolved = {} as Record<FeatureFlag, boolean>;
  for (const flag of Object.keys(FEATURE_FLAG_DEFAULTS) as FeatureFlag[]) {
    resolved[flag] = FEATURE_FLAG_DEFAULTS[flag] || on.has(flag);
  }
  return resolved;
}
