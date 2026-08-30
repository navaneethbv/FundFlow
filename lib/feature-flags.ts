/**
 * Server-evaluated flags for pages that are built but not yet released.
 *
 * A flag only ever decides whether a finished surface is reachable. It must
 * never gate authentication, MFA, RLS scoping, or audit writes — those run
 * identically whether a flag is on or off, so a stray flag can never widen
 * access.
 *
 * `FUNDFLOW_FEATURE_FLAGS` is a comma-separated override list: `reportsPage`
 * forces a flag on, and `-reportsPage` forces it off.
 */

/** Every known flag and its shipped default. */
export const FEATURE_FLAG_DEFAULTS = {
  /**
   * Plaid Liabilities is a separately billed provider call.
   * Keep the daily cron call opt-in until quota and product access are approved.
   */
  liabilitiesSync: false,
  accountsPage: true,
  cashFlowPage: true,
  budgetPage: true,
  recurringPage: true,
  /**
   * Phase 6. Released: `20260730190000_saved_reports.sql` is applied, so the
   * page's `saved_reports` reads resolve. A deployment that somehow lags the
   * migration would 500 on /reports rather than degrade — re-gate with
   * `FUNDFLOW_FEATURE_FLAGS=-reportsPage`, not by editing the page.
   */
  reportsPage: true,
  /**
   * Phase 7. Released: `20260730200000_goals_v2.sql` is applied. This one does
   * not gate a *new* page — `/goals` and `/budget` were already live and both
   * now read `goal_accounts` / `goal_progress_events`, so a deployment missing
   * the migration would break two live pages, not one new one.
   */
  goalsV2: true,
  /**
   * Phase 8. Released. No migration is involved — widget layout lives in the
   * existing `profiles.dashboard_prefs` JSON. This gates a behaviour change
   * rather than a schema one: with it on, the widget grid is the dashboard's
   * landing view. Monitor, Plan, and Wealth stay reachable from the same
   * toolbar either way.
   */
  dashboardWidgets: true,
  /**
   * Phase 9A. Released: `20260730210000_investments.sql` is applied, covering
   * `securities`, `holdings`, `holding_snapshots`, and the `sync_jobs.job_type`
   * column. `job_type` is the load-bearing one — without it the stale-data
   * banners on Dashboard, Budget, Cash Flow, and Recurring would read a fresh
   * investments-only sync as "the bank sync is up to date".
   */
  investmentsPage: true,
  /**
   * Phase 10. Released. No migration is involved — the page reads only
   * existing accounts/manual_accounts/transactions through the canonical
   * projection — so this was purely a review gate, the same shape as
   * `dashboardWidgets`.
   */
  forecastingPage: true,
  /**
   * Phase 11. Released: `20260730230000_advice.sql` is applied, so the page's
   * `advice_progress` and `profiles.advice_profile` reads/writes resolve.
   */
  advicePage: true,
  /**
   * Phase 12. Released: `20260730240000_manual_transactions_receipts.sql` is
   * applied. Unlike the Phase-9-through-11 flags this gates an ALREADY-LIVE
   * page — /transactions is always reachable, and this flag only decides
   * whether its query selects `manual_account_id`/`source` and whether the
   * Add Transaction / Columns controls render.
   */
  transactionsParity: true,
  /**
   * Phase 13. Released: `20260730250000_profile_and_tags.sql` is applied. Like
   * `transactionsParity` this gates an ALREADY-LIVE page: /settings is always
   * reachable, and the Profile/Display/Tags sections are the only ones reading
   * the new profile columns or `user_tags`. The rest (Security, Institutions,
   * Categories, Merchants, Rules, Household, Integrations, Data) predate it.
   */
  settingsIa: true,
} as const;

export type FeatureFlag = keyof typeof FEATURE_FLAG_DEFAULTS;

export const FEATURE_FLAG_ENV = "FUNDFLOW_FEATURE_FLAGS";

/** Only the one variable is read, so tests can pass a bare object. */
export type FeatureFlagEnv = Record<string, string | undefined>;

interface FlagOverrides {
  on: Set<string>;
  off: Set<string>;
}

/**
 * A bare name forces the flag on; a `-` prefix forces it off. Force-off is
 * what makes the env var a kill switch: every default is currently `true`, so
 * without it the variable could only ever turn flags on and re-gating a broken
 * surface would need a code change and a redeploy.
 */
function parseOverrides(env: FeatureFlagEnv): FlagOverrides {
  const on = new Set<string>();
  const off = new Set<string>();
  for (const raw of (env[FEATURE_FLAG_ENV] ?? "").split(",")) {
    const name = raw.trim();
    if (!name) continue;
    if (name.startsWith("-")) off.add(name.slice(1));
    else on.add(name);
  }
  return { on, off };
}

function resolve(flag: FeatureFlag, overrides: FlagOverrides): boolean {
  if (overrides.off.has(flag)) return false;
  return FEATURE_FLAG_DEFAULTS[flag] || overrides.on.has(flag);
}

/**
 * True when the flag is on for this deployment. Unknown names in the env var
 * are ignored rather than throwing, so a typo cannot take a deployment down.
 */
export function isFeatureEnabled(flag: FeatureFlag, env: FeatureFlagEnv = process.env): boolean {
  return resolve(flag, parseOverrides(env));
}

/** The full resolved map, for pages that branch on several flags at once. */
export function resolveFeatureFlags(env: FeatureFlagEnv = process.env): Record<FeatureFlag, boolean> {
  const overrides = parseOverrides(env);
  const resolved = {} as Record<FeatureFlag, boolean>;
  for (const flag of Object.keys(FEATURE_FLAG_DEFAULTS) as FeatureFlag[]) {
    resolved[flag] = resolve(flag, overrides);
  }
  return resolved;
}
