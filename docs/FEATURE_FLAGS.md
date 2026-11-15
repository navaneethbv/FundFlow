# Feature flag rollout review

Status reviewed November 15, 2026. Release candidates require the checks listed here and the existing review before rollout.

## Release candidates

Pass the stated browser or fixture check and approve the release.

| Flag | Acceptance check |
| --- | --- |
| `ledgerKeyboardNavigation` | Keyboard-only ledger navigation and focus restoration |
| `ownerAttributionDots` | Mixed-owner household rendering and accessible owner labels |
| `onboardingTour` | Fresh-account tour completion and dismissal |
| `releaseHighlights` | Current release content and first-visit dismissal |
| `cashFlowWaterfall` | Chart and table parity for both positive and negative cash flow |
| `goalVisuals` | Zero-target and completed-goal rendering |
| `budgetDailyAllowance` | Zero spend, overspend, and end-of-month states |
| `budgetOverAllocation` | Annualized-income and mixed-currency fixtures |
| `planningCalculators` | Projection inputs and output checks on small screens |

## Schema and workflow acceptance

Verify the referenced schema is applied in staging and exercise the named flow.

| Flag | Acceptance check |
| --- | --- |
| `mortgageEquity` | Manually entered home and mortgage reconciliation |
| `investmentBasis` | Holdings with mixed broker basis and statement basis |
| `investmentXirr` | Dated cash flows and unresolved return results |
| `investmentTaxBuckets` | Account tax classifications and missing classifications |
| `portfolioLookthrough` | Manual holdings with incomplete constituent inputs |
| `importWizard` | Drop, keyboard and complete csv import |
| `importPreflight` | Malformed, clean and duplicate csv files |
| `importProfiles` | Save and reuse layouts with owner isolation |
| `importHistory` | Row counts and access isolation for committed batches |
| `importUndo` | Repeat undo and ledger consistency |
| `insightGenerators` | Notification rules, preferences and stable subject keys |
| `insightsFeed` | Insight feed filtering and removal |
| `compoundRules` | Preview, applying rules and reapplying to older transactions |
| `ruleRunHistory` | Per-owner run log and retention |
| `ruleSuggestions` | Confirmation, skip and duplicate handling |
| `transactionDetails` | Detail and annotation round-trips |
| `bulkEdit` | Multi-row update, cancellation and owner checks |
| `undoToasts` | Concurrent edits and previous-value restoration |
| `amortizationEngine` | Zero-interest and early-payoff schedules |
| `loanDetails` | Loan schedule and scenario parity |
| `forecastingMonteCarlo` | Reproducible bounds and projection copy |
| `householdReportsOnly` | Membership isolation and a discoverable report link |
| `mcpEndpoint` | Scoped tokens and truncation through the aggregates rest route |
| `dashboardWidgetLayout` | Preference persistence and mobile widget order |
| `statementVault` | Upload, signed read, and erasure from private storage |
| `transactionReview` | Manual entry, audit and concurrent annotation changes |
| `balanceQualityReview` | Evidence, resolution, and correction provenance |
| `connectionHealth` | Repair, partial sync, and stale health across real institution types |
| `historyProvenance` | Derived vs. imported history badges |
| `paycheckPlanner` | Paydays crossing holidays, leap days and year boundaries |
| `paydaySettings` | Validate and persist each supported frequency |
| `billsViews` | All supported list and calendar views |
| `recurringPriceHistory` | False positives, skipped charges and recurring streams |
| `subscriptionCatalog` | Deduplication between manual and inferred subscriptions |
| `membershipCardValueModel` | Membership data migrations and owner scope |
| `membershipCardValueCalculation` | Annual fee, credit limits and redemption examples |
| `membershipTermsEntry` | Manual terms update and reconciliation |
| `plaidCategoryMappings` | Mapping precedence and tenant isolation |
| `bayesCategorization` | Feedback capture and low-confidence fallback |
| `merchantsPage` | Merchant merge and name changes without duplicate spend |
| `projectedLedgerRows` | Projection marker and separation from posted totals |
| `transactionCalendar` | Viewer timezone and date-only rows |
| `quickAddTransaction` | Keyboard submission and duplicate-submit prevention |
| `transactionCollections` | Membership edits and cross-user access checks |
| `budgetMoves` | Atomic movement, reversal and ledger integrity |
| `budgetSetupWizard` | Saved progress and cancellation |
| `typedManualAssets` | Valuation and classification for each supported asset type |
| `assetOwnership` | Joint ownership and household scope |
| `explainableMatchSuggestions` | Manual confirmation, decline and rerun |
| `weeklyReview` | Week boundaries, low-data states, and first run |
| `privateLending` | Principal, payments and date-boundary examples |
| `transactionTimes` | Apply the timestamp migration and verify existing rows and provider fallback |

## Provider approval

Approve the provider product and budget before enabling.

| Flag | Acceptance check |
| --- | --- |
| `liabilitiesSync` | Confirm the separately billed plaid liabilities call and quota |

## Retirement candidate

Keep disabled until the owner approves removal or a replacement ships.

| Flag | Acceptance check |
| --- | --- |
| `backupRestore` | Retire the current restore path once the replacement format and migration plan are accepted |
