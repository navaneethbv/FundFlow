# FundFlow — Session Handoff

Last updated: 2026-07-12. Read this first to resume.

## Latest session (2026-07-12, branch `feat/weekly-insights-notifications`)

Implemented timezone-aware weekly spending insights and a first-class notification center. Reports cover the previous Monday through Sunday and include categorized spending, prior-week comparison, top merchants, budget pace, depository cash flow, and bank and credit card spend. The HTML email and attached PDF exclude balances, masks, account numbers, and transaction detail.

Delivery is idempotent through `weekly_report_deliveries`, retries failed or stale work, isolates per-user failures, and sends to the Supabase Auth signup email. `/notifications` controls optional weekly and daily email plus optional planning alerts. Broken-bank, sync, Auth, and security messages remain mandatory.

Deployment requirements:

- `20260713051741_weekly_insights_notifications.sql` was applied to the live FundFlow project on 2026-07-12 through the Supabase migration API.
- Configure production `SMTP_*` values.
- Use Vercel Pro or another trusted hourly scheduler for the requested per-user Monday 8:00 AM delivery behavior.
- Run the weekly email visual QA section in `docs/QA.md` with a signed-in browser and real email client before production rollout.

## Latest session (2026-07-08, branch `feat/todos-roadmap`)

Security review of the branch + three roadmap partials finished. All code-level
gates green: `npm run build` ✓ · `npm run lint` ✓ (2 pre-existing warnings in an
integration test) · `npm run test:unit` ✓ **196 tests**.

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
