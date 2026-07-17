# FundFlow — Session Handoff

Last updated: 2026-07-16. Read this first to resume.

## Latest session (2026-07-16, branch `feat/remaining-must-haves`)

Delivered the three remaining must-have items from `docs/TODO.md`: session
revocation enforced on page renders, cron-failure alert emails, and a mobile
polish pass. All gates green: `npm run build` PASS, `npm run lint` PASS,
`npm run test:unit` PASS (374 tests). See
`.superpowers/sdd/task-9-report.md` for the full session record.

- **Session revocation on page renders.** `proxy.ts` now calls
  `isSessionRevoked` (from `lib/session-revocation.ts`) for every logged-in,
  non-MFA-pending, non-API page request; a revoked session triggers
  `supabase.auth.signOut({ scope: "local" })` and a redirect to `/login` with
  the queued cookie clears copied onto the redirect response. API calls were
  already 401'd on a revoked session via `requireUser()` in `lib/http.ts`.
  Files: `proxy.ts`, `lib/session-revocation.ts`. QA: end-to-end browser
  verification with Playwright (see `.superpowers/sdd/revocation-e2e-report.md`)
  confirmed a revoked session redirects `/dashboard` to `/login`, clears
  `sb-*` cookies, and 401s a follow-up authenticated API call.
- **Cron-failure alert emails.** `lib/cron-alert.ts` (`alertCronFailure`)
  emails the admin profile (`profiles.role = 'admin'`) when a cron run has
  failures, deduped to one alert per cron name per 24h via the existing
  Postgres rate limiter; the email body includes the cron name, failure
  count, and a truncated first error. Wired into `/api/cron/sync` (per-user
  sync failures plus the whole-run catch) and `/api/cron/weekly-report`
  (report failures plus the whole-run catch). Never throws: a failing alert
  send cannot break the cron's own response. Files: `lib/reporting.ts`
  (`sendCronAlertEmail`), `lib/cron-alert.ts`,
  `app/api/cron/sync/route.ts`, `app/api/cron/weekly-report/route.ts`. QA:
  unit tests cover the success, rate-limit-dedupe, no-admin-profile,
  no-admin-email, and send-failure paths (`tests/unit/cron-alert.test.ts`,
  `tests/unit/cron-sync-route.test.ts`,
  `tests/unit/cron-weekly-report-route.test.ts`).
- **Mobile polish.** A stacked card ledger below the `sm` breakpoint
  (`components/transactions/MobileLedgerList.tsx`, wired into
  `app/transactions/page.tsx`), 44px minimum touch targets on nav links and
  month chips, and a scroll-strip edge-fade affordance on the mobile nav.
  Also fixed a site-wide mobile overflow bug: the mobile nav strip's
  `-mx-4`/`-mx-6` bleed pattern had no matching parent padding to cancel
  against, causing horizontal scroll on every signed-in page at phone
  widths. Files: `components/transactions/MobileLedgerList.tsx`,
  `app/transactions/page.tsx`, `components/dashboard/MonthChips.tsx`,
  `components/shell/AppSidebar.tsx`. QA: screenshot-verified with Playwright
  at 375px and 414px across all nine signed-in routes plus `/login`, before
  and after the overflow fix; a programmatic scan confirmed no control
  overlaps or sub-24px tap targets.
- **Deployment consideration:** cron alert emails require an admin profile
  (`profiles.role = 'admin'`) and production `SMTP_*` env; if either is
  missing, `alertCronFailure` logs and skips the send rather than throwing.

## Previous session (2026-07-13, branch `navaneethbv-patch-1`)

Fixed the weekly report scheduler, which had failed every run since it was
configured. Two independent causes:

- `FUNDFLOW_APP_URL` pointed at a URL Vercel redirects (an `http://` origin or
  a Deployment-Protection-gated alias), so curl got a 3xx `Redirecting...` body
  and never reached the app. The secret now holds the canonical production
  domain `https://fund-flow-swart.vercel.app`; a `workflow_dispatch` run
  returns 200. **If the production alias ever changes, update this secret.**
- `isWeeklyReportDue` matched a single local hour (Monday 08:00), and GitHub
  Actions cron is best-effort — it delayed and dropped hours, including that
  one, so the 2026-07-06..07-12 report was never owed to anyone. The check is
  now "Monday 08:00 local onward, all week", so a skipped or failed run catches
  up on any later run. `claimWeeklyDelivery` dedupes on `period_start`, so a
  delivered week is claimed and never re-sent.

Not yet deployed: the widened window ships this week's missed report on the
first hourly run after it reaches production.

## Previous session (2026-07-12, branch `feat/weekly-insights-notifications`)

Implemented timezone-aware weekly spending insights and a first-class notification center. Reports cover the previous Monday through Sunday and include categorized spending, prior-week comparison, top merchants, budget pace, depository cash flow, and bank and credit card spend. The HTML email and attached PDF exclude balances, masks, account numbers, and transaction detail.

Delivery is idempotent through `weekly_report_deliveries`, retries failed or stale work, isolates per-user failures, and sends to the Supabase Auth signup email. `/notifications` controls optional weekly and daily email plus optional planning alerts. Broken-bank, sync, Auth, and security messages remain mandatory.

Deployment requirements:

- `20260713051741_weekly_insights_notifications.sql` was applied to the live FundFlow project on 2026-07-12 through the Supabase migration API.
- Configure production `SMTP_*` values.
- GitHub Actions provides the hourly trigger because the linked Vercel project is on Hobby. Repository secrets `FUNDFLOW_APP_URL` and `CRON_SECRET` were configured on 2026-07-12.
- Run the weekly email visual QA section in `docs/QA.md` with a signed-in browser and real email client before production rollout.

## Latest session (2026-07-11, branch `feat/todos-roadmap`)

Three-level dashboard drill-down and advanced ledger filters completed. All code-level gates green: `npm run build` ✓ · `npm run lint` ✓ (2 pre-existing warnings in an integration test) · `npm run test:unit` ✓ **231 tests**.

- **Three-level drilldown:** dashboard `OverviewTab` category donut slices, merchant lists, and subscriptions link dynamically to in-place subcategory donut, top merchants, and 6-month trends, using search parameters (`/dashboard?category=X&sub=Y`).
- **Interactive charts:** donut slices link to category drills, trend charts preserve drill filters when pivoting months, and diverging columns link back to dashboard views.
- **Advanced ledger filters:** `/transactions` page supports exact parameters (`category`, `sub`, `merchant`, `flow`, `accountType`) with dynamic badge chips for easy removal.
- **Data layer support:** added `buildCategoryDrilldown` and `buildMerchantDrilldown` helpers to fetch and aggregate history cleanly with zero new data, zero Plaid calls, and zero schema migrations.
- **Verification:** 35 new unit tests added covering the drilldown calculations, panel rendering, and parameter wiring.

## Previous session (2026-07-08)

Security review of the branch + three roadmap partials finished. All code-level
gates green: `npm run build` ✓ · `npm run lint` ✓ · `npm run test:unit` ✓.

- **Security fix (HIGH):** `getGoals` was called with the RLS-bypassing service
  client in the notification cron with no `user_id` filter — a cross-user leak
  of goal names/amounts into other users' notifications/digest emails. Now takes
  `userId` and scopes the query (`lib/goals.ts`, `lib/notifications.ts`);
  regression test added.
- **Security fix (MEDIUM):** the offline service worker cached authenticated
  page HTML into Cache Storage (persisted across logout on shared devices).
  `public/sw.js` now serves navigations network-only and caches only static
  assets.
- **Refund netting:** linked refund pairs net out of dashboard spend/income
  aggregation (`getDashboardData` reads `linked_refunds`); cash-flow + ledger
  still show them.
- **Splits/notes UI:** per-row ledger editor (`TransactionEditor` →
  `/api/transactions/annotate`) for note, tags, and category splits.
- **CSV column remap:** import preview offers manual column mapping when
  auto-detection fails (`normalizeColumnMap`/`getCsvColumns`, `parseImportCsv`
  `columns` override).
- **Migration:** `20260708040000_roadmap_completion.sql` (transaction_annotations,
  transaction_splits, linked_refunds, transaction_review_decisions,
  user_session_records, mfa_backup_codes) was **NOT** applied to the live project
  until **2026-07-08** — it was applied via the dashboard SQL editor after the
  refund Link button 500'd in production (the tables didn't exist). Verified all
  six tables now return 200. If you spin up a fresh project, apply it.
- **Deferred (not a merge blocker):** session revocation is API-only — revoke
  sets `revoked_at` but does not `auth.admin.signOut` or gate page renders in
  `proxy.ts`; and a full multi-breakpoint mobile visual QA still needs the
  running app (the shell/pages are already Tailwind-responsive).

## Where we are

A secure personal-finance app (Next.js 16 + Supabase + Plaid) is **built and
verified at the code/DB level**. The only thing left is a **browser end-to-end
run**, which is blocked on adding Plaid Sandbox keys.

**Status: green.**
- `npm run build` ✓ · `npm run lint` ✓ · `npx tsc --noEmit` ✓
- `npm test` ✓ **20 files / 99 tests** (unit + integration against the live FundFlow DB)
- Supabase migrations **applied** to the FundFlow project (`zrxbmmtqqhlwtrinocww`)
- RLS cross-user isolation and sync idempotency are **proven by integration tests**

## Key facts / decisions

- **Stack:** Supabase-native on Vercel. Next.js App Router (TS). No Java. See the
  approved plan: `~/.claude/plans/build-a-secure-ai-powered-parsed-valiant.md`.
- **Supabase project:** FundFlow, ref `zrxbmmtqqhlwtrinocww`. URL + keys are in
  `.env.local` (gitignored). A separate old project (`ofyyjzjjmopwvfqlhnyc`,
  paper-trading) exists — do NOT touch it.
- **MCP gotcha:** the Supabase MCP connector in the last session pointed at the
  OLD project. `.mcp.json` now points at FundFlow but needs a Claude Code restart
  + `/mcp` OAuth to use. We bypassed it by applying migrations via the SQL editor
  and verifying with the integration tests (which hit FundFlow directly).
- **Personal app, 1-2 users.** AI is NOT integrated by design — instead a CSV
  export the user feeds to an external AI.
- **Secrets note:** the Supabase secret key was pasted in chat earlier; consider
  rotating it (dashboard → API Keys) at some point.

## To resume (do this next)

1. **Add Plaid Sandbox keys** to `.env.local`:
   - `PLAID_CLIENT_ID` and `PLAID_SECRET` from
     https://dashboard.plaid.com/developers/keys (keep `PLAID_ENV=sandbox`).
2. **Supabase Auth setting:** in the FundFlow dashboard, Auth → Providers → Email,
   either disable "Confirm email" for easy local testing, or use the emailed link
   (handled by `/auth/callback`).
3. `npm run dev`, open http://localhost:3000:
   - Sign up, (optionally enroll TOTP in Settings), log in.
   - Click **Connect a bank** → Plaid Sandbox → `user_good` / `pass_good`.
   - Confirm the dashboard fills in (balances, categories, merchants, recurring).
   - Click **Refresh** twice → verify no duplicate transactions.
   - Settings → **Download CSV** → confirm only date/merchant/amount/category.
   - Settings → **Disconnect** a bank and **Delete account** flows.
4. Optional hardening check: `curl -I http://localhost:3000` → verify CSP + security
   headers are present.

## Deploy later (Vercel)

- Import repo, add all `.env.local` vars as Production env vars.
- `vercel.json` already schedules the daily cron (`/api/cron/sync`, guarded by
  `CRON_SECRET`).
- Flip `PLAID_ENV=production` + production Plaid keys to use the 10 real
  connections.

## Where things live

- Plan: `~/.claude/plans/build-a-secure-ai-powered-parsed-valiant.md`
- Future features: `docs/TODO.md` (card designs, mobile, per-card/per-bank spend,
  checking cash-flow insights, monthly history, email report, webhooks, AI).
- Full walkthrough + security checklist: `README.md`
- Migrations: `supabase/migrations/0001_init.sql`, `0002_rate_limit.sql`

## Not yet done

- Browser end-to-end run (needs Plaid keys — step above).
- Cleanup work is on branch `cleanup/docs-and-issues`. Commit when ready.
- Everything in `docs/TODO.md` is deferred by design.
