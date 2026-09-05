# FundFlow comprehensive review

Review date: September 4, 2026, Pacific time.
This document is the high-level walkthrough.
The companion [implementation plan](2026-09-04-implementation-plan.md) maps every finding to concrete work and acceptance tests.

## Verdict

FundFlow has a coherent visual language, substantial functionality, and a healthy basic build.
It does not need a fashionable reskin.
It needs much stronger financial consistency, security enforcement, and product editing.
The current UI too often looks confident when the underlying information is incomplete, inconsistent, or based on an unstated assumption.
That is a more serious problem in a financial app than an unattractive button.

The harsh assessment: the transaction workflow wastes the first screen, the account overview prioritizes decoration over inspection, forecasting presents arbitrary targets as personalized milestones, and several dashboard cards contradict their destination pages.
Settings exposes implementation details where users need clear explanations.
Shipping more features before addressing these problems will increase complexity without increasing trust.

The most urgent work is to make session revocation authoritative, complete database-level MFA enforcement, make receipt consent fail closed, guarantee complete backups, and correct financial-model semantics.
No cross-user data theft was demonstrated, and this review is not a claim of a production compromise.
The verified security-policy weaknesses are nevertheless actionable without attempting an exploit against a real account.

## Evidence and boundaries

The local review used commit `4b554e03f92c5aa7d8142891041731cce3bbda2e` on `codex/docs-current-truth`.
The fetched `origin/main` and production deployment used `652ced2013a51e89a3d3464c8829b8c5adce53fa`.
Both commits had the identical source tree, `a1b40ee443f821d948a145dbc63f148e92af361f`.
Vercel reported the production deployment as READY.
The initial working tree was clean.

The review combined repository navigation, targeted source and test inspection, authenticated Chrome observation of the real application, read-only database policy metadata, the linked migration ledger, official provider documentation, and local checks.
The repository inventory included 120 application files, 201 component files, 164 library files, 519 test files, 85 documentation files, and 78 Supabase files.
Inventory coverage is not a claim that every line received equal scrutiny.

Browser coverage included Dashboard, Accounts, Transactions, Cash Flow, Reports, Budget, Recurring, Goals, Investments, Debt payoff, Forecasting, Advice, Notifications, Settings profile/security/data, Monthly review, and Year in Money.
Desktop observation used the existing dark theme.
Transactions and Settings were also inspected at 390 by 844 pixels, then the viewport and Dashboard were restored.
Mobile Settings adapted cleanly; mobile Transactions did not prioritize the core task well.
Personal screenshots, raw balances, account masks, emails, and merchant identifiers are deliberately not reproduced in these documents.

No financial records, bank connections, settings, sessions, or production database policies were changed.
No real account was deleted, restored, or subjected to a security exploit.
No paid AI request was submitted.
Integration and automated browser suites that can write through local environment credentials were not run against the linked personal project.
Light-mode live rendering, screen-reader operation, every keyboard interaction, all responsive widths, provider outage simulation, and full backup recovery remain explicit validation gaps.

| Evidence label | Meaning |
| --- | --- |
| Live | Observed in authenticated Chrome during this review. |
| Metadata | Verified with read-only deployed database/deployment metadata. |
| Source | A reachable implementation and its failure mechanism were traced. |
| Local reproduction | A bounded local experiment demonstrated the behavior. |
| Conditional | Requires a stated setting, data shape, outage, or provider configuration. |
| Improvement | A product/design recommendation, not an established defect. |

P1 means prioritize before expanding use or relying on the affected financial/security promise.
P2 means material correctness, reliability, or usability work for the next remediation sequence.
P3 means polish or maintenance after the higher priorities.
There are 33 numbered findings below; a finding can cover several related symptoms with one underlying remedy.

## Security and privacy

### FF-01: A revoked session can undo its own revocation

**P1 | Metadata + Source.**
The session record is the revocation authority, but the authenticated owner can update or delete that same record through Supabase.
The deployed owner policies and grants permit those operations, and the table has no trigger that makes revocation immutable.
A still-valid revoked owner token can therefore remove or clear the marker that `private.session_not_revoked()` relies upon.
This defeats the security promise of the Revoke button.
It does not require crossing another user's ownership boundary.

Evidence: `supabase/migrations/20260708040000_roadmap_completion.sql:129`, owner policies at lines 175-181, `supabase/migrations/20260810120000_session_revocation_rls.sql:18`, `app/api/settings/sessions/route.ts`, and `lib/http.ts`.
The API marks a database row revoked; it does not establish an independently immutable revocation authority.
Make revocation state server-controlled and give session heartbeat operations a much narrower contract.

### FF-02: MFA and revoked-session protection do not cover all financial data

**P1 | Metadata + Source.**
The hardening migration protects important core tables, but other sensitive tables retain owner-only policies without MFA or revocation checks.
Deployed examples include owner paths for holdings, manual accounts, receipts, scheduled transactions, and linked transfers.
A valid AAL1 session for a user who has enabled MFA can bypass the application's page guard by using a permitted direct data API path.
Permissive policies combine with OR, so one stronger policy does not repair a weaker owner policy.

Evidence: `supabase/migrations/20260810120000_session_revocation_rls.sql`, deployed `pg_policies` and grants, and `scripts/check-rls.sql`.
This is incomplete second-factor/session enforcement, not evidence that arbitrary users can read one another's data.
Audit every table, storage policy, and callable privileged function against one documented access matrix.

### FF-03: Receipt AI consent fails open when the profile cannot be read

**P1 | Source; conditional on enabled AI/provider.**
Receipt processing rejects an explicit `ai_export_enabled === false`, but missing profile data and query errors do not satisfy that rejection.
If AI settings are enabled, the route can send a receipt image despite being unable to establish the export preference.
The navigation helper repeats the same permissive logic.
Other export paths already contain a more appropriate fail-closed preference reader.

Evidence: `app/api/ai/receipt/route.ts:47`, `lib/ai-gate.ts:16`, and `lib/export.ts` function `readExportPreference`.
Use a shared consent decision with explicit unavailable, denied, and allowed outcomes.

### FF-04: Security checks treat infrastructure errors as permission to proceed

**P2 | Source; conditional on lookup failure.**
Session-revocation lookup intentionally fails open, session recording errors are treated as best effort, and the rate limiter returns allowed on failures.
The API MFA check also needs explicit handling of assurance-query errors.
These choices should not share one availability policy across ordinary refresh work, AI spending, authentication controls, and destructive actions.
Core RLS provides some defense, but FF-02 limits its coverage and service-role operations require particular care.

Evidence: `lib/session-revocation.ts:7`, `lib/http.ts:57`, `lib/http.ts:65`, `lib/rate-limit.ts:7`, and `lib/step-up.ts`.
Sensitive actions should return a clear temporary-unavailability response when their authorization prerequisites cannot be established.

### FF-05: Account deletion can fail after bank removal or leave stored files behind

**P1 | Source + official platform behavior; conditional on storage/provider state.**
Deletion removes Plaid items best effort and then deletes the Auth user without first handling Storage objects.
Avatar upload uses the authenticated Storage client, which creates user-owned objects.
Supabase documents that a user owning Storage objects cannot be deleted.
Receipt objects uploaded with a service role can instead have no owner, so relational cascades are not evidence that those bytes disappear.
A failed Plaid removal is logged and processing continues, while the audit field counts attempted items as removed.
The UI promises that all stored data and bank connections are erased more strongly than the workflow guarantees.

Evidence: `app/api/account/route.ts:67`, `app/api/settings/profile/route.ts:134`, receipt upload routes, and the Danger zone copy in Settings.
Sources: [Supabase user deletion](https://supabase.com/docs/guides/auth/managing-user-data), [Storage ownership](https://supabase.com/docs/guides/storage/security/ownership), and [object deletion](https://supabase.com/docs/guides/storage/management/delete-objects).
Design a resumable deletion workflow that retains enough secure state to retry external cleanup and reports actual completion.

### FF-06: Saved regular expressions can block the process

**P1 | Source + Local reproduction.**
The regex safety heuristic accepts `^(a?a?)+$`.
A bounded local child process testing that expression against 24 `a` characters followed by `!` exceeded three seconds and was terminated.
The safety scanner checks several ambiguous constructs but misses this nested optional construction.
Saved merchant rules are evaluated by finance projection and rule simulation, so a user-owned rule can make ordinary finance work very slow and consume shared server resources.
This is authenticated denial of service, not anonymous code execution.

Evidence: `lib/rules-engine.ts` function `safeCompileRegex`, `lib/planning.ts` rule matching, and `app/api/rules/batch/route.ts`.
Use a non-backtracking engine or an intentionally restricted rule language with explicit input bounds.
Do not fix this by merely adding one more pattern to the heuristic.

### FF-07: Four exported fields are not a guarantee of anonymous data

**P2 | Live + Source; privacy improvement.**
Raw merchant descriptions can contain ACH references, personal names, or other embedded identifiers.
The live application displayed raw bank descriptors in places intended to be readable merchant names.
Removing account-ID columns does not remove identifiers inside free text.
Settings encourages users to feed exports to an AI tool while saying there are no identifiers.
Receipt images also contain much more sensitive content than four transaction fields.

Evidence: Settings Data export copy, `lib/export.ts`, and AI payload construction in `lib/ai-provider.ts`.
Distinguish a minimized export from an anonymous export, document the actual provider payload, and apply an explicit descriptor-cleaning policy to AI-bound text without destroying the user's original ledger evidence.

## Financial correctness and recoverability

### FF-08: Full backup and takeout queries are not paginated

**P1 | Source; conditional on tables exceeding the response cap.**
`collectUserData` reads each table once without pagination.
The repository config sets the API row limit to 1,000, while the reviewed account's ledger contains several thousand transactions.
A request can succeed while returning only the server's first page.
The live server's effective response cap was not independently measured by downloading personal data, so the exact production truncation count is not asserted.
The implementation is nevertheless incomplete for any finite configured cap.
A successful encrypted attachment is not proof of a complete backup.

Evidence: `lib/user-data.ts:100`, `supabase/config.toml`, `app/api/export/takeout/route.ts`, and `app/api/cron/backup/route.ts`.
Require deterministic pagination, per-table row counts, explicit completeness metadata, and a stable archive contract.

### FF-09: The backup schema does not preserve the full application state

**P1 | Source.**
The shared archive registry omits newer user decisions and fields.
Examples include transaction display-category/cash-flow overrides, merchant-rule amount bounds and tags, and account-preference state.
A receipt storage path is not a backup of the receipt bytes.
The restore feature is disabled by default, which is an appropriate current guard, but it does not resolve the discrepancy between a full-backup promise and what can actually be recovered.

Evidence: `lib/user-data.ts` constant `USER_DATA_TABLES`, `lib/restore.ts`, `lib/feature-flags.ts`, and `scripts/restore-backup.mjs`.
Version the archive and inventory every user-owned table, field, foreign-key relationship, and stored object against a tested recovery contract.
Keep external access tokens and authentication secrets outside portable takeout.

### FF-10: Backup automation reports success even when users fail

**P2 | Source; conditional on partial failure.**
The cron catches per-user failures and still returns HTTP 200 with `ok: true`.
The workflow's success check can therefore pass despite missing backups.
Retrying the whole batch can send successful recipients duplicate mail because there is no equivalent of the weekly-report delivery journal.

Evidence: `app/api/cron/backup/route.ts` and `.github/workflows/backup.yml`.
Track per-recipient outcomes and idempotency, distinguish partial from complete success, and retry only unfinished deliveries.

### FF-11: Net worth disagrees across screens and snapshots can conceal incomplete data

**P1 | Live + Source.**
Dashboard net worth differed from Accounts and Forecasting by roughly $2.3k during the same read-only session.
The dashboard card uses the latest historical snapshot but labels it simply Net worth.
Accounts uses current balances and preferences.
The snapshot writer also treats linked accounts as included unconditionally and does not stop on every balance-read error.
That can preserve a partial or differently scoped figure as apparently authoritative history.

Evidence: `components/dashboard/widgets/NetWorthWidget.tsx`, `lib/dashboard.ts`, `lib/net-worth.ts`, and the Accounts summary implementation.
Unify the current-value contract, label historical values with their date, respect account inclusion preferences, retain currency boundaries, and never write a complete-looking snapshot after a failed source read.

### FF-12: Forecasting can double-count progress and invent milestone assumptions

**P1 | Live + Source.**
Forecast milestones use a default $3,000 monthly expense assumption because the page does not supply actual expenses.
The resulting emergency-fund and financial-independence targets are presented as personalized milestones without exposing that basis.
Historical negative savings is clamped to zero when deriving defaults.
Loan-payment defaults sum absolute values from both sides of matched movements, which can double-count credit-card payments.
The monthly projection reduces liabilities without reducing cash, while its savings default is based on income less expenses that exclude loan transfers.
Without an explicit post-debt cash-contribution contract, this can count debt principal as additional net-worth growth without its funding source.

Evidence: `lib/forecasting.ts:92`, `lib/forecasting.ts:249`, `lib/forecasting.ts:258`, `lib/forecasting.ts:354`, `lib/forecasting-data.ts`, and `app/forecasting/page.tsx`.
Starting balances also discard missing-value information and do not load account-inclusion or currency fields.
Reconcile the model with cash conservation and visibly editable assumptions before relying on its long-range chart.
These are application-model findings, not financial advice.

### FF-13: AI summaries use a different spending definition and mislabel six months as this month

**P1 | Source; conditional on insight generation.**
The privacy export projects canonical rows but drops their flow classification.
Insight aggregation then counts signed amounts instead of using the canonical income/expense/transfer semantics.
That can count loan payments or transfers as spending and misrepresent refunds.
The deterministic fallback can sum the fetched six-month dataset while describing it as this month.
Raw signed export rows can be legitimate for a ledger export; they are not automatically a valid spending aggregate.

Evidence: `lib/export.ts`, `lib/ai-provider.ts` function `buildInsightPayload`, `lib/ai-insights.ts`, and `app/api/ai/insights/route.ts`.
Use a separate, consent-gated canonical insight payload with explicit window, currency, scope, and coverage.
Preserve the documented raw export contract rather than silently removing ledger records to fix AI arithmetic.

### FF-14: Transfer matching and linking need stronger invariants

**P2 | Live + Source.**
The matching algorithm only considers incoming postings on or after the outgoing posting.
Different institutions can post the same movement in the reverse order; that pattern was visible in the ledger.
The endpoint uses a large `.limit()` without stable pagination, so a server cap can still restrict candidate coverage.
The confirmation path does not establish all the one-to-one, distinct-account, and date-window invariants that its UI implies.
A pair-unique constraint alone does not stop one transaction from being reused in another pair.
Linking and recording a decision should be one atomic operation.

Evidence: `lib/transaction-quality.ts:157`, `app/api/transactions/transfers/route.ts`, and linked-transfer migrations.
Use symmetric date tolerance, canonical ownership validation, one-use constraints, and persisted-state tests for concurrent confirmations.

## UI and everyday usability

### FF-15: The transaction sign explanation contradicts the displayed ledger

**P2 | Live + Source.**
The page says positive amounts are money out and mentions Plaid's sign convention.
The user-facing ledger negates the raw amount, so expenses display as negative.
A user should never need to know Plaid's convention to understand a transaction.

Evidence: `app/transactions/page.tsx:869` and `lib/ledger-projection.ts:134`.
Explain the displayed convention consistently across ledger, editor, import preview, and export documentation.

### FF-16: Transfer review overwhelms Transactions without enough information to decide

**P2 | Live + Source.**
Three large suggestion cards push search and the actual ledger below the first mobile screen.
The cards repeat Transfer between your accounts with amounts and dates but omit the two account identities and useful merchant context.
The user is asked to approve a consequential classification without the information needed to judge it.
Loading errors disappear, and successful decisions do not refresh the surrounding server-derived totals.

Evidence: `components/transactions/TransferReview.tsx` and `app/api/transactions/transfers/route.ts`.
Replace the wall of cards with a compact review-count entry and an inspectable two-sided queue.
Keep search and the first transaction visible promptly, show both sources, explain the effect, and refresh affected summaries after confirmation.

### FF-17: Dashboard filters do not have a consistent scope

**P2 | Source.**
The account selection reaches the main dashboard query, but cumulative spending loads an independent projection with no account filter.
`selectedAccountId` in the overview loader is used for the ledger strip rather than that spend query.
The toolbar therefore promises a broader scope change than this widget implements.

Evidence: `app/dashboard/page.tsx`, `components/dashboard/OverviewView.tsx`, and `lib/dashboard-widgets-data.ts:45`.
Pass one explicit scope through every relevant loader or label a card as all accounts when it intentionally ignores a filter.
Browser account-filter switching was not executed during this review, so this remains source-confirmed rather than a claimed live reproduction.

### FF-18: The dashboard says there are no investments when account balances exist

**P2 | Live + Source.**
The Investments page correctly provides balance-based coverage for retirement accounts without holdings.
The dashboard card reads holdings only and shows No investment holdings yet with a suggestion to sync another account.
This makes an existing supported condition look like missing setup.

Evidence: `lib/dashboard-widgets-data.ts` function `loadDashboardInvestmentSummary` and `components/dashboard/widgets/InvestmentsWidget.tsx`.
Reuse the detailed page's coverage semantics and distinguish known account balances from itemized holdings.

### FF-19: The recurring dashboard card mixes incoming money with bills due

**P2 | Live + Source.**
An incoming recurring stream appeared as Due.
The widget's simplified item loses stream direction and uses absolute amounts.
Its This month label also describes a next-seven-days window, and overdue items fall outside a future-only filter.

Evidence: `components/dashboard/widgets/RecurringWidget.tsx` and its dashboard item-building path.
Separate expected income from payments, show the actual date window, and provide an explicit overdue/uncertain state.

### FF-20: Budget navigation does not identify the selected period

**P2 | Live + Source.**
The Budget header offers Previous and Next without a visible selected month/year label in the reviewed view.
A user can change financial periods without being able to verify the active period easily.
With no configured budget, large empty groups and zero left-to-budget figures make an unconfigured plan resemble a completed plan.

Evidence: `app/budget/page.tsx` and `components/budget/BudgetPlanner.tsx`.
Make the period explicit, preserve it in navigation, and provide a guided first-budget state with reviewed suggestions instead of empty planning scaffolding.

### FF-21: Missing evidence is presented as reassuring progress

**P2 | Live + Source.**
Goal status returns on-track when pace is unknown.
Monthly review says no categories are projected over limit when there are no configured categories to evaluate.
Both statements can reassure the user without evidence of progress or coverage.

Evidence: `lib/goals-v2.ts:186` and `app/review/page.tsx:103`.
Use No pace data, Set a contribution, and No budget configured as distinct states.
Explain that goal allocation is bookkeeping, not a transfer of money between banks.

### FF-22: Period and data-coverage context is too weak

**P2 | Live + Source; partly product improvement.**
Early in the current month, Cash Flow displayed an extreme negative savings rate because recorded income was very small relative to expenses.
The arithmetic can be correct; clamping the percentage would hide information.
The missing context is month-to-date coverage, expected income timing, and a clear distinction between income and ambiguous merchant credits.
Year in Money says Across the whole year even for the current incomplete year.

Evidence: Cash Flow, Monthly review, `app/wrapped/page.tsx:127`, and `lib/finance-domain.ts` flow classification.
Label incomplete periods, compare equivalent elapsed windows, and provide a reviewable classification for refunds and statement credits.
Do not assume that every incoming merchant transaction is a refund or silently rewrite historical data.

### FF-23: Annual-summary drilldowns lose the selected year

**P2 | Live + Source.**
Year in Money category and merchant links pass only a category or merchant to Transactions.
They omit the selected year, so the destination does not explain the annual total the user clicked.

Evidence: `app/wrapped/page.tsx:151` and `app/wrapped/page.tsx:165`.
Carry the inclusive start and exclusive end of the selected year through a supported ledger filter and preserve that context in exports.

### FF-24: Accounts spends too much space on an under-explained chart

**P2 | Live; design improvement.**
The account overview allocates much of the first desktop screen to a large chart with little immediately visible scale/date context.
The rows needed to inspect accounts are pushed down.
Multiple history/sparkline treatments compete rather than answer a distinct question.
Some selectors still show duplicated masks or malformed source characters despite cleanup elsewhere.

Evidence: Accounts screen, its summary/chart components, and Settings Data account selectors.
Use a compact dated summary, readable axes or an accessible equivalent, and a useful first account row above the fold.
Apply one display-name formatter consistently while retaining original bank names in details.

### FF-25: Connection health and balance freshness communicate different kinds of truth

**P2 | Live; design improvement.**
A recent successful synchronization and healthy bank status coexist with old balance timestamps on individual accounts.
Those conditions can both be true, but users can interpret the green status as proof that every balance is current.
The account-level stale indicators are useful and should remain.

Evidence: Dashboard bank health and Accounts freshness labels during the same session.
Separate connection status, last attempted sync, last successful transaction update, and balance as-of dates.
Summarize stale coverage wherever totals depend on stale balances.

### FF-26: Settings has competing import workflows and misleading location copy

**P2 | Live + Source.**
Data displays both Import data and Import with review as separate full workflows.
For financial records, preview and duplicate review should be the obvious main journey.
Receipt scanning says enable AI insights above even though that control lives in Integrations.
The long page mixes exports, two imports, receipt scanning, demo data, and account destruction.

Evidence: `components/settings/ImportSection.tsx`, `components/settings/ImportReviewSection.tsx`, Settings section composition, and receipt scanning copy.
Consolidate import entry into a preview-first flow, deep-link prerequisites, and group data portability, record capture, and destructive actions more clearly.

### FF-27: Security history is not useful to a nontechnical user

**P2 | Live + Source.**
Active sessions display full browser user-agent strings instead of readable device names and last-active times.
Audit log rows display event keys and metadata field names, without useful event explanations, timestamps, or outcomes in the reviewed UI.
A user cannot readily answer Was that me? or Did the action succeed?

Evidence: `components/settings/SessionsSection.tsx` and `components/settings/AuditLogSection.tsx:43`.
Show readable device/browser labels, current-session state, last activity, and timestamped audit summaries with expandable sanitized detail.
Do not imply device location unless a trustworthy, privacy-reviewed source exists.

### FF-28: Navigation, hierarchy, and action emphasis need product editing

**P3 | Live; design improvement.**
Cash Flow and Reports have overlapping entry points, Reports has many competing controls, and Advice puts long explanations ahead of a clear next action.
The Settings profile save button stretches across a very wide desktop panel, giving a routine action more visual weight than its importance warrants.
Orange emphasis is used frequently enough that truly important actions lose distinction.

Keep the existing warm palette and component vocabulary.
Prioritize daily tasks, progressively disclose secondary controls, constrain reading width, and use one dominant action per section.
Preserve the successful mobile Settings selector and existing accessible skip/navigation patterns.
Validate light/dark themes, keyboard operation, zoom, reduced motion, focus restoration, and loading/error/empty states before calling the redesign complete.
Those accessibility checks are acceptance work, not a claim that each currently fails.

## Engineering, dependencies, and documentation

### FF-29: The default AI model configuration is obsolete and internally incompatible

**P1 | Source + official provider documentation; conditional on environment override.**
The PR changed the default to `claude-3-5-sonnet-20241022` while requesting adaptive thinking on newer model families.
The provider documents that default as retired, so a deployment without an explicit model override can fail at runtime.
An environment override may avoid the retired default, but the deployed override was not disclosed or tested.
The September 2 TODO assertion that the previous default was supported is incorrect.
Ask and receipt errors also use generic failure responses while documentation describes graceful degradation more broadly.

Evidence: `lib/ai-provider.ts:119`, `app/api/ai/ask/route.ts:62`, `app/api/ai/receipt/route.ts:72`, and `docs/TODO.md`.
Sources: [model deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations), [adaptive thinking](https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking), and [structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs).
Centralize provider construction and model capabilities, select a supported model explicitly, and test degradation per route.

### FF-30: Green checks do not test the highest-risk contracts

**P2 | Source + executed checks.**
The current unit suite is large and passes, but that does not establish real JWT enforcement, complete recovery, concurrent transfer atomicity, or financial conservation.
The CI dependency audit ends with `|| true`, so new high-severity advisories do not fail that job.
The migration check mainly inspects policy structure rather than exercising every access path with realistic tokens.
Test setup loads local environment credentials, and documentation does not consistently prevent integration tests from targeting a personal project.

Evidence: `.github/workflows/ci.yml`, migration-check workflow, `scripts/check-rls.sql`, `tests/setup.ts`, and `tests/integration/`.
Create an explicit isolated test-project contract and make security/completeness regression checks required.
Do not weaken tests to preserve a green badge.

### FF-31: Migration history needs deliberate reconciliation

**P2 | Metadata; operational work, not an asserted missing deployment.**
The linked ledger has local-only versions `20260902220000`, `20260903010000`, and `20260904000000`, plus remote-only versions `20260903171727` and `20260903171733`.
Local filenames concern smart-rule regex, merchant-rule tags, and atomic account preferences.
This does not prove that the corresponding schema is absent, because remote migrations may contain equivalent changes under different versions.
Current handoff documentation already acknowledges migration ambiguity.

Evidence: successful `supabase migration list --linked` during this review and the migration directory.
Compare exact migration content with deployed columns, functions, grants, and constraints before applying or repairing ledger history.
Do not blindly replay historical migrations or mark them applied based on filenames.

### FF-32: Living documentation contradicts current code and itself

**P2 | Source.**
README/architecture/constitution descriptions of a single Anthropic constructor conflict with the three current call sites.
The model-validity statement is stale.
Architecture text describing receipt support as schema-only is obsolete relative to active upload routes.
Webhook test-bypass wording conflicts with the hardened implementation and newer handoff text.
The restore script references a moved roadmap document, and recovery claims exceed FF-08/FF-09.
Test instructions need to distinguish unit checks from isolated integration work.
Some QA diagnostic language treats a stylesheet symptom or a successful HTTP response as more conclusive than it is.

Evidence: `README.md`, `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/TODO.md`, `docs/HANDOFF.md`, `docs/QA.md`, `scripts/restore-backup.mjs`, and `lib/feature-flags.ts`.
Keep current state in the living documents and use archived reviews only as historical evidence.
Do not rewrite archived findings or manually edit generated changelogs to make the history appear cleaner.

### FF-33: Dependencies and operational tooling need a staged refresh

**P3 | Executed freshness check.**
The dependency audit returned zero known vulnerabilities at review time.
New versions are available, but version age alone is not a security finding.
Candidates include Playwright 1.63, Supabase JS 2.115, Supabase SSR 0.12.6, Anthropic SDK 0.124, and Lucide 1.41.
Major candidates include Vitest 5, ESLint 10, Nodemailer 10, Plaid 47, and TypeScript 7.
Separate compatibility-sensitive changes instead of combining them into the review-doc change.

The Vercel CLI session reports 59.11.2 with 59.11.7 available.
Upgrade the CLI with `npm i -g vercel@latest` or `pnpm add -g vercel@latest` for current compatibility.
Also measure the effect of the app/database region separation before changing deployment region; geographic separation is an optimization hypothesis, not measured proof of a latency defect.

## What passed and what should not be re-opened blindly

| Check | Result |
| --- | --- |
| Unit suite | 438 files, 4,770 tests passed. |
| Lint | Passed. |
| Typecheck | Passed. |
| Production build | Completed successfully. |
| Palette validation | Passed its configured light/dark checks. |
| Dependency audit | Zero reported vulnerabilities. |
| Local/production source alignment | Identical trees at the recorded commits. |
| Migration ledger read | Succeeded; discrepancies recorded in FF-31. |

The detailed Investments page already handles balance-only coverage.
Reports already provides sort controls, and the weekly PDF action is labeled as a weekly report.
The restore kill switch is disabled by default.
The current webhook implementation no longer has the broad test-environment bypass described in older material.
Mobile Settings uses an appropriate compact section selector.
These are reasons to reuse existing good patterns, not to revive old findings without checking them.

## Recommended order

1. Close the session, MFA, consent, deletion, and regex risks.
2. Establish complete recoverable archives and observable delivery.
3. Reconcile net worth, forecasting, and AI financial semantics.
4. Repair transaction review and scope-preserving drilldowns.
5. Simplify the daily UI and remove false reassurance.
6. Update living documentation, required checks, and dependencies against the corrected behavior.

The implementation plan supplies exact file targets, test cases, sequencing, and release gates for these steps.
