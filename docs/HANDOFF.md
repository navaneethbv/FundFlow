# FundFlow — Session Handoff

Last updated: 2026-09-05. Read this first to resume.

## 2026-09-05: Second review round on PR #153

Branch: `codex/comprehensive-review-remediation` (unchanged).

The 2026-09-04 entry below claims all 33 findings were "fully resolved".
A second review of the branch at `4ddf547` rejected that, reproducing defects against seven findings plus four unfinished follow-ups.
Read the 2026-09-04 entry as the record of what each package touched, not as a statement of what shipped.
[`TODO.md`](TODO.md) now carries the accurate closed / closed-with-a-limit / deferred split.

What this round changed:

1. **FF-02, MFA and revocation gates were incomplete.**
   `life_events`, `credit_card_bills` and `account_reconciliations` still had owner-only policies, and a wider audit found 37 user-data tables in the same state.
   `supabase/migrations/20260905100000_mfa_gate_remaining_user_tables.sql` rewrites each policy in place from `pg_policies`, ANDing the two gates onto the recorded predicate so no existing ownership check is retyped by hand.
   `profiles`, `user_session_records` and `mfa_backup_codes` are excluded on purpose: all three are read before a session can reach AAL2.
2. **FF-06, the regex guard only looked at groups.**
   `^a*a*a*a*a*a*!$` has none, so it compiled and then ran for seconds.
   New `lib/regex-safety.ts` defines a restricted language: no ambiguous quantified group, no two adjacent loops over a shared character, at most three loops.
   RE2 and worker-thread timeouts were not options, because `safeCompileRegex` is imported by a client component.
3. **FF-09, backups could not restore what they promised.**
   Added the missing annotation columns, the account provider keys, and receipt image bytes.
   `accounts` and `manual_accounts` now upsert instead of delete-then-insert, so a restore no longer cascades the ledger away before refilling it.
   Both remaining limits (an 8 MiB image budget, and accounts whose Plaid item is gone) are reported in the archive and the restore result rather than hidden.
4. **FF-10, backup deduplication was not durable.**
   New `public.backup_deliveries` journal; the claim is the insert, so the primary key arbitrates concurrent runs, and both the claim and the completion check their errors.
5. **The rest.**
   FF-13 signed expense credits; FF-12 loan-payment double counting and net-worth-parity starting balances; FF-30 fail-closed test-database guard; FF-07 export copy; FF-26 one import workflow; FF-27 session and audit timestamps.
6. **Three Sonar findings.**
   `computeForecastMilestones` cognitive complexity, `table()`'s eight parameters, and a rethrow-only catch in the transfers route.

Verification: 444 test files, 4,900 unit tests, all passing.
Branch coverage is 95.07% against the 95% gate; lint, typecheck, `next build` (70 routes) and the palette validator are clean.

**Not verified, and not claimed.**
Neither new migration has been applied to the linked project, and neither was run against a real Postgres (no Docker on this machine), so the `DO` block in the gate migration is reviewed but unexecuted.
Apply both by hand before deploying: the backup cron writes to `backup_deliveries` on every run, so shipping the code without `20260905110000` fails every backup.
Production exploit testing and a live restore from a real archive were also not performed.

## 2026-09-04: Comprehensive review remediation (Packages A–J, FF-01 through FF-33)

Branch: `codex/comprehensive-review-remediation`.
> **Superseded.** This section claimed all 33 findings were fully resolved. The 2026-09-05 review found seven of them
> reproducible and four follow-ups unfinished; see the entry above. Kept for the record of what each package touched.

All 33 findings identified in `docs/reviews/2026-09-04-comprehensive-review.md` and planned in `docs/reviews/2026-09-04-implementation-plan.md` were addressed in this round.

Key architectural and behavioral updates:
1. **Security & Session Enforcement**:
   - `supabase/migrations/20260904120000_session_revocation_and_mfa_hardening.sql`: RLS policy allowing users to select their own `user_session_records`.
   - `app/api/settings/sessions/route.ts`: Switched GET to cookie-bound user client; restricted service-role client strictly to session revocation.
   - `lib/http.ts`: MFA verification fails closed (503) on `aalError` instead of falling back to aal1.
   - `lib/rate-limit.ts`: Added `failClosed` option for sensitive / security routes.
2. **AI Consent & Rules Engine**:
   - `lib/ai-gate.ts`: Introduced `resolveAiConsent` strictly enforcing double-consent (`ai_settings.enabled` AND `profiles.ai_export_enabled !== false`) and failing closed (403/503) on errors or missing profiles.
   - `lib/rules-engine.ts`: Regex compilation validates length (<= 250 chars) and complexity to prevent ReDoS before evaluating rules.
   - `lib/ai-provider.ts`: Server-only AI provider routing (`claude-sonnet-4-6`) explicitly filters out transfers and loan payments from prompts.
3. **Data Lifecycle & Account Hygiene**:
   - `app/api/account/route.ts`: Purges user-owned storage objects (`avatars` and `receipts`) via service role client before deleting auth user to prevent Supabase deletion failures and orphaned bytes.
   - `lib/user-data.ts`: Deterministic 1,000-row chunked pagination for takeout and backup; added full state table coverage (`account_preferences`, `credit_card_bills`, `life_events`).
   - `app/api/cron/backup/route.ts`: Fails with non-200 status when user queries error; skips redundant monthly backups.
4. **Financial Calculations & Forecasting**:
   - `lib/net-worth.ts`: Properly respects `include_in_net_worth === false` across accounts and throws on query errors rather than reporting partial net worth.
   - `lib/forecasting.ts`: Ensures cash conservation in `stepMonth` (balance adjusts for income minus expenses); computes un-clamped negative savings rates for honest debt visibility.
   - `app/forecasting/page.tsx`: Uses median monthly expense for milestone calculation.
5. **Transaction Integrity & Ledger Depth**:
   - `lib/transaction-quality.ts`: Symmetric transfer detection date window (+/- days).
   - `app/api/transactions/transfers/route.ts`: Pre-filters already linked transfer transactions and enforces account distinctness.
   - `lib/ledger-query.ts` & `app/wrapped/page.tsx`: Adds explicit year filter bounds to prevent unbounded history scans.
6. **UI/UX Polish**:
   - Investments widget displays itemization notices when balance is present without holdings.
   - Recurring widget clearly labels income vs expense, marks overdue items, and clarifies dropdown range ("Next 7 days").
   - Budget page provides horizon-aware shifting, visible period labels, and guided unconfigured state.
   - Goal cards distinguish missing pace evidence with `"no-pace"` badge and bookkeeping disclaimers.
   - Settings sessions displays human-readable device/browser labels (`lib/security-account.ts`) and readable audit actions (`AuditLogSection.tsx`).
7. **Verification & Freshness**:
   - Production database safety check enforced in `tests/setup.ts`.
   - CI audit made blocking (`npm audit --audit-level=high`).
   - Minor dependencies updated cleanly via `npm-check-updates`.
   - All 438 test files (4,775 tests) pass 100%. TypeScript (`tsc --noEmit`), ESLint (`npm run lint`), palette validator, and `next build` all exit 0.

## 2026-09-04: documentation refresh and deployment-state reconciliation

PR #151 is merged into `main`.
Completed reviews, plans, and prompts were moved under `docs/archive/` and
`docs/superpowers/archive/`; those files are provenance, not current
instructions.

The linked Supabase migration ledger does not match the local names for
`20260902220000_smart_rules_regex`, `20260903010000_merchant_rules_tags`, or
`20260904000000_account_preferences_atomic`.
It contains two different September 3 remote entries that are not present
locally.
Reconcile that history before describing those migrations as deployed.

## 2026-09-03: PR #149 review round and migration state

PR #149 (`feat/frontend-motion-and-power-features`) went through a full review;
the findings and their reasoning are archived in
`docs/archive/CODE_REVIEW-PR149-2026-09-02.md`.

The scheduled-transactions, budget-template, linked-transfer, and account-
reconciliation migrations are recorded as applied to the linked project
`zrxbmmtqqhlwtrinocww`.
The smart-rules, merchant-tags, and account-preferences migrations need their
remote-history mapping reconciled before they can be called deployed.

The first four were already applied and were verified rather than assumed: the
`linked_transfers` one matters most because its second half widens
`transaction_review_decisions_kind_check` to `('duplicate', 'refund',
'transfer')`.
The smart-rules and merchant-tags schema changes were recorded as applied in
the earlier review, but their current remote migration names do not match the
local files and must be reconciled before relying on that record.

Backup restore ships **disabled**.
`executeRestore` deleted `accounts` before reinserting them, and `accounts` cascades into `transactions` and most of the schema, while the reinsert could never satisfy the `plaid_item_id` / `plaid_account_id` NOT NULL columns because `plaid_items` holds the encrypted Plaid token and is deliberately outside the backup registry.
That is a design gap rather than a missing column, so the surface sits behind `FEATURE_FLAG_DEFAULTS.backupRestore: false`, gated in the route immediately after `requireUser()`.
The redesign is recorded in `docs/TODO.md`.

## 2026-08-30: PR #130 hybrid recurring detection

Branch `codex/pr-130-recurring-impl` adds a local recurring detector that fills the gap when Plaid returns no recurring stream, on top of the Plaid 46 upgrade the PR already carried.

Plaid stays authoritative.
A deterministic detector reads canonical transactions and materializes inferred streams into the existing `recurring_streams` table, so the calendar, review, dismissal, override, notification, and household behavior all keep working unchanged.
Thresholds are weekly 8-in-8-weeks, biweekly 4-in-8-weeks, monthly 3-in-4-months, and quarterly 3-in-10-months; annual is never inferred because three annual occurrences exceed reliably available history.
Amounts qualify as fixed, single newest price step, or bounded variable, and a variable stream additionally needs a utility or bill category or a recurring signifier and is rejected outright for an `in store` channel.

Inference runs after transactions are durably synced: manual refresh and the daily cron take the full hybrid path, auto refresh runs local inference only so Plaid request volume is unchanged, and both the transaction and the new `RECURRING_TRANSACTIONS_UPDATE` webhooks reconcile the affected item.
An import commit into a connected account also triggers it.
Failures degrade rather than break: a detector error never fails an already durable sync, webhook, or import.

**All three migrations are applied to the linked project** (`20260830190000`, `20260830200000`, `20260830210000`).
Two of them did not compile against a real Postgres and were fixed while applying: an unparenthesized `CASE ... THEN` inside an `IF` condition truncated the expression, and `datetime_field_value_out_of_range` is not a real condition name.
Both had passed review because pgTAP could not run locally without Docker.

Local verification passed typecheck, lint, production build, `npm audit` with zero vulnerabilities, and 4,338 tests across 406 files including the live-Supabase integration suite.
The three existing recurring browser tests pass.

The new `infers a monthly stream when Plaid omits it` browser test is **written but never executed**: it needs Plaid sandbox credentials, and `.env.local` points `PLAID_ENV` at production.
It self-skips rather than issuing sandbox calls with a production secret.
Run it in an environment with `PLAID_ENV=sandbox` and matching `PLAID_SECRET` before treating the browser regression as proven.


## 2026-08-29: PR #137 exact-head review and remediation

Branch `codex/monarch-production-alignment` implements Phase 0 through Phase 6 of the Monarch alignment plan.
The second full review confirmed and fixed merchant-rule precedence, recurring-calendar keyboard and ARIA behavior, cursor-health persistence, budget replacement identity, import conflict approval, override validation, canonical export dependencies, bounded reads, weekly and annual override propagation, liabilities preservation, bounded sync progress, repair locking, reconciliation aggregation, investment-account coverage, and user-timezone date boundaries.

The recurring calendar now uses full date keys, a single roving tab stop, real grid rows, and the actual last date of the month.
Normal transaction sync and repair both apply and persist bounded page progress, reject unknown accounts before cursor advancement, and coordinate through the item claim lock.
Account reconciliation now uses `20260829173000_account_reconciliation_aggregate.sql` to compute owner-scoped integer-cent totals and per-account coverage in PostgreSQL instead of downloading up to 20,000 rows per account.

Plaid Liabilities bill synchronization is disabled by default through the `liabilitiesSync` feature flag because it adds a separately billed provider request for each user and sync run.
Enable it only after Plaid product access and quota impact are approved by adding `liabilitiesSync` to `FUNDFLOW_FEATURE_FLAGS`.
The older APR enrichment path remains separately gated by `PLAID_LIABILITIES_ENABLED=1`.

The original migrations through `20260829160000` are present in the linked migration ledger.
The four follow-up migrations are recorded as applied in the linked migration
ledger.
They should still be rechecked with the linked ownership, retirement,
identity, and reconciliation assertions before any production claim is made:

1. `20260829170000_credit_card_bill_insert_ownership.sql`
2. `20260829171000_life_event_retirement_amount.sql`
3. `20260829172000_goal_import_identity_unique.sql`
4. `20260829173000_account_reconciliation_aggregate.sql`

The migration ledger is evidence of deployment, but it does not replace the
linked behavioral checks or the authenticated production comparison.

Local verification passed lint, typecheck, production build, 4,147 unit tests, the focused sync integration suite, and the recurring and repair browser acceptance paths.
Unit coverage is 98.09% statements, 95.11% branches, 98.76% functions, and 99.08% lines.
`npm audit --omit=dev` reports zero vulnerabilities.
The linked migration ledger confirms those four migrations are present remotely.
The exact Production deployment commit and authenticated comparison remain
external verification steps.

The tracked-tree privacy pass removes 29 personal screenshots and attachments, deletes the live-data remediation plan, and replaces exact live financial evidence with synthetic values and generic labels.
The ignored local `qa-shots` folder was also moved out of the repository workspace because its generated reports and live-data screenshots contained personal identifiers.
The retained visual-regression baselines are generated from the disposable `Quality Reviewer` fixture and contain only synthetic data.
The tracked tree contains no occurrence of the requested personal email address or username.
Deleting `.vscode/settings.json` intentionally removes the repository-specific SonarLint connected-mode identifier; developers may configure connected mode locally without committing that file.
Historical Git objects and author metadata are outside a normal PR deletion and require a separately authorized coordinated history rewrite if permanent historical erasure is required.

## 2026-08-28: PR #134 UI review remediation (F1-F12)

PR #134 is merged.
The point-in-time review and remediation notes are archived under
`docs/archive/`.

### Follow-up review fixes (historical working-tree state)

A second review of the uncommitted remediation caught a regression and a correctness bug in the F2 (Review PDF) work, plus a few smaller items.

**`/api/export/report` now serves both cadences.** F2 made `month=YYYY-MM` mandatory, which 400'd the two existing no-parameter callers (`app/reports/page.tsx` and `components/settings/ExportSection.tsx`), replacing the app with raw JSON.
The route now takes `month` as optional: given, it is a monthly review; omitted, it is the current week (from `profiles.timezone`), matching the Monday cron.
`WeeklyReportPeriod` carries a `kind` (`"weekly" | "monthly"`, absent means weekly), and `buildWeeklyReportModel` measures budgets against the full `monthlyLimit` for a monthly period instead of the `* 12 / 52` weekly proration (which had marked every monthly budget ~4x over).
`generateWeeklyReportPdf` resolves its "week"/"month" copy from `period.kind` via the exported `reportCadenceCopy` helper; the model field `weeklyAllowance` was renamed to `allowance`.

**All three PDF download buttons now use `components/review/ExportReportButton`** (fetch + blob), so a 403/400/500 shows an in-app error instead of navigating the browser to a JSON error document.

Smaller: `loadCanonicalProjection` no longer `await`s the split-chunk batch inside its `Promise.all` (it was serializing the five dependency queries behind every split read); the receipt-scan file picker shows the chosen filename again; two `app/globals.css` indentation slips fixed.

The twelve review findings are addressed. The two high-severity correctness fixes changed shared loaders, so they are worth carrying forward as rules:

**Supabase ranges are inclusive and PostgREST caps a single response at 1,000 rows, so every ranged read must carry an explicit date+id order and page deliberately.** The Year in Money page and the duplicate-review loader both silently read only 1,000 rows at volume; both now page through the canonical loader or an equivalent ordered range walk.

**A 500-id `in()` list overflows Node's 16 KB header limit (`UND_ERR_HEADERS_OVERFLOW`).** The split-chunk size is now 250 in `lib/finance-query.ts`, `lib/cash-flow-data.ts`, and `lib/weekly-report-data.ts`, and split reads run with bounded concurrency (`runBatched`, cap 6) instead of firing every chunk at once.

`fetchFinanceTransactions` now issues one exact count in parallel with page zero and fetches the remaining pages in bounded concurrent batches, which took Cash Flow from ~9–10 s to under 4 s warm at all three viewports.

The F10 contrast fixes changed the light accent to a burnt orange (`--accent: #9a3412`), added `--accent-foreground` (white) and `--accent-strong-foreground` (dark) so both the dark and vivid orange fills pass AA, darkened muted/success/danger, and lightened the dark muted. `scripts/validate_palette.js` now gates these exact text pairs at 4.5:1. Re-step with the validator, never by eye.

The axe verification required real signed-in scanning: unauthenticated probes against protected routes redirect to the login page and report login-only contrast nodes, and a theme flip needs a settle delay before axe samples colors.

## 2026-08-21: documentation refresh and archive

Branch `docs/refresh-and-archive-2026-08-21`. Docs only, no runtime code touched.

**The "no in-app AI" rule was false and had been for a while.** `CLAUDE.md`
stated it as a hard product constraint while `app/api/ai/{insights,ask,receipt}`
had been calling the Anthropic SDK; `README.md` still said "instead of sending
your data to an LLM" and listed AI insights as *planned*. All three now
describe what the code does: export stays the default path, and the in-app
surface is documented as opt-in twice (deployment key plus per-account
consent), aggregate-only, per-user rate capped, and degrading to the local
rule-based summaries rather than erroring. The privacy contract, not the
absence of AI, is the thing to protect. `docs/ARCHITECTURE.md` gained an
"In-app AI" section with the invariants, and `.env.example` finally documents
`ANTHROPIC_API_KEY` (it never did, so the feature was undiscoverable).

**Two findings came out of writing that up**, both recorded at the top of
`docs/TODO.md` and deliberately left unfixed in that documentation refresh:
the default model id was not a real model (and `insights` masked the failure by
falling back to local summaries), and `/api/ai/receipt` was gated on
`ai_settings.enabled` only, despite a docstring claiming the same double
consent as insights. Both findings were resolved in the September AI hardening
work; this entry preserves the state of the earlier refresh.

**Archived, not deleted.** Closed reviews and superseded changelogs moved to
`docs/archive/` (with a new `docs/archive/README.md` index saying what each
was and what replaced it); the eleven July plans and six July specs, whose
phases are all marked Done in `docs/TODO.md`, moved to
`docs/superpowers/archive/`. `docs/` is now six live files. Every inbound
link was repaired, which is worth knowing before writing a new one: these
docs cite each other constantly by backticked repo-root path, so a move is
never just a move.

## 2026-08-21: migration import from Mint, Monarch, and YNAB

Branch `feat/production-readiness-2026-08`. Plan:
`docs/superpowers/archive/plans/2026-08-21-migration-import.md`.

**What shipped.** Three pure sniffer+normalizer pairs feed the existing
import pipeline: `lib/import-mint.ts`, `lib/import-monarch.ts`,
`lib/import-ynab.ts`, each emitting the existing `ImportedRow` shape with
Plaid sign convention (positive = money out).
Mint's sign comes from `Transaction Type` (`debit`/`credit`), never from the
raw `Amount` magnitude. Monarch's signed `Amount` is negated at the
normalizer boundary. YNAB reuses the shared `twoColumnToSignedAmount` rule
extracted from the generic debit/credit branch in `lib/import.ts`, preferring
`Category Group/Category` over the bare `Category` column.

`lib/import.ts::detectSourceFormat` now dispatches OFX → Mint → Monarch →
YNAB → plain CSV in one place, and both `/api/import/preview` and
`/api/import/csv` dispatch through it, replacing each route's duplicated
inline OFX-vs-CSV branch.

**Category gap closed.** `import_review_rows` gained a nullable `category`
column (migration `20260821155029_import_review_row_category.sql`, applied to
the linked live project on 2026-08-21) so a staged row's category survives
preview and the commit route threads it into `pfc_primary` instead of
hardcoding `null`. Mint/Monarch/YNAB rows carry real categories; this was the
one correctness gap the plan's research surfaced.

**Verification.** `npm run lint`, `npm run test:unit` (2552 tests), and
`npm run build` are all green. New unit coverage: `import-mint.test.ts`,
`import-monarch.test.ts`, `import-ynab.test.ts`, plus `detectSourceFormat`
cases and route-level tests for no-manual-mapping preview, the
deterministic-id upsert path, and commit-time category threading.

**Not verified end to end.** The three acceptance criteria from `features.md`
§6 (preview+commit each format through the review queue without manual
mapping; re-import idempotency; second-import remembering nothing new) are
covered at the unit level but were not exercised against the live dev server
with real files. The plan's literal "re-import reports imported: 0" does not
match the csv route's response semantics (`imported` counts rows in the
file, not rows newly inserted); idempotency is guaranteed by the
deterministic `import-<hash>` ids, which the unit tests prove collide on
re-import.

## 2026-08-20: production-readiness pass (branch `feat/production-readiness-2026-08`)

Phase 0 (mechanical), Phase 1 (fresh security/money review), Phase 2
(dependabot sweep), and Phase 3 (owner-decision checklist). See
`docs/archive/Security-Review-2026-08-20.md` for the full Phase 1 findings.

**nanoid CVE (GHSA-2v37-7h3g-55p8, alert #18).** `npm audit fix` bumped nanoid
3.3.17 → 3.3.18 via the single deduped `postcss@8.5.25`, which is the common
path behind all three introduction routes (`@tailwindcss/postcss`, `next`,
`vitest`). `npm audit` is now clean and the full unit suite passes. No
`overrides` entry was needed.

**VAPID keys.** The key pair generated during the original pass was exposed in
the PR description, removed on 2026-08-20, and must be treated as burned.
Generate a new pair directly in the deployment environment before enabling push notifications.
Placeholder entries (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
`NEXT_PUBLIC_VAPID_PUBLIC_KEY`, optional `VAPID_SUBJECT`) remain in `.env.example`.

**`rls_auto_enable()` grants.** New migration
`20260820000000_revoke_rls_auto_enable_grants.sql` revokes `PUBLIC`/`anon`/
`authenticated` execute on the platform-managed function, guarded on its
existence (safe no-op in self-hosted / fresh dev where the function does not
exist). Replacement grant is `service_role` only, matching the
`20260810170000` trigger-function precedent. Applied to the linked live project
on 2026-08-20 and verified with direct privilege checks and `scripts/check-rls.sql`.

**Migration status on the linked live project (`zrxbmmtqqhlwtrinocww`).**
Verified via `supabase migration list`: `20260814100000` and `20260820000000`
were applied on 2026-08-20 after correcting the transaction category index to
use the real `pfc_primary` column. A post-apply dry run reports the linked
database is up to date, and direct catalog queries confirm all six intended
indexes exist.

**Phase 1 review.** Reviewed the 14-phase parity program + last two weeks of
commits (multi-currency conversion, forecasting milestones, multi-format
exports, advanced merchant rules, performance indexes) plus the three
`20260812*` migrations. No cross-user leak or money-correctness regression
found. All new SECURITY DEFINER RPCs are correctly hardened and scoped. The
key findings: (a) `lib/currency.ts` multi-currency engine is shipped but
unwired (dead code — not imported anywhere); (b) FIRE milestone wording
implying a guarantee was **fixed inline** with a regression test;
(c) `toLedgerCli`/`toTaxCsv` are unwired dead exports; (d) regex merchant rules
are self-only ReDoS surface; (e) export routes are unrate-limited (consistent
with existing exports). See the findings doc for (a), (c)-(e) and the
owner-decision items.

**Phase 2 sweep.** `gh pr list --state open` returns zero open PRs, and the
only open dependabot alert (#18, nanoid) is fixed by this branch's Phase 0.1
commit. Nothing to merge.

**Phase 3 checklist.** Added to `docs/TODO.md` ("Added 2026-08-20"): exact
steps for the custom domain, E2E CI secrets (`gh secret set` commands),
Plaid Liabilities, VAPID keys, and the migration deployment status.

## Previous delivery: PR #114, Sonar refactor plus its review fixes

PR #114 (`fix/form-control-accent-color`) is merged and refactored the reported
Sonar cognitive-complexity findings across 85 files.
Every check on it was green, Sonar's quality gate included, before the review below ran.
The last Sonar finding (S4323 on `app/api/goals/accounts/route.ts`) is fixed by extracting `NumericColumn`, `GoalBaselineRow`, and `AccountBaselineRow`.

A review of the diff against `main` found four behavior regressions the refactor introduced and the full suite did not catch.
Each one now has a test that was confirmed to fail without its fix.

**postgrest-js appends `order()` calls rather than replacing them.** Hoisting a shared query builder that baked in `.order("date")`/`.order("id")` made the ledger ignore `?sort=` entirely, because the requested sort landed behind the default. The builder is now split: `buildLedgerFilterQuery` is deliberately unordered, and `buildLedgerScanQuery` adds the fixed total order that `range()` chunking needs.

**`x` is a card-mask character and also a letter.** Unifying the two report mask strippers into `lib/account-label.ts` turned "Amex 1234" into "Ame". The helper now gives back letters borrowed from the end of a word, which also fixes `lib/report-pdf.ts`, broken this way before the refactor.

**A hand-written scanner replacing an email regex leaked PII.** `redactEmails` treated trailing punctuation as part of the domain, so `user@example.com!` failed the TLD check and passed through whole into the admin alert inbox and the logs. The span now ends at the last real `.tld`.

**A regex finding and a behavior contract can both be real.** Narrowing `/^-+/` to `/^-/` in `lib/ical.ts` silenced S8786 but changed VEVENT UIDs for names with two or more leading or trailing non-alphanumerics, and a subscriber reads a changed UID as a second event. The finding was legitimate: `/-+$/` is unanchored at its start, so a long dash run retries at every position. Restoring the quantifiers would have reopened it, so the trim is now done by index instead, which keeps the UIDs and clears the rule. Reach for a non-regex form when a pattern is both flagged and load-bearing, rather than picking one of the two to sacrifice.

One more worth carrying forward: reading a deprecated SDK field through a computed key (`legacySession[["on","success"].join("_")]`) silences the deprecation rule by hiding the field from the compiler, grep, and static analysis at once.
A locally declared type expresses the same intent and keeps the read checked.

## Previous delivery: security hardening (PR #110)

A full-repository security review (`docs/archive/CODE_REVIEW-2026-08-10.md`, `docs/archive/Security-Review-2026-08-10.md`) and the fixes for every finding it raised: H1-H5, M1-M15, L1-L12, plus the Next.js 16.3.0 upgrade for the `sharp`/libvips CVEs.

All nine `supabase/migrations/20260810*` files are applied to the linked live Supabase project `zrxbmmtqqhlwtrinocww`.
The final migration, `20260810180000_recurring_streams_drop_client_write.sql`, was applied on 2026-08-10 before merge.
A post-apply migration dry run reports that the remote database is up to date.
Live verification confirms the guarded `recurring_streams_select_visible` policy remains and the unintended `recurring_streams_update_own` client-write policy is gone.
The database prerequisite for merging PR #110 is complete.

The live-only `public.rls_auto_enable()` event-trigger function is not created by this repository and remains executable by `PUBLIC`, `anon`, and `authenticated`.
Both `scripts/check-rls.sql` and the Supabase security advisor flag those grants.
This is a separate follow-up, not a PR #110 migration prerequisite, and it should be corrected through a checked-in migration or Supabase-managed configuration rather than an undocumented live-only change.

Two behavior changes worth remembering.
`/api/plaid/exchange` now requires a `link_token` in the body and consumes it single-use, so any caller other than `ConnectBankButton` has to send one.
The webhook route no longer honours the `NODE_ENV === "test"` bypass, so tests that need to skip signature verification must pin `PLAID_ENV=sandbox` with a non-production `NODE_ENV`; `tests/integration/webhook.test.ts` does this explicitly now.

## Previous delivery: a reported "web login is broken" that was never the app

The report was that web login was broken while mobile worked.
It was neither an auth defect nor a deployment defect.
The login page was rendering with its stylesheet missing, which looks like a broken app but leaves sign-in working underneath, and the cause was a **browser ad blocker** blocking the CSS request.

The diagnostic trap is worth carrying forward, because it cost most of the session.
A clean-engine reproduction passed at every step: `curl` fetched the stylesheet with a 200, and Playwright WebKit rendered the production page perfectly and completed a real sign-in attempt against live Supabase, returning "Invalid login credentials" for bad input.
Neither loads browser extensions.
**A passing Playwright or `curl` reproduction rules out the server and says nothing about the user's browser.**
When a page is unstyled in a real browser but fine in automation, suspect an extension before anything server-side, and ask for the user's own Network tab, where a blocked request reads as blocked rather than as a 404.
NordVPN Threat Protection was also active and served a malware block page for the domain, which was a convincing red herring; disabling it changed nothing.

Two unrelated defects were found while investigating and are fixed.

`/manifest.webmanifest` was returning a 307 to `/login` for signed-out visitors, because the proxy matcher excluded `sw.js` but not the manifest.
The browser then parsed a login page as JSON and reported that the manifest was not valid JSON data.
Verified by curl before and after; it now returns 200 with `application/manifest+json`.

`public/sw.js` precached `/`, `/login`, and `/signup` into a cache named by a hardcoded constant.
The activate handler only deletes caches whose name differs, so cleanup was a permanent no-op and those documents outlived every deployment, still pointing at `/_next` chunks that later deploys delete.
Precaching is removed, navigations are network-only, and only `response.ok` is cached, since `cache.put` will otherwise happily store a 404 and pin the failure.
This was a latent bug, not the reported one.

Two SonarQube findings on `proxy.ts` are resolved.
`PUBLIC_PAGE_PATHS` is now a `Set`, which required widening the source-parsing regex in `tests/unit/proxy.test.ts`; that guard was re-verified to still fail when a path is added to the allowlist.
S7780 (`String.raw`) is suppressed rather than applied, with the reason in a comment: Next statically analyzes `config.matcher` at build time and ignores anything that is not a plain literal, so a tagged template would silently disable the matcher and with it the `sw.js` and static-asset exclusions.

Documentation was restructured in the same pass, around one rule.
**`CLAUDE.md` is how to work in this repository; documentation is what the repository contains.**
It was 336 lines and had become a repository manual, which competes for attention with the actual task every session.
It is now 117 lines and holds only rules.

Everything descriptive moved out verbatim, so nothing was lost.
`docs/ARCHITECTURE.md` is new and holds the request path, the full `lib/` module catalogue, the two-Supabase-clients detail, and the subsystem invariants in long form.
`docs/PALETTE.md` is new and holds the ΔE and contrast measurements behind the chart-palette rules.
`CLAUDE.md` keeps the short imperative version of each rule and points at both.

Keep that split when adding to either file.
A new module's description belongs in `docs/ARCHITECTURE.md`; only a rule that changes how someone works belongs in `CLAUDE.md`.

`CLAUDE.md` also gained the service-worker and proxy-matcher invariants it had never recorded, plus the reproduction rule from this session's failure: `curl` and Playwright load no browser extensions, so a green run there rules out the server and proves nothing about the reporter's browser.
`README.md` gained a Troubleshooting section covering the unstyled-page symptom, and `docs/QA.md` gained an ordered procedure for diagnosing "the app looks broken" reports.

## Previous delivery: every approved shipped-defect phase is implemented

Branch `fix/shipped-defects`, PR #99.
The reviewed plan is `~/.claude/plans/create-a-plan-on-toasty-treehouse.md`.

Phase A repairs the PWA identity, restores an environment kill switch for default-on feature flags, removes false security claims, makes the seven-slot dark chart palette pass the repository validator, and restores a clean lint boundary.
Phase B1 repairs the legacy browser baseline and the UI defects it exposed.
Phase C completes persistent private receipts, grouped dashboard budgets, investment day movement and movers, institution branding, bundled goal artwork, and OFX/QFX import preview.
Phase D adds debt payoff planning, recurring sinking funds, persisted cross-source duplicate review, Supabase passkeys, and multiple named TOTP factors as the recovery path.
The unusable custom backup-code table was removed because Supabase Auth does not expose backup-code consumption as an authentication factor.
Passkeys retain the existing server-side AAL2 invariant, so an account with verified TOTP still receives the TOTP step-up after passkey sign-in.

The five new migrations are applied to the linked live Supabase project.
Production Auth has passkeys enabled for `fund-flow-swart.vercel.app` with the canonical HTTPS origin.
The institution backfill updated all six live Plaid items, including four available logos and six brand colours.

Browser coverage now uses disposable live-Supabase users and deterministic finance fixtures.
It covers the completed feature journeys, the primary-route responsive matrix at 375, 430, 768, and 1440 pixels in both themes, collapsed and expanded shell states, the account menu, and 26 reviewed desktop visual baselines.

Two test-harness traps are worth knowing before writing more specs.
Playwright's default `caret: "hide"` on `page.screenshot()` mutates inline styles and races hydration on the next reload, so visual captures use `caret: "initial"`.
`getByLabel` substring-matches, so a bare `"History"` or `"Owner"` collides with sparkline labels and with the signed-in user's own email address.

### Post-review repair pass

A review of the finished branch found nine defects, all fixed on the same branch; `docs/QA.md` records each one.
The two worth carrying forward as rules rather than as fixed bugs:

Pairwise colour separation and surface contrast are independent properties, and passing one says nothing about the other.
The first dark re-step cleared every pairwise gate in `scripts/validate_palette.js` and still left three of seven slots under WCAG's 3:1 non-text minimum against the dark panel, because the validator only measured ΔE between series.
It now gates both, the dark set was re-stepped again to clear both at the light palette's own hues, and light `--viz-2`/`--viz-3` are carried as two named exceptions.
That exception list is a ratchet: never extend it to make a re-step pass.

A payoff plan keyed debts by display name, and account names are not unique.
Anything that joins a computed result back to its source rows must key on the id.

Phase C1 also shipped without the RLS integration test its plan required.
`tests/integration/receipts-rls.test.ts` now proves cross-user isolation over both the row and the Storage object, including that no client has a write path and that the object is reachable only through a server-minted signed URL.

One approved-plan deviation is worth knowing: Phase D4 called for one-time backup codes, and the branch removed the custom backup-code store instead.
The reasoning is recorded in the PR and in `docs/TODO.md` — Supabase Auth does not expose backup-code consumption as an authentication factor, so multiple named TOTP factors are the supported recovery path.
That was a deliberate substitution, not an oversight, but it is a scope change from the reviewed plan.

## Previous delivery: transaction sorting and staged filters

The Transactions page now has explicit Search, Date, Filters, and one shared Sort popover across desktop and mobile.
Date, account, category, subcategory, merchant, money direction, and account type changes are staged locally until Apply, while search applies on Enter or its Search button.
Applied chips, Clear filters, pagination, browser history, column state, and saved views all preserve the normalized ledger URL contract.
Date and displayed signed amount use deterministic database ordering, while merchant, category, and account sort the complete rule-adjusted display projection before selecting each 50-row page.
The previous silent 4,000-row rule-aware cutoff is gone, failed chunks no longer appear as successful empty results, and every financial query remains explicitly owner-scoped.
No migration or exchange-rate handling was added because this ledger is USD-only.

Verification passed with repository-wide lint, TypeScript, unit tests, the production build, and `tests/e2e/transactions.spec.ts` against a disposable Supabase user with 56 seeded transactions.
The browser journey covered all five sort fields in both directions, complete ordering across two pages, merchant-rule display values, staged Apply behavior, saved-view restoration, Back and Forward, client navigation without reload, mobile controls, Escape handling, and focus restoration.

## Older sessions

Finished phase programs and session notes from 2026-07-05 through 2026-08-09 are
in [`archive/HANDOFF-2026-07-to-08.md`](archive/HANDOFF-2026-07-to-08.md).
Nothing there is pending.
