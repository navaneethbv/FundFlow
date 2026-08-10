# FundFlow architecture

What this repository contains: the request path, the modules in `lib/`, and the
subsystem invariants in full.

`CLAUDE.md` holds the short version, which is the set of rules to follow while
working. This file is the reference behind those rules.
Read the relevant section here before changing a subsystem it covers.

## Request path

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

## Key modules in `lib/`

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
  `app/globals.css`. Rules: fixed slot order, never a 8th+ hue (fold into
  "Other" via `foldTail`), legend for ≥2 series, every chart ships a table twin
  or direct labels, text never wears series color.
  `scripts/validate_palette.js` gates two independent properties and both must
  stay green: pairwise CVD separation *and* WCAG non-text contrast against each
  theme's `--panel`. **Re-step with the validator, never by eye, and never
  extend its exception list to make a re-step pass.** The measurements behind
  all of this, and why seven slots is a ceiling rather than a preference, are
  in `docs/PALETTE.md`; read it before touching the palette.
- `dashboard-widgets.ts` — Phase 8 widget registry and prefs. Layout lives in
  the existing client-writable `profiles.dashboard_prefs` JSON (no migration),
  shared with `sidebarCollapsed` and the legacy hide flags — so every writer
  read-merge-writes rather than overwriting the column. `normalizeWidgetPrefs`
  is deliberately total: it takes `unknown` and always returns a usable layout,
  appending any widget missing from a stored order so a new one is never hidden
  from users who saved a layout before it existed. `computeCumulativeSpendByDay`
  (in `dashboard.ts`) returns **null, never zero**, for a day not yet reached
  and for a day past a shorter previous month's end — a zero there draws a line
  along the floor that reads as "spent nothing". The chart's table twin
  forward-fills; the plotted line stops.
- `export.ts` — the privacy-safe export contract (date/merchant/amount/
  category), shared by `/api/export/csv` and `/api/export/json`;
  `/api/export/report` serves the weekly PDF on demand, and
  `/api/export/report-csv` the Reports page's filtered row set (`isExportAllowed`
  is the shared `ai_export_enabled` gate for exports that build their own rows).
- `sankey.ts` — pure Sankey geometry for `components/charts/SankeyChart.tsx`.
  Two invariants: one value→pixel scale is shared by every column (per-column
  scaling silently breaks flow conservation), and ribbon thickness is never
  floored even though node heights are — floor a ribbon and the ones arriving at
  a node sum to more than the node. `foldSankeyOverflow` caps a column and
  rewrites its edges; the chart's table twin keeps the unfolded detail.
  `sankeyCanvasHeight` sizes the canvas to the busiest column — a fixed height
  crushes every node toward `MIN_SANKEY_NODE_HEIGHT` and smears the labels
  while still rendering, so nothing announces the failure. In `SankeyChart`,
  color encodes the **spending group** and a category inherits its parent's
  hue; sources/hub label to the right and groups/categories to the left, since
  labelling both sides toward the middle is what made columns 2 and 3 collide.
- `reports.ts` — Phase 6 aggregation: `buildCashFlowSankeyData` (transfers
  excluded, so refunds and card payments cannot double-count; "Net Income" on a
  surplus, "Unfunded Spending" on a deficit, link values always non-negative),
  `summarizeTransactions` (totals come from `financeTotals`, which is what keeps
  Reports reconciling with Cash Flow), and the versioned saved-report filter
  schema — strict `parseReportFilters` for stored jsonb, forgiving
  `reportFiltersFromSearchParams` for URLs. `reports-data.ts` is the single
  loader the page and the CSV route share, so a download always matches the
  chart above it.
- `goals-v2.ts` — Phase 7 funded goals. A goal's progress has three sources
  (typed-in `saved_amount`, account allocations capped at the real balance, and
  the `goal_progress_events` ledger) and the failure mode is counting the same
  money twice — so **pay-down goals use the balance delta alone**, never the
  ledger on top. `validateAllocation` mirrors the `set_goal_allocation`
  database function's rules for a fast error message, but that function is the
  enforcement point: its rules are cross-row and it holds a row lock.
  `goalContributionsForMonth` feeds the Budget page, and reads only the event
  ledger — a balance moving is not a contribution.
  `goal-templates.ts` whitelists `image_slug` before it becomes a URL.
- `investments.ts` — Phase 9A holdings aggregation: `buildInvestmentsPage`
  groups active holdings into a fixed asset-class slot order (never a 7th+
  hue, same rule as the chart palette), computes weight/day-change/top-movers
  purely from already-fetched rows, and `normalizeManualHolding` validates a
  manual entry (quantity/price/as-of all required — a manual value never
  claims market freshness it doesn't have). `externalFlowsFromTransactions`
  flips Plaid's debit-positive sign onto "money added is positive" for
  `investment-performance.ts`.
- `investment-sync.ts` — item-scoped Plaid holdings and investment-transaction
  sync. Mark-and-sweep (deactivating a holding absent from a response) runs
  only after a full successful response, scoped to *that item's* own accounts
  — a user-wide account map would let one item's absent holdings deactivate
  another item's. `PRODUCT_NOT_READY`, a missing Investments product, and
  rate limiting are reported as distinct non-failure outcomes, never a broken
  connection. Investment sync writes `sync_jobs.job_type = 'investments'`
  (see the invariant below) and is isolated in its own try/catch from
  transaction sync in the daily cron — a broken Investments item must never
  make a bank sync look like it failed.
- `investment-performance.ts` — `computeTimeWeightedReturn`: a simplified
  per-sub-period Modified Dietz, chain-linked, that removes deposits and
  withdrawals so a balance chart can't be mistaken for market performance. A
  sub-period whose starting base is zero returns 0%, not an infinite result.
  `hasSufficientPerformanceData` (>=2 valuation points) is what a chart checks
  before it's allowed to say "Portfolio performance" instead of "Balance."
- `benchmark-provider.ts` — the `BenchmarkProvider` interface and a caching
  wrapper exist, but `UNAVAILABLE_BENCHMARK_PROVIDER` is the only
  implementation and nothing renders it. Do not wire a benchmark comparison
  into any page until a licensed market-data source is provisioned and its
  terms are documented — this is a legal exposure, not a missing feature.
- `forecasting.ts` — `computeWhatIfProjection` is the dashboard's What-if
  sandbox math (extracted out of `WhatIfPanel`'s own `useMemo`, behavior
  unchanged). `forecastNetWorth`'s three scenarios spread **additively**
  (+/-2 percentage points around the entered rate), not multiplicatively — a
  multiplicative spread inverts conservative/optimistic ordering the moment
  the entered rate goes negative. Every projection surface must say
  "projection," never "prediction" or a confidence level this module doesn't
  compute.
- `advice.ts` / `advice-content.ts` — `ADVICE_LIBRARY` is reviewed education
  content, not user data; `ALLOWED_SOURCE_HOSTS` is an enforcement allowlist
  (a security-review test, not documentation) restricting sources to neutral
  federal-agency domains, never a specific fund/insurer/broker.
  `validateAdviceLibrary` is a content-review guard run as a test against the
  real library — it already caught two items whose own risk disclaimers
  tripped the prohibited-guarantee-language check. `buildAdviceView` treats a
  user's saved priority order as a decision (shown even if `relevantWhen` no
  longer matches), and intersects stored progress against an item's *current*
  task ids so a later content edit can't inflate a completion count.
- `manual-transaction.ts` — `normalizeManualTxn` validates a manual ledger
  entry and resolves its stored sign (debit positive, credit negative,
  matching Plaid's convention). Stored with `plaid_transaction_id =
  manual-<uuid>`, mirroring `import.ts`'s `import-<hash>` prefix convention —
  `lib/finance-domain.ts`'s `fromTransactionRow` derives provenance from this
  prefix, not the newer `source` column, because the prefix is already relied
  on by the sync overlap guard.
- `ledger-columns.ts` — which optional ledger columns are visible, persisted
  as a repeated `col` GET param plus a `colsSubmitted` marker (distinguishing
  "every column explicitly unchecked" from "the menu was never touched," an
  ambiguity a plain multi-checkbox form can't otherwise resolve) rather than
  client state.
- `tags.ts` — `planTagRename` treats renaming a tag to an existing name as a
  merge (a tag's identity is its name, not a row id); the actual rewrite runs
  through the `rename_user_tag` SQL function so it can never race a
  concurrent annotation edit into a lost update.
- `profile.ts` — `validateProfilePatch`: every field is optional, `null`
  clears it, an absent key leaves the stored value untouched (same PATCH
  semantics as the advice profile).
- `components/settings/settings-nav.ts` — `SettingsSection` +
  `sectionFromParam` (invalid/absent falls back to `"profile"`, never a 404 —
  Settings is a control center people bookmark) and the `DisplayPrefs`
  parse/validate pair: `parseDisplayPrefs` is forgiving (for reading whatever
  is already stored), `validateDisplayPrefsPatch` is strict (a write with a
  bad value fails loudly instead of silently substituting a default).
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

## The two Supabase clients

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

## Subsystem invariants in full

- **MFA is enforced server-side.** `lib/mfa.ts` (`needsMfaStepUp`) is checked
  in both `proxy.ts` (pages: aal1-pending sessions are redirected to `/login`,
  which resumes at the TOTP prompt) and `requireUser()` (APIs: 401). Auth
  entry points: email+password and Google OAuth (`signInWithOAuth` →
  `/auth/callback`); both are subject to the same AAL check.
- Plaid `access_token`s are encrypted app-side before insert and never logged,
  returned to the browser, or stored plaintext.
- Cron routes (`/api/cron/*`) authenticate `Authorization: Bearer $CRON_SECRET`
  via `safeEqual`. Vercel sends this automatically for registered crons
  (`vercel.json`: daily sync 07:00 UTC).
  The weekly report is not a Vercel cron: `.github/workflows/weekly-report.yml`
  calls it hourly so each user can be served at their own local Monday 08:00,
  and the period stays due for the rest of the week so a dropped hour or a
  transient send failure can catch up. A send the provider rejects with a 5xx
  is permanent (`isPermanentDeliveryError`) and is not retried, otherwise an
  undeliverable address burns an attempt every hour until the period rolls.
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
  on `budgets`, `saved_reports`, `user_tags`, and the `profiles` preference
  columns — all four hold nothing but user-authored configuration, which is
  the test for joining that list; a provider-synced table never qualifies,
  see `20260730180000_recurring_streams_revert_client_write.sql`). Migrations
  live in `supabase/migrations/` and are applied via the Supabase CLI or
  dashboard SQL editor — there is no migration runner in CI. Code that reads a
  column from a new migration fails until that migration is applied to the
  live project.
- Two private Supabase Storage buckets, both user-prefixed-path RLS
  (`(storage.foldername(name))[1] = auth.uid()::text`): `receipts` (Phase 12
  migration; schema only, no upload route built yet) and `avatars` (Phase 13,
  backing `ProfileSection`'s photo upload). Both render through short-lived
  signed URLs; the existing `img-src 'self' data: https:` CSP directive
  already permits them, so a new bucket needs no CSP change.
- `public/sw.js` caches **only** content-addressed static assets (style/script/
  font/image) and only when `response.ok`. It never caches an HTML document and
  never precaches: documents render per-user financial data that Cache Storage
  would keep readable after sign-out, and a precached document outlives the
  build it came from, then points at `/_next` chunks a later deploy deleted
  (404 → the app renders completely unstyled). Navigations are network-only.
  `CACHE_NAME` is a constant, so the activate-time cleanup never fires, which is
  safe only as long as nothing but hashed URLs goes in.
- The proxy matcher excludes `sw.js` and `manifest.webmanifest`. Both are public
  files with no user data; routing them through the page-auth guard redirects
  them to `/login`, which breaks SW registration and makes the browser parse a
  login page as JSON. Matcher values must stay plain string literals: Next
  statically analyzes them at build time and silently ignores anything else, so
  `String.raw` (which Sonar's S7780 suggests) would disable the matcher.
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
