# Reference-repo feature adoption plan

Date: 2026-10-01.
Status: approved in scope by the owner.
Implementation is being delivered in grouped five-to-six feature PRs.
The current group is 5.4 to 5.6 and 6.5 to 6.7.
Companion documents:

- `docs/reviews/2026-10-01-finance-repository-feature-comparison.md`: independent source comparison with 27 pinned source links and acceptance conditions. Its findings are merged below.
- `docs/superpowers/plans/2026-10-01-reference-repo-implementation-prompt.md`: the prompt that drives implementation of this plan.

## Purpose

Eight open-source finance apps were read to find features and UI patterns worth bringing into FundFlow.
`we-promise/sure` was read most deeply, as requested.
FundFlow already covers most baseline features (Monarch-parity program, all fourteen phases shipped), so this plan lists real gaps, deepenings of existing features, UI and interaction patterns, and three suspected defects.

## Sources read

| Repo | Commit | Stack | License | Strongest ideas |
|---|---|---|---|---|
| we-promise/sure | `51192d0` / `97fa8a2` (both 2026-10-01) | Rails, Postgres | AGPL-3.0 | Bills pipeline, paycheck planner, loans, insights feed, rules and rule runs, import preflight, connection status, MCP, statements, budget move, bulk selection bar |
| orlandoc01/tallyo | `27220d6` (2026-09-29) | Rust, React, SQLite | Apache-2.0 | Balance review queue, connection review, scoped roles, aggregate-only MCP, Plaid category mapping editor, mobile sheets, owner dots |
| securo-finance/securo | `76065db` (2026-09-30) | FastAPI, Postgres, React | AGPL-3.0 | Asset growth rules, explainable match suggestions, import history, calendar view switcher, projected rows, quick add, onboarding tour, payees page, collections |
| gillespiejameson/personal-finance-tracker | `ddaa9f8` (2026-09-30) | Next.js, SQLite | MIT | Bank-file profiles, import undo, daily allowance, weekly ritual, explained anomalies, cash-flow waterfall, undo toasts |
| kxl3785/KevFin | `e83be1c` (2026-07-28) | Express, React | MIT | Fund look-through, cost-basis coverage, observed versus estimated history, Monte Carlo, tax buckets, rule suggestion after recategorize, per-page assumptions panel |
| Komediruzecki/token-circles | `a22a6a4` (2026-09-27) | SolidJS, CF Worker | AGPL-3.0 | Variable-rate loans, dated prepayments, rent-vs-buy, emergency fund and compound-interest calculators, spending heatmap, subscription catalog, lifestyle markers |
| tydude001/penny | `508877d` (2026-09-30) | Python | MIT | Membership and card value after fees, caps, credits and perks, anniversary-year accounting |
| lcsfls/achilles-financials | `0b59a7c` (2026-07-26) | Next.js, SQLite | none tracked | Valuation provenance, private lending, external-services disclosure, emergency fund excluded from FIRE |

`orlandoc01/tallyo` was listed twice in the request; it was read once.

### License rule

FundFlow is Apache-2.0.
Sure, Securo and Token Circles are AGPL-3.0, and Achilles has no tracked license (all rights reserved).
**No code, assets, copy or fixtures are copied from any of those four.**
Every item is a clean reimplementation from described behavior, in FundFlow's own idiom and tests.
MIT and Apache sources may be read more closely, but implementation is still original; any deliberate reuse keeps the notice and gets a specific license check.
Reference rates and prices in those repos (penny's card rates, Token Circles' subscription prices) are not facts FundFlow may present as current.

### Design rule for adopted UI

Adopt interaction patterns and information design, not the reference apps' visual styles.
FundFlow's established direction stays: `lib/themes.ts` palettes, the seven `--viz-*` slots, `components/ui/*` primitives, direct labels or a table twin on every chart, text never in series colour.
Every adopted UI must work at 375px and desktop, by keyboard, with visible focus, accessible names and passing contrast.

## Already in FundFlow (not re-planned)

Plaid `days_requested: 730`, payday-anchored safe-to-spend, recurring price-hike diff, avalanche and snowball payoff, linked transfers, sinking funds, receipts, splits, household (`owner`/`member`/`read_only`), API tokens, calendar feed, recurring calendar, CSV/OFX and Mint/Monarch/YNAB import with preview and commit, source-account mappings, tax export, deterministic forecasting, FIRE and life events, weekly PDF report, keyboard shortcuts and command palette, privacy toggle, bulk tag bar, mobile ledger list, bottom-sheet `Modal` placement, filter chips, budget Month/Year/Decade views with rollover and copy-last-month, dashboard customize drawer, duplicate/refund/transfer review decisions, rule dry-run preview and batch audit, Sankey, Wrapped, encrypted backup.

Verified corrections to the comparison report:
FundFlow rules are **single-condition** (`lib/rules-engine.ts`: one `matchType` of merchant, keyword, account or regex, plus an optional amount condition), so compound rules are a real gap.
`transactionReview` defaults to `false` in `lib/feature-flags.ts`; finish its release prerequisites (see `docs/TODO.md`) before building any second review surface.

## Workstream 0: suspected defects (verify first)

Each is a **hypothesis until reproduced**; reproduce before fixing.

- **0.1 Pending-row annotations lost on posting.**
  `lib/sync.ts:290-299` hard-deletes Plaid `removed` ids, and annotation tables in `supabase/migrations/20260723100000_phase_features.sql` cascade on delete.
  Reproduce with a sandbox pending transaction that gets a note, tag, override, split and review state, then post it.
  Fix: one RPC that re-points user-authored child rows to the posted row with the matching `pending_transaction_id` before deleting.
- **0.2 Broker rollup holdings double counted.**
  Check whether sum(holdings) reconciles to account balance in `lib/investment-sync.ts`; drop rollup rows only when a mismatch is observed (Tallyo `plaid_dedupe.rs` behavior).
- **0.3 Raw descriptor not requested.**
  Set `include_original_description`, store it in a nullable column, keep it out of every export and AI payload.

## Workstream 1: imports

- **1.1 Saved bank-file profiles (pft `import/profiles.ts`).**
  Owner-scoped header signature, column map, debit/credit or signed amount, sign convention, date format, skipped leading rows.
  Auto-select on signature match; ambiguous files still go to review; a profile is saved only after a successful commit.
- **1.2 Import preflight diagnostics (Sure `import/preflight.rb`).**
  Structured results before preview: unparsed dates, amount format, sign inference, delimiter, header row, duplicate rows, with row numbers.
- **1.3 Drop-zone and mapping wizard UI (pft `ImportDropzone`, `MappingWizard`, `ImportPreview`).**
  Drag a file anywhere on the import screen; the wizard names columns, previews parsed rows with dates and signs, then commits.
- **1.4 Import history (Securo `import-history.tsx`).**
  Read-only list of committed batches: file, profile, account, row counts added/skipped/flagged, committed at, by whom.
- **1.5 Guarded batch undo (pft `import/commit.ts`).**
  Undo deletes only rows attributable to that batch and refuses, with a reason, when later edits, splits, transfer links, reconciliations or provider records depend on them.
  Ships separately from 1.4 because it is a financial write.

## Workstream 2: data quality and connections

- **2.1 Balance-quality review queue (Tallyo `flagging.rs`, `BalanceReviewModal`).**
  Flag snapshots with implausible jumps, empty holdings, or price anomalies; keep the raw provider value and the last reliable value; show reason and affected dates side by side; user resolves accept or keep previous.
  A carried-forward value is labelled stale and never masquerades as current.
- **2.2 Consolidated connection health (Sure `provider_connection_status.rb`, Tallyo `ConnectionReviewQueue`).**
  One view separating reconnect-needed, sync error, and account-review-needed, with linked versus unlinked account counts and one recovery action each.
- **2.3 Observed versus estimated history (KevFin `observations.ts`).**
  Snapshot rows carry `provenance` (`observed`, `estimated`, `manual`); estimated values never overwrite observed ones and render visually distinct.
- **2.4 Explainable match suggestions (Securo `reconciliation_suggestion_service.py`).**
  Duplicate, refund and transfer suggestions show amount agreement, date distance, counterparty agreement and strategy, not one opaque score; accepted and declined decisions persist (FundFlow already persists decisions).

## Workstream 3: spending guidance and bills

- **3.1 Paycheck planner (Sure `paycheck_planner.rb`, `bills/paycheck.html.erb`).**
  Next three pay periods; each bill funded from the period it falls due in; bills larger than one paycheck reserved across earlier periods; due, reserved and remaining per period.
  Bridge window judged against cash on hand; an unknown balance never claims a shortfall.
- **3.2 Explicit payday configuration (pft `PaydayForm`).**
  User confirms or overrides detected paycheck cadence and next date; detected inflows never silently define paydays.
- **3.3 Budget-paced daily allowance (pft `budget/safeToSpend.ts`).**
  A separately labelled "budget left per day" next to the cash-based safe-to-spend, with payday and month-end context.
  The two formulas answer different questions; never substitute one for the other or subtract bills twice.
- **3.4 Bills views: list, calendar, paycheck (Sure `bills/_view_switcher`, `_month_pulse`).**
  Extend the Recurring page with a paycheck view and a month-pulse summary; side detail pane on desktop, sheet on mobile.
- **3.5 Confirmed price changes with history (Sure `price_change_detector.rb`).**
  Record a change only when the two latest paid occurrences each settled by one payment and agree on a new amount; `recurring_price_changes` table; auto streams update, user-declared streams only suggest.
- **3.6 Subscription catalog quick add (Token Circles `subscriptionCatalog.ts`).**
  Pick several common subscriptions at once with plan pills; prices are labelled "typical, edit me" and are FundFlow-authored, not copied; logos only from the existing `lib/merchant-logos.ts` set.

## Workstream 4: alerts, insights and review

- **4.1 New generators (Sure `insight/generators/*`, pft `anomalies/*`).**
  `new_merchant`, `double_charge` (adjacent pairs only), `category_spike` (pace versus trailing three full months), `merchant_spike`, `bill_overdue`, `savings_rate_change` (complete months only), `idle_cash` (monthly rotating dedupe key), `goal_reserve_depleted`.
  Each is pure, unit tested, explained in plain words with the numbers that triggered it, and toggled in `alert_preferences`.
- **4.2 Insights feed UI (Sure `insights/_insight_card`).**
  One feed with acknowledge and restore, priority ordering, and a reason line per card.
- **4.3 Weekly review ritual (pft `ritual/*`, `StepRail`).**
  Five-step `/review/weekly` with a progress rail: stale connections, review queue, budget pace (plus or minus five points), bills due in seven days, alerts; streak per user.

## Workstream 5: rules, categorization and merchants

- **5.1 Compound rules (Sure `rule/condition_filter/*`, `rule/action_executor/*`).**
  AND/OR groups over merchant, name, raw descriptor, account, amount, category, tag, notes, type; actions set category, set display name, add tags, exclude, mark as transfer, notify.
  Additive `conditions jsonb`, null for existing rules.
  An existing rule converts to an AND group of its match leaf **and** its amount predicate when one is set, so both predicates are preserved; until a user edits a rule, the legacy columns stay authoritative.
  Current rule ordering and first-match semantics are unchanged; a regression test runs every existing fixture through both the legacy and the group evaluator and requires identical results.
  Bounded work: maximum nesting depth 3, maximum 20 leaves per rule, a per-batch evaluation budget, all enforced in validation and in a check constraint; every regex leaf goes through `lib/regex-safety.ts`.
- **5.2 Rule run history (Sure `rule_run.rb`).**
  Per run: rule id, trigger (manual, sync, import), matched, changed, status, error; failures stay visible; per-transaction "changed by rule X" provenance.
- **5.3 Rule suggestion after recategorize (KevFin `RuleSuggestModal`).**
  After a manual category change, offer one rule from tickable AND conditions with a live count of matching transactions and an apply-to-past option.
- **5.4 Plaid category mapping editor (Tallyo `CategoryPlaidCodes`).**
  Per-user mapping of Plaid PFC detailed codes to FundFlow categories, applied before merchant rules.
- **5.5 Local Bayes categorizer (Sure `bayes_categorizer.rb`).**
  Per-user naive Bayes, add-one smoothing, 5,000-row cap, at least 20 rows and 2 categories, 0.7 confidence, uncategorized rows only, `source = 'bayes'`, user edits always win, no network call.
- **5.6 Merchants page and merge (Securo `payees.tsx`, Token Circles `Counterparties`, Sure `merchant/merger.rb`).**
  List with logo, total, count, last seen, category; detail with history; rename and merge A into B across overrides, rules and tags in one SQL function.

## Workstream 6: transactions UX

- **6.1 Detail pane and sheet (Tallyo `TransactionDetailsPane`, Sure drawer).**
  Desktop side pane keeps the list visible; mobile uses the existing `Modal placement="sheet"`.
- **6.2 Keyboard ledger navigation (Sure `list_keyboard_navigation_controller`).**
  `j`/`k` move, `Enter` opens detail, `x` selects, `c` category, `t` tags, `e` edit, `Escape` closes; listed in the shortcuts help; never fires inside inputs.
- **6.3 Bulk edit expansion (Sure `_selection_bar`, Tallyo `BulkEditSheet`, Securo `mobile-bulk-selection-actions`).**
  Extend `BulkTagBar` to category, display name, exclude, mark reviewed, add to collection; sticky selection bar on desktop, action sheet on mobile.
- **6.4 Undo toasts (pft `sonner`).**
  A toast primitive with Undo for reversible single actions (recategorize, exclude, tag, mark reviewed); announced via a polite live region.
  Undo replays a recorded inverse, and refuses with a message if the target changed since the action.
  Merchant merge (5.6), rule application, import commit and any multi-row write are **not** toast-undoable; they need durable inverse operations and conflict checks of their own.
- **6.5 Projected rows in the ledger (Securo `projected-transaction-badge`, Sure `_upcoming`).**
  Upcoming recurring items render above today with a "Projected" badge, excluded from every total.
- **6.6 View switcher with calendar heatmap (Securo `transaction-calendar-view`, Token Circles `D3HeatmapChart`).**
  List or calendar; calendar cells show daily spend intensity using a sequential `--viz-*` ramp, open the day's transactions, are keyboard navigable, and have a table twin; refunds and transfers follow canonical semantics; dates are viewer-local.
- **6.7 Quick add (Securo `quick-add-transaction`, Token Circles `Ctrl+Shift+T`).**
  Global shortcut and a mobile floating action to add a manual transaction through the existing atomic manual-entry RPC.
- **6.8 Collections (Securo `collections`).**
  Group transactions across categories into a named collection (trip, renovation) with a total and optional budget; built on tags if that is sufficient.

## Workstream 7: budgets

- **7.1 Move money between categories (Sure `budget_move_controller`).**
  Move an amount from one category budget to another for the period, recorded as an adjustment with history.
- **7.2 Over-allocation warning (Sure `_over_allocation_warning`).**
  Warn when budgeted totals exceed expected income for the period.
- **7.3 Budget setup wizard (Tallyo `BudgetSetupWizard`, pft `BudgetSetup`).**
  Guided first budget seeded from trailing averages, reusing the existing budget-seeding proposal.

## Workstream 8: debt, lending and calculators

- **8.1 Amortization engine (Sure `loan/*`, Token Circles `loanCalculator.ts`, KevFin `mortgage.ts`).**
  Pure `lib/amortization.ts`: monthly accrual, rate periods (interest at the rate in force when the period opened, payment sizing at the rate on the payment date), `reamortize` and `hold` strategies, dated extra and lump-sum prepayments, final payment capped, period cap that refuses rather than truncates.
  Fixtures for zero APR, leap dates, insufficient payment, rate change on a payment date; dates are `YYYY-MM-DD` strings, no UTC slicing.
- **8.2 Loan detail UI (Sure `loans`, `loan_payoff_chart`).**
  Schedule table, payoff chart with table twin, interest saved by an extra payment, comparison of strategies.
- **8.3 Private lending (Achilles `loans.ts`).**
  Money lent and money borrowed between people, optional interest accruing daily, payments applied to interest then principal, outstanding balance in net worth as receivable or payable.
- **8.4 Calculators (Token Circles `RentBuyCalculator`, `EmergencyFundCalculator`, `CompoundInterestCalculator`).**
  A Planning tools area with rent-versus-buy, emergency fund (seeded from real essential spend), and compound interest; every assumption editable and shown.

## Workstream 9: assets and investments

- **9.1 Typed manual assets with growth rules (Securo `asset_service.py`, Sure `property.rb`/`vehicle.rb`).**
  `asset_kind` (property, vehicle, other), `manual_account_values` history, percent or absolute growth per month or year with optional start date, materialized to today; no market-data feed.
  Depends on 2.3: every growth-derived value is stored with `provenance = 'estimated'`, labelled "Estimate" wherever shown, and never overwrites a user-entered or observed value.
- **9.2 Valuation provenance and ownership (Achilles property schema).**
  Value source, valuation date, purchase price and date, ownership percentage; net worth counts the owned share.
- **9.3 Mortgage-linked equity (KevFin `mortgage.ts`).**
  Link an 8.1 loan to a property so equity is value minus scheduled balance, historically too.
  A scheduled balance is an estimate and is labelled as one; an observed lender balance (Plaid or manual) always wins.
  Accounting boundary: net worth counts the mortgage once.
  If the mortgage already exists as a liability account (Plaid or manual), property equity is a presentation only and is never deducted again; a test asserts net worth is identical with and without the link.
- **9.4 Cost-basis provenance and coverage (KevFin).**
  Basis source (`reported`, `manual`, `imported`, `estimated`) and coverage percentage; gains computed on partial basis are labelled partial.
- **9.5 Money-weighted return XIRR (Sure `portfolio/xirr.rb`).**
  Beside TWR; Newton from 10% with bisection fallback; documented root choice.
- **9.6 Tax-treatment buckets (KevFin `taxBucket.ts`, Sure `tax_treatable.rb`).**
  From Plaid `subtype`, user overridable; allocation by bucket on Investments; feeds Forecasting.
- **9.7 Portfolio look-through engine (KevFin `allocation.ts`, Tallyo `portfolio/analysis.rs`).**
  Build the engine and UI (exposure by stock, sector, region with contributing holdings, unknown coverage, source and as-of date, world map with table twin) against **user-supplied or manually entered constituent weights** now.
  Any automated constituent feed (including SEC N-PORT) stays off until the owner records a data-source decision, the same gate as the benchmark item in `docs/TODO.md`.
  Weights must conserve; a fund and a direct holding of the same stock must not double count; keys are stable ids, never names.

## Workstream 10: planning and forecasting

- **10.1 Earmarked money excluded from FIRE capital (Achilles).**
  Funded emergency and sinking-fund goals are subtracted from FIRE starting capital with a visible line.
- **10.2 Monte Carlo projection (KevFin `forecastSim.ts`).**
  Seeded, reproducible, user-entered return and volatility only, percentile bands labelled "projection"; the three deterministic scenarios remain the default.
- **10.3 Lifestyle and milestone markers (Token Circles `lifestyleMarkers.ts`).**
  Vertical markers where the projection meets each target, label pill at the top, direct labels, no legend needed.
- **10.4 "How this is calculated" panels (KevFin `PageFaq`).**
  Per-page panel whose numbers are imported from the same constants the math uses, so it cannot drift.

## Workstream 11: membership and card value (penny)

- **11.1 Model.**
  Per membership and per card: fee, anniversary date, reward tiers with caps and eligibility, statement credits with expiry, user-valued perks.
  Separate the card's advantage over a baseline card from the benefit caused by the membership; never count one benefit in both.
- **11.2 Calculation.**
  Runs locally on canonical spend aggregates; measured rewards, projected rewards and subjective perks shown separately; low, base and high range; break-even spend; partial history and stale assumptions flagged; anniversary years, not calendar years.
  Refunds are netted against the eligible purchases they reverse (using FundFlow's existing refund links where present), so a returned purchase reduces eligible spend and earned rewards; transfers and card payments are excluded.
- **11.3 Terms entry.**
  User-maintained terms with a "confirmed on" date; no shipped rate catalog until a maintained update process exists.

## Workstream 12: household, access and agents

- **12.1 Owner attribution dots (Tallyo `OwnerDot`).**
  Household member colour dot on accounts and transactions, with an accessible name, never colour alone.
- **12.2 Aggregate-only household role (Tallyo roles).**
  A `reports_only` role that reads spending and cash-flow aggregates and no transaction rows; every household policy and `scripts/check-rls.sql` updated.
  Before building, define the permitted aggregates as a written allowlist: which fields (month, category, totals, counts), which filters (date range, category, scope), and a minimum group size so a filter cannot isolate one transaction.
  Aggregates come from a `security definer` function returning only allowlisted shapes, not from row grants.
  Proof required, each as a test: direct database access as the member (PostgREST and SQL) returns no rows from `transactions` or annotation tables; every existing API that returns rows (ledger, drilldowns, review, recurring detail, receipts) returns 403 or empty; every export route refuses; household drilldowns stop at aggregates; and membership never grants any member, of any role, another member's raw rows beyond what the existing household policies already allow.
- **12.3 Read-only MCP endpoint (Sure `docs/hosting/mcp.md`, Tallyo `mcpserver/projections_*`).**
  Prerequisite: **scoped API tokens across every token consumer.**
  Today `verifyApiToken()` (`lib/api-tokens.ts`) returns only a user id and its consumer `lib/export-route.ts` accepts any valid token, so a new scope alone would not stop an aggregate-only token from reading row exports.
  Add a `scopes text[]` column; backfill every existing token with an explicit legacy scope (`export:rows`) so current permissions are preserved, not widened or silently revoked; make `verifyApiToken()` take the required scope and return the token's scopes; make every consumer, current and future, require a named scope; fail closed on missing scopes.
  Tests: an `mcp:aggregates` token is refused by every existing CSV/JSON export route; a legacy token still works on exports and is refused by MCP; a revoked or expired token is refused everywhere.
  Then the endpoint: off by default; `mcp:aggregates` returns only aggregate projections (month/category totals, budgets, recurring, net-worth trend); an optional, separately granted `mcp:export-rows` scope limited to the export contract (date, merchant, amount, category) and `ai_export_enabled`; read-only; rate limited; audited.
  No write tools in this plan.

## Workstream 13: shell, onboarding and transparency

- **13.1 First-run setup checklist and tour (Tallyo setup steps, Securo `onboarding-tour`, KevFin `Welcome`).**
  Connect a bank, confirm payday, seed a budget, choose alerts, enable MFA; dismissible, resumable, keyboard accessible.
- **13.2 What's new panel (Sure `release_highlights`, Securo `update-available-banner`).**
  Short in-app highlights per release from a versioned file, shown once per user.
- **13.3 Dashboard drag reorder and widget size (Sure `dashboard_sortable`, `dashboard_widget_size`).**
  Extend the customize drawer with drag and keyboard reorder plus size presets, persisted in widget prefs.
- **13.4 Cash-flow waterfall (pft `CashFlowWaterfall`).**
  Income to expenses to savings for a month, `--viz-*` slots, direct labels, table twin.
- **13.5 External-services disclosure (Achilles `services.ts`).**
  Settings > Privacy registry of every outbound service (Plaid, Supabase, Resend, web push, opt-in Anthropic): purpose, data sent, trigger, optionality, and the source file, derived from actual calls.
- **13.6 Statement vault and coverage grid (Sure `account_statement/coverage.rb`).**
  Private upload of PDF statements per account and a month grid (covered, missing, duplicate); no parsing.
- **13.7 Goal visuals (Sure `goals/progress_ring`, `status_pill`, `goal_projection_chart`).**
  Progress ring, status pill, and projection chart on goal detail using existing goals-v2 data.

## Not adopted, with reasons

- Sure's ~30 regional and crypto providers, SimpleFIN, Enable Banking, FinTS, wallets: FundFlow is US Plaid.
- Automated property valuation (Zillow, RentCast, Realie) and live quote feeds: licensed data.
- Sure's LLM auto-categorizer and assistant write tools: break "aggregates leave, rows never do".
- Penny's retailer browser-capture scripts and shipped card rates.
- Achilles metals lots, pension statements, watchlist: niche and need price feeds.
- Securo invoicing, workspaces, FX with 1:1 fallback.
- Token Circles IndexedDB storage of financial data: conflicts with the offline cache policy.
- No-auth or master-password deployment models from pft, KevFin and Tallyo.
- Wall display token and gamification badges: covered by 12.2 and the 4.3 streak.

## Delivery rules

- Owner update, 2026-10-01: group five or six features into each branch and PR.
  Implement and verify one item or tight pair at a time within that group.
  Use topic prefixes (`feat/`, `fix/`, `ui/`), never tool or agent names, and no attribution lines.
- New user tables: RLS gated on `session_not_revoked()` and `mfa_satisfied()`, `check-rls.sql` green, migration applied by hand and verified with `supabase migration list --linked`.
- Client writes only on user-authored configuration tables, added to the CLAUDE.md list when introduced.
- Every spend total applies `EXCLUDED_PFC`; Plaid sign convention; `YYYY-MM-DD` dates; joins on ids; "projection", never "prediction".
- Every new feature is behind a flag in `lib/feature-flags.ts`, default off until verified.
  The flag gates **every entry point**, not just UI: route handlers return 404 when off, sync and import processing skip the new step, and cron or scheduled jobs no-op; tests cover the off state for each entry point.
  Confirmed defect fixes (workstream 0) and correctness fixes are **not** flagged; they ship enabled once reproduced and fixed.
- Keep dependencies inside a group when practical.
  Independent groups branch from current `main`; a dependent group may target its unmerged prerequisite group with that dependency documented.
  Keep group stacks at most three deep, and retarget after the base merges.
- Each PR runs lint, typecheck, unit tests, build, and a real browser journey at 375px and desktop with keyboard.

## Order

1. Workstream 0.
2. Imports 1.1 to 1.4, then 2.1, 2.2, 2.3, 3.1 to 3.3.
3. 4.1, 4.2, 5.1 to 5.3, 6.1 to 6.4, 8.1, 8.2.
4. 11, 3.4 to 3.6, 5.4 to 5.6, 6.5 to 6.8, 7, 9.1 to 9.6 (9.x depends on 2.3; 9.3 also on 8.1).
5. 1.5, 2.4, 4.3, 8.3, 8.4, 10, 12.1, 13.
6. 9.7, then scoped tokens (12.3 prerequisite), 12.2, 12.3 last, because they change privacy or data-source posture.

## Cleanup

Reference clones live outside the repository under `/private/tmp/fundflow-reference-*` and are deleted when the program ends.

## Grouped delivery

The owner replaced the per-item PR rule with groups of five or six features on 2026-10-01.
Group 1 is [PR #198](https://github.com/navaneethbv/FundFlow/pull/198), consolidating items 0.1, 0.3, 1.1, 1.2, 1.3, and 1.4 on `feat/import-foundation` from main `a19a0a6`.
Individual PRs #192 through #197 are closed as superseded.
All hosted checks on the consolidated PR passed at `643eda8`, including build, migration/RLS, security/static analysis, preview, and smoke tests.
Group 2 is [PR #199](https://github.com/navaneethbv/FundFlow/pull/199) and contains 2.1, 2.2, 2.3, 3.1, 3.2, and 3.3, preserving the implementation order.
Group 2 is implemented in `/private/tmp/fundflow-balance-quality` on `feat/data-quality-guidance`; see `docs/superpowers/specs/2026-10-01-data-quality-guidance.md` for its six-item checklist.
PR #198 merged to main as `5479261` on 2026-10-02 after its migrations and the two transaction-review prerequisites were applied to production.
Group 3 is [PR #200](https://github.com/navaneethbv/FundFlow/pull/200), the six-item insights, rules, and transaction-detail batch on `feat/insights-rules-ledger`, based on PR #198's `feat/import-foundation` branch.
No production migration or flag flip is included.
Group 4 is [PR #202](https://github.com/navaneethbv/FundFlow/pull/202), containing items 6.2, 6.3, 6.4, 8.1, and 8.2 on `feat/ledger-interactions`, based on Group 3's branch.
The grouped implementation has no migration and all hosted checks passed at `a375739`.
Group 5 is [PR #203](https://github.com/navaneethbv/FundFlow/pull/203), implemented together on `feat/bills-membership-value`, based on `feat/data-quality-guidance` to keep the stack shallow.
It contains 3.4, 3.5, 3.6, 11.1, 11.2, and 11.3; its grouped design and acceptance evidence are in `docs/superpowers/specs/2026-10-02-bills-membership-value.md`.
The owner merged PR #203 at an earlier head before its original analysis and lint-build checks were green.
The latest quality fixes remain on `feat/bills-membership-value` at `5264d68` and are the dependency for the current group.
Group 6 is [PR #204](https://github.com/navaneethbv/FundFlow/pull/204) and implements 5.4, 5.5, 5.6, 6.5, 6.6, and 6.7 on `feat/rules-transaction-tools`.
Its grouped design and acceptance evidence are in `docs/superpowers/specs/2026-10-02-rules-transactions.md`.
The merchant merge acceptance is adapted to FundFlow's schema: `category_overrides` stores category-to-category mappings and has no merchant key, so it is left untouched rather than rewriting unrelated categories.
The five maintainability findings and the reported Codacy security-rule crashes have local corrective changes and regression evidence.
Corrective commit `a405b24` passed hosted CI, migration/RLS, smoke and Sonar's quality gate; Codacy still returned action required without GitHub diagnostics.
Sonar's one remaining stateless-helper scope finding and the two further component crashes in the owner's Codacy log have follow-up corrections.
Extracting the existing ledger loader and desktop row renderer reduced the local Opengrep rule run from 8.27 seconds with a partial-parse warning to 0.27 seconds without errors.
The [quality follow-up](../../reviews/2026-10-02-transaction-tools-quality.md) lists 22 other pre-existing files that crash the same rule; the owner was asked for the broader cleanup scope.
The next grouped checklist starts only after all PR #204 checks pass, as requested by the owner on 2026-10-02.

## Execution checklist

Group 7 is [draft PR #205](https://github.com/navaneethbv/FundFlow/pull/205), containing 6.8, 7.1, 7.2, 7.3, 9.1, and 9.2.
Its implementation contract and verification limits are in [the group spec](../specs/2026-10-03-budgets-collections-assets.md).
The exact head `b0507e6c4be5bc6f40867e5704f0cb244b178ca7` passes the hosted checks, including the dependency audit, and direct SonarCloud verification reports zero unresolved issues and `new_violations=0`.
No production migration, merge, or flag change is included.

Verification exception approved by the owner on 2026-10-01: defer signed-in browser journeys and full Supabase integration tests until a disposable target exists.
Docker is unavailable and no `TEST_SUPABASE_URL` is configured.
Never use the production-linked database or the primary checkout's `.env.local` for testing.
Local PostgreSQL regressions use synthetic records and Auth/Storage schema stand-ins; these do not prove full Supabase Auth behavior.
All new feature flags remain off pending the deferred acceptance.

Dependency freshness checked once at program start: simple-icons 16.33.0, sharp 0.35.5, ESLint 10 and TypeScript 7 are available.
No dependency changes are included in feature PRs.

| Item | Status | PR / evidence |
| --- | --- | --- |
| 0.1 | Merged to main in #198 (`5479261`) on 2026-10-02; migrations applied; flags off | [#198](https://github.com/navaneethbv/FundFlow/pull/198) |
| 0.2 | Not reproduced; skipped per verification rule | Unique holding key rejects duplicate-security rollups |
| 0.3 | Merged to main in #198 (`5479261`) on 2026-10-02; migrations applied; flags off | [#198](https://github.com/navaneethbv/FundFlow/pull/198) |
| 1.1 | Merged to main in #198 (`5479261`) on 2026-10-02; migrations applied; flags off | [#198](https://github.com/navaneethbv/FundFlow/pull/198) |
| 1.2 | Merged to main in #198 (`5479261`) on 2026-10-02; migrations applied; flags off | [#198](https://github.com/navaneethbv/FundFlow/pull/198) |
| 1.3 | Merged to main in #198 (`5479261`) on 2026-10-02; migrations applied; flags off | [#198](https://github.com/navaneethbv/FundFlow/pull/198) |
| 1.4 | Merged to main in #198 (`5479261`) on 2026-10-02; migrations applied; flags off | [#198](https://github.com/navaneethbv/FundFlow/pull/198) |
| 1.5 | Implemented, release gated | PR #208: guarded import undo with exact-row provenance and refusal checks. |
| 2.1 | Implemented in [#199](https://github.com/navaneethbv/FundFlow/pull/199); local checks passed; rollout deferred | `lib/balance-quality.ts`, `app/accounts/balance-review/page.tsx` |
| 2.2 | Implemented in [#199](https://github.com/navaneethbv/FundFlow/pull/199); local checks passed; rollout deferred | `app/settings/connections/page.tsx` |
| 2.3 | Implemented in [#199](https://github.com/navaneethbv/FundFlow/pull/199); local checks passed; rollout deferred | `lib/history-provenance-writer.ts` |
| 2.4 | Implemented, release gated | PR #208: bounded evidence for duplicate, refund, and transfer suggestions. |
| 3.1 | Implemented in [#199](https://github.com/navaneethbv/FundFlow/pull/199); local checks passed; rollout deferred | `app/recurring/paychecks/page.tsx` |
| 3.2 | Implemented in [#199](https://github.com/navaneethbv/FundFlow/pull/199); local checks passed; rollout deferred | `app/settings/payday/page.tsx` |
| 3.3 | Implemented in [#199](https://github.com/navaneethbv/FundFlow/pull/199); local checks passed; rollout deferred | `lib/budget-allowance.ts` |
| 3.4 | Group 5 in [PR #203](https://github.com/navaneethbv/FundFlow/pull/203); merge deferred | `app/recurring/page.tsx`, `components/recurring/MonthPulse.tsx` |
| 3.5 | Group 5 in [PR #203](https://github.com/navaneethbv/FundFlow/pull/203); merge deferred | `lib/recurring-price-changes.ts`, `app/api/recurring/price-changes/route.ts` |
| 3.6 | Group 5 in [PR #203](https://github.com/navaneethbv/FundFlow/pull/203); merge deferred | `components/recurring/SubscriptionCatalog.tsx`, `lib/subscription-catalog.ts` |
| 4.1 | Implemented in [#200](https://github.com/navaneethbv/FundFlow/pull/200) at `dc58d93`; hosted checks passed; rollout deferred | `lib/insight-generators.ts`, `lib/insight-generation.ts` |
| 4.2 | Implemented in [#200](https://github.com/navaneethbv/FundFlow/pull/200) at `dc58d93`; hosted checks passed; rollout deferred | `components/notifications/InsightsFeed.tsx`, `app/api/insights/acknowledge/route.ts` |
| 4.3 | Implemented, release gated | PR #208: five-step weekly review rail and owner streak. |
| 5.1 | Implemented in [#200](https://github.com/navaneethbv/FundFlow/pull/200) at `dc58d93`; hosted checks passed; rollout deferred | `lib/rule-conditions.ts`, `lib/rules-engine.ts` |
| 5.2 | Implemented in [#200](https://github.com/navaneethbv/FundFlow/pull/200) at `dc58d93`; hosted checks passed; rollout deferred | `lib/rule-run-history.ts`, `supabase/migrations/20261001180000_compound_rules.sql` |
| 5.3 | Implemented in [#200](https://github.com/navaneethbv/FundFlow/pull/200) at `dc58d93`; hosted checks passed; rollout deferred | `components/transactions/RuleSuggestion.tsx`, `app/api/rules/suggestion/route.ts` |
| 5.4 | Implemented in merged PR #204 at `eaf1b0c`; hosted checks and Sonar verification pass | `lib/plaid-category-mapping.ts`, `components/settings/PlaidCategoryMappingSection.tsx` |
| 5.5 | Implemented in merged PR #204 at `eaf1b0c`; hosted checks and Sonar verification pass | `lib/bayes-categorizer.ts`, `app/api/categorization/bayes/route.ts` |
| 5.6 | Implemented in merged PR #204 at `eaf1b0c`; hosted checks and Sonar verification pass | `app/merchants/page.tsx`, `app/api/merchants/merge/route.ts`, `20261002100000_rules_transactions_adoption.sql` |
| 6.1 | Implemented in [#200](https://github.com/navaneethbv/FundFlow/pull/200) at `dc58d93`; hosted checks passed; rollout deferred | `components/ui/DetailPane.tsx`, `components/transactions/TransactionEditor.tsx` |
| 6.2 | Implemented in [#202](https://github.com/navaneethbv/FundFlow/pull/202); hosted checks passed at `a375739` | `components/transactions/LedgerKeyboardNavigation.tsx`, `lib/use-keyboard-shortcuts.ts` |
| 6.3 | Implemented in [#202](https://github.com/navaneethbv/FundFlow/pull/202); hosted checks passed at `a375739` | `components/transactions/BulkEditBar.tsx`, `app/api/transactions/bulk-edit/route.ts` |
| 6.4 | Implemented in [#202](https://github.com/navaneethbv/FundFlow/pull/202); hosted checks passed at `a375739` | `components/ui/UndoToast.tsx`, `app/api/transactions/undo-annotation/route.ts`, `app/api/transactions/undo-override/route.ts` |
| 6.5 | Implemented in merged PR #204 at `eaf1b0c`; hosted checks and Sonar verification pass | `components/transactions/ProjectedLedgerSection.tsx` |
| 6.6 | Implemented in merged PR #204 at `eaf1b0c`; hosted checks and Sonar verification pass | `components/transactions/TransactionCalendar.tsx`, `lib/transaction-calendar.ts` |
| 6.7 | Implemented in merged PR #204 at `eaf1b0c`; hosted checks and Sonar verification pass | `components/transactions/AddTransactionModal.tsx` |
| 6.8 | Implemented in Group 7; verification and rollout tracked in the group spec | `lib/collections-data.ts`, `app/transactions/collections/page.tsx` |
| 7.1 | Implemented in Group 7 | `app/api/budget/move/route.ts`, `scripts/check-budget-moves.sql` |
| 7.2 | Implemented in Group 7 | `lib/budget-allocation.ts` |
| 7.3 | Implemented in Group 7 | `components/budget/BudgetSetupWizard.tsx` |
| 8.1 | Implemented in [#202](https://github.com/navaneethbv/FundFlow/pull/202); hosted checks passed at `a375739` | `lib/amortization.ts`, `tests/unit/amortization.test.ts` |
| 8.2 | Implemented in [#202](https://github.com/navaneethbv/FundFlow/pull/202); hosted checks passed at `a375739` | `components/debt/LoanDetail.tsx`, `components/debt/DebtPlannerView.tsx` |
| 8.3 | Implemented, release gated | PR #208: owner-scoped private lending with daily interest and payment allocation. |
| 8.4 | Implemented, release gated | PR #208: editable rent-buy, emergency-fund, and compound-interest calculators. |
| 9.1 | Implemented in Group 7; growth estimates preserve entered history | `app/accounts/assets/page.tsx`, `supabase/migrations/20261003092000_manual_assets.sql` |
| 9.2 | Implemented in Group 7; owned share across balance readers | `lib/manual-assets-data.ts`, `lib/manual-asset-flags.ts` |
| 9.3 | Implemented, release gated | PR #206: mortgage equity, existing liability counted once; fixed-rate loan terms. |
| 9.4 | Implemented, release gated | PR #206: basis source annotations and partial coverage. |
| 9.5 | Implemented, release gated | PR #206: matched owner-account TWR and annualized XIRR. |
| 9.6 | Implemented, release gated | PR #206: subtype tax buckets and overrides reused by Forecasting. |
| 9.7 | Implemented, release gated | PR #206 exact head `1879d369`; `lib/portfolio-lookthrough.ts`, `components/investments/PortfolioLookthrough.tsx`, `supabase/migrations/20261005090000_portfolio_lookthrough.sql`; manual weights only, hosted checks and Sonar verification pass. |
| 10.1 | Implemented, release gated | Group 6: funded emergency and sinking-style goal balances are visible and excluded from FIRE capital. |
| 10.2 | Implemented, release gated | Group 6: seeded, reproducible percentile projection behind `forecastingMonteCarlo`; user-entered return and volatility only. |
| 10.3 | Implemented | Group 6: direct milestone marker lines and labels on the projection chart. |
| 10.4 | Implemented | Group 6: Forecasting methodology panel imports the projection constants. |
| 11.1 | Group 5 in [PR #203](https://github.com/navaneethbv/FundFlow/pull/203); merge deferred | `lib/card-value.ts`, `20261002091000_card_value_terms.sql` |
| 11.2 | Group 5 in [PR #203](https://github.com/navaneethbv/FundFlow/pull/203); merge deferred | `lib/card-value.ts`, `app/settings/page.tsx` |
| 11.3 | Group 5 in [PR #203](https://github.com/navaneethbv/FundFlow/pull/203); merge deferred | `app/api/settings/card-value/route.ts`, `components/settings/MembershipCardValueSection.tsx` |
| 12.1 | Implemented, release gated | Group 6: stable accessible owner dots on household account and dashboard transaction rows behind `ownerAttributionDots`. |
| 12.2 | Implemented | Aggregate-only reports role, bounded security-definer aggregate RPC, restrictive row-deny policies, feature-gated route, invite-role propagation, and service-report denial are in PR #216 exact head `3740a261`; hosted checks and Sonar verification pass, while the migration and flag remain unapplied/off pending hosted RLS acceptance. |
| 12.3 | Implemented | Scoped token capabilities and read-only `/api/mcp` aggregate projections are in PR #215 exact head `1e5ae55c` and PR #217 exact head `5d088377`; hosted checks and Sonar verification pass, while `mcpEndpoint` remains off pending rollout acceptance. |
| 13.1 | Implemented, release gated | PR #210: bounded setup status and dismissible/resumable keyboard-accessible tour; `onboardingTour` remains off. |
| 13.2 | Implemented, release gated | PR #210: versioned dashboard release highlights with per-user viewed marker; `releaseHighlights` remains off. |
| 13.3 | Implemented, release gated | Stacked continuation after PR #210: optional drag and keyboard reorder controls plus persisted widget density presets behind `dashboardWidgetLayout`. |
| 13.4 | Implemented, release gated | Stacked continuation after PR #210: accessible income-to-expenses-to-savings waterfall and table twin behind `cashFlowWaterfall`. |
| 13.5 | Implemented | PR #212 exact head `d559a96d`; source-linked Settings > Privacy external-service registry; hosted checks and Sonar verification pass. |
| 13.6 | Implemented | PR #213 exact head `68115041`; private PDF statement vault, metadata-only API, and covered/missing/duplicate account-month grid behind `statementVault`; hosted checks and Sonar verification pass. |
| 13.7 | Implemented, release gated | PR #214 exact head `43bf763d`; goal detail progress ring, status pill, and projection chart behind `goalVisuals`; hosted checks and Sonar verification pass. |

### 0.1 decisions and evidence

Reproduced against the existing schema with `scripts/check-pending-carryover.sql` with `fundflow.test_legacy_sync=on`: pending note, tags and classification override disappeared after deletion.
Plaid documents that pending removal and posted addition can arrive on separate pages of the same update: [transaction states](https://plaid.com/docs/transactions/transactions-data/).
The original implementation queues removal ids on the owning item across routine and bounded repair pages, resetting them when an invalidated cursor chain restarts.
`finish_transaction_sync_page` moves annotations, splits, receipts, recurring associations and goal event links before deleting, in one transaction, scoped to both user and item.
It refuses ambiguous replacements, conflicting annotations/splits and confirmed financial links rather than silently discarding user work.
No existing rows are rewritten by the additive migration.
Review-state clarification: current FundFlow rejects marking pending rows reviewed.
The fix preserves review history/version and reopens on posting according to the existing source-change contract, rather than introducing a pending-review bypass.
This defect is unflagged; migration `20261001100000` must be applied to an approved target before deploying its sync code.

Local acceptance for 0.1: 490 unit suites / 5,423 tests passed, unchanged coverage gates passed, lint/typecheck/palette checks passed.
The SQL carryover and RLS checks passed on isolated PostgreSQL after applying all 89 existing migrations and the new additive migration.
Production builds are not verified locally: Turbopack worker-port permission failure, then Webpack's existing `node:crypto` client-import failure.
Hosted build verification is pending; no production rollout is authorized.

Recovery record: the first attempted branch push unintentionally updated main and triggered production deployment.
With explicit owner approval, production was rolled back and corrective PR #191 restored main after green checks; its administrator exception was limited to that corrective PR.
Item 0.1 is reintroduced on `fix/pending-annotation-preservation` from restored main, using a non-tracking branch and verified explicit push refspecs.

### 0.2 verification

Read Tallyo's pinned `server-rs/src/wealth/adapters/plaid_dedupe.rs` and FundFlow's `lib/investment-sync.ts`.
The reference condition requires multiple rows for the same account/security, including a rollup.
FundFlow upserts on `(account_id, security_id, source)`, protected by `20260810140000_holdings_upsert_conflict.sql`.
An original synthetic 3-unit / 9-unit / 12-unit rollup batch in isolated PostgreSQL fails with SQLSTATE 21000 and persists no partial holdings.
The reported double-counting hypothesis was not reproduced, so no heuristic row deletion is added.
A separate possible sync-rejection case remains for verified provider lot/rollup payloads; handling it would require conservative lot aggregation and a real representative fixture.

### Items 0.3 and 1.1 evidence

Item 0.3 requests and stores the original provider descriptor while leaving export and AI allowlists unchanged.
PR #193 passed hosted build/unit coverage, migration smoke, CodeQL, Sonar, Codacy, and preview checks at `155934c`.
Its migration `20261001110000_transaction_original_description.sql` remains unapplied to production.

Item 1.1 stores an owner layout only after a committed import and reuses normalized ordered headers, positional columns, sign convention, explicit date order, and skipped logical records.
PR #194 is independent of the defect PRs and keeps `importProfiles` off.
Local coverage, lint, typecheck, isolated SQL/RLS checks, and four Chromium component journeys at 375px/1440px in both themes passed.
Those browser fixtures mock HTTP; signed-in acceptance remains deferred as approved.
Migration `20261001120000_import_profiles.sql` is unapplied to production.

### Items 1.2 and 1.3 evidence

PR #194 passed all hosted checks at `6820c96` and remains unmerged.
Item 1.2 is PR #195, based on #194; all emitted hosted checks passed at `2cf0f7d`, including build/unit coverage, Sonar, Codacy, preview, and smoke tests.
Local item 1.2 verification passed 495 suites / 5,509 tests, the coverage gates, lint/types, and four Chromium fixtures in both themes at 375px and 1440px.
Its readonly endpoint and UI require default-off `importPreflight` and the saved-layout prerequisite; it adds no migration.

For 1.3, column naming, sample rows, date/sign configuration, duplicate review, and explicit commit already exist in `components/settings/ImportReviewSection.tsx` and are reused.
The remaining implementation adds scoped file drop, visible steps, keyboard focus transitions, and stale-preview clearing behind `importWizard: false`.
The #194 -> #195 -> wizard stack is three branches deep; do not extend it until a base merges.


### Item 1.3 completion and 1.4 checkpoint

PR #196 passed all emitted hosted checks at `0ffebe8`, including build/unit coverage, Sonar, Codacy, preview, and smoke tests.
Its four synthetic Chromium fixtures exercise drop/file selection, mapping focus, review, stale-preview clearing, completion, and off-state behavior at 375px/1440px in both themes.
Item 1.4 is isolated on `feat/import-history`, based on #194 rather than extending the three-deep wizard stack.
The history names the existing upsert outcome "Imported rows", explicitly including updates; exact newly inserted ledger counts require item 1.5 provenance and are not fabricated.
Existing committed batches show Not recorded for unavailable timestamps, profiles, flags, and accounts.

PR #197 records item 1.4 at `2d0957f` with 494 suites / 5,494 tests passing, coverage gates, lint/types, isolated SQL/RLS checks, and four synthetic browser fixtures.
Migration `20261001130000_import_history.sql` is unapplied to production and `importHistory` remains off.
Item 2.1 begins on independent branch `feat/balance-quality-review` from main `a19a0a6`; its upstream is explicitly unset to prevent a default push to main.
