# Finance repository feature comparison

Reviewed on 2026-10-01 against FundFlow checkout `5b232034a3bd0fc752a522067275d4242eefdd5c` on `fix/repository-review-remediation`.
This is a source-based product comparison and a proposed backlog, not an implementation plan or authorization to ship changes.

## Recommendation

All eight unique repositories contain useful ideas, but FundFlow already implements most of their baseline finance features.
The best next work is to deepen existing workflows: reusable import profiles, a balance-quality review workflow, and better explanations for automated decisions.
The strongest new product capability is membership and credit-card value analysis inspired by Penny.
Investment look-through is valuable but should follow a decision about licensed data availability.

Suggested order:

1. Saved import profiles and a visible import history, followed separately by guarded batch undo.
2. Balance-quality review and explicit valuation provenance.
3. Membership and card value analysis using user-confirmed assumptions.
4. Detailed loan schedules with dated extra payments and rate changes.
5. Portfolio exposure analysis when suitable constituent data is available.

A small parallel-sized opportunity for a later task is an external-services disclosure panel in Settings.
No additional provider is necessary for the first four proposals when implemented with existing records and user-entered data.

## Scope and evidence

The supplied Tallyo URL appeared twice; it was reviewed once.
All eight repositories were shallow-cloned into a dedicated temporary directory.
The review covered each README, tracked-file inventory, license files, relevant implementation modules, and selected UI and test sources.
It did not read every line of every repository, execute their applications, install their dependencies, or run their test suites.
An implementation or test file demonstrates source presence, not a passing runtime journey or production readiness.
FundFlow comparisons use current local source and feature defaults; no production deployment, environment overrides, or migration state was verified.

Existing uncommitted changes in `.env.example`, `README.md`, `docs/HANDOFF.md`, and `docs/TODO.md` were left intact.
Some status documentation describes older rollout states, so this report does not infer current hosting status from those notes.

| Repository | Inspected commit | Commit date | License found |
| --- | --- | --- | --- |
| [Sure](https://github.com/we-promise/sure) | `97fa8a2eda5df778abcccb2a08a643d8004907c4` | 2026-10-01 | AGPL-3.0 |
| [Personal Finance Tracker](https://github.com/gillespiejameson/personal-finance-tracker) | `ddaa9f80d3ebe6c6de746ca3a86be3ebb1e1b4eb` | 2026-09-30 | MIT |
| [Achilles Financials](https://github.com/lcsfls/achilles-financials) | `0b59a7c710d110665be6c4c3efa7d71c6b0daabb` | 2026-07-26 | No tracked license file found |
| [KevFin](https://github.com/kxl3785/KevFin) | `e83be1c2c9955b342a0f8209bd2fd4b5edbc54df` | 2026-07-28 | MIT |
| [Securo](https://github.com/securo-finance/securo) | `76065dbcfa7cbba4479cd0835ae1a3560748fc36` | 2026-09-30 | AGPL-3.0 |
| [Token Circles](https://github.com/Komediruzecki/token-circles) | `a22a6a428fef5ed5b45eb0915d71ab2dab5fe4f0` | 2026-09-27 | AGPL-3.0; package declares AGPL-3.0-only |
| [Penny](https://github.com/tydude001/penny) | `508877db9ebc662b0dde9d70770c916a6f41557d` | 2026-09-30 | MIT |
| [Tallyo](https://github.com/orlandoc01/tallyo) | `27220d668c33383b3aab2535008adb3a84287b8b` | 2026-09-29 | Apache-2.0 |

License labels come from the inspected repositories, not a compatibility determination for FundFlow.
Prefer original implementations of the product ideas.
Any actual source reuse should retain applicable notices and undergo a specific license check; do not treat a public repository as blanket permission to copy.
For Achilles, seek an explicit license before copying implementation or assets.

## Findings by repository

### 1. Sure

Sure is a Rails application with a substantially broader provider and client ecosystem than FundFlow.
Its strongest transferable ideas are operational visibility and structured import configuration.

- **Rule execution history:** `RuleRun` records execution type, queued/processed/modified counts, pending jobs, status, and failures.
  Its completion logic preserves a prior failure while outstanding jobs drain.
  FundFlow already previews rule matches and writes batch audit events, so the opportunity is a user-facing run history and per-rule explanation, not another rules engine.
- **Import preflight:** configurable date/number formats, sign conventions, delimiters, skipped rows, and structured validation results.
  FundFlow has staged preview/commit already; take the clearer configuration and diagnostics rather than replacing that pipeline.
- **Connection health:** one model combines sync state, credential/setup status, and linked versus unlinked account counts across providers.
  FundFlow already has Plaid reconnection, stale-data warnings, and sync jobs; a consolidated recovery view would be an extension.

Evidence: [rule runs](https://github.com/we-promise/sure/blob/97fa8a2eda5df778abcccb2a08a643d8004907c4/app/models/rule_run.rb), [import preflight](https://github.com/we-promise/sure/blob/97fa8a2eda5df778abcccb2a08a643d8004907c4/app/models/import/preflight.rb), [connection status](https://github.com/we-promise/sure/blob/97fa8a2eda5df778abcccb2a08a643d8004907c4/app/models/provider_connection_status.rb).
Selected test source: `test/models/rule_run_test.rb`.
Do not transplant Rails jobs, its provider catalog, or broad assistant access into FundFlow merely for parity.

### 2. Personal Finance Tracker

This Next.js/SQLite project is particularly useful for manual-import ergonomics.

- **Reusable bank profiles:** header signatures identify bank layouts; profiles store columns, sign convention, date format, and skipped rows.
  The commit workflow saves a custom profile only after a successful import.
- **Import undo:** transactions are associated with an import and there is an explicit undo action.
  FundFlow already stages batches and remembers source-account mappings, but I did not find saved CSV-layout profiles or a user-facing committed-batch history/undo workflow.
- **Budget-paced spending:** its safe-to-spend view includes a daily allowance and both payday and month-end context.
  FundFlow already computes cash minus upcoming bills until payday; the new part would be a separately labelled budget pace and explicit payday configuration.
  The two formulas answer different questions and must not be silently substituted.
- **Explained anomalies:** merchant spikes, category outliers, new merchants, bill jumps, and likely double charges produce concrete reasons.
  FundFlow already has several alerts and review queues, so additional signals should earn their place through low-noise behavior.

Evidence: [bank profiles](https://github.com/gillespiejameson/personal-finance-tracker/blob/ddaa9f80d3ebe6c6de746ca3a86be3ebb1e1b4eb/src/lib/import/profiles.ts), [commit workflow](https://github.com/gillespiejameson/personal-finance-tracker/blob/ddaa9f80d3ebe6c6de746ca3a86be3ebb1e1b4eb/src/lib/import/commitFlow.ts), [undo implementation](https://github.com/gillespiejameson/personal-finance-tracker/blob/ddaa9f80d3ebe6c6de746ca3a86be3ebb1e1b4eb/src/lib/import/commit.ts), [spending pace](https://github.com/gillespiejameson/personal-finance-tracker/blob/ddaa9f80d3ebe6c6de746ca3a86be3ebb1e1b4eb/src/lib/budget/safeToSpend.ts).
Selected test sources include `tests/lib/import/commitFlow.test.ts`, `tests/lib/budget-safe.test.ts`, and `tests/lib/anomalies-detect.test.ts`.
Its single-user, no-login deployment and whole-SQLite backup approach do not fit FundFlow's hosted multi-user model.

### 3. Achilles Financials

The useful distinction is support for assets and obligations beyond bank transactions.

- **Valuation provenance:** property records include value source, valuation date, purchase information, and ownership percentage.
  FundFlow has manual balances and history but lacks this richer explanation of where a valuation came from.
- **Private lending:** loans distinguish money lent from money borrowed and allocate actual payments to accrued interest and then principal.
  This is different from FundFlow's debt payoff projection and household expense settlement.
- **External-services disclosure:** a structured registry describes purpose, transmitted information, trigger, optionality, and source location, presented in Settings.
  This is a small, useful transparency improvement for FundFlow's existing privacy controls.
- Metals lots and pension-statement tracking are implemented niche extensions, worth considering only if the user's assets require them.

Evidence: [service disclosures](https://github.com/lcsfls/achilles-financials/blob/0b59a7c710d110665be6c4c3efa7d71c6b0daabb/src/lib/services.ts), [loan accounting](https://github.com/lcsfls/achilles-financials/blob/0b59a7c710d110665be6c4c3efa7d71c6b0daabb/src/lib/loans.ts), [property schema](https://github.com/lcsfls/achilles-financials/blob/0b59a7c710d110665be6c4c3efa7d71c6b0daabb/src/lib/db.ts).
The tracked test inventory is limited compared with the larger projects; only `tests/backup.test.ts` appeared in the test-file inventory.
Treat its loan formulas as design references requiring independent fixtures, not verified finance primitives.

### 4. KevFin

KevFin contributes the strongest wealth-analysis ideas.

- **Portfolio look-through:** allocation rolls fund constituents into underlying stock, sector, country, and asset-class exposure, with contributors back to holdings/accounts.
  FundFlow currently groups holdings into broad security classes; it does not expose constituent-level overlap.
- **Cost-basis provenance and coverage:** distinguish manual, imported, reported, and estimated basis, including partial coverage.
  This is more useful than showing a gain calculated from incomplete basis without qualification.
- **Observed versus estimated history:** estimated observations cannot overwrite real observations.
  This provenance pattern fits future historical reconstruction in FundFlow, without pretending reconstructed history is observed.
- **Retirement depth:** seeded Monte Carlo simulation, tax buckets, multiple earners, housing costs, and education events go beyond FundFlow's deterministic scenario bands.
  The model is a later project, not an immediate replacement: it includes simplified tax/RMD assumptions that require independent validation.

Evidence: [allocation](https://github.com/kxl3785/KevFin/blob/e83be1c2c9955b342a0f8209bd2fd4b5edbc54df/server/src/services/allocation.ts), [observation provenance](https://github.com/kxl3785/KevFin/blob/e83be1c2c9955b342a0f8209bd2fd4b5edbc54df/server/src/services/observations.ts), [simulation](https://github.com/kxl3785/KevFin/blob/e83be1c2c9955b342a0f8209bd2fd4b5edbc54df/client/src/lib/forecastSim.ts).
Selected test sources: `server/src/services/observations.test.ts` and `client/src/lib/forecastSim.test.ts`.
Do not copy its no-auth deployment, local CLI assistant routing, or market-data access assumptions.
FundFlow's stable-ID rule also rules out copying account-name aggregation keys found in the allocation implementation.

### 5. Securo

Securo's FastAPI/Postgres/React architecture differs from FundFlow, but its review workflow provides useful product patterns.

- **Explain each match:** reconciliation suggestions preserve amount agreement, date distance, counterparty agreement, strategy, and group membership.
  This is more actionable than a single opaque confidence percentage.
- **Remember decisions:** accepted and declined suggestions persist, while related multi-invoice matches are handled as a group.
  FundFlow already persists duplicate/refund/transfer decisions, so the incremental benefit is richer explanations and a consolidated review presentation.
- **Import history:** a UI lists prior import runs and supports undo; asset-order undo also recomputes positions.
- **Multi-currency:** dated FX storage and conversion paths offer design references if FundFlow expands beyond its current foreign-currency exclusions.
  Its live-read 1:1 fallback when a rate is unavailable is not appropriate to adopt for FundFlow totals.

Evidence: [suggestion state and signals](https://github.com/securo-finance/securo/blob/76065dbcfa7cbba4479cd0835ae1a3560748fc36/backend/app/services/reconciliation_suggestion_service.py), [import history](https://github.com/securo-finance/securo/blob/76065dbcfa7cbba4479cd0835ae1a3560748fc36/frontend/src/components/import-history.tsx), [FX service](https://github.com/securo-finance/securo/blob/76065dbcfa7cbba4479cd0835ae1a3560748fc36/backend/app/services/fx_rate_service.py).
Selected test sources: `backend/tests/test_reconciliation_engine.py`, `backend/tests/test_import_service.py`, and `backend/tests/test_fx_rates.py`.
Its invoice-oriented reconciliation is not equivalent to FundFlow's statement reconciliation; use the interaction pattern without importing an invoicing domain unnecessarily.

### 6. Token Circles

This SolidJS/Cloudflare application is useful for planning tools and transaction exploration.

- **Loan schedules:** variable-rate periods, dated prepayments, amortization rows, and comparisons of interest and payoff duration.
  FundFlow's avalanche/snowball planner uses a fixed APR and steady monthly extra amount; richer schedules would extend it.
- **Rent-versus-buy:** editable assumptions compare housing costs, equity, and investing alternatives over a selected horizon.
  A useful standalone planner after debt schedules, rather than a new top-level product area immediately.
- **Spending calendar heatmap:** selecting a day can drill into that day's transactions.
  FundFlow has cumulative spending and Sankey reports, but I did not find this calendar-style exploration.

Evidence: [loan calculation](https://github.com/Komediruzecki/token-circles/blob/a22a6a428fef5ed5b45eb0915d71ab2dab5fe4f0/frontend/src/core/loanCalculator.ts), [loan tests](https://github.com/Komediruzecki/token-circles/blob/a22a6a428fef5ed5b45eb0915d71ab2dab5fe4f0/frontend/src/core/__tests__/loanCalculator.test.ts), [rent versus buy](https://github.com/Komediruzecki/token-circles/blob/a22a6a428fef5ed5b45eb0915d71ab2dab5fe4f0/frontend/src/features/RentBuyCalculator.tsx), [heatmap](https://github.com/Komediruzecki/token-circles/blob/a22a6a428fef5ed5b45eb0915d71ab2dab5fe4f0/frontend/src/components/D3HeatmapChart.tsx).
Reimplement calculations and charts within FundFlow conventions: the source calculator uses JavaScript date rollover/UTC slicing, and its final-payment/prepayment accounting needs independent edge-case checks.
The heatmap source hardcodes EUR formatting; FundFlow must use the active currency, keyboard access, and a table alternative.
Do not adopt its IndexedDB financial-data storage without a deliberate change to FundFlow's offline privacy policy.

### 7. Penny

Penny is the clearest source of a distinctive new feature: deciding whether a paid membership and its associated card earn their cost on the user's spending.

- Separate the card's advantage over a baseline card from the benefit specifically caused by paying for the membership.
- Include tier-reward caps and eligibility, fees, user-valued perks, and low/base/high assumptions.
- Show break-even spending, incomplete history, and stale/unverified rate assumptions.
- Evaluate card annual fees and credits over anniversary years rather than assuming calendar years.

FundFlow detects subscriptions and price hikes but does not currently model membership benefits, reward terms, or counterfactual card value.
The calculation can run locally on canonical spending aggregates without widening the AI privacy boundary.
Start with user-maintained terms and confirmation dates, then only add a maintained catalog with a clear update process.
Keep measured rewards, projected rewards, and subjective perk values separate.
Do not assume store-wide spending qualifies for every reward or count the same benefit in both membership and card totals.

Evidence: [membership model](https://github.com/tydude001/penny/blob/508877db9ebc662b0dde9d70770c916a6f41557d/penny/model.py), [card value and anniversary accounting](https://github.com/tydude001/penny/blob/508877db9ebc662b0dde9d70770c916a6f41557d/penny/cardworth.py), [model fixtures](https://github.com/tydude001/penny/blob/508877db9ebc662b0dde9d70770c916a6f41557d/tests/test_model.py).
Its shipped rates are source fixtures, not verified current offers for FundFlow to recommend.
Its local board and retailer-specific browser-capture scripts are not proposed for adoption.

### 8. Tallyo

Tallyo's Rust/React implementation has particularly useful handling for questionable provider data.

- **Balance review queue:** retain provider values and a prior snapshot when a holdings-price anomaly or empty-holdings condition triggers review.
  The user can compare values, see the reason and affected dates, and explicitly resolve the discrepancy.
- **Portfolio composition:** weighted sector/composition reports retain contributing holdings and unclassified data.
- **Connection review:** distinguishes reconnection needs, sync errors, and account review needs.
  FundFlow has basic connection health already; the balance-review layer is the meaningful addition.

Evidence: [snapshot flagging](https://github.com/orlandoc01/tallyo/blob/27220d668c33383b3aab2535008adb3a84287b8b/server-rs/src/wealth/flagging.rs), [review persistence](https://github.com/orlandoc01/tallyo/blob/27220d668c33383b3aab2535008adb3a84287b8b/server-rs/src/wealth/store/reviews.rs), [review UI](https://github.com/orlandoc01/tallyo/blob/27220d668c33383b3aab2535008adb3a84287b8b/web/src/components/wealth/BalanceReviewModal.tsx), [portfolio analysis](https://github.com/orlandoc01/tallyo/blob/27220d668c33383b3aab2535008adb3a84287b8b/server-rs/src/portfolio/analysis.rs).
Selected tests include inline Rust tests and `web/src/components/wealth/BalanceReviewQueue.test.tsx`.
For FundFlow, start with detection and visible warnings; carrying a previous value forward must be labelled stale and must never silently masquerade as the current balance.
Its embedded OAuth/MCP server, master-password mode, crypto providers, and USD-only assumptions are not reasons to replace FundFlow's authentication or data model.

## FundFlow parity and actual gaps

| Area | Already present in FundFlow source | Useful increment |
| --- | --- | --- |
| Imports | CSV/OFX, Mint/Monarch/YNAB parsing, preview/commit, deduplication, source-account mappings | Remember bank layouts; import history; guarded batch undo |
| Spending guidance | Payday-anchored cash-based safe-to-spend in `lib/insights.ts` | Separate budget pace, per-day context, user-confirmed payday override |
| Budgets | Category groups, rollover, templates, copy-last-month, goals | Do not rebuild these for parity |
| Transaction quality | Duplicate/refund/transfer decisions and review components | Richer signal explanations and one review entry point |
| General transaction review | Persistent review code exists; `transactionReview` defaults to `false` | Validate release prerequisites before proposing a second implementation |
| Rules | Conditions, priority, tags, rename/category changes, dry-run batch preview, audit events | Per-rule run history and change provenance |
| Accounts | Daily snapshots, manual accounts, exclusions, relink deduplication, reconciliation | Valuation source/date/ownership and questionable snapshot review |
| Investments | Holdings, class allocation, performance, account coverage and manual holdings | Fund look-through, overlap, sector/region exposure, basis coverage |
| Debt | Avalanche/snowball payoff with fixed APR and monthly extra payments | Dated prepayments, rate periods, amortization table |
| Forecasting | Three deterministic scenarios, FIRE targets and life events | Later: validated tax buckets and simulation model |
| Reports/UI | Cash flow, Sankey, CSV/PDF, monthly review, Wrapped, privacy blur | Optional spending calendar; no chart/UI rewrite needed |
| Privacy | Consent gates, aggregate-only AI, receipt exception, static-only offline cache | Consolidated external-services disclosure |
| Membership value | Subscription detection and price-increase alerts | New reward/fee/perk model and anniversary-year credit tracking |

Local source anchors: [feature defaults](../../lib/feature-flags.ts), [import review](../../components/settings/ImportReviewSection.tsx), [import commit](../../app/api/import/commit/route.ts), [safe-to-spend](../../lib/insights.ts), [review decisions](../../lib/transaction-quality.ts), [rules batch](../../app/api/rules/batch/route.ts), [account snapshots](../../lib/account-history.ts), [investments](../../lib/investments.ts), [debt](../../lib/debt.ts), [forecasting](../../lib/forecasting.ts), and [reports](../../app/reports/page.tsx).

## Proposed delivery boundaries

Complexity estimates below are relative engineering scope, not elapsed-time promises.

| Priority | Proposal | Scope | First useful slice | Critical acceptance condition |
| --- | --- | --- | --- | --- |
| First | Saved import profiles | Medium | Owner-scoped header signature, mapping, date/sign convention, preview | Ambiguous files still require review; bad imports never save a misleading profile |
| First | Import history, then undo | Medium to large | Read-only batch history first; undo as separate financial-write work | Undo only rows attributable to that batch; protect later edits, splits, links, reconciliations, and provider records |
| First | Balance-quality review | Large | Explain suspect snapshots alongside last reliable observations | Preserve raw values, stable account identity, audit history, stale labels, and genuine market changes |
| Next | Membership/card value | Medium to large | Annual fee plus user-entered rewards/perks and break-even view | Refunds, transfers, caps, expiry, anniversary windows, partial history, and benefit double-counting covered |
| Next | Debt schedule details | Medium | Fixed-rate amortization table and dated extra payments, then rate periods | Principal/interest/payments reconcile; final payment caps; zero APR, leap dates, and insufficient-payment cases |
| Small extension | External-services panel | Small | Purpose, outbound data, trigger, and controls for existing integrations | Derived from actual browser/server calls; no inaccurate blanket privacy claims |
| Later | Rule run history | Medium | History of existing batch runs, counts, rule identity and outcome | Errors and partial results remain visible; do not duplicate or weaken current audit writes |
| Later | Budget-paced daily allowance | Medium | Separate budget-remaining indicator next to existing cash-based figure | Do not subtract the same bills twice or hide negative cash outlook |
| Data-dependent | Investment look-through | Large | Exposure table with source/as-of date, unknown coverage, holding contributors | Licensed data, weight conservation, no fund/direct-holding double count, stable IDs |
| Optional | Spending calendar | Small to medium | Daily spending grid linking to the ledger | Refund/transfer semantics, timezone dates, keyboard operation and table alternative |
| Deferred | FX, more bank providers, Monte Carlo | Large | Separate requirements and data-source decisions | No 1:1 missing-rate fallback, speculative provider abstraction, or unsupported confidence claims |

For any future implementation, use FundFlow's canonical finance projection, positive-outflow convention, transfer exclusions, and user-scoped data access.
New persisted configuration needs RLS with the existing MFA/revocation gates, migration verification, archive compatibility, and meaningful regression coverage.
Financial mutations need retry safety and independent outcome checks; UI changes need a real desktop/mobile and keyboard journey.
These are acceptance criteria for later implementation, not checks claimed complete by this research.

## Research verification and cleanup

Repository snapshots and linked source paths were checked locally before deleting the temporary clones.
No third-party code was copied into FundFlow and no runtime dependencies were installed from those repositories.
No FundFlow application code, database schema, feature flags, deployment, or credentials were changed.
No application test suites or browser journeys were run because the deliverable is a research document.

The repository-required dependency freshness check completed and reported newer `simple-icons` and `sharp` versions plus major `eslint` and `typescript` versions.
Dependency updates were kept out of this read-only comparison; they require their own toolchain verification.
The only authored repository artifact is this report.
