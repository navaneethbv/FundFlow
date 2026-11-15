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
  // Rollout: manually entered home and mortgage reconciliation.
  mortgageEquity: false,
  // Rollout: holdings with mixed broker basis and statement basis.
  investmentBasis: false,
  // Rollout: dated cash flows and unresolved return results.
  investmentXirr: false,
  // Rollout: account tax classifications and missing classifications.
  investmentTaxBuckets: false,
  /** Reference adoption 9.7: user-supplied constituent look-through. */
  // Rollout: manual holdings with incomplete constituent inputs.
  portfolioLookthrough: false,
  /** File drop, visible import steps, and keyboard focus transitions. */
  // Rollout: drop, keyboard and complete CSV import.
  importWizard: false,
  /** Read-only CSV diagnostics; requires importProfiles. */
  // Rollout: malformed, clean and duplicate CSV files.
  importPreflight: false,
  /** Saved CSV layouts; requires the import-profiles migration and acceptance. */
  // Rollout: save and reuse layouts with owner isolation.
  importProfiles: false,
  /** Read-only committed batch history; requires the history migration. */
  // Rollout: row counts and access isolation for committed batches.
  importHistory: false,
  /** Guarded removal of a committed import batch; requires importHistory. */
  // Rollout: repeat undo and ledger consistency.
  importUndo: false,
  // Rollout: notification rules, preferences and stable subject keys.
  insightGenerators: false,
  // Rollout: insight feed filtering and removal.
  insightsFeed: false,
  // Rollout: preview, applying rules and reapplying to older transactions.
  compoundRules: false,
  // Rollout: per-owner run log and retention.
  ruleRunHistory: false,
  // Rollout: confirmation, skip and duplicate handling.
  ruleSuggestions: false,
  // Rollout: detail and annotation round-trips.
  transactionDetails: false,
  /** Keyboard movement and row actions in the transaction ledger. */
  // Rollout: keyboard-only ledger navigation and focus restoration.
  ledgerKeyboardNavigation: false,
  /** Multi-row transaction edits from the ledger toolbar. */
  // Rollout: multi-row update, cancellation and owner checks.
  bulkEdit: false,
  /** Single-row inverse actions with an accessible undo toast. */
  // Rollout: concurrent edits and previous-value restoration.
  undoToasts: false,
  /** User supplied loan schedules and amortization projections. */
  // Rollout: zero-interest and early-payoff schedules.
  amortizationEngine: false,
  /** Detail schedule and strategy comparison on the debt page. */
  // Rollout: loan schedule and scenario parity.
  loanDetails: false,
  /**
   * Plaid Liabilities is a separately billed provider call.
   * Keep the daily cron call opt-in until quota and product access are approved.
   */
  // Rollout: confirm the separately billed Plaid Liabilities call and quota.
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
  /** Reference adoption 10.2: user-entered, seeded percentile projections. */
  // Rollout: reproducible bounds and projection copy.
  forecastingMonteCarlo: false,
  /** Reference adoption 12.1: accessible household-owner attribution dots. */
  // Rollout: mixed-owner household rendering and accessible owner labels.
  ownerAttributionDots: false,
  /** Reference adoption 12.2: aggregate-only household reports role. */
  // Rollout: membership isolation and a discoverable report link.
  householdReportsOnly: false,
  /** Reference adoption 12.3: read-only scoped MCP projections. */
  // Rollout: scoped tokens and truncation through the aggregates REST route.
  mcpEndpoint: false,
  /** Reference adoption 13.1: resumable first-run setup checklist and tour. */
  // Rollout: fresh-account tour completion and dismissal.
  onboardingTour: false,
  /** Reference adoption 13.2: versioned in-app release highlights. */
  // Rollout: current release content and first-visit dismissal.
  releaseHighlights: false,
  /** Reference adoption 13.3: pointer and keyboard layout controls. */
  // Rollout: preference persistence and mobile widget order.
  dashboardWidgetLayout: false,
  /** Reference adoption 13.4: income-to-savings waterfall on Cash Flow. */
  // Rollout: chart and table parity for both positive and negative cash flow.
  cashFlowWaterfall: false,
  /** Reference adoption 13.6: private PDF statement vault and coverage grid. */
  // Rollout: upload, signed read, and erasure from private storage.
  statementVault: false,
  /** Reference adoption 13.7: goal progress ring, status, and projection. */
  // Rollout: zero-target and completed-goal rendering.
  goalVisuals: false,
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
  /**
   * Backup restore (features.md #5).
   * Disabled until the restore redesign lands. Restoring provider-synced tables
   * (like accounts) cascades across the schema and fails on missing plaid_items foreign keys.
   * Only user-authored config should be restorable in-app.
   */
  // Rollout: retire the current restore path once the replacement format and migration plan are accepted.
  backupRestore: false,
  /**
   * Persistent transaction review (PR #166).
   * Off by default until migration is deployed and acceptance tests pass.
   */
  // Rollout: manual entry, audit and concurrent annotation changes.
  transactionReview: false,
  /** Reference adoption 2.1: owner review of suspect raw observations. */
  // Rollout: evidence, resolution, and correction provenance.
  balanceQualityReview: false,
  /** Reference adoption 2.2: all bank connections and their recovery action. */
  // Rollout: repair, partial sync, and stale health across real institution types.
  connectionHealth: false,
  /** Reference adoption 2.3: durable source labels for account history. */
  // Rollout: derived vs. imported history badges.
  historyProvenance: false,
  /** Reference adoption 3.1: funding across the next three declared pay periods. */
  // Rollout: paydays crossing holidays, leap days and year boundaries.
  paycheckPlanner: false,
  /** Reference adoption 3.2: user-confirmed paydays, never silently inferred. */
  // Rollout: validate and persist each supported frequency.
  paydaySettings: false,
  /** Reference adoption 3.3: monthly budget pace, separate from cash. */
  // Rollout: zero spend, overspend, and end-of-month states.
  budgetDailyAllowance: false,
  /** Reference adoption 3.4: recurring bills list, calendar, and paycheck views. */
  // Rollout: all supported list and calendar views.
  billsViews: false,
  /** Reference adoption 3.5: confirmed recurring price-change history. */
  // Rollout: false positives, skipped charges and recurring streams.
  recurringPriceHistory: false,
  /** Reference adoption 3.6: user-authored subscription quick-add catalog. */
  // Rollout: deduplication between manual and inferred subscriptions.
  subscriptionCatalog: false,
  /** Reference adoption 11.1: membership and card value terms model. */
  // Rollout: membership data migrations and owner scope.
  membershipCardValueModel: false,
  /** Reference adoption 11.2: local membership and card value calculation. */
  // Rollout: annual fee, credit limits and redemption examples.
  membershipCardValueCalculation: false,
  /** Reference adoption 11.3: user-maintained membership terms entry. */
  // Rollout: manual terms update and reconciliation.
  membershipTermsEntry: false,
  /** Reference adoption 5.4: user-authored Plaid detailed-category mappings. */
  // Rollout: mapping precedence and tenant isolation.
  plaidCategoryMappings: false,
  /** Reference adoption 5.5: local, bounded Bayes categorization. */
  // Rollout: feedback capture and low-confidence fallback.
  bayesCategorization: false,
  /** Reference adoption 5.6: merchant directory and merge workflow. */
  // Rollout: merchant merge and name changes without duplicate spend.
  merchantsPage: false,
  /** Reference adoption 6.5: scheduled rows projected above the ledger. */
  // Rollout: projection marker and separation from posted totals.
  projectedLedgerRows: false,
  /** Reference adoption 6.6: transaction list/calendar view switcher. */
  // Rollout: viewer timezone and date-only rows.
  transactionCalendar: false,
  /** Reference adoption 6.7: keyboard and floating quick-add transaction. */
  // Rollout: keyboard submission and duplicate-submit prevention.
  quickAddTransaction: false,
  /** Reference adoption 6.8: named collections across categories, built on tags. */
  // Rollout: membership edits and cross-user access checks.
  transactionCollections: false,
  /** Reference adoption 7.1: move planned money between category budgets. */
  // Rollout: atomic movement, reversal and ledger integrity.
  budgetMoves: false,
  /** Reference adoption 7.2: warn when the budget allocates more than planned income. */
  // Rollout: annualized-income and mixed-currency fixtures.
  budgetOverAllocation: false,
  /** Reference adoption 7.3: guided first budget from trailing averages. */
  // Rollout: saved progress and cancellation.
  budgetSetupWizard: false,
  /** Reference adoption 9.1: typed manual assets with estimated growth. */
  // Rollout: valuation and classification for each supported asset type.
  typedManualAssets: false,
  /** Reference adoption 9.2: valuation provenance and owned share in net worth. */
  // Rollout: joint ownership and household scope.
  assetOwnership: false,
  /** Reference adoption 2.4: explainable duplicate, refund, and transfer suggestions. */
  // Rollout: manual confirmation, decline and rerun.
  explainableMatchSuggestions: false,
  /** Reference adoption 4.3: the five-step weekly review ritual and streak. */
  // Rollout: week boundaries, low-data states, and first run.
  weeklyReview: false,
  /** Reference adoption 8.3: owner-scoped private lending balances and payments. */
  // Rollout: principal, payments and date-boundary examples.
  privateLending: false,
  /** Reference adoption 8.4: editable rent-buy, emergency-fund, and compound tools. */
  // Rollout: projection inputs and output checks on small screens.
  planningCalculators: false,
  /**
   * Plaid time of day on transactions. Requires
   * `20261025090000_transaction_datetime.sql`: with it on, sync writes
   * `datetime`/`authorized_datetime` and bill search reads them, so turning it
   * on before the migration is applied would fail every sync.
   */
  // Rollout: apply the timestamp migration and verify existing rows and provider fallback.
  transactionTimes: false,
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
