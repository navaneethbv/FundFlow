# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev         # Next.js dev server on http://localhost:3000
npm run build       # production build (also the fastest full type/route check)
npm run lint        # eslint (flat config, eslint.config.mjs)
npx tsc --noEmit    # typecheck only
npm run test:unit   # unit tests only — no external services needed
npm test            # unit + integration tests (integration hits the live Supabase project)
npm run test:watch  # vitest watch mode
```

Run a single test file: `npx vitest run tests/unit/csv.test.ts`.

Integration tests (`tests/integration/`) require `.env.local` with Supabase URL
+ publishable + secret keys and the migrations applied; they **auto-skip**
(`describe.skip`) when those vars are missing. They create throwaway users
(deleted in `afterAll`) against the real FundFlow Supabase project — never point
them at a production database with real user data.

## What this app is

FundFlow is a personal-finance app for 1–2 users: Next.js 16 App Router
(TypeScript, Tailwind 4) deployed on Vercel, Supabase for auth + Postgres,
Plaid for bank data. There is deliberately **no in-app AI** — the user exports
a privacy-safe CSV (date/merchant/amount/category only) and feeds it to an AI
tool of their choice.

## Architecture

```
Browser (React, publishable key only, RLS-bound)
   │ HttpOnly cookie session
proxy.ts  ── session refresh (getUser), CSP nonce, security headers, page-auth redirects
   │
app/api/* route handlers (the trust boundary)
   │           │             │
Supabase Auth  Supabase PG   Plaid API (server-only client, lib/plaid.ts)
(email+TOTP)   (RLS on all   link-token / exchange / transactions/sync /
               user tables)  recurring / webhook verification
```

Key modules in `lib/`:

- `crypto.ts` — AES-256-GCM for Plaid access tokens at rest (key:
  `PLAID_TOKEN_ENC_KEY`, 32 bytes base64). Rotation: decryption falls back to
  `PLAID_TOKEN_ENC_KEY_PREVIOUS` (`decryptSecretDetailed` reports which key
  worked); the daily sync re-encrypts fallback-decrypted tokens. Also
  `safeEqual` for constant-time secret comparison (cron auth, webhook hash).
- `plaid-service.ts` — item storage (encrypt/decrypt), account upserts, cursor,
  `decryptItemTokenAndUpgrade` (rotation), `getItemByPlaidItemId` (webhooks).
- `sync.ts` — idempotent `/transactions/sync`: upsert on unique
  `plaid_transaction_id`; the cursor is persisted only after a fully successful
  run, so re-runs re-apply pages without duplicates. Each item sync records a
  `sync_jobs` row (running → done/failed with the Plaid `error_code`); the
  dashboard's stale-data banner reads the newest `done` job.
- `origin.ts` — pure `isCrossOrigin`; `proxy.ts` 403s mutating `/api` requests
  with a mismatched Origin header (absent Origin passes — non-browser callers).
- `chart-utils.ts` — pure chart geometry (ticks, paths, donut arcs, tail-fold);
  unit-tested. `components/charts/` are **server-rendered SVG** (no chart
  library, no client JS, CSP-safe) driven by the `--viz-*` tokens in
  `app/globals.css` — a categorical palette validated for CVD + contrast in
  both modes (dataviz-skill validator). Rules baked in: fixed slot order,
  never generate a 7th+ hue (fold into "Other" via `foldTail`), legend for ≥2
  series, every chart ships a table twin, text never wears series color.
- `export.ts` — the privacy-safe export contract (date/merchant/amount/
  category), shared by `/api/export/csv` and `/api/export/json`;
  `/api/export/report` serves the weekly PDF on demand.
- `import.ts` — pure CSV-statement parsing/normalization for
  `/api/import/csv` (pre-Plaid backfill). Invariants: output uses the Plaid
  sign convention; imported rows carry deterministic `import-<hash>`
  transaction ids (the prefix marks non-Plaid rows — the overlap guard and
  any future logic key off it); rows on/after the account's earliest
  Plaid-synced date are skipped, never merged.
- `recurring.ts` — recurring streams (subscriptions + income).
- `dashboard.ts` — pure aggregation over RLS-scoped queries; exports
  `EXCLUDED_PFC` (transfers/loan payments are cash movement, not spending —
  every spend total in the app must apply it or credit-card payments get
  double-counted).
- `reporting.ts` — weekly PDF (pdfkit) + email (nodemailer). Runs under the
  cron with the **service client**, so every query must scope `user_id`
  explicitly. In production, missing `SMTP_*` env throws (never falls back to
  the public Ethereal test inbox); in dev, Ethereal + preview URL.
- `http.ts` — `requireUser()` / `requireAdmin()` return either an
  `AuthedContext` or a ready `NextResponse` (check `instanceof NextResponse`).
  `errorResponse()` hides details in production.
- `rate-limit.ts` — Postgres fixed-window limiter (`rate_limit_hit` RPC),
  **fails open** by design.
- `audit.ts` — best-effort `audit_logs` writes (never throws, never PII).
- `log.ts` — `logError` logs message/stack only; `redact()` for objects.
- `csv.ts` — RFC-4180 builder with spreadsheet formula-injection
  neutralization (leading `=+-@`/tab/CR on strings get an apostrophe prefix).

## The two Supabase clients — the most important rule here

- `lib/supabase/server.ts` `createClient()` — cookie-bound, runs **as the
  user**, RLS applies. Default for reads in pages and routes.
- `lib/supabase/service.ts` `createServiceClient()` — secret key, **bypasses
  RLS**. Only for writes RLS intentionally blocks (tokens, synced data, audit
  logs) and cron jobs. Every service-client query **must** filter by
  `user_id` explicitly; RLS will not save you. (A missing filter here is
  exactly how the weekly report once leaked cross-user account balances.)

`lib/env.server.ts` (secrets, lazy getters) is guarded by `server-only`;
`lib/env.ts` holds the `NEXT_PUBLIC_*` values. Never import server env into
client components.

## Security invariants (do not regress)

- **MFA is enforced server-side.** `lib/mfa.ts` (`needsMfaStepUp`) is checked
  in both `proxy.ts` (pages: aal1-pending sessions are redirected to `/login`,
  which resumes at the TOTP prompt) and `requireUser()` (APIs: 401). Auth
  entry points: email+password and Google OAuth (`signInWithOAuth` →
  `/auth/callback`); both are subject to the same AAL check.
- Plaid `access_token`s are encrypted app-side before insert and never logged,
  returned to the browser, or stored plaintext.
- Cron routes (`/api/cron/*`) authenticate `Authorization: Bearer $CRON_SECRET`
  via `safeEqual`. Vercel sends this automatically for registered crons
  (`vercel.json`: daily sync 07:00 UTC, weekly report Sunday 07:00 UTC).
- `/api/plaid/webhook` verifies the `plaid-verification` JWT outside sandbox:
  pinned `alg: ES256`, key via `webhookVerificationKeyGet`, signature checked
  with `dsaEncoding: "ieee-p1363"` (JWS raw r||s, not DER — omitting this
  rejects all genuine webhooks), body SHA-256 compared with `safeEqual`, 5-min
  `iat` freshness. Sandbox and `NODE_ENV=test` skip verification.
- The CSV export contains only date/merchant/amount/category and is gated by
  the profile's `ai_export_enabled` flag.
- CSP (in `proxy.ts`, not middleware — Next 16 renamed it) is nonce-based with
  `strict-dynamic`; only Plaid + the Supabase host are allowed. New external
  scripts/hosts require a CSP change there. Vercel Web Analytics (`<Analytics/>`
  in `app/layout.tsx`) needs no CSP entry: its script is dynamically injected
  (trusted via `strict-dynamic`) and its beacons hit the same-origin
  `/_vercel/insights/*` (covered by `connect-src 'self'`).
- Every user table has RLS with owner-only `select` (client writes allowed only
  on `budgets` and the `profiles` preference columns). Migrations live in
  `supabase/migrations/` and are applied via the Supabase CLI or dashboard SQL
  editor — there is no migration runner in CI. Code that reads a column from a
  new migration fails until that migration is applied to the live project.
- Bank-connection health: `ITEM` webhooks and sync failures set
  `plaid_items.status`/`error_code`; Settings offers update-mode reconnection
  (`/api/plaid/link-token` with `item_id` → `/api/plaid/reconnect`). Don't
  create a second item for the same bank to "fix" a broken one.
- Live updates: `components/AutoRefresh.tsx` re-renders the page every 2 min
  (no Plaid calls) and triggers `/api/plaid/sync` with `{source:"auto"}` at
  most once per 30 min — the window is enforced **server-side** via the
  `autosync:` rate-limit key (client timers/localStorage are only a courtesy).
  A consumed window returns 200 `{skipped:true}`, never an error; auto runs
  are recorded in `sync_jobs` but deliberately not in `audit_logs` (audit is
  for user actions). Don't shorten the window without checking Plaid quotas.
- Plaid-call frugality invariants: auto-pulls skip `refreshRecurringForUser`
  (manual Refresh + daily cron keep streams fresh); webhook verification keys
  are cached by `kid` (expired keys never cached); link tokens request
  `days_requested: 730` (max history, set per-link); `getDashboardData`
  fetches transactions **bounded to the 6-month render window** (oldest-date
  probe drives the month browser) — don't reintroduce a select-all, the
  2-minute auto re-render multiplies whatever this costs.

## Conventions

- Route handlers follow the pattern: `requireUser()` → early-return the
  `NextResponse` → rate limit (where sensitive) → validate body with
  `badRequest()` → work → `writeAudit()` → JSON; all wrapped so failures hit
  `errorResponse(context, error)`.
- Amount sign follows Plaid: **positive = money out**, negative = money in.
- Dates are handled as `YYYY-MM-DD` strings end-to-end; month keys are
  `YYYY-MM` (`monthKey()` in `dashboard.ts`).
- Tests mock modules with `vi.mock` and import route handlers directly
  (`POST as plaidWebhookPost`) rather than spinning up a server.
- `docs/HANDOFF.md` is the session-resume note; `docs/TODO.md` is the deferred
  feature list. Update both when finishing significant work.

## Local-change workflow (this repo, current phase)

Do **not** commit or push. Every added/updated file must also be copied into
`New-Changes/` (mirroring the repo path), and `New-Changes/README.md` must
describe each change; deletions/moves are documented there too.
