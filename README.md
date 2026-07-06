# FundFlow

A secure, personal AI-ready finance app. Connect your bank accounts and credit
cards through **Plaid**, pull and categorize transactions, detect recurring
subscriptions, and see spending insights on a dashboard. Built for **1-2 users**
(personal use), deployed on **Vercel + Supabase**.

Instead of sending your data to an LLM, FundFlow lets you **export a privacy-safe
CSV** (merchant, amount, date, category only) that you can feed to any AI tool you
choose.

## Stack

- **Frontend + backend:** Next.js 16 (App Router, TypeScript) — one deployable on Vercel.
- **Auth:** Supabase Auth (email + password, optional **TOTP MFA**), cookie sessions via `@supabase/ssr`.
- **Database:** Supabase Postgres with **Row Level Security** on every table.
- **Bank data:** Plaid (`/link/token/create`, `/item/public_token/exchange`, `/transactions/sync`, `/transactions/recurring/get`).
- **Scheduling:** Vercel Cron (daily sync).

## Architecture

```
Browser (React, no secrets)
   │  fetch, HttpOnly cookie session
Next.js server routes / proxy (the trust boundary)
   │              │                   │
Supabase Auth   Supabase Postgres    Plaid API (server-only)
(email + MFA)   (+ RLS, cron)        exchange / accounts / sync / recurring
```

- Plaid `client_id`/`secret` and all `access_token`s live **only** in server code.
- The `access_token` is **AES-256-GCM encrypted** before it touches the database.
- The browser only ever reads sanitized finance data, constrained by RLS.

## Security

- **Encrypted tokens at rest** — Plaid access tokens are AES-256-GCM encrypted app-side (`lib/crypto.ts`); the key is `PLAID_TOKEN_ENC_KEY` (never in the DB).
- **Row Level Security** — every user table enforces `user_id = auth.uid()`; server code also scopes by user (defense in depth). Cross-user access is covered by an integration test.
- **Server-only secrets** — `lib/env.server.ts` is guarded by `server-only`; secrets can never be bundled into client code.
- **MFA** — TOTP via Supabase Auth (enrollable in Settings; enforced once enrolled).
- **Security headers** (`proxy.ts`) — nonce-based CSP (allows Plaid + Supabase only), `X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security`, `Referrer-Policy`, `Permissions-Policy`.
- **Rate limiting** — Supabase handles auth limits; a Postgres-backed limiter guards token exchange and refresh (`lib/rate-limit.ts`).
- **Audit logs** — login/connect/exchange/disconnect/refresh/export/delete recorded in `audit_logs` (never tokens or PII).
- **No sensitive logging** — `lib/log.ts` redacts tokens/PII; errors log message/stack only.
- **Prod error hygiene** — generic errors in production, details only in dev (`lib/http.ts`).
- **RBAC** — admin/debug endpoints gated by a `role` column (`requireAdmin`).
- **User-controlled deletion** — "Disconnect bank" removes the Plaid item + its data; "Delete account" removes everything and calls Plaid `/item/remove`.
- **Least privilege** — the browser uses the publishable key (RLS-bound); the secret key is used only in trusted server routes.
- **Dependency scanning** — Dependabot + `npm audit` in CI.

## Setup

### 1. Prerequisites
- Node 20+ and npm
- A Supabase project ([supabase.com](https://supabase.com))
- A Plaid account with Sandbox keys ([dashboard.plaid.com](https://dashboard.plaid.com/developers/keys))

### 2. Environment
Copy `.env.example` to `.env.local` and fill it in:

```bash
cp .env.example .env.local
```

Generate the crypto secrets:
```bash
node -e "console.log('PLAID_TOKEN_ENC_KEY=' + require('crypto').randomBytes(32).toString('base64'))"
node -e "console.log('CRON_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
```

Get your Supabase URL + **publishable** and **secret** keys from
Project Settings → API Keys. Get Plaid `client_id`/`secret` from the Plaid dashboard.

### 3. Database
Apply the migrations in `supabase/migrations/` to your project. Either:
- **Supabase CLI:** `supabase link --project-ref <ref>` then `supabase db push`, or
- **Dashboard:** paste `0001_init.sql` then `0002_rate_limit.sql` into the SQL editor.

### 4. Supabase Auth settings
- For quick local testing, disable "Confirm email" (Auth → Providers → Email), or use the emailed confirmation link (handled by `/auth/callback`).
- MFA (TOTP) is enabled by default on Supabase.

### 5. Run
```bash
npm install
npm run dev
```
Open http://localhost:3000, sign up, then connect a bank. In **Plaid Sandbox**, use
username `user_good` / password `pass_good`.

## Testing

```bash
npm run test:unit   # crypto round-trip/tamper, CSV masking (no external services)
npm test            # also runs integration tests against your Supabase project
```

Integration tests (`tests/integration/`) require `.env.local` and applied
migrations. They verify **cross-user RLS isolation** and **sync idempotency**
(re-applying the same transaction never duplicates). They auto-skip if env is missing.

## Deploy (Vercel)

1. Import the repo in Vercel.
2. Add all `.env.local` vars as Project Environment Variables (Production).
3. `vercel.json` registers a daily cron at 07:00 UTC hitting `/api/cron/sync`.
   Vercel automatically sends `Authorization: Bearer $CRON_SECRET`, which the
   route verifies. Make sure `CRON_SECRET` is set in Vercel.
4. Switch `PLAID_ENV` to `production` (and use production Plaid keys) when ready
   to connect real banks.

## Project structure

```
app/
  api/plaid/{link-token,exchange,sync,disconnect}/  Plaid routes (server-only)
  api/{export/csv,account,cron/sync,admin/stats}/   export, delete, cron, admin
  {login,signup,dashboard,settings}/                pages
  auth/callback/                                    email-confirm/OAuth exchange
components/                                         UI (Plaid Link, settings, auth)
lib/
  crypto.ts        AES-256-GCM token encryption
  plaid.ts         Plaid client
  plaid-service.ts item storage, accounts, token decrypt
  sync.ts          idempotent /transactions/sync
  recurring.ts     recurring streams
  dashboard.ts     aggregations (RLS-scoped)
  supabase/        browser / server / service clients
  audit.ts log.ts rate-limit.ts http.ts env*.ts
supabase/migrations/                                schema + RLS + rate limiter
proxy.ts                                            session refresh + CSP + route guard
```

## Known Notes / Future Todos

- **`npm audit`** flags moderate PostCSS entries pinned transitively *inside Next.js itself*; the advisory affects untrusted CSS stringification (not our path). It resolves when Next bumps its internal PostCSS; we don't downgrade Next.
- **Email the CSV report** on a schedule (e.g. Resend) — planned.
- **Plaid webhooks** with signature verification for real-time sync — planned (currently on-demand + daily cron).
- **Optional in-app AI insights** endpoint reusing the export data contract — planned.

See [`docs/TODO.md`](docs/TODO.md) for the deferred feature list and
[`docs/HANDOFF.md`](docs/HANDOFF.md) for the latest session handoff notes.
