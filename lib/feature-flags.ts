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
  /**
   * Phase 6. Off by default until `20260730190000_saved_reports.sql` is applied
   * to the live project: the page reads `saved_reports`, and reading a table
   * that does not exist yet is a 500, not a graceful degrade. Flip this to
   * `true` in the same change that confirms the migration landed — or set
   * `FUNDFLOW_FEATURE_FLAGS=reportsPage` to release it per-deployment first.
   */
  reportsPage: false,
  /**
   * Phase 7. Off by default until `20260730200000_goals_v2.sql` is applied.
   * Unlike `reportsPage` this does not gate a *new* page: `/goals` and
   * `/budget` are already released, and both would start reading
   * `goal_accounts` / `goal_progress_events` the moment this is on. With it
   * off they behave exactly as they did before Phase 7, so a deployment that
   * has not run the migration keeps working instead of 500ing two live pages.
   */
  goalsV2: false,
  /**
   * Phase 8. Off by default. No migration is involved — widget layout lives in
   * the existing `profiles.dashboard_prefs` JSON — so this can be flipped as
   * soon as the grid has been reviewed. It gates a behaviour change rather
   * than a schema one: turning it on makes the widget grid the dashboard's
   * landing view. Monitor, Plan, and Wealth stay reachable from the same
   * toolbar either way.
   */
  dashboardWidgets: false,
  /**
   * Phase 9A. Off by default until `20260730210000_investments.sql` is
   * applied: the page and the daily cron's investment sync both read/write
   * `securities`, `holdings`, and `holding_snapshots`, and the cron write
   * would fail on every run without the migration. `sync_jobs.job_type`
   * (same migration) is also required — the stale-data banners on Dashboard,
   * Budget, Cash Flow, and Recurring would otherwise read a fresh
   * investments-only sync as "the bank sync is up to date" once this is on.
   */
  investmentsPage: false,
  /**
   * Phase 10. Off by default. No migration is involved — the page reads only
   * existing accounts/manual_accounts/transactions through the canonical
   * projection — so this is purely a review gate, the same shape as
   * `dashboardWidgets`.
   */
  forecastingPage: false,
  /**
   * Phase 11. Off by default until `20260730230000_advice.sql` is applied:
   * the page reads/writes `advice_progress` and the new `profiles`
   * preference columns, and the route would 500 on every request without it.
   */
  advicePage: false,
  /**
   * Phase 12. Off by default until `20260730240000_manual_transactions_receipts.sql`
   * is applied: unlike the other Phase-9-through-11 flags, this one gates an
   * ALREADY-RELEASED page. /transactions is always reachable, and this flag
   * only decides whether its query selects the new `manual_account_id`/
   * `source` columns and whether the Add Transaction / Columns controls
   * render — with it off the ledger behaves exactly as it did before Phase 12
   * instead of 500ing on every visit to a live page.
   */
  transactionsParity: false,
  /**
   * Phase 13. Off by default until `20260730250000_profile_and_tags.sql` is
   * applied. Like `transactionsParity`, this gates an ALREADY-LIVE page:
   * /settings is always reachable, and the new Profile/Display/Tags sections
   * are the only ones that read the new profile columns or `user_tags` — the
   * rest (Security, Institutions, Categories, Merchants, Rules, Household,
   * Integrations, Data) use tables that already existed and work with this
   * off. With it off those three sections redirect to Institutions instead
   * of querying columns that don't exist yet.
   */
  settingsIa: false,
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
