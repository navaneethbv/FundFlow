# Graph Report - lib  (2026-08-21)

## Corpus Check
- 127 files · ~77,302 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1233 nodes · 2523 edges · 65 communities (58 shown, 7 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 8 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Currency, Dates & Calendar Utils
- Cash Flow Data Loading
- Cash Flow Breakdown Logic
- Ledger Formatting & Columns
- Dashboard Widgets & Cumulative Spend
- Debt Payoff Planner
- Goals & Templates
- CSV/Statement Import Parsing
- Recurring Data Loading
- Transaction Quality & Report Period
- Report Email Rendering
- Spending Insights Engine
- Accounts Page Data
- Plaid Item & Liabilities Sync
- Auth & Route Handler Core
- Email Delivery Error Parsing
- Dashboard Aggregation Core
- API Tokens & Audit Logging
- Budget Data Loading
- Budget Page View Model
- Cron Alerts & Push Notifications
- Dashboard Domain Types
- Financial Advice Progress
- Feature Flags & User Data Export
- Investment Holdings Sync
- Advice Content Library
- Dashboard Drilldown
- Plaid Transaction Sync
- Receipt Matching
- Export Formats & Privacy-Safe CSV
- Budget Line Building
- Planning Depth View
- Investment Benchmark Provider
- Chart Rendering Utils
- Token Encryption
- Env Config & Supabase Clients
- Account Balance Snapshots
- Advice Page Data & What-If
- AI Insights Provider Gate
- Date Formatting Utils
- Dashboard Budget Groups
- Dashboard Cache
- Sinking Funds
- Demo Data Generator
- Year in Money Summary
- Backup Encryption
- Investment Performance (TWR)
- Manual Transaction Validation
- Passkey Availability
- Institution Branding
- Tag Rename & Merge
- Plaid Link Resume
- Profile Patch Validation
- Receipt Image Normalization
- Security Account Exports
- Card Network Detection
- Card Art Images
- AI Insight Summaries
- Category Emoji Mapping
- Data Integrity Checks

## God Nodes (most connected - your core abstractions)
1. `createServiceClient()` - 52 edges
2. `getDashboardData()` - 40 edges
3. `logError()` - 40 edges
4. `formatCurrency()` - 21 edges
5. `loadCanonicalProjection()` - 20 edges
6. `addDays()` - 18 edges
7. `DashboardData` - 17 edges
8. `titleCase()` - 17 edges
9. `loadBudgetData()` - 16 edges
10. `buildAccountsPageData()` - 13 edges

## Surprising Connections (you probably didn't know these)
- `getDashboardData()` --indirect_call--> `fromTransactionRow()`  [INFERRED]
  dashboard.ts → finance-domain.ts
- `writeDailyAccountSnapshots()` --calls--> `createServiceClient()`  [EXTRACTED]
  account-history.ts → supabase/service.ts
- `tryWriteDailyAccountSnapshots()` --calls--> `logError()`  [EXTRACTED]
  account-history.ts → log.ts
- `loadAdvicePageData()` --calls--> `groupKeyFor()`  [EXTRACTED]
  advice-data.ts → accounts-page.ts
- `computeForecastStartingState()` --calls--> `groupKeyFor()`  [EXTRACTED]
  forecasting.ts → accounts-page.ts

## Import Cycles
- None detected.

## Communities (65 total, 7 thin omitted)

### Community 0 - "Currency, Dates & Calendar Utils"
Cohesion: 0.06
Nodes (58): convertCurrency(), DEFAULT_EXCHANGE_RATES, formatMoneyWithFx(), SUPPORTED_CURRENCIES, addDays(), addMonths(), isoDate(), parseDate() (+50 more)

### Community 1 - "Cash Flow Data Loading"
Cohesion: 0.06
Nodes (60): AccountRow, assertQuery(), CashFlowLoadOptions, CashFlowLoadResult, CategoryOverrideDbRow, chunks(), isStale(), loadCashFlowData() (+52 more)

### Community 2 - "Cash Flow Breakdown Logic"
Cohesion: 0.05
Nodes (57): BREAKDOWN_FIELD, breakdownBy(), BreakdownDimension, BreakdownDirection, breakdownLabel(), BreakdownRow, CashFlowPeriod, cashFlowPeriodKey() (+49 more)

### Community 3 - "Ledger Formatting & Columns"
Cohesion: 0.05
Nodes (39): subcategoryLabel(), formatFrequency(), titleCase(), UNKNOWN_CURRENCY, DEFAULT_LEDGER_COLUMNS, LEDGER_COLUMNS, LedgerColumn, parseLedgerColumns() (+31 more)

### Community 4 - "Dashboard Widgets & Cumulative Spend"
Cohesion: 0.06
Nodes (49): computeCumulativeSpendByDay(), CumulativeSpendDay, daysInMonth(), shiftMonthKey(), DashboardWidgetPrefs, CumulativeSpendView, DashboardInvestmentSummary, EMPTY_CUMULATIVE_SPEND (+41 more)

### Community 5 - "Debt Payoff Planner"
Cohesion: 0.07
Nodes (50): applyExtraPayments(), applyInterest(), applyMinimumPayments(), buildPayoffPlan(), completedPlan(), buildDebtPlannerData(), DebtPlannerAccount, DebtPlannerAccountInput (+42 more)

### Community 6 - "Goals & Templates"
Cohesion: 0.07
Nodes (42): BY_SLUG, GOAL_TEMPLATES, goalImageAlt(), GoalTemplate, goalTemplateBySlug(), assertGoalsQuery(), GoalsPageData, loadGoalsPageData() (+34 more)

### Community 7 - "CSV/Statement Import Parsing"
Cohesion: 0.08
Nodes (40): AMOUNT_HEADERS, CATEGORY_HEADERS, ColumnMap, consumeCsvCharacter(), CREDIT_HEADERS, CsvFormatSpec, CsvParserState, DATE_HEADERS (+32 more)

### Community 8 - "Recurring Data Loading"
Cohesion: 0.08
Nodes (44): AccountRow, assertRecurringQuery(), dominantCurrency(), isStale(), JoinRow, KNOWN_FREQUENCIES, KNOWN_STATUSES, loadJoinRows() (+36 more)

### Community 9 - "Transaction Quality & Report Period"
Cohesion: 0.09
Nodes (36): applyMerchantRules(), previewMerchantRules(), addDays(), DEFAULT_REPORT_TIMEZONE, getWeeklyReportPeriod(), LocalDateTime, normalizeReportTimezone(), WEEKDAY_INDEX (+28 more)

### Community 10 - "Report Email Rendering"
Cohesion: 0.12
Nodes (33): hasFourDigits(), isDigit(), isLetter(), isWhitespace(), stripTrailingAccountMask(), accountLabel(), barRows(), clampPercent() (+25 more)

### Community 11 - "Spending Insights Engine"
Cohesion: 0.08
Nodes (36): addYearMonths(), anchoredMonthDate(), BudgetSuggestion, buildMerchantDriftItems(), CategorizedSpendRow, collectMerchantDriftBuckets(), computeMerchantPriceDrift(), computeSafeToSpend() (+28 more)

### Community 12 - "Accounts Page Data"
Cohesion: 0.12
Nodes (28): AccountBalanceSnapshot, AccountGroupKey, AccountsPageData, AccountsPageRow, AccountsPageViewOptions, addAmount(), applyAccountsPageView(), BalanceChange (+20 more)

### Community 13 - "Plaid Item & Liabilities Sync"
Cohesion: 0.15
Nodes (24): diffRecurringStreams(), RecurringDiff, syncCardAprsForUser(), getPlaidClient(), consumeLinkToken(), decryptItemToken(), hashLinkToken(), listActiveItems() (+16 more)

### Community 14 - "Auth & Route Handler Core"
Cohesion: 0.17
Nodes (17): withUser(), safeEqual(), exportError(), AuthedContext, badRequest(), currentSessionId(), errorResponse(), requireAdmin() (+9 more)

### Community 15 - "Email Delivery Error Parsing"
Cohesion: 0.12
Nodes (18): describeDeliveryError(), domainEnd(), EMAIL_PART_SEPARATORS, findEmailSpan(), isAsciiLetter(), isEmailPartCharacter(), isPermanentDeliveryError(), redactEmails() (+10 more)

### Community 16 - "Dashboard Aggregation Core"
Cohesion: 0.19
Nodes (22): aggregateActiveMonth(), aggregateCashFlowMaps(), aggregateDashboardTransactions(), aggregateMonthlyMaps(), buildDashboardSpendMetrics(), buildDebtSummary(), buildMonthlyAggregates(), buildStreamSummaries() (+14 more)

### Community 17 - "API Tokens & Audit Logging"
Cohesion: 0.19
Nodes (17): API_TOKEN_PREFIX, hashApiToken(), verifyApiToken(), AuditAction, AuditParams, getClientIp(), writeAudit(), ExportContext (+9 more)

### Community 18 - "Budget Data Loading"
Cohesion: 0.13
Nodes (20): assertBudgetQuery(), BudgetLoadResult, BudgetPeriodRow, BudgetRow, getMonthEndExclusive(), GoalContributionSource, GoalEventRow, isStale() (+12 more)

### Community 19 - "Budget Page View Model"
Cohesion: 0.13
Nodes (18): appendSinkingFundProposals(), BudgetGroup, BudgetLine, BudgetPageData, BudgetSection, BudgetSummaryTab, BudgetViewInput, BudgetYearData (+10 more)

### Community 20 - "Cron Alerts & Push Notifications"
Cohesion: 0.18
Nodes (14): alertCronFailure(), isUndeliverableRecipient(), logError(), SENSITIVE_KEYS, BROWSER_PATTERNS, matchLabel(), notifyNewDeviceLogin(), OS_PATTERNS (+6 more)

### Community 21 - "Dashboard Domain Types"
Cohesion: 0.16
Nodes (20): AccountSummary, addMonths(), DashboardData, DashboardSpendMetricsInput, DashboardTransactionAggregates, enumerateMonths(), StreamRow, TxnLite (+12 more)

### Community 22 - "Financial Advice Progress"
Cohesion: 0.12
Nodes (16): ADVICE_PROFILE_KEYS, AdviceItemProgress, AdviceLibraryViolation, AdvicePrioritiesResult, AdviceProfileResult, AdviceProgressRow, AdviceView, buildAdviceView() (+8 more)

### Community 23 - "Feature Flags & User Data Export"
Cohesion: 0.14
Nodes (14): FEATURE_FLAG_DEFAULTS, FEATURE_FLAG_ENV, FeatureFlag, FeatureFlagEnv, FlagOverrides, isFeatureEnabled(), parseOverrides(), resolve() (+6 more)

### Community 24 - "Investment Holdings Sync"
Cohesion: 0.19
Nodes (17): daysBefore(), fetchInvestmentHoldings(), fetchInvestmentTransactions(), investmentOutcome(), InvestmentSyncOutcome, InvestmentSyncResult, InvestmentTransactionSyncResult, NO_PRODUCT_CODES (+9 more)

### Community 25 - "Advice Content Library"
Cohesion: 0.12
Nodes (15): ADVICE_DEFINITIONS, ADVICE_LIBRARY, AdviceCategory, AdviceDefinition, AdviceSource, AdviceTask, AdviceTaskInput, ALLOWED_SOURCE_HOSTS (+7 more)

### Community 26 - "Dashboard Drilldown"
Cohesion: 0.17
Nodes (15): buildDashboardDrilldown(), buildCategoryDrilldown(), buildMerchantDrilldown(), categoryContributions(), CategoryDrilldownData, categorySummary(), Contribution, contributionsForTransaction() (+7 more)

### Community 27 - "Plaid Transaction Sync"
Cohesion: 0.23
Nodes (15): invalidateDashboardCache(), getAccountIdMap(), setItemStatus(), updateItemCursor(), upsertAccounts(), mapTransactionRow(), NOOP_RESULT, notifySyncedTransactions() (+7 more)

### Community 28 - "Receipt Matching"
Cohesion: 0.22
Nodes (14): loadReceiptCandidates(), loadReceiptInbox(), publicReceipt(), RECEIPT_SELECT, ReceiptInboxRow, ReceiptRow, findReceiptCandidates(), merchantSimilarity() (+6 more)

### Community 29 - "Export Formats & Privacy-Safe CSV"
Cohesion: 0.20
Nodes (10): escapeField(), neutralizeFormula(), toCsv(), RFC-4180, ExportFetchResult, ExportRow, fetchPrivacySafeRows(), toTaxCsv() (+2 more)

### Community 30 - "Budget Line Building"
Cohesion: 0.27
Nodes (13): actualsForMonth(), addMonths(), addUnbudgetedLines(), budgetWindow(), buildBudgetLines(), buildBudgetPage(), buildBudgetSections(), buildBudgetView() (+5 more)

### Community 31 - "Planning Depth View"
Cohesion: 0.29
Nodes (11): buildPlanningDepthView(), buildRecurringStatuses(), daysBetween(), DebtAccount, LIABILITY_TYPES, normalize(), planDebtPayoff(), PlanningDepthAccount (+3 more)

### Community 32 - "Investment Benchmark Provider"
Cohesion: 0.22
Nodes (8): BenchmarkClose, BenchmarkKey, BenchmarkProvider, BenchmarkSeriesResult, cache, cacheKey(), getCachedBenchmarkSeries(), UNAVAILABLE_BENCHMARK_PROVIDER

### Community 33 - "Chart Rendering Utils"
Cohesion: 0.27
Nodes (7): annularSectorPath(), areaPath(), DonutSegment, donutSegments(), linePath(), Point, round2()

### Community 34 - "Token Encryption"
Cohesion: 0.31
Nodes (10): decodeKey(), DecryptedSecret, decryptSecret(), decryptSecretDetailed(), EncryptedPayload, encryptSecret(), getDecryptionKeys(), getKey() (+2 more)

### Community 36 - "Account Balance Snapshots"
Cohesion: 0.31
Nodes (9): AccountBalanceSnapshotInsert, assertDate(), currencyCode(), numberOrNull(), shapeDailyAccountSnapshots(), SnapshotManualAccount, SnapshotPlaidAccount, tryWriteDailyAccountSnapshots() (+1 more)

### Community 37 - "Advice Page Data & What-If"
Cohesion: 0.31
Nodes (9): AdviceProfileAnswers, AdviceContext, AdvicePageData, dayAfter(), loadAdvicePageData(), monthsBack(), computeWhatIfProjection(), computeRunwayMonths() (+1 more)

### Community 38 - "AI Insights Provider Gate"
Cohesion: 0.27
Nodes (8): isAskAiAvailable(), AggregateRow, buildInsightPayload(), generateInsightsWithProvider(), INSIGHT_SCHEMA, isAiProviderConfigured(), ProviderInsight, SYSTEM_PROMPT

### Community 39 - "Date Formatting Utils"
Cohesion: 0.24
Nodes (6): formatRelativeAnnotation(), formatRelativeTime(), localDateKey(), localMonthKey(), MONTH_ABBR, MONTH_DAY_YEAR

### Community 40 - "Dashboard Budget Groups"
Cohesion: 0.33
Nodes (8): buildDashboardBudgetGroups(), DashboardBudgetGroup, DashboardBudgetGroupKey, expenseGroup(), GROUPS, round2(), worseStatus(), EnvelopeStatus

### Community 41 - "Dashboard Cache"
Cohesion: 0.25
Nodes (6): CacheRecord, dashboardCache, dashboardScopeKey(), getCachedDashboardData(), DashboardOptions, DrillParams

### Community 42 - "Sinking Funds"
Cohesion: 0.32
Nodes (6): SinkingFundCadence, CADENCES, isIsoDate(), parseSinkingFundMutation(), SINKING_FUND_SELECT, SinkingFundMutation

### Community 43 - "Demo Data Generator"
Cohesion: 0.38
Nodes (5): buildDemoDataset(), DemoDataset, MERCHANTS, mulberry32(), toInt32()

### Community 44 - "Year in Money Summary"
Cohesion: 0.40
Nodes (5): AnnualTxn, computeYearInMoney(), round2(), YearInMoney, TRANSFER_GROUPS

### Community 45 - "Backup Encryption"
Cohesion: 0.67
Nodes (5): BackupEnvelope, buildBackupArchive(), deriveKey(), parseKey(), readBackupArchive()

### Community 46 - "Investment Performance (TWR)"
Cohesion: 0.33
Nodes (3): ExternalFlow, ReturnPoint, Valuation

### Community 47 - "Manual Transaction Validation"
Cohesion: 0.40
Nodes (5): ManualTxnAccountRef, ManualTxnInput, ManualTxnResult, normalizeManualTxn(), validAccount()

### Community 48 - "Passkey Availability"
Cohesion: 0.33
Nodes (3): PASSKEY_HOSTS, PasskeyAvailability, PasskeyAvailabilityOptions

### Community 49 - "Institution Branding"
Cohesion: 0.47
Nodes (5): fetchInstitutionBranding(), InstitutionBranding, normalizeBrandColor(), PNG_SIGNATURE, validateInstitutionLogo()

### Community 50 - "Tag Rename & Merge"
Cohesion: 0.40
Nodes (5): planTagRename(), TagNameResult, TagRenamePlan, TagRenameResult, validateTagName()

### Community 52 - "Profile Patch Validation"
Cohesion: 0.50
Nodes (4): ProfileFieldsPatch, ProfilePatchResult, validateOptionalText(), validateProfilePatch()

### Community 53 - "Receipt Image Normalization"
Cohesion: 0.40
Nodes (3): MAX_RECEIPT_IMAGE_BYTES, MIME_FORMATS, NormalizedReceiptImage

### Community 55 - "Card Network Detection"
Cohesion: 0.67
Nodes (3): CardStyle, detectCardDesign(), detectNetwork()

## Knowledge Gaps
- **328 isolated node(s):** `SnapshotPlaidAccount`, `SnapshotManualAccount`, `AccountBalanceSnapshotInsert`, `AccountGroupKey`, `UnifiedAccountSummary` (+323 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `logError()` connect `Cron Alerts & Push Notifications` to `Currency, Dates & Calendar Utils`, `Token Encryption`, `Account Balance Snapshots`, `Plaid Item & Liabilities Sync`, `Auth & Route Handler Core`, `API Tokens & Audit Logging`, `Investment Holdings Sync`, `Plaid Transaction Sync`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **Why does `createServiceClient()` connect `API Tokens & Audit Logging` to `Currency, Dates & Calendar Utils`, `Token Encryption`, `Env Config & Supabase Clients`, `Account Balance Snapshots`, `Plaid Item & Liabilities Sync`, `Auth & Route Handler Core`, `Cron Alerts & Push Notifications`, `Investment Holdings Sync`, `Plaid Transaction Sync`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **Why does `loadCanonicalProjection()` connect `Cash Flow Data Loading` to `Budget Data Loading`, `Debt Payoff Planner`, `Dashboard Widgets & Cumulative Spend`, `Advice Page Data & What-If`?**
  _High betweenness centrality (0.024) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `getDashboardData()` (e.g. with `isIncome()` and `isSpending()`) actually correct?**
  _`getDashboardData()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `SnapshotPlaidAccount`, `SnapshotManualAccount`, `AccountBalanceSnapshotInsert` to the rest of the system?**
  _328 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Currency, Dates & Calendar Utils` be split into smaller, more focused modules?**
  _Cohesion score 0.05583972719522592 - nodes in this community are weakly interconnected._
- **Should `Cash Flow Data Loading` be split into smaller, more focused modules?**
  _Cohesion score 0.05706760316066725 - nodes in this community are weakly interconnected._