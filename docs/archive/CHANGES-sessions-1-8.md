# New-Changes — local change log

**Completeness audit (2026-07-05, after Session 8):** every locally changed
file (62 total: all `git diff` modifications + all untracked additions) was
diffed against its copy here — all present and byte-identical. Removed one
orphan: `app/api/plaid/route.ts` (a Session-6 `cp` briefly landed the sync
route at the wrong path before `app/api/plaid/sync/` existed; the correct
`app/api/plaid/sync/route.ts` copy is current). Reminder of the one naming
exception: the repo-root `README.md` is archived as `README.repo.md`.

## Session 8 (2026-07-05): CSV import for pre-Plaid history

The only route past Plaid's 730-day history cap. Settings → "Import history
(CSV)" backfills bank-statement CSVs into an existing account.

| File | What it does |
|---|---|
| `lib/import.ts` **(new)** | Pure parsing/normalization: RFC-4180 parser (quoted fields, embedded newlines), header auto-detection (date + description + amount OR debit/credit split, optional category), date normalization (ISO + US formats, impossible dates rejected), amount parsing (`$1,234.56`, parens negatives), Plaid sign-convention output with a "positive amounts are deposits" flip flag, and deterministic `import-<sha256>` transaction ids (occurrence counter disambiguates identical rows within a file). |
| `app/api/import/csv/route.ts` **(new)** | Multipart upload (2 MB / 20k-row caps, 5/hour rate limit). Ownership of the target account is checked with the RLS-scoped client; inserts use the service client with explicit `user_id`. **Dedupe strategy:** rows dated on/after the account's earliest Plaid-synced transaction are skipped (`import-` id prefix separates the two populations), and deterministic ids make re-imports upsert onto themselves. Bad lines are reported per line number, never silently dropped. Audited as new action `data_import` (`lib/audit.ts`). |
| `components/settings/ImportSection.tsx` **(new)**, `app/settings/page.tsx` | File picker + target-account select + sign-convention checkbox; result panel shows imported/skipped counts and expandable parse errors. Settings page now also fetches accounts. |
| `tests/unit/import.test.ts` **(new)** | 15 tests: CSV parser edge cases, column detection, date/amount normalization, sign flip, debit/credit mapping, id determinism/occurrence behavior. |
| Docs | README feature bullet; TODO item struck; CLAUDE.md invariants (sign convention, `import-` prefix semantics, overlap rule). |

Limitations stated honestly: imports attach to an **existing** account (the
schema ties accounts to Plaid items — no standalone manual accounts), and
imported rows have no `pfc_detailed`/pending semantics (category comes from
the CSV if present, uppercased to match the SNAKE_CASE convention).

Session-8 verification: lint clean, `tsc --noEmit` clean, **15 files / 105
unit tests** pass, `next build` succeeds (`/api/import/csv` registered).

---

## Session 7 (2026-07-05): Plaid-call optimizations, max history, search upgrade

Context: historical data IS persisted (cursor-based `/transactions/sync` writes
everything to Postgres; browsing past months never calls Plaid). These changes
trim the remaining genuine waste:

| # | Files | What changed |
|---|---|---|
| 1. Recurring throttle | `app/api/plaid/sync/route.ts` | Auto-pulls (`source:"auto"`) skip `refreshRecurringForUser` — subscriptions/income streams change weekly at best but cost one Plaid call per item per pull (~48/day at the 30-min cadence). Manual Refresh + the daily cron keep them fresh. Cuts roughly half of steady-state Plaid calls. |
| 2. Webhook key cache | `app/api/plaid/webhook/route.ts` | Verification keys cached by `kid` (Plaid's documented recommendation); expired keys are never cached so rotation falls through to a fresh fetch. Steady-state webhooks now cost zero extra Plaid calls. |
| 3. Max history | `app/api/plaid/link-token/route.ts` | New links request `transactions.days_requested: 730` — Plaid's hard maximum (24 months; institutions may provide less; 10 years is not available from any aggregator). Applies per-link: already-connected banks keep their original depth (reconnect via update mode does NOT re-pull deeper history — only a fresh link does). Our DB retains everything forever from link day onward. |
| 4. Bounded dashboard | `lib/dashboard.ts` | `getDashboardData` no longer selects **all transactions ever** on every render (which the 2-minute auto re-render would multiply as history grows). Now: a 1-row oldest-date probe drives a continuous month browser (`enumerateMonths`, capped at 120 months — empty months render as zeros), and the transaction fetch is bounded to the 6-month window actually rendered (`addMonths` string math, no timezone drift). Semantics note: `availableMonths` is now a continuous range rather than only months-with-data. |
| 5. Search upgrade | `app/transactions/page.tsx` | The ledger search now also matches categories (`pfc_primary`/`pfc_detailed`, spaces mapped to the SNAKE_CASE the columns use) — "food", "travel", "coffee" all work. Placeholder updated. |
| Docs | `README.repo.md`, `CLAUDE.md`, `docs/TODO.md` | README documents the frugality + history-depth story; CLAUDE.md adds the four invariants (don't reintroduce a select-all, etc.); TODO gains the CSV-import-for-pre-Plaid-history idea (the only route to >24-month backfill). |

Session-7 verification: lint clean, `tsc --noEmit` clean, **90/90 unit tests**,
`next build` succeeds. Caveat: `tests/integration/dashboard.test.ts` runs only
on the configured machine — `availableMonths`' new continuous-range semantics
should be sanity-checked there during the E2E pass.

---

## Session 6 (2026-07-05): live transaction updates, rate-limit-aware

Goal: see transactions as they happen without burning Plaid rate limits.
Two independent layers, exactly as requested ("pull within the rate limits,
maybe once every half an hour; else update when the user refreshes"):

| File | What changed |
|---|---|
| `components/AutoRefresh.tsx` **(new)** | Renders nothing; keeps open pages live. Layer 1: `router.refresh()` every 2 min while the tab is visible — re-runs the server queries only (zero Plaid calls), so webhook-delivered transactions appear as they happen. Layer 2: a Plaid auto-pull at most every 30 min; localStorage coordinates tabs, visibility changes trigger an immediate catch-up, failures/429s back off a full window and leave layer 1 + the manual Refresh button as the fallback. |
| `app/api/plaid/sync/route.ts` | Accepts `{source:"auto"}`: the 30-min window is enforced **server-side** (`autosync:` rate-limit key) so multiple tabs/devices collapse to one Plaid call per half hour; a consumed window returns 200 `{skipped:true}` (not an error). Manual refreshes keep their 6/min limit + audit; auto runs are tracked in `sync_jobs` but not audited (audit = user actions, and 48 rows/day of noise would drown it). |
| `lib/dashboard.ts`, `lib/format.ts` | `lastSyncAgoMinutes` (computed in the lib — the `react-hooks/purity` rule bans `Date.now()` in component render) + `formatMinutesAgo` helper. |
| `app/dashboard/page.tsx`, `app/transactions/page.tsx` | Mount `<AutoRefresh />`; dashboard action bar shows an "Updated Xm ago" freshness chip. |
| `tests/unit/format.test.ts` | Covers the minute/hour/day ladder and the never/negative guards. |
| `README.repo.md`, `CLAUDE.md` | Documented the two layers and the "don't shorten the window without checking Plaid quotas" invariant. |

Session-6 verification: lint clean, `tsc --noEmit` clean, **13 files / 90 unit
tests** pass, `next build` succeeds.

---

## Session 5 (2026-07-05): charts, transactions ledger, in-app exports, UI polish

Built with the dataviz skill's procedure: forms chosen by the data's job, the
categorical palette **validated by script** against this app's real surfaces
(`#ffffff` / `#0a0a0a`) — light passes with the relief obligation (aqua/yellow
under 3:1 → every chart shows visible value labels), dark passes in the CVD
floor band (→ 2px surface gaps + direct labels, which the components provide).

| Area | Files | What was built |
|---|---|---|
| Viz tokens + UI polish | `app/globals.css` | `--viz-*` CSS custom properties (categorical slots, diverging pair, ink/grid/status), selected separately per mode — not auto-flipped. Body now uses the Geist font var (was hardcoded Arial next to loaded-but-unused Geist). |
| Chart kit | `lib/chart-utils.ts` (new), `components/charts/{TrendChart,DonutChart,DivergingColumns,Sparkline,StatTile}.tsx` (new) | **Server-rendered SVG, zero client JS, no chart library** (CSP untouched). Pure geometry in `chart-utils` (nice ticks, line/area paths, gapped donut arcs, tail-folding) unit-tested separately. Mark specs per the skill: 2px lines, ≥8px end markers with 2px surface rings, ≤24px columns with 4px rounded data-ends square at the baseline, hairline solid gridlines, 10% area wash single-series only, legends for ≥2 series, selective endpoint labels, native `<title>` tooltips, and a `<details>` **table twin on every chart**. |
| Dashboard upgrade | `app/dashboard/page.tsx`, `lib/dashboard.ts` | Stat tiles (value + signed delta vs last month, colored by direction×good + 6-month sparkline) replace the flat stat cards; **spending-vs-income trend lines** (outflow red / inflow blue, consistent everywhere) replace the bar-list "trend"; **category donut** (top 5 + Other, never a 7th hue) replaces the category bars; Cash Flow tab gains **6-month diverging deposits/withdrawals columns**. `getDashboardData` now also returns `monthlyIncome` and `monthlyCashFlow` (additive). Ranking bar lists restyled to the single-hue slot-1 spec. Header links to `/transactions`. |
| Transactions ledger | `app/transactions/page.tsx` (new) | The app previously had **no way to see individual transactions**. Server-rendered, RLS-scoped table with merchant search (input sanitized for PostgREST `.or` syntax), month + account filters (plain GET form, no JS), pagination (50/page), pending badges, inflow amounts in the good-direction color. |
| In-app exports | `lib/export.ts` (new), `app/api/export/{json,report}/route.ts` (new), `app/api/export/csv/route.ts`, `components/settings/ExportSection.tsx` | The privacy-safe contract (date/merchant/amount/category) extracted to `lib/export.ts` and shared by CSV + new **JSON export** (both gated by `ai_export_enabled`, both audited + recorded in `data_exports`). New **on-demand weekly PDF** (`/api/export/report`) reuses the cron's `getWeeklyReportData`/`generateWeeklyReportPdf`, scoped to the requesting user, audited. Settings now offers all three buttons. |
| Tests | `tests/unit/chart-utils.test.ts`, `tests/unit/charts-render.test.ts` (new) | 20 new tests: geometry (no-NaN guards, gap/fold/tick invariants) and `react-dom/server` render checks of every chart component (legend presence, table twin, tooltips, empty states, delta coloring). |
| Docs | `README.repo.md`, `docs/TODO.md`, `CLAUDE.md` | README describes the new features; TODO strikes through five now-shipped "requested enhancements" (card designs, monthly history, spend indicator, per-card/bank, cash-flow insights — several were already built by earlier PRs); CLAUDE.md documents the chart kit rules and export contract. |

Session-5 verification: lint clean, `tsc --noEmit` clean, **13 files / 88 unit
tests** pass (was 68), `next build` succeeds with `/transactions` +
`/api/export/{json,report}` registered. Caveat honestly stated: charts were
verified structurally (rendered markup asserted NaN-free with all contract
elements) — a human look in the browser is still pending the Plaid-sandbox E2E
run, same as the rest of the UI.

---

## Session 4 (2026-07-05): pulled PR #12 (Vercel Web Analytics) — review only

Fast-forward pull, no conflicts with the uncommitted work. The change adds
`@vercel/analytics` and `<Analytics />` to `app/layout.tsx`. Review verdict:
**safe, no code changes needed.**

- **CSP:** compatible, for a non-obvious reason — with `strict-dynamic`,
  browsers ignore host allowlists entirely; the analytics script loads because
  it is *dynamically injected* by trusted (nonce'd) code, and its beacons go to
  the same-origin `/_vercel/insights/*` (`connect-src 'self'`). Documented in
  CLAUDE.md so nobody adds an unnecessary CSP entry (only CLAUDE.md changed
  locally; copy re-synced here).
- **Origin check (#5):** unaffected — beacons are same-origin POSTs, and
  `/_vercel/*` is generally handled by the Vercel platform before middleware.
- **Privacy:** pageview URLs include query params (`accountId` UUID, `month`)
  — pseudonymous, no PII, and Vercel already hosts the app, so no new party
  sees the data. It no-ops in local dev.
- Verified on the merged state: lint clean, tsc clean, 68/68 unit tests,
  build succeeds.

---

## Session 3 (2026-07-05, later still): remaining must-haves #2–#6

⚠️ **Action needed before these work end-to-end:** apply
`supabase/migrations/0003_hardening.sql` to the live Supabase project (adds
`profiles.weekly_report_enabled` + a `sync_jobs` index). The weekly-report cron
and the Settings page read that column and will error until it exists.

| Must-have | Files | What was built |
|---|---|---|
| **#2 Bank reconnection** | `app/api/plaid/webhook/route.ts`, `lib/plaid-service.ts`, `lib/sync.ts`, `app/api/plaid/link-token/route.ts`, `app/api/plaid/reconnect/route.ts` (new), `lib/audit.ts`, `components/settings/ReconnectBankButton.tsx` (new), `components/settings/BanksSection.tsx`, `app/settings/page.tsx` | `ITEM` webhooks (`ERROR`, `PENDING_EXPIRATION`, `LOGIN_REPAIRED`, `USER_PERMISSION_REVOKED`) now set item status/error_code; sync failures store the real Plaid `error_code` (e.g. `ITEM_LOGIN_REQUIRED`) instead of generic `sync_failed`; the link-token route accepts `item_id` for Plaid Link **update mode** (ownership-scoped, products omitted per Plaid docs); a Reconnect button appears in Settings for broken/expiring items; `/api/plaid/reconnect` clears the error and resyncs; audited as `plaid_reconnect`. |
| **#3 Report opt-out** | `supabase/migrations/0003_hardening.sql` (new), `components/settings/ReportsSection.tsx` (new), `app/api/cron/weekly-report/route.ts`, `app/settings/page.tsx` | `profiles.weekly_report_enabled` (default true), a Settings toggle (RLS-scoped update, same pattern as ExportSection), and the weekly cron filters recipients by it. |
| **#4 Cron observability** | `lib/sync.ts`, `lib/dashboard.ts`, `app/dashboard/page.tsx`, `app/api/cron/sync/route.ts` | The previously-unused `sync_jobs` table is now written on every item sync (running → done/failed + error code, best-effort so logging can never break a sync). The dashboard shows an amber banner when a bank is broken (with a Reconnect link) or when no sync succeeded in 48h; staleness is computed in `getDashboardData` (the `react-hooks/purity` lint rule forbids `Date.now()` in component render). The daily cron prunes jobs >30 days old. |
| **#5 Origin/CSRF check** | `lib/origin.ts` (new), `proxy.ts`, `tests/unit/origin.test.ts` (new) | Mutating `/api` requests with a mismatched `Origin` header get 403 in the proxy. Absent Origin passes (Plaid webhooks, cron, curl — CSRF is browser-only). Handles `x-forwarded-host`, the opaque `"null"` origin, and malformed values (blocked). |
| **#6 Key rotation** | `lib/crypto.ts`, `lib/plaid-service.ts`, `lib/sync.ts`, `.env.example`, `tests/unit/crypto.test.ts` | `PLAID_TOKEN_ENC_KEY_PREVIOUS` enables a two-key decrypt window: `decryptSecretDetailed` tries the current key then the fallback (GCM auth tags make wrong-key attempts fail loudly, so the fallback is safe), and `decryptItemTokenAndUpgrade` re-encrypts fallback-decrypted tokens during the daily sync — rotation converges within a day, no re-linking. |
| Minor: counter pruning | `app/api/cron/sync/route.ts` | `rate_limit_counters` windows older than a day are deleted by the daily cron. |
| Test fix | `tests/integration/api-routes.test.ts` | link-token `POST` now takes a request argument; the test passes a `NextRequest` (its `toHaveBeenCalledWith` expectation is unchanged and still passes — normal mode sends the same Plaid payload). |
| Docs | `README.repo.md`, `docs/TODO.md`, `CLAUDE.md`, `.env.example` | README documents reconnection, opt-out, origin check, key rotation, and migration 0003; TODO strikes through #2–#6 and the pruning minor (the optional cron-failure alert email and the browser E2E run remain); CLAUDE.md gains the new invariants. |

Session-3 verification: lint clean, `tsc --noEmit` clean, **11 files / 68 unit
tests** pass (was 61: +5 origin, +2 crypto rotation), `next build` succeeds.
Integration tests still auto-skip on this machine (no `.env.local`); on the
configured machine, apply migration 0003 first or the weekly-report test fails
on the missing column.

---

## Session 2 (2026-07-05, later): pull from main + MFA enforcement + Google login

Pulled `origin/main` first (fast-forward, PR #11 `hardening/mfa-server-finalization`
— server-side MFA *audit* verification, i.e. must-have #7; no conflicts with the
local uncommitted work). Then:

| File | What changed |
|---|---|
| `lib/mfa.ts` **(new)** | Pure `needsMfaStepUp(currentLevel, nextLevel)` — the single MFA step-up rule shared by proxy, API auth, and the login form. |
| `lib/http.ts` | **Must-have #1 implemented:** `requireUser()` now checks `getAuthenticatorAssuranceLevel()`; an MFA-enrolled user with a password-only (aal1) session gets `401 MFA verification required` from every API route. |
| `proxy.ts` | Same check for pages: aal1-pending sessions are treated as not signed in for protected pages (redirect to `/login`), while `/login` itself stays reachable for them — the `!mfaPending` guard on the "signed-in users skip auth pages" rule prevents a redirect loop. |
| `components/LoginForm.tsx` | On mount, if the session is aal1-pending, jumps straight to the TOTP prompt (resumes an abandoned MFA step). Adds the Google button (hidden during the TOTP step). |
| `components/GoogleSignInButton.tsx` **(new)** | "Continue with Google" via `supabase.auth.signInWithOAuth` → `/auth/callback` (same PKCE exchange the email flow uses). Free tier; Apple was deliberately skipped ($99/yr Apple Developer requirement). |
| `components/SignupForm.tsx` | Google button added below the email form. |
| `tests/unit/mfa.test.ts` **(new)** | 5 cases for `needsMfaStepUp`. |
| `tests/unit/http.test.ts` | Mock client gained `auth.mfa`; 2 new tests: aal1-pending → 401, aal2 → pass. |
| `README.md` (`README.repo.md`) | Stack line mentions Google sign-in; MFA security bullet now describes real server-side enforcement; new "4b. Google sign-in" setup section (Google Cloud OAuth client + Supabase provider toggle — dashboard steps, no code/env changes). |
| `docs/TODO.md` | Must-haves #1 (AAL2 enforcement — this session) and #7 (MFA audit — PR #11) marked done with pointers. |
| `CLAUDE.md` | New top security invariant: MFA enforced server-side via `lib/mfa.ts` in both proxy and `requireUser()`; Google OAuth noted as an auth entry point. |

Session-2 verification: lint clean, `tsc --noEmit` clean, **10 files / 61 unit
tests** pass (was 54), `next build` succeeds (`/login` still prerenders static).
Google provider still needs the one-time dashboard setup (README 4b) before the
button works.

---

## Session 1 (2026-07-05): review, fixes, CLAUDE.md

This folder holds a copy of **every file added or updated** in this working
session (2026-07-05, Claude Code review pass). Paths mirror the repo layout,
so `New-Changes/lib/reporting.ts` is the new version of `lib/reporting.ts`.
Nothing has been committed — all changes exist only in the working tree.
No files were deleted or moved in this session.

One naming exception: the copy of the repo-root `README.md` lives here as
`README.repo.md`, because `New-Changes/README.md` (this file) is the change log.

## Why each file changed

### Security / correctness fixes

| File | Severity | What was wrong → what changed |
|---|---|---|
| `lib/reporting.ts` | **High** | `getWeeklyReportData` queried `accounts` with the service-role client (bypasses RLS) and **no `user_id` filter** — the weekly PDF's "Account Balances" section included every user's accounts and balances. Added `.eq("user_id", userId)`. (The integration test `tests/integration/reporting.test.ts` already expected exactly 1 account, i.e. user-scoping was the intended behavior.) |
| `lib/reporting.ts` | **Medium** | `sendWeeklyReportEmail` silently fell back to an **Ethereal test account** (public inbox + shareable preview URL) whenever `SMTP_*` env was missing — including in production, where it would have shipped real financial PDFs to a public test service. Now: in production, missing SMTP config throws (the cron logs and skips that user); the Ethereal fallback remains for dev only. |
| `lib/reporting.ts` | Low | Weekly spend counted transfers/loan payments, double-counting credit-card purchases and the checking-account payment that settles them. Now applies the same `EXCLUDED_PFC` set the dashboard uses (spend/categories/merchants only; the cash-flow section still counts all deposits/withdrawals, which is correct for cash flow). |
| `app/api/plaid/webhook/route.ts` | **High** | Signature verification called `crypto.verify(undefined, …)` with the key alone. ES256 JWS signatures are raw `r‖s` (IEEE P1363), but Node expects DER by default — so **every genuine production webhook would fail verification** (fail-closed outage; invisible in sandbox, which skips verification). Now verifies with `"sha256"` + `dsaEncoding: "ieee-p1363"`. Also: pins `header.alg === "ES256"` (algorithm-confusion guard), compares the body SHA-256 with constant-time `safeEqual`, and rejects webhooks older than Plaid's documented 5-minute freshness window (`iat`). |
| `lib/csv.ts` | Medium | The CSV export had no spreadsheet **formula-injection** guard: a merchant name like `=HYPERLINK(...)` (merchant names come from bank/Plaid data) executes when the export is opened in Excel/Sheets. String fields starting with `= + - @`, tab, or CR are now prefixed with an apostrophe; numeric fields (negative amounts) are untouched. |
| `app/auth/callback/route.ts` | Low | Errors from `exchangeCodeForSession` were ignored, so an expired/used email-confirmation link bounced users to `/login` with no explanation. Now logs the error and redirects to `/login?error=confirmation_failed` (or `?error=missing_code`). |

### Supporting changes

| File | What changed |
|---|---|
| `lib/dashboard.ts` | `EXCLUDED_PFC` is now exported so `lib/reporting.ts` shares the same spend definition (one-word change, no behavior change to the dashboard). |
| `components/LoginForm.tsx` | Displays a friendly message for the new `?error=` codes from `/auth/callback`, via `useSearchParams` seeding the initial error state. |
| `app/login/page.tsx` | Wraps `LoginForm` in `<Suspense>` — required by `useSearchParams` on this prerendered page (verified: the page still builds as static ○). |
| `tsconfig.json`, `eslint.config.mjs` | Exclude `New-Changes/**` from typecheck and lint so these archived copies are never treated as live source (duplicate-looking modules, stale copies breaking CI). |
| `tests/unit/csv.test.ts` | New test covering formula-injection neutralization, including the "numeric negatives must pass through untouched" edge. |
| `.env.example` | Documented the previously-missing `SMTP_HOST/PORT/USER/PASS/FROM` vars used by the weekly report (required in production, optional in dev). |
| `README.md` (see `README.repo.md`) | "Known Notes" said webhooks and the emailed report were *planned* — both are implemented. Rewrote those bullets to describe the actual state, including the production SMTP requirement. |
| `docs/TODO.md` | Struck through the two "previously planned" items that are now done (webhooks, emailed report). Added a ranked **"Must-have before real-bank production use"** section from the review: (1) server-side MFA/AAL2 enforcement — today `getAuthenticatorAssuranceLevel` is checked only in `LoginForm`, so an aal1 password-only session bypasses MFA entirely; (2) Plaid Link update-mode reconnection for errored items; (3) weekly-report email opt-out; (4) cron failure observability — the `sync_jobs` table is in the schema but written by no code; (5) Origin-header CSRF check on mutating routes; (6) encryption-key rotation/versioning; (7) server-side MFA audit verification (promoted from the old list). |
| `CLAUDE.md` | Was a one-line `@AGENTS.md` import (and `AGENTS.md` only contains a Next.js-version warning). Replaced with a full guide: commands, architecture map, the two-Supabase-clients rule (user-scoped vs service-role), security invariants (crypto, cron auth, webhook verification, CSP, RLS), conventions (Plaid sign convention, route-handler pattern, date handling), testing notes, and this New-Changes workflow. The `@AGENTS.md` import is preserved. |

## Deliberately not changed

- `app/api/settings/mfa/route.ts` writes audit entries based on client-claimed
  factor IDs without server-side verification. `docs/TODO.md` already defers
  server-side MFA audit, and the integration test
  (`tests/integration/mfa-audit.test.ts`) intentionally posts fabricated factor
  IDs and expects 200 — changing this means changing the test contract, so it
  stays a documented TODO.
- `lib/rate-limit.ts` fails open on limiter errors — that is a documented,
  deliberate design choice for a 1–2 user app.
- The webhook route responds only after the sync completes (no true
  backgrounding). Acceptable at this scale; Plaid retries non-2xx deliveries.

## Verification run (2026-07-05)

- `npm run lint` — clean (0 errors, 0 warnings)
- `npx tsc --noEmit` — clean
- `npm run test:unit` — **9 files / 54 tests passed** (was 49; +5 new CSV
  formula-injection assertions). Note: `env.test.ts` and
  `supabase-server.test.ts` need Supabase env vars at import time — on a
  machine without `.env.local` (like this one), run with stubs:
  `NEXT_PUBLIC_SUPABASE_URL=… NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=… npm run test:unit`.
  This is pre-existing behavior, unrelated to these changes.
- `npm run build` — succeeds; `/login` still prerenders as static.
- Integration tests were **not** run (no `.env.local` with live Supabase keys
  on this machine); they auto-skip by design. The reporting fix matches the
  existing expectation in `tests/integration/reporting.test.ts`
  (`report.accounts` must have length 1 — i.e. only the report user's account).
