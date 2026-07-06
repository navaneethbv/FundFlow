# FundFlow — Session Handoff

Last updated: 2026-07-05. Read this first to resume.

## Where we are

A secure personal-finance app (Next.js 16 + Supabase + Plaid) is **built and
verified at the code/DB level**. The only thing left is a **browser end-to-end
run**, which is blocked on adding Plaid Sandbox keys.

**Status: green.**
- `npm run build` ✓ · `npm run lint` ✓ · `npx tsc --noEmit` ✓
- `npm test` ✓ **13/13** (unit + integration against the live FundFlow DB)
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
- Future features: `TODO.md` (card designs, mobile, per-card/per-bank spend,
  checking cash-flow insights, monthly history, email report, webhooks, AI).
- Full walkthrough + security checklist: `README.md`
- Migrations: `supabase/migrations/0001_init.sql`, `0002_rate_limit.sql`

## Not yet done

- Browser end-to-end run (needs Plaid keys — step above).
- `git` is untouched (no commits made). Commit when ready.
- Everything in `TODO.md` is deferred by design.
