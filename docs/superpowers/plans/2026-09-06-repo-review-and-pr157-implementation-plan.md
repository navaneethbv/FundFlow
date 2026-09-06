# Repository review and PR #157 review: implementation plan

Date: 2026-09-06. Local review only. Nothing in this document was committed, pushed, or posted to GitHub.

Reviewed: `main` at `262c420` and PR #157 (`codex/ui-page-audit`) at head `ebfe220`, fetched as a detached worktree and diffed against `main` (135 files, +3,568 / -447).

This plan has three parts. Part 1 is the PR #157 review with a merge verdict. Part 2 is the repository review of `main`, grouped by area. Part 3 is the ordered implementation plan that closes both, with tests to write first, acceptance criteria, and verification gates. Everything below was verified by reading the code at the cited lines; items that could not be verified are labelled as such.

## Verification evidence

| Check | `main` (`262c420`) | PR head (`ebfe220`) |
| --- | --- | --- |
| `npx tsc --noEmit` | not run | pass |
| `npx eslint .` | not run | pass |
| `node scripts/validate_palette.js app/globals.css` | pass (agent run) | pass, documented warnings only |
| `npx vitest run tests/unit` | 445 files, 4,924 tests, all pass | 453 files, 5,036 tests, all pass |
| `npm audit --omit=dev` | 0 vulnerabilities | not re-run |
| `npx npm-check-updates` | only majors remain (Vitest/coverage 5, ESLint 10, Nodemailer 10, Plaid 47, TypeScript 7) plus the `simple-icons` minor the PR takes | same |

Not verified and not claimed: `next build`, Playwright, integration tests against Supabase, the linked migration ledger (`supabase migration list --linked`), and any signed-in browser pass. Node was absent on this machine at the start of the review and was installed mid-review; the unit suites needed CI's placeholder env (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) to import at all, which is itself a finding (T-8).

Severity scale: P0 data loss or cross-user exposure in production; P1 wrong money shown to the user, a security gate that does not hold, or user data silently destroyed; P2 a real defect with a narrower trigger; P3 drift, hygiene, or a latent bug.

---

## Part 1: PR #157 review

### 1.1 Verdict

**Request changes: three blocking fixes (PR-1, PR-12, PR-13), then approve.** The PR does what it says: the 17 audit findings, the five review findings R1 to R5, the backend hardening, and the takeout fix are all present in the diff and their regression tests exist and pass. Three defects introduced or left by the branch still show wrong money or wrong labels to the user: the dashboard headline was not moved onto the composed snapshot (PR-1), the new shared label helper mishandles any mask that is not exactly four digits (PR-12), and under household scope the live net-worth point is spliced into an owner-only history (PR-13). Four more (PR-14 to PR-17) are small, sit on the same files, and should ride along before merge.

### 1.2 Verified as correct

- **Takeout 500 fix.** `lib/user-data.ts:86` dropped `amount_operator`, `amount_value`, `amount_max_value` from `merchant_rules`. No migration creates those columns (grep of `supabase/migrations/` returns nothing), so the old select failed every takeout and backup. The new `tests/unit/user-data-schema-drift.test.ts` parses the migrations and asserts every selected column exists; this is a good static guard.
- **Net-worth composition (R1, partial).** `lib/net-worth-inputs.ts` is a clean single owner of the rule. `lib/net-worth.ts`, `lib/forecasting-data.ts`, and the dashboard's open-month point all read it. `ownProfilePrefsQuery` correctly keys on `id` even under household scope; `profiles_select_own` (`0001_init.sql:251`) means the unfiltered `maybeSingle()` can only see the caller's row, so it cannot hit a multi-row error.
- **Dismissed streams (R3).** `isEligibleStream` in `lib/dashboard.ts` mirrors `appendPlaidStream` (`lib/recurring-page.ts:252`) for `dismissed_at` and `TOMBSTONED`; the notification cron shares the function and passes `userId`, so the new `manual_accounts` and `profiles` reads are user-scoped under the service client.
- **Rate limits fail closed** on Plaid exchange, Link-token mint, `requireOwnedItem`, API-token mint, and the new calendar-token cap. `lib/rate-limit.ts` returns `!options?.failClosed` on error, so the flag does what the PR says.
- **`safeEqual`** hashes both sides before `timingSafeEqual`, removing the length early-exit. Correct.
- **AI consent route** validates a strict boolean, upserts on `user_id` with the cookie-bound client (the `ai_settings` insert/update policies exist and are rewritten with both gates by `20260905100000`), and audits. The consent panel does not trigger generation.
- **`buildInsightPayload`** now buckets merchants per month before applying the 6-month window, so out-of-window spend cannot re-enter via merchant totals. Correct privacy fix.
- **`greetingInTimezone`** wraps `Intl.DateTimeFormat` in try/catch and the caller passes through `normalizeReportTimezone`, so the Codacy `RangeError` concern is already handled.
- **`ThemeToggle` revert** is the right call; the PR's hydration analysis is accurate.
- **Weekly report `sumById`** keys on institution/account id, satisfying the "join on id, never on display name" rule.
- **Admin panel** now selects `job_type` (real column) and separates error from empty.
- **Validation claims** (453 files / 5,036 tests, lint, typecheck, palette) reproduce locally.

### 1.3 Blocking findings

**PR-12 (P1). `accountDisplayLabel` mishandles any mask that is not exactly four digits.**
`lib/account-label.ts:8-18`. The guard `unwrapped.endsWith(mask)` passes for a 2, 3, or 5-digit mask, but `stripTrailingAccountMask` only removes a run of exactly four digits (`hasFourDigits`), so the strip returns the string unchanged and the mask is appended a second time; the `)` removed by `unwrapped` is never restored on that path. Reproduced on the PR head with Node:

```
"Visa (34)"      mask "34"    => "Visa (34 ••34"
"Card (...123)"  mask "123"   => "Card (...123 ••123"
"Card ••123"     mask "123"   => "Card ••123 ••123"
"Card 12345"     mask "12345" => "Card 1 ••12345"
"Chase (1234)"   mask "1234"  => "Chase ••1234"     (correct)
```

The helper now feeds Dashboard, Accounts, Debt, Goals, Recurring, Investments, the dashboard toolbar, and the Wealth tab, so one short-mask account is mislabelled on every surface. Plaid masks are usually four digits but the API does not guarantee it. Fix: strip `mask.length` trailing digits rather than a fixed four, and fall back to `clean` (with its `)`) when the strip did not consume the mask. Tests: the five cases above plus a null name with a two-digit mask.

**PR-13 (P1). Under household scope the live net-worth point mixes a household-wide balance sheet into an owner-only history.**
`lib/dashboard.ts:750-754` skips the user filter when `options.scope === "household"`, and `accounts` RLS (`user_id = auth.uid() or private.can_read_shared_account(id)`) then includes the partner's shared balances in `netWorthSnapshot`. `net_worth_snapshots` has only an owner select policy (`20260707012910_roadmap_features.sql:217`), so `allSnapshots` is viewer-only. The splice at `:1377-1383` writes the household total next to own-only prior months; `netWorthDeltaFromHistory` and `NetWorthWidget` then report a spurious month-over-month jump equal to the partner's shared balances. `main` never added a live point, so this is new. Fix: skip the splice when `options.scope === "household"`, or compose the live point from own accounts only under that scope. Test: household scope with a shared partner account leaves the history series unchanged.

**PR-1 (P1). The dashboard headline still computes net worth from connected accounts only, so Overview and Wealth now disagree.**
`app/dashboard/page.tsx:114` keeps `const netWorth = computeNetWorth(data.accounts)` (`components/dashboard/metrics.ts:10`, Plaid rows only, no manual accounts, no exclusions). The PR made `data.netWorthSnapshot` and the open-month `netWorthHistory` point include manual accounts and honour `excludedNetWorthIds`, and `WealthView.tsx:89` reads `data.netWorthSnapshot.netWorth`. `MonitorView.tsx:706` computes `netWorthDeltaFromHistory(netWorth, data.netWorthHistory)`, subtracting a fully composed prior-month snapshot from a Plaid-only headline.
Scenario: connected checking 10,000, manual "Home equity" 400,000 included, last month's snapshot 410,000. Overview headline: 10,000. Wealth tile: 410,000. Monitor delta: about -400,000. This is the same class of defect R1 fixed, one surface higher.
Fix: `const netWorth = data.netWorthSnapshot.netWorth;` and delete `computeNetWorth` from `metrics.ts` (it has no other callers). Add a regression to `tests/unit/dashboard-net-worth-composition.test.ts` that renders the Overview headline value and asserts it equals the snapshot for a manual-asset and an excluded-account case.

### 1.4 Should ride along before merge

- **PR-14 (P2). `getDashboardData` now throws on a balance-sheet read for pages that never render net worth.** `composeDashboardBalanceSheet` (`lib/dashboard.ts:723`) throws on a `manual_accounts` or `profiles` error, and `app/goals/page.tsx:48` and `app/review/page.tsx:55` await `getDashboardData` with no catch. A transient PostgREST error on `manual_accounts` (whose policy gates on `mfa_satisfied()`) now takes down Goals and Monthly Review, which only read envelopes, categories, and anomalies. The throw is right for the Dashboard number; make the balance-sheet load opt-in via `DashboardOptions`, or catch and null `netWorthSnapshot` for callers that do not render it.
- **PR-15 (P2). Manual-account mutations do not invalidate the dashboard cache.** The Dashboard now derives net worth from `manual_accounts`, but `app/api/manual-accounts/route.ts` POST/PATCH/DELETE never call `invalidateDashboardCache`; only `lib/sync.ts:599` and the demo route do. With the 45-second process-local TTL (`lib/dashboard-cache.ts:54`) a user who adds a manual asset or flips `include_in_net_worth` in Settings sees the old number on return, which is the number R1 set out to make correct. Add `invalidateDashboardCache(user.id)` after each mutation.
- **PR-16 (P2). Mobile `BudgetCard` shows `RowMenu` for unbudgeted lines.** `components/budget/BudgetTable.tsx:306` renders the Group/Rollover/Sort menu unconditionally; the desktop `BudgetRow` withholds it when `line.budgetId` is null (`:197-217`), and `BudgetPlanner.updateLine` returns early for those lines, so every control is a silent no-op and the select snaps back. Wrap in `line.budgetId && …`.
- **PR-17 (P2). `Modal`'s body scroll lock is not ref-counted.** `components/ui/Modal.tsx:40` saves and restores `document.body.style.overflow` per instance, and `MobileNavigation.tsx:112-119` has an identical independent lock. Non-LIFO unwinds leave `overflow: hidden` with nothing open: `BudgetTemplateButton` keeps its templates and 409-conflict modals open together and a route change unmounts both in sibling order; or the shortcuts modal opens over the mobile sheet via `lib/use-keyboard-shortcuts.ts:113-118`. Use one shared ref-counted lock hook, or a CSS `body:has(dialog[open])` rule, instead of two save/restore effects.

### 1.5 Non-blocking findings

- **PR-2 (P2). Calendar feed eligibility is narrower than the dashboard's.** `app/api/calendar/[token]/route.ts:60` adds `.is("dismissed_at", null)` but not the `TOMBSTONED` check that `isEligibleStream` (`lib/dashboard.ts:593`) and `appendPlaidStream` (`lib/recurring-page.ts:252`) apply. Sync copies `status` and `is_active` independently from Plaid (`lib/recurring.ts:81,84`), and the PR's own test treats `is_active: true, status: "TOMBSTONED"` as a real state, so such a stream vanishes from the Dashboard and Recurring page yet keeps publishing events into the subscribed calendar, with no UI left to dismiss it. Fix: select `status` and filter `.or("status.is.null,status.neq.TOMBSTONED")` (a plain `.neq` drops NULL rows), or share one predicate across the three surfaces.
- **PR-18 (P3). `buildDebtSummary` uses the display label as the debt identity.** `lib/dashboard.ts:534` passes `accountDisplayLabel(a.name ?? "Card", a.mask)` as `DebtInput.name`, which `buildPayoffPlan` uses for `order`, `debts[].name`, and `key={d.name}` in `PlanView.tsx:272`. `lib/debt-data.ts:96-100` documents that this field is the plan's identity and passes `id`. Two liabilities with null name and mask both become "Card" (duplicate React keys); a null-name card reads "Card ••1234" on the Dashboard and "Debt ••1234" on `/debt`, so the new comment claiming the two surfaces agree is wrong. Pass `id` as the key and label separately; drop the per-call-site fallbacks so the helper's single "Account" fallback wins.
- **PR-19 (P3). `AiConsentSection` discards the error body.** `components/settings/AiConsentSection.tsx:31-36` replaces any non-OK response with a fixed "could not be saved" message and leaves the Save button enabled, so the route's fail-closed 429 ("try again later") invites the exact retry it forbids. `CalendarFeedSection.tsx:40-41` in the same PR reads `body?.error ?? fallback`; do the same.
- **PR-20 (P3). Two month-key sources.** The live point is keyed by `localMonthKey(now)` (`lib/dashboard.ts:743`) while `lib/net-worth.ts:16` keys the stored current-month row by UTC month. Identical on Vercel; in a non-UTC dev process near a month boundary the series shows two open months, and `tests/unit/dashboard-extra.test.ts` (around line 252) expects the UTC month while the code uses local, so that test is flaky within hours of a boundary. Use one source on both sides (see M-11).
- **PR-21 (P3). Extra reads.** `getDashboardData` now reads `profiles` a second time on the dashboard page (the page already selects `dashboard_prefs`), and adds two queries to Goals, Review, and the notification cron that never use them. Folding the balance-sheet load behind an option (PR-14) removes both.
- **PR-22 (P3). Docs and comments that overstate.** The `lib/net-worth-inputs.ts` header says the forecast uses `composeNetWorthAccounts`; `lib/forecasting-data.ts` only imports `readExcludedNetWorthIds` and still composes its own rows. The `usePlannedAmount` comment in `BudgetTable.tsx` claims the desktop row and mobile card "cannot drift"; each instance holds its own draft, so an uncommitted edit is lost across a breakpoint change. Weekly report renders two identical-label rows for same-name cards, which is a deliberate trade-off the code should say so.
- **PR-3 (P3). `PATCH /api/settings/ai` rate-limits after body validation.** `app/api/settings/ai/route.ts:10-15`. CLAUDE.md's route order is auth, rate limit, validate. Swap the two blocks.
- **PR-4 (P3). Misleading comment on `currentMonth`.** `lib/dashboard.ts:740-743` says `localMonthKey` fixes users east of UTC; the server clock is UTC on Vercel and has no user timezone, so this only makes `currentMonth` consistent with the server-local `today` at line 1109. `lib/notifications.ts:270` still passes a UTC month into the same function. See M-11 for the real fix (one `today` in the profile timezone); for the PR, correct the comment.
- **PR-5 (P3). `hasBalanceSheet` pushes a live point when every balance is null.** `lib/dashboard.ts:1380`: an account list with all-null balances yields a 0/0/0 point in the chart. Require at least one non-null balance.
- **PR-6 (P3). Recurring occurrence rows lose table semantics on phones.** `components/recurring/RecurringList.tsx:276-350` styles `<tr>` as `grid` and hides `<thead>` below `sm`. Browsers drop row/cell roles when display changes, and the visible "Due" prefix does not label amount, account, or category. The other three tables in this PR got a card twin; do the same here.
- **PR-7 (P3). `Avatar` hard-codes `bg-white` for logo backing.** `components/ui/Avatar.tsx:56`. Intentional for UI-16, but it is the only raw colour in `components/ui/`; add a `--logo-backing` token so dark-mode contrast stays in the palette validator's domain.
- **PR-8 (P3). `lib/import-{mint,monarch,ynab}.ts` replace re-exports with wrapper functions.** The wrappers add a second signature to keep in sync with `lib/import.ts` for no behavioural gain. If Sonar objects to `export { a, b } from`, prefer `export * from` for the functions or delete the three shim modules and import from `lib/import` directly.
- **PR-9 (P3). Documentation placement.** The PR creates `docs/plans/` while the existing plan location is `docs/superpowers/plans/`; `docs/reviews/2026-09-06-pr157-review.md` still says "Changes requested" although the branch fixed all five findings (governance says completed reviews move to `docs/archive/`); `docs/TODO.md` now carries two dated status sections at the top; and `docs/HANDOFF.md` adds another test-count line (see T-4). Move the plan, archive or annotate the review, and collapse TODO to one status block.
- **PR-10 (P3). Branch name violates the rule the PR introduces**, as the PR acknowledges. The new CLAUDE.md rule also overrides the `commit-commands` plugin's `Co-Authored-By` default; anyone using that plugin on this repo will need to strip the trailer by hand until the plugin is configured.
- **PR-11 (process).** Nine commits and 135 files mixing UI fixes, a backend audit, a coverage push, and an unrelated policy change. Reviewable, but each of the last three would have merged faster alone.

### 1.6 Repo findings the PR already closes

These appear in Part 2 for completeness and are marked "closed by #157": fail-open limiters on exchange, link-token, token mint and item routes (S-5, partial); token-rotation `user_id` scope (S-4, partial); missing audits on session revocation, import commit, takeout, and link-token mint (A-11, partial); the dashboard net-worth snapshot half of M-3.

---

## Part 2: Repository review of `main`

### 2.1 Security and data access

**S-1 (P1). Thirty-five RLS policies default to the `public` role, so the FF-02 gate migration and `check-rls.sql` both skip them.**
`create policy` statements without a `TO` clause get `pg_policies.roles = '{public}'`. `20260905100000_mfa_gate_remaining_user_tables.sql:74` filters `'authenticated' = any(roles)`, and `scripts/check-rls.sql:147,165` filter the same way, so neither the rewrite nor the CI assertion ever sees these policies. Confirmed for `api_tokens` (`20260723150000_bucket_features.sql:96-103`, four policies, never dropped or altered afterwards) and the table is in the migration's `gated_tables` list, so the migration intended to gate it and silently did not. The same shape covers `calendar_tokens`, `saved_views`, `category_overrides`, `milestones`, `household_invites`, `push_subscriptions`, `cancelled_subscriptions`, `households`, `household_members`, `shared_expenses`, `sinking_funds_select_own`, and the `0001_init.sql:287-295` policies on `audit_logs`, `sync_jobs`, `data_exports`.
Consequence: a revoked session, or an aal1 session of an MFA-enrolled user, can still read and write these tables through PostgREST. `api_tokens` is the sharp one: an insert there mints a read-only API token, and `lib/export-route.ts` accepts API tokens without MFA or revocation checks by design. `docs/TODO.md:63` and `docs/HANDOFF.md:56` claim FF-02 is complete; it is not, and CI is green because the check shares the blind spot.
Fix: new migration that re-runs the DO block with `roles && '{public,authenticated}'::name[]`, plus a `check-rls.sql` assertion that no `public`-schema policy has `roles = '{public}'`. Add a migration-check unit that fails if a future `create policy` omits `to authenticated`.

**S-2 (P2). Three write routes prove account ownership by visibility, which household sharing satisfies.**
`app/api/transactions/manual/route.ts:35-41`, `app/api/investments/manual/route.ts:28-35`, `app/api/import/csv/route.ts:52`. Each does an RLS-client `select id from accounts where id = ?` and then writes with the service client. `accounts_select_visible` (`20260810120000_session_revocation_rls.sql:83-91`) shows household members the owner's shared accounts, so member B can attach manual transactions, holdings, or a whole CSV import to owner A's Plaid account. `app/api/import/commit/route.ts:66-92` and `app/api/accounts/apr/route.ts:32-35` do this correctly.
Fix: add `.eq("user_id", user.id)` to all three ownership reads; add a test per route with a visible-but-not-owned account expecting 404.

**S-3 (P3). Client-side writes to eight tables outside the CLAUDE.md allow-list.** `merchant_rules`, `category_overrides`, `households`, `goals`, `shared_expenses`, `saved_views`, `notifications`, `alert_preferences` (see `components/settings/MerchantRulesSection.tsx:91`, `components/goals/GoalWizard.tsx:86`, `components/transactions/SavedViewsBar.tsx:45`, and others). All eight have gated owner policies, so this is drift, not exposure. Fix: extend the allow-list in CLAUDE.md and `docs/ARCHITECTURE.md:351-355` (these are user-authored configuration, which is the stated test) or move the writes behind routes. Pick one.

**S-4 (P3). Service-client writes that filter on a row id but not `user_id`.** `lib/plaid-service.ts:302-304` (link-token consume), `lib/sync.ts:555-557` (`sync_jobs`), `lib/investment-sync.ts:214-227,369-371`, `lib/scheduled-promotion.ts:65-71`; upserts keyed only on provider ids at `lib/plaid-service.ts:167`, `lib/sync.ts:231`, `app/api/import/csv/route.ts:11`. Ids come from prior user-scoped reads, so nothing is reachable with attacker input today. Token rotation (`lib/plaid-service.ts:433`) is closed by #157. Fix: add the filter everywhere; make provider-id upsert conflict targets include `user_id`.

**S-5 (P3). Rate-limit gaps.** Still fail-open after #157: `household/invite` (sends email), `receipts` upload, `import/csv`, `import/preview`. Unlimited: every `app/api/export/*` route including `takeout`, the API-token export path in `lib/export-route.ts:15-20`, `import/commit`, `settings/mfa` unenroll. Fix: `{ failClosed: true }` on the first group; per-user limits on takeout, commit, and export routes; IP-keyed limit on the token export path.

**S-6 (P3). Calendar feed limiter keyed per token hash.** `app/api/calendar/[token]/route.ts:38-42`. Every guessed token gets a fresh counter and inserts a `rate_limit_counters` row; the comment about brute-force protection is untrue. Entropy makes guessing infeasible; the exposure is unauthenticated write amplification. Fix: key the not-found path on client IP, keep the per-token key after the token resolves.

**S-7 (P3). Step-up and MFA lifecycle.** `lib/step-up.ts:26-38` tries the code against every verified factor, multiplying the 5/hour cap by factor count; `:42-45` password fallback calls `signInWithPassword` on the cookie client, minting a session as a side effect; `app/api/settings/mfa/route.ts:89-101` unenroll requires no step-up while account deletion does. Fix: verify against the supplied factor only, use a throwaway client for the password check, require `verifyStepUp` on unenroll.

**S-8 (P3). `/api/health` uses the service client unauthenticated** (`app/api/health/route.ts:16-23`). Only a timestamp leaks. Document it or move to an aggregate RPC.

Checked and clean: cron bearer auth via `safeEqual` on all three cron routes; webhook JWT pinning with `ieee-p1363`; Plaid tokens encrypted before insert and never selected in plaintext; `env.server` never imported by client code; PostgREST filter-string sanitisation in `lib/ledger-query.ts:79-106`; redirect targets fixed; `requireUser` fails closed on AAL and revocation lookup errors; all service-client cron, backup, report, and notification paths filter `user_id`.

### 2.2 Money and correctness

**M-1 (P1). Budget "spent" is keyed differently on three surfaces.**
`lib/dashboard.ts:1007-1010` builds `categoryBreakdown` by `pfc_primary` (uppercase group) and `lib/planning.ts:200` matches `currentSpend.get(budget.category)` case-sensitively. `lib/budget-page.ts:303,335` lowercases and matches the detailed `categoryKey`, which is also what the seed flow stores (`lib/budget-page.ts:174` to `components/budget/SeedBudgetButton.tsx:81`). `lib/weekly-report.ts:259-268` keys on the primary category.
Scenario: seeded budget `food_and_drink_groceries` 600 with 700 of grocery rows. `/budget`: 700 spent, over. Dashboard `riskyBudgets`, `BudgetWidget`, `PlanView`: 0 spent, on track. Weekly email: 0. An `ENTERTAINMENT` budget does the reverse.
Fix: one exported `matchesBudgetCategory(budgetCategory, txn)` in `lib/finance-domain.ts` that lowercases both sides and matches on `categoryKey` or `groupKey`, used by `buildBudgetEnvelopes`, `actualsForMonth`, and the weekly report. Test with one detailed-key budget and one group-key budget against the same rows on all three surfaces.

**M-2 (P1). `addMonths` overflows at month end.**
`lib/date-utils.ts:18-22` uses `setUTCMonth`. Reproduced: `addMonths("2026-01-31", 1)` returns `2026-03-03`; `addMonths("2026-03-31", -1)` also returns `2026-03-03`. Consumers: `advanceFrequency` in `lib/planning.ts:177-180` (forecast, bill calendar), `lib/insights.ts:150,180` (`detectPaychecks`), `lib/recurring-page.ts:78-108` (`occurrenceDatesInWindow`, Plaid and manual).
Scenario: rent due 2026-03-31 monthly. Recurring page for March emits 03-03 and never 03-31; the real payment on the 31st is 28 days from the emitted date, beyond the 10-day tolerance, so it shows overdue with a wrong date. A 01-31 anchor produces no February occurrence at all and drifts permanently to the 3rd. Salary on the 31st mis-steps `nextPayDate` and the Safe-to-Spend horizon.
Fix: `lib/recurring-detection.ts:125-133` already has a correct `addMonthsClamped`. Move it into `lib/date-utils.ts` as the implementation of `addMonths`, preserving the anchor day-of-month across steps (step from the anchor, not from the previous result). Tests: 01-31 +1 = 02-28, +2 = 03-31; 03-31 -1 = 02-28; leap year.

**M-3 (P1). Three definitions of current net worth.** `components/dashboard/metrics.ts:10` (Plaid only), `lib/dashboard.ts` snapshot (closed by #157), `lib/net-worth.ts` history (full). What remains after #157 is exactly PR-1. Fix as PR-1.

**M-4 (P2). Cash-flow forecast and Safe-to-Spend drop recurring items whose anchor is in the past.** `lib/planning.ts:249-262` (`forecastCashFlow`) and `:289` (`groupRecurringByWeek`) skip `nextDate < asOf` instead of advancing, unlike `groupRecurringByPeriod:335`. `lib/dashboard.ts:1101-1104` falls back to the last matched charge when Plaid gives no prediction, which is always in the past. Scenario: cash 3,000, rent 2,000 monthly last charged 08-01, no prediction, asOf 09-06: projected balance 3,000, no low-balance risk, Safe-to-Spend 3,000, while the bill calendar shows the same rent on 10-01. Fix: one shared `expandRecurring(item, from, to)` helper with the bounded advance loop, used by all three.

**M-5 (P2). Weekly report ignores `linked_transfers` and `category_overrides`.** `lib/weekly-report-data.ts:68-104` loads refunds and duplicates only. A user-linked 1,500 transfer that Plaid tagged as a service shows as spend in the email but nowhere else. Fix: load `linked_transfers` into the exclusion set, or build the report from `projectFinanceTransactions`.

**M-6 (P2). Price-spike detection cannot see a Plaid hike and false-alarms on user overrides.** `app/recurring/page.tsx:183-193` passes `lastAmount: s.userAmount ?? s.averageAmount` (there is no `lastAmount` on the row type) and `lib/recurring-alerts.ts:65` skips only `status === "inactive"`, a value that does not exist. Fix: thread `last_amount` through `RecurringStreamRow`, compare last to average, skip `!isActive || dismissedAt || status === "TOMBSTONED"`.

**M-7 (P2). `planDebtPayoff` treats APR percent as a fraction.** `lib/planning-depth.ts:93` uses `apr / 12`; every other module divides by 100. Latent because `components/dashboard/PlanningDepth.tsx:27-31` never passes `apr`. Fix: delete `planDebtPayoff` in favour of `buildPayoffPlan`, or divide by 100.

**M-8 (P2). Unlinked refunds and card credits count as income.** `lib/finance-domain.ts:138-141`: any negative amount outside transfer groups is income, and refund linking (`lib/transaction-quality.ts:112`) requires exact amounts, so partial refunds can never be netted. A 200 unlinked refund inflates income to 5,200 and lists the retailer as an income source in Cash Flow. Fix: treat negative rows in non-INCOME categories as expense credits; allow partial-refund linking with an amount bound.

**M-9 (P3). Assumed 22% APR and 2% minimum applied to mortgages and loans.** `lib/debt-data.ts:36,72,79,145`. A 300,000 mortgage with null APR becomes a 22%, 6,000/month debt in the planner. Fix: type-specific defaults, or require APR for non-card liabilities and show them as unplanned.

**M-10 (P3). `cashBalance` coerces null to 0 and sums across currencies.** `lib/dashboard.ts:1125-1127` feeds runway and Safe-to-Spend. Fix: null when any depository balance is unknown; partition non-USD as `lib/forecasting.ts:230-234` does.

**M-11 (P3). Mixed clocks for "today".** `lib/dashboard.ts` (UTC at one line, server-local at others), `lib/recurring-data.ts:441`, `lib/forecasting-data.ts`, `lib/net-worth.ts:10`, `components/dashboard/OverviewView.tsx:54`, `app/forecasting/page.tsx:59`. Identical on Vercel, wrong for any user west of UTC in the evening of a month's last day. `lib/report-period.ts` already has `dateKeyInTimezone`. Fix: resolve `today` once from the profile timezone at the page or cron entry point and thread it down.

**M-12 (P3). Income-group budgets counted as expense envelopes.** `lib/dashboard.ts:1027,1065-1070` include `group_name = "income"` rows that `buildDashboardBudgetGroups` drops, so envelopes and groups disagree. Filter income budgets before both.

**M-13 (P3). Planning-depth surplus uses the partial current month.** `lib/planning-depth.ts:145` with month-to-date income minus expenses; on the 2nd after payday it suggests routing a full paycheck to debt. Use the trailing median from `computeForecastDefaults`.

Checked and clean: `EXCLUDED_PFC` and `flow === "transfer"` applied on every spend total; sign conventions; id-based joins in `spendPerCard`, debt planner, goal allocations, sankey, drilldown; division guards; `round2` at boundaries; month-key arithmetic; transfer pair detection; no user-facing "prediction" or "confidence" copy.

### 2.3 API routes and error handling

**A-1 (P1). Bulk tag upsert wipes notes and tags when the pre-read fails.** `app/api/transactions/annotate-batch/route.ts:46-70`. The existing-annotation read destructures only `data`; on a query error every row is rebuilt with `note: ""` and `tags: [tag]`, overwriting up to 100 transactions' notes and tags and returning 200. Line 35 has the same pattern and returns `{ updated: 0 }` as success. Fix: throw on both errors; send only the columns being changed; add a `writeAudit` (there is no bulk-tag action).

**A-2 (P1). Rules batch live mode overwrites tags when the annotations read fails.** `app/api/rules/batch/route.ts:91-102` then `:127-147`. Error ignored, `original.tags = []`, every match becomes a tag change, upsert writes rule tags only for up to 5,000 rows. Fix: throw on error; scope the annotations read by `user_id` like the rest of the file.

**A-3 (P1). Refund confirmation is persisted before its inputs are validated.** `app/api/transactions/refunds/route.ts:104-141`. Upsert of the confirmed decision precedes validation of `charge_id`, `refund_id`, `amount`; a malformed confirm marks the pair resolved with no `linked_refunds` row, so GET hides it forever. `amount` is client-supplied and never checked against the ledger rows (transfers does this at `:215-226`); there is no already-linked check and no audit. Fix: validate first, derive the amount from the owned rows, write both rows in one RPC modelled on `confirm_transfer_link`, audit.

**A-4 (P1). Account deletion is not idempotent and can wedge permanently.** `app/api/account/route.ts:223-257`. Plaid `itemRemove` (irreversible) runs before storage cleanup and `deleteUser`, both of which can throw; on retry `itemRemove` returns `ITEM_NOT_FOUND`, `itemsFailed > 0`, 503 "try again" forever. No `ITEM_NOT_FOUND` handling exists in `lib/` or `app/`. Fix: treat `ITEM_NOT_FOUND` and `INVALID_ACCESS_TOKEN` as removed, mark the local item `disconnected` immediately after a successful remove, and do Plaid removal last.

**A-5 (P1). Dashboard transaction window is unpaginated and silently capped at 1,000 rows.** `lib/dashboard.ts:853-861` has no `.range()` or `.limit()`; PostgREST truncates at `max_rows = 1000` (`supabase/config.toml:18`; hosted default matches). A ledger above roughly 165 transactions a month, or any household scope, gets wrong spend totals, envelopes, and cron alerts with no error. Every Stage-1 query at `:698-713` also ignores `error`, so a DB failure renders a dashboard of zeros. Fix: page like `lib/export.ts` `loadPagedRows`; check every error.

**A-6 (P2).** Same as S-2.

**A-7 (P2). Reconcile can un-clear already-reconciled transactions on a transient error.** `app/api/accounts/reconcile/route.ts:163-175,213-230`. `getReconcileSinceDate` ignores its error and falls back to a 120-day window; `syncClearedStatus` then nulls `cleared_at` on prior-statement rows. Lines 37 and 52 also ignore errors and return "Account not found". Fix: throw on error; never widen the window on failure.

**A-8 (P2). Override route clears the sibling column when the existing-override read fails.** `app/api/transactions/override/route.ts:63-80,183-197`. Fix: throw; write only the supplied field.

**A-9 (P2). Tax-scope CSV export returns an empty file as success and audits `row_count: 0`.** `app/api/export/csv/route.ts:36-49`. Fix: throw on error.

**A-10 (P2). Cron sync integrity pass and per-user isolation.** `app/api/cron/sync/route.ts:184-195` selects all transactions per user with no range (same 1,000 cap) and ignores errors; `:124-128` runs snapshots, recurring refresh, net-worth snapshot, and notifications unwrapped, so one failure skips the rest for that user; `:243` returns 200 `ok: true` with non-empty `failures`. Fix: page; wrap each step; return 207 with the failure list.

**A-11 (P2). Missing `writeAudit` on money-linking mutations.** `transactions/transfers` POST, `transactions/refunds` POST, `transactions/annotate-batch`. Session revocation, import commit, takeout, and link-token mint are closed by #157. Model on the duplicates routes.

**A-12 (P2). Demo loader's real-bank guard fails open.** `app/api/demo/route.ts:23-34,43-47`. `existingItems` error ignored means demo rows land next to real data; cleanup delete unchecked; no rate limit. Fix: throw; check the delete; add a limiter.

**A-13 (P3).** `plaid/repair/route.ts:133` `getItem` outside `try`; `data_exports` insert results unchecked in `lib/export-route.ts:32`, `export/tax/route.ts:114`, `export/report-csv/route.ts:91`; `household/accept/route.ts:53-56` `accepted_at` update unchecked (invite stays reusable) and `:51` plus `subscriptions/cancelled/route.ts:22` match `"duplicate"` in the message instead of `code === "23505"`; `{ data }`-only destructures that turn a DB failure into 400/404 or empty success in `goals/events:66`, `annotate:28,252`, `override:127,215`, `household/invite:39`, `plaid/share:32,46`, `accounts/apr:31`, `goals/accounts:139-152`, `calendar/[token]:45,56`, `export/report:55`, `scheduled-transactions:30`, `settings/passkeys:25`, `ai/receipt:86` (also unscoped by `user_id`); `transactions/annotate/route.ts:268-279` saves the annotation before splits are validated; `lib/notifications.ts:243-247` defaults prefs on error; `lib/sync.ts:156-161` defaults the threshold on error; `cron/sync/route.ts:73` skips the digest silently when `getUserById` errors.

Checked and clean: `confirm_transfer_link`, `update_budget_period`, duplicate RPCs, `claim_item_sync`, `rate_limit_hit` guards; transfers POST atomicity and 409; import commit idempotency; scheduled promotion; Plaid exchange CAS; backup cron claim and send boundary; weekly-report runner isolation; input validation on the budget, recurring, sinking-fund, life-event, manual-account, goals, settings, receipts, AI, restore, and import-config routes.

### 2.4 Frontend and accessibility

**F-1 (P1). Privacy blur misses a large share of on-screen amounts.** `app/globals.css:383` blurs only `.metric-value, .money, [data-money]`; `components/PrivacyToggle.tsx:6-10` promises every amount is hidden. Unblurred: `components/goals/GoalCard.tsx:83-136`, `app/goals/page.tsx:150`, `components/dashboard/GoalsSummary.tsx:39-51`, `CategoryDrilldownPanel.tsx:85`, `MerchantDrilldownPanel.tsx:37,49`, `DrilldownTransactionList.tsx:19`, `ScopeChips.tsx:56-57`, `components/forecasting/FireSimulator.tsx:114-248`, `components/recurring/RecurringCalendar.tsx:172,216`, `PriceSpikeBanner.tsx:95-134`, `components/transactions/TransactionEditor.tsx:94-377`, `components/goals/GoalsManager.tsx:110-129`. Fix: `data-money` at each site or on the enclosing list; add a unit test that walks `.tsx` files for `formatCurrency(` calls outside a blur hook.

**F-2 (P2). Hydration text mismatch on every notification row.** `components/notifications/NotificationFeed.tsx:51` formats `created_at` with `Intl.DateTimeFormat` and no `timeZone`; server UTC and browser local differ, so React logs a hydration error and re-renders on every `/notifications` load. Fix: `formatTimestampUtc` (`lib/format-date.ts:125`).

**F-3 (P2). Async errors are never announced to screen readers.** Thirty client files render `{error && <p className="text-danger">…}` without `role="alert"`; worst are `components/LoginForm.tsx:261`, `settings/DangerZone.tsx:174`, `transactions/AddTransactionModal.tsx:167`, `ConnectBankButton.tsx:179`. Fix: a shared `components/ui/FormMessage` with `role="alert"`; adopt at those sites first.

**F-4 (P2). Money-recording forms have no in-flight guard.** `components/settings/SettleUpSection.tsx:170` (double-click records a shared expense twice; no unique constraint), `ManualAccountsSection.tsx:253`, `BudgetsSection.tsx:195`, `goals/GoalsManager.tsx:382`. Fix: `busy` state and `loading={busy}` on `Button`, as `AddTransactionModal.tsx:172` already does.

**F-5 (P2). Prop-copied state goes stale after `router.refresh()`.** `components/settings/BanksSection.tsx:130` copies `initialItems` into state with no re-sync and no `key`; `ReconnectBankButton` inside it refreshes on success, but the badge still says "Reconnect" until a hard reload. Same in `NotificationFeed.tsx:21`, `goals/GoalsManager.tsx:219`, `forecasting/LifeEventsPanel.tsx:41`. Fix: render from props, keep only per-row busy state.

**F-6 (P3). Privacy mode flashes amounts on reload.** `app/layout.tsx:25-34` restores `data-theme` pre-paint but not `data-privacy`. One line in the bootstrap script.

**F-7 (P3). "Today" in server timezone.** `components/dashboard/OverviewView.tsx:54`, `app/forecasting/page.tsx:59`. Same fix as M-11.

**F-8 (P3). Date inputs initialised from local date in an SSR'd client form.** `components/investments/AddManualHoldingForm.tsx:33,125`. Use the `useSyncExternalStore` pattern from `SinkingFundsSection.tsx:64-68`.

**F-9 (P3). `AllocationView` cycles hues instead of folding.** `components/investments/AllocationView.tsx:8-15,34,46` uses `SLOT_COLORS[i % 7]`. Use `foldTail`.

Checked and clean: palette validator passes; no client import of server-only modules; `ThemeToggle` and `PrivacyToggle` SSR-safe; dialogs share `use-dialog-focus`; every `onClick` is on a button or listbox option; inputs labelled; charts ship table twins or legends and never colour text by series; `Button` enforces 44px; no page-level horizontal scroll at 390px; service worker and proxy matcher as documented.

### 2.5 Tests, CI, docs, migrations, dependencies

**T-1 (P1). No status check is required to merge to `main`.** Ruleset `18543151` has `pull_request` (0 approvals), `update`, `deletion`, `non_fast_forward`, and no `required_status_checks`. A PR with failing CI, Sonar, or migration-check can merge. Fix: require `CI / lint-build-test` and `Migration smoke-check` (make the latter run on every PR or set `strict: false`).

**T-2 (P2). Code on `main` depends on migrations the docs say are not applied remotely.** `app/api/cron/backup/route.ts:42-159` reads and writes `backup_deliveries` and `send_started_at` (`20260905110000`, `20260905120000`); `lib/account-preferences.ts:17` calls `update_account_preferences` (`20260904000000`); `app/api/rules/batch/route.ts:48` selects `merchant_rules.tags` (`20260903010000`); `lib/rules-engine.ts:10` accepts `regex` (`20260902220000`). `docs/TODO.md:16` lists all of these as local-only or unreconciled, and Vercel deploys `main`. Fix: run `supabase migration list --linked` today, apply or repair, and record the result; add a startup probe in the backup cron that reports a missing table clearly.

**T-3 (P2). `docs/TODO.md` describes three merged PRs as pending.** `:7` (#153, merged as `55bf767`), `:28-31` (#155, `d2798f3`), `:33-39` (#156, `262c420`); `docs/HANDOFF.md:13-21` likewise. Rewrite the section as the state of `main`.

**T-4 (P2). Mutable facts duplicated across TODO and HANDOFF.** The four-migration local-only ledger appears nine times in TODO and six in HANDOFF; test counts appear at `TODO.md:106` and `HANDOFF.md:19,41,76,129,187,222` with six different numbers. Keep the ledger in TODO only; HANDOFF links.

**T-5 (P2). CI does not enforce coverage thresholds, typecheck, or the palette validator.** `.github/workflows/ci.yml:25` runs `npm test` without `--coverage`; the 95% thresholds in `vitest.config.mts:52-57` only run in `sonarcloud.yml`, which skips for forks and is not required; no `tsc --noEmit` step; no `validate:palette`; Sonar gate not blocking. Fix: add `typecheck`, `validate:palette`, and `test:coverage` to `ci.yml`.

**T-6 (P2). CLAUDE.md promises ARCHITECTURE.md documents every `lib/` module; it names 57 of 165.** Security-relevant omissions include `lib/ai-gate.ts`, `lib/session-revocation.ts`, `lib/step-up.ts`, `lib/passkeys.ts`, `lib/api-tokens.ts`, `lib/rules-engine.ts`, `lib/backup.ts`, `lib/user-data.ts`. Soften the claim or add an index table.

**T-7 (P3). Coverage-boost tests: 58 files, 929 tests, a measurable share assert nothing.** Eighteen tests whose only assertion is `toBeDefined()`, `toBeTruthy()`, or `not.toThrow()`; concentrated in `coverage-boost-ui-and-hooks.test.ts`, `coverage-boost-charts-n1.test.ts` (an `invokeComponents()` helper that calls component bodies "so their bodies execute"), `coverage-boost-r9-n1.test.ts:105`, `coverage-boost-lib1-n4.test.ts:14`. Fix: assert on rendered markup via `renderToStaticMarkup`; delete tests that only touch lines. PR #157 adds another 559-line file in this family; it does assert, but the pattern should stop.

**T-8 (P3). Unit tests do not run on a clean clone.** `lib/env.ts:8` throws at import when `NEXT_PUBLIC_SUPABASE_URL` is missing; 55 unit files fail without `.env.local` or CI's placeholder env, contradicting CLAUDE.md ("Unit tests need none of this"). Fix: set the two placeholders in `vitest.config.mts` `env`, and pin `TZ: "UTC"` there too.

**T-9 (P3). No global mock hygiene.** `vitest.config.mts` sets neither `restoreMocks` nor `clearMocks`; 40 of 182 mocking files never restore; 18 use `vi.spyOn` with no restore. Fix: `test.restoreMocks: true`.

**T-10 (P3).** `app/auth/callback/route.ts` is excluded from Sonar and Vitest coverage and has no unit test. `react`, `react-dom`, and `sharp` exact pins are deliberate but undocumented. `tsconfig.json` lacks `noUncheckedIndexedAccess`. Plaid 47, Nodemailer 10, and Vitest 5 are unreviewed majors; ESLint 10 and TypeScript 7 are intentionally blocked in `.github/dependabot.yml`.

Checked and clean: `tests/setup.ts` fail-closed guard logic; actions pinned; `permissions: contents: read`; `npm audit --audit-level=high` blocking; migration-check applies all migrations and runs `check-rls.sql`; the last eight migrations are idempotent and carry both gates where they create policies; `next.config.ts` has no `ignoreBuildErrors`; no ESLint rules disabled; cron schedules match docs.

---

## Part 3: Implementation plan

Order is by risk, then by dependency. Each task lists the files to touch, the test to write first, and the acceptance check. Sizes are S (under an hour), M (a few hours), L (a day or more). Do not batch phases into one PR; each phase is one or two reviewable PRs. Follow the repo's route convention and the naming rule from #157 (no agent or vendor names in branch, commit, or PR text).

### Phase 0: Finish PR #157 and merge (M, same branch)

Blocking:
1. **PR-12.** In `lib/account-label.ts`, strip `mask.length` trailing digits instead of a fixed four, and fall back to `clean` when the strip did not consume the mask. Tests first in `tests/unit/account-label.test.ts`: the five reproduced cases plus a null name with a two-digit mask.
2. **PR-13.** In `lib/dashboard.ts`, skip the live-point splice when `options.scope === "household"` (or compose it from own accounts only). Test first: household scope with a shared partner account leaves `netWorthHistory` equal to the stored snapshots.
3. **PR-1.** In `app/dashboard/page.tsx` replace `computeNetWorth(data.accounts)` with `data.netWorthSnapshot.netWorth`; delete `computeNetWorth` from `components/dashboard/metrics.ts` and its import. Test first: extend `tests/unit/dashboard-net-worth-composition.test.ts` with a manual-asset case and an excluded-account case asserting the Overview headline equals the snapshot, and that `netWorthDeltaFromHistory` uses the same basis.

Ride-along, same files:
4. **PR-14, PR-21.** Add `includeBalanceSheet?: boolean` to `DashboardOptions`; load `manual_accounts` and prefs only when set; the dashboard page passes it (and can pass its already-loaded `dashboard_prefs`), Goals, Review, and the cron do not. Test: a failing `manual_accounts` read still renders Goals.
5. **PR-15.** `invalidateDashboardCache(user.id)` after POST, PATCH, DELETE in `app/api/manual-accounts/route.ts`. Test: mock and assert the call.
6. **PR-16.** Wrap `RowMenu` in `line.budgetId && …` in `BudgetCard`. Test: render an unbudgeted line below `sm` and assert no menu.
7. **PR-17.** Extract `lib/use-body-scroll-lock.ts` with a module-level counter; use it in `Modal` and `MobileNavigation`. Test: two locks released in either order restore the original value.
8. **PR-2.** Select `status` in the calendar route and filter `.or("status.is.null,status.neq.TOMBSTONED")`, or share `isEligibleStream`. Test: a tombstoned active stream produces no VEVENT.
9. **PR-3, PR-4, PR-5, PR-19, PR-22.** Swap the rate-limit and validation blocks in `app/api/settings/ai/route.ts`; correct the `currentMonth` comment; require one non-null balance before pushing the live point; read `body?.error` in `AiConsentSection`; fix the two overstated comments.
10. **PR-9.** Move `docs/plans/2026-09-05-ui-page-fixes.md` to `docs/superpowers/plans/`; move `docs/reviews/2026-09-06-pr157-review.md` to `docs/archive/` with a one-line "all five fixed at `afe7f05`" header; collapse `docs/TODO.md` to one status block; drop the test-count line from HANDOFF and link to TODO.
11. Defer PR-6, PR-7, PR-8, PR-18, PR-20 to Phase 4 and name them in the PR description as deferred.
12. Gates: `npm run lint`, `npm run typecheck`, `npx vitest run tests/unit`, `npm run build`, `npm run validate:palette`. Merge.

### Phase 1: Security gates that do not hold (M)

1. **S-1.** New migration `2026MMDDHHMMSS_gate_public_role_policies.sql`: same DO block as `20260905100000` with the role predicate `roles && array['public','authenticated']::name[]`, iterating every `public` table with RLS enabled except the three bootstrap tables. Update `scripts/check-rls.sql:147,165` to the same predicate and add an assertion that no policy on a `public` table has `roles = '{public}'`. Test first: a Vitest unit that parses `supabase/migrations/*.sql` and fails on any `create policy` lacking a `to` clause (add an allow-list for the bootstrap tables). Acceptance: `migration-check.yml` green; `docs/TODO.md` FF-02 entry corrected to say the first migration missed public-role policies and this one closes it.
2. **S-2.** Add `.eq("user_id", user.id)` to the ownership reads in `transactions/manual`, `investments/manual`, `import/csv`. Test first: one test per route with a visible-but-foreign account expecting 404 and no service-client write.
3. **T-1.** Add `required_status_checks` to the ruleset for `CI / lint-build-test` and `Migration smoke-check`. This is a GitHub setting, not code; record it in `docs/HANDOFF.md`.
4. **T-2.** Run `supabase migration list --linked`; apply the four September migrations and reconcile the three unreconciled ones; record the exact result in `docs/TODO.md` the same day. Until then, the backup cron fails on the linked project.
5. **S-5, S-7 (minimum slice).** `failClosed: true` on `household/invite`, `receipts`, `import/csv`, `import/preview`; per-user limit on `export/takeout` and `import/commit`; `verifyStepUp` on MFA unenroll; step-up verifies only the supplied factor. One test per route for the 429 and 403 paths.

### Phase 2: Data-loss and wrong-money P1s (L, two PRs)

PR A, write paths:
1. **A-1, A-2.** Throw on the pre-read errors in `annotate-batch` and `rules/batch`; send only changed columns; scope the annotations read by `user_id`; add `bulk_tag_applied` to `AuditAction` and write it. Test first: mock the pre-read to return `{ data: null, error }` and assert no upsert is issued and the response is 500 via `errorResponse`.
2. **A-3.** Reorder `refunds` POST: validate, load both rows scoped to the user, derive the amount, check not already linked, then one RPC `confirm_refund_link(p_user_id, p_charge_id, p_refund_id)` modelled on `confirm_transfer_link` (migration plus `check-rls.sql` pass), then audit. Tests: malformed body leaves no decision row; mismatched amount is 400; second confirm is 409.
3. **A-4.** In `account` DELETE, treat `ITEM_NOT_FOUND` and `INVALID_ACCESS_TOKEN` as already removed, mark the local item `disconnected` after each successful remove, and move Plaid removal to the last step. Test: a retry after a storage failure returns 200.
4. **A-7, A-8, A-9, A-12.** Throw on the ignored errors; never widen the reconcile window on failure; write only the supplied override field; add the demo limiter. One failing-read test each.

PR B, calculations:
5. **M-2.** Replace `addMonths` in `lib/date-utils.ts` with the clamped, anchor-preserving implementation from `lib/recurring-detection.ts:125-133`; update `advanceFrequency`, `detectPaychecks`, and `occurrenceDatesInWindow` to step from the anchor. Tests listed under M-2 first; then run the recurring, planning, and insights suites.
6. **M-1.** Add `matchesBudgetCategory` to `lib/finance-domain.ts`; use it in `buildBudgetEnvelopes`, `actualsForMonth`, and `lib/weekly-report.ts`. Test first: one detailed-key and one group-key budget produce identical "spent" on all three surfaces.
7. **A-5, A-10.** Page the dashboard and cron-sync transaction reads with `loadPagedRows`; check every Stage-1 error in `getDashboardData`. Test: a mocked client returning 1,000 then 200 rows yields totals over 1,200.
8. **M-4.** Extract `expandRecurring` and use it in `forecastCashFlow`, `groupRecurringByWeek`, and `groupRecurringByPeriod`. Test: a past anchor with no prediction still produces the next occurrence in the forecast.

### Phase 3: P2 money and route correctness (M)

1. **M-5.** Load `linked_transfers` into the weekly report exclusion set. Test: a linked transfer is absent from `totalSpend`, banks, and cards.
2. **M-6.** Thread `last_amount`; fix the skip predicate in `lib/recurring-alerts.ts`. Tests: Plaid hike alerts; user override does not; tombstoned does not.
3. **M-7.** Delete `planDebtPayoff` or divide by 100; test with balance 1,000, APR 22, payment 300.
4. **M-8.** Expense-credit classification for negative rows in non-INCOME categories; partial-refund linking with an upper bound. Tests on `financeTotals` and the refunds route.
5. **A-11.** Audit entries on transfers and refunds POST.
6. **M-9, M-10, M-12, M-13, A-13** as small follow-ups in the same PR where they touch the same files.

### Phase 4: Frontend (M)

1. **F-1.** Add `data-money` at the listed sites; add `tests/unit/privacy-blur-coverage.test.ts` that scans `components/**/*.tsx` and `app/**/*.tsx` for `formatCurrency(` calls and asserts each is inside an element carrying a blur hook (allow-list for intentionally visible copy).
2. **F-6.** Restore `data-privacy` in the `app/layout.tsx` bootstrap script.
3. **F-2, F-8.** Use `formatTimestampUtc` in `NotificationFeed`; `useSyncExternalStore` for the holding form's date default.
4. **F-3.** Add `components/ui/FormMessage` (`role="alert"` for errors, `<output>` for status) and adopt it at the eight listed sites.
5. **F-4.** `busy` plus `loading={busy}` on the four money-recording forms.
6. **F-5.** Render `BanksSection`, `NotificationFeed`, `GoalsManager`, `LifeEventsPanel` from props.
7. **PR-6, PR-7, F-9.** Card twin for recurring occurrences; `--logo-backing` token; `foldTail` in `AllocationView`.
8. **M-11, F-7.** Resolve `today` from the profile timezone at each page and cron entry point and thread it down; remove the remaining `new Date().toISOString().slice(0, 10)` and `localDateKey()` call sites in server code.

### Phase 5: CI, tests, docs, dependencies (S to M)

1. **T-5, T-8, T-9.** `ci.yml`: add `npm run typecheck`, `npm run validate:palette`, switch to `test:coverage`. `vitest.config.mts`: `env` with the two Supabase placeholders and `TZ: "UTC"`; `restoreMocks: true`. Fix any test that relied on leaked spies.
2. **T-7.** Convert or delete the eighteen assertion-free tests; add a lint-style test that fails on `expect(x).toBeDefined()` as the only assertion in a test body.
3. **T-3, T-4, T-6, S-3.** Rewrite `docs/TODO.md` "Current status" as state of `main`; single ledger owner; ARCHITECTURE index table for the unlisted `lib/` modules or a softened CLAUDE.md sentence; decide the client-write allow-list and update CLAUDE.md and ARCHITECTURE together.
4. **S-4, S-6, S-8.** `user_id` filters on the remaining service-client writes; IP-keyed limiter on the calendar not-found path; document or replace the health route's service query.
5. **T-10.** Unit test for `app/auth/callback/route.ts`; comment the exact pins in `package.json`; evaluate Plaid 47 and Nodemailer 10 in their own PRs with the build and unit suites as the gate.

### Verification gates for every phase

```sh
npm run lint
npm run typecheck
NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=build-placeholder npx vitest run tests/unit --coverage
npm run build
npm run validate:palette
```

Phase 1 additionally needs `migration-check.yml` green and `supabase migration list --linked` recorded. Nothing here runs the integration suite or touches the linked project; anything that must be checked against live data (the signed-in preview pass PR #157 still lists as open, the backup cron after T-2) is a manual step and should be recorded in `docs/HANDOFF.md` as done or not done, never assumed.

---

## Appendix: method

Five parallel read-only reviews of `main` (security and data access; money and correctness; API routes and error handling; frontend and accessibility; tests, CI, docs, migrations, dependencies), a hands-on read of every risk-bearing hunk in the PR diff, and a separate high-effort review of the PR diff whose sixteen candidate findings were each independently verified (eleven confirmed, four plausible, one refuted and dropped). Every finding above was re-read at the cited line before it was kept; the two money P1s and the label P1 were also reproduced directly with Node (`addMonths`, `accountDisplayLabel`), and the budget keying by tracing both call paths. Findings that depended on the linked Supabase project, a browser session, or Plaid credentials are marked unverified rather than asserted.
