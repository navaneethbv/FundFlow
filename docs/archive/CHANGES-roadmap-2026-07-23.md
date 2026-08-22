# FundFlow — Roadmap Implementation Drop (2026-07-23)

This document records every file added or modified across the four
implementation sessions on 2026-07-23.
It was originally the manifest for a staging folder (`new_changes/`); that
folder has been merged into the repo and removed, so the paths named below are
the real ones.

## Verification (final state)

- `npm run test:unit` — **87 files / 517 tests pass** (374 before this work;
  143 tests added, pure functions all written test-first).
- `npm run lint` — clean. `npm run build` — compiles. `npx tsc --noEmit` —
  zero errors in app code.
- Playwright smoke suite compiles and lists 6 specs (needs
  `npx playwright install chromium` + a running app to execute).
- Env note: 3 pre-existing test files import `lib/env.ts` and need
  `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` set —
  any placeholder works locally; CI has real values.

## ⚠️ Deploy checklist (do these in order)

0. **Apply ALL THREE new migrations in filename order** —
   `20260723100000_phase_features.sql`, then
   `20260723150000_bucket_features.sql`, then
   `20260723200000_full_sharing_push_prefs.sql` (session 4: full
   per-connection household sharing, dashboard prefs, push subscriptions).
0b. **Optional env for new features:** `PLAID_LIABILITIES_ENABLED=1` (paid
   Plaid product — auto card APRs), and for web push generate VAPID keys
   (`npx web-push generate-vapid-keys`) → set `VAPID_PUBLIC_KEY`,
   `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (mailto:), and
   `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (same value as the public key).
1. **Apply `supabase/migrations/20260723100000_phase_features.sql`** to the
   live project BEFORE deploying — the dashboard and settings read new
   columns (`accounts.apr`, `budgets.rollover_enabled`, `category_overrides`,
   `calendar_tokens`, `household_members/invites`, `milestones`,
   `saved_views`, `alert_preferences.large_transaction_threshold`, pg_trgm
   indexes) and fail until it runs.
   Note this migration also **replaces the `household_members` insert/update
   policies** with owner-only versions.
   The originals (from `20260707012910`) allowed `user_id = auth.uid()`, which
   was harmless when membership granted nothing, but becomes a
   privilege-escalation path once `is_household_member()` starts gating shared
   financial data.
2. **Set `BACKUP_ENC_KEY`** (32 bytes base64:
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`)
   in Vercel env — the backup cron fails closed (and alerts the admin)
   without it. Store a copy of the key somewhere that is NOT your email.
3. **Optionally set `ANTHROPIC_API_KEY`** to activate real AI insights
   (without it the rule-based summaries keep working). Optional
   `AI_INSIGHTS_MODEL` overrides the default `claude-opus-4-8`.
4. The **backup workflow** (`.github/workflows/backup.yml`, monthly) reuses
   the existing `FUNDFLOW_APP_URL` + `CRON_SECRET` repo secrets — nothing new
   to configure.

---

## Session 1 — Financial-intelligence quick wins (9 features)

Dashboard tiles: **Safe to Spend** (cash − bills due before the detected
payday), **Next paycheck** (income streams matched to real deposits),
**Emergency runway** (liquid cash ÷ median monthly essentials). Alerts:
**subscription price hikes** and **new recurring charges** (pre-upsert stream
diff, first refresh seeds silently, no migration needed). **Merchant-spike
anomalies** (≥2× a merchant's trailing median and ≥$25 above it). **Budget
suggestions** in Settings (median + 5% headroom, one-click add).
**Savings-rate/essentials split** powering the runway. **Privacy blur** (eye
icon in the top bar blurs every `.metric-value` via CSS; localStorage-persisted).

Key new files: `lib/insights.ts` (all the pure math), `components/PrivacyToggle.tsx`.

## Session 2 — Phases 2–8 + Phase-1 remainder

### Phase 1 remainder

- **1.8 Bill calendar with weekly/monthly toggle** *(as requested)* —
  `groupRecurringByPeriod` in `lib/planning.ts` expands recurring occurrences
  over the horizon (a weekly gym charge appears every week, anchored to each
  stream's latest real transaction) into Monday-keyed weeks or calendar
  months with in/out totals. `components/dashboard/BillCalendar.tsx` renders
  it on the Plan view; the **Weekly | Monthly** toggle is a server-rendered
  `?bills=` link pair — no client JS.
- **1.9 Price drift** — recent 3-month vs prior 3-month average charge per
  repeat merchant (≥2 charges each side), plus a spend-weighted overall
  "your personal inflation" number. Plan-view panel.
- **1.10 Debt payoff planner** — `lib/debt.ts` (avalanche/snowball monthly
  simulation with payment rollover; null when minimums can't cover interest).
  Plan-view panel shows months + interest at minimums and with +$200/mo.
  User-entered APRs via Settings → Card APRs (`/api/accounts/apr`); cards
  without one assume 22% and the panel says so.
- **1.12 Budget rollover** — per-budget checkbox; carry = Σ(limit − spend)
  over the window months (zero-spend months count as full carry), effective
  limit floored at 0; envelope status/remaining use the effective limit.
- **1.13 Custom categories** — `category_overrides` table; a display-time
  mapping layer in the dashboard aggregation (after merchant rules; overrides
  touching `EXCLUDED_PFC` in either direction are dropped so transfers can't
  be hidden or double-counted). Settings section to rename/merge; stored
  transactions are never rewritten, so Plaid re-syncs can't fight user edits.

### Phase 2 — Resilience & ops

- **2.1 Encrypted backups** — `lib/backup.ts` (gzip → AES-256-GCM with a
  dedicated `BACKUP_ENC_KEY`, versioned JSON envelope; tamper/wrong-key
  covered by tests), `/api/cron/backup` emails each user their archive
  monthly (`.github/workflows/backup.yml`), `scripts/restore-backup.mjs`
  decrypts. Users with no transactions are skipped; failures alert the admin.
- **2.2 E2E scaffold** — `tests/e2e/smoke.spec.ts` (6 no-auth specs: login
  renders, CSP + security headers, unauth redirects, API auth), `playwright.config.ts`,
  `.github/workflows/e2e.yml`, `npm run test:e2e`. Authenticated golden-path
  specs are listed as TODOs in `tests/e2e/README.md`.
- **2.3 Integrity checks** — `lib/integrity.ts` (stuck sync jobs >24h,
  orphaned transactions, duplicate Plaid ids — import rows exempt) runs per
  user inside the daily sync cron; findings alert the admin through the
  existing deduped rail.
- **2.4 Health endpoint** — `/api/health`: DB reachability + last-sync age,
  booleans only, no auth, no data. Wired into the compose healthcheck.
- **2.6 Migration smoke-check CI** — `.github/workflows/migration-check.yml`
  applies every migration to an ephemeral Postgres on PRs touching
  migrations, then `scripts/check-rls.sql` fails the build if any public
  table lacks RLS or has zero policies — the repo's most important invariant
  is now a gate.
- **2.7 Admin ops** — Operations panel on `/admin`: backup freshness
  (current/overdue vs the monthly cadence) and last-sync age.

### Phase 3 — Real AI insights

`lib/ai-provider.ts`: official `@anthropic-ai/sdk`, model `claude-opus-4-8`
(env-overridable), adaptive thinking, JSON-schema-constrained output. The
only data sent is what the CSV export already exposes — bounded month/category
totals + top-25 merchants; never balances, accounts, or emails. Activates only
when `ANTHROPIC_API_KEY` is set AND both existing consents are on; hard-capped
at 4 generations/user/day via the rate limiter; any provider failure falls
back to the rule-based summaries (never a 500). Results still persist to
`ai_insights` as before.

### Phase 4 — Household (scoped deliberately)

- **4.1 Membership + invites** — `household_members`/`household_invites`
  tables (owner-gated RLS), invite-by-email from the Settings household card
  (hashed 7-day tokens over the SMTP rail, 5/day rate limit), acceptance
  route requires sign-in AND a matching signup email.
- **4.4 Settle-up math** — `computeSettleUp` in `lib/insights.ts` nets shared
  expenses into one "X owes Y" balance (unit-tested; UI arrives with 4.2).
- **Explicitly deferred: 4.2/4.3 shared data visibility.** Membership grants
  NO access to the other person's financial data yet. Rewriting every RLS
  policy is the highest-risk change in the codebase (see the `getGoals` leak
  history) and deserves its own carefully-reviewed pass with cross-user
  integration tests — now protected by the 2.6 CI gate.

### Phase 5

pg_trgm extension + trigram indexes on `transactions.name`/`merchant_name`
(ledger search stays fast as history grows), and
`docker-compose.selfhost.yml` (app container against your own Supabase, with
the health endpoint wired in). Annual report / web push / investments deferred.

### Phase 6 — Interoperability

- **6.2 iCal feed** — `lib/ical.ts` (pure RFC 5545 builder, deterministic
  UIDs, escaping, CRLF), `/api/calendar/[token]` capability URL (SHA-256
  hashes stored, plaintext shown once, revocable), Settings → Calendar feed
  section. Amounts in event titles are opt-in and off by default.
- **6.3 OFX/QFX import** — `lib/import-ofx.ts` parses SGML 1.x and XML 2.x
  statements into the exact pipeline CSV uses (same sign convention,
  deterministic ids, overlap guard); the import form now accepts `.ofx/.qfx`.
- **6.4 Tax export** — tag transactions "tax" in the ledger editor, then
  Settings → "Tax-tagged CSV" (`/api/export/csv?scope=tax`, same privacy
  contract).
- **Deferred: 6.1 personal API tokens** (security-sensitive enough to deserve
  an unhurried pass).

### Phase 7 — Security extras

- **7.3 Large-transaction threshold** — `lib/sync.ts` now reads
  `alert_preferences.large_transaction_threshold` (null = $500 default) for
  the webhook-time instant alert. (Set via SQL/table for now — prefs UI knob
  is a small follow-up.)
- **7.2 Privacy blur** shipped in session 1.
- **Deferred: 7.1 login alerts, 7.4 demo mode.**

### Phase 8 — Delight

- **8.2 Milestones** — first-positive net worth and every $10k crossing fire
  exactly once ever (the `milestones` unique key is the claim; only a
  successful claim notifies), as success-toned feed notifications from the
  daily cron.
- **Schema-ready, UI deferred: 8.4 saved views** (table + RLS exist).
  **Deferred: 8.1 wrapped, 8.3 command palette, 8.5 bulk edit, 8.6 layout prefs.**

---

### Design notes

- **Zero marginal dashboard cost preserved** — the bill calendar, drift, and
  debt plan are pure math over data `getDashboardData` already loads; the
  2-minute auto re-render multiplies whatever this path costs.
- **Every new credential is hash-only** (calendar tokens, household invites),
  compared/minted with the same discipline as Plaid tokens; every mint/use
  is audit-logged; everything is revocable from Settings.
- **Two encryption keys on purpose** — `BACKUP_ENC_KEY` ≠
  `PLAID_TOKEN_ENC_KEY`; a leaked backup key must not unlock bank tokens.
- **Everything degrades, nothing breaks** — no AI key → rule-based insights;
  no backup key → alert, not crash; notification failures never break the
  sync that found them; provider errors never 500 the insights route.

## Session 3 — Bucket 1 (deferred finishers) + Bucket 2 (new ideas)

### Bucket 1 — deferred items now shipped

- **4.2-lite household sharing** — `is_household_member()` SECURITY DEFINER
  helper; goals and budgets gain a nullable `household_id` with an additive
  member-read RLS policy (writes stay owner-only). Budgets get a "Visible to
  my household" checkbox in Settings. **Transaction/account-level sharing
  remains deliberately out** — that RLS rewrite still deserves its own pass.
- **4.4 Settle-up UI** — `shared_expenses` ledger (Splitwise-lite): each
  partner records what they paid; `computeSettleUp` nets it to one
  "X owes Y" line with a mark-settled button. Members can see their
  household and its member list (new additive policies); member emails are
  resolved server-side for the picker.
- **8.4 Saved ledger views** — chips bar on `/transactions`: save the
  current filter combination under a name, jump back with one click, delete
  with ×. Client-written under the existing `saved_views` RLS.
- **7.1 Login alerts** — when the session-record upsert in `requireUser()`
  *creates* a record (new session), and that user agent has never been seen
  on the account, the user gets a "new sign-in" email (coarse device label
  only — no IPs), rate-limited 3/day, fully fire-and-forget.
- **6.1 Personal API tokens** — `fft_`-prefixed read-only bearer tokens for
  `/api/export/csv|json` from your own scripts. SHA-256 hashes only,
  plaintext shown once, revocable in Settings, last-used stamped, 5 mints/
  day. Also fixed a latent hazard found on the way: `fetchPrivacySafeRows`
  now scopes transactions by user id explicitly (it previously leaned on
  RLS, which the token path's service client bypasses).
- **8.1 Year in Money** — `/wrapped?year=` recap page: totals, savings
  rate, top merchants/categories (linked into the ledger), biggest/quietest
  month, largest purchase, 12-month spend bars. Pure `lib/annual.ts` (9
  tests). Not in the sidebar yet — reachable by URL.
- **8.3 Command palette** — ⌘K/Ctrl+K overlay on every signed-in page:
  filterable jump list to pages/views/exports, arrow-key + Enter, ARIA'd.
- **7.3 threshold knob** — the large-transaction alert threshold is now
  editable on `/notifications` (blank = $500 default).
- **Authenticated E2E golden path** — `tests/e2e/golden-path.spec.ts`:
  7 serial specs (sign-in, dashboard tiles, ledger, settings panels, export
  contract, privacy blur, gated Plaid-sandbox connect). Skips cleanly
  without `E2E_EMAIL`/`E2E_PASSWORD`; Plaid step needs `E2E_PLAID=1`.

### Bucket 2 — new ideas shipped

- **Receipt scanning** — Settings → "Scan a receipt": the photo goes to the
  vision model (`/api/ai/receipt`, same double consent as insights, 10/day,
  image never stored), extraction is matched against the ledger (amount ±1%,
  date ±3 days), and you choose whether to attach the line items as a note
  via the existing annotate route.
- **Ask your money** — Settings → one-question Q&A (`/api/ai/ask`, 10/day)
  over the same privacy-safe aggregates; no chat, no history.
- **Plaid Liabilities APRs** — `syncCardAprsForUser` pulls real purchase
  APRs into `accounts.apr` during the daily cron, **only when
  `PLAID_LIABILITIES_ENABLED=1`** (it's a paid Plaid product add).
- **Sinking funds** — Settings CRUD + Plan-view panel showing the monthly
  set-aside per fund; funds due within 45 days count as upcoming bills in
  Safe to Spend (past-due dates clamp to today). Pure math in
  `computeSinkingFunds` (tests).
- **What-if simulator** — Plan view: income/spending/extra-debt sliders
  recomputing monthly surplus, emergency runway, and debt-free date live in
  the browser (the pure libs are client-safe — zero server round-trips).
- **Trajectory projection** — Plan view: `projectNetWorth` (0% growth by
  default, honest about it) shows where the current median savings pace
  lands in 1 and 5 years.
- **Cancellation watch** — Settings: mark a merchant cancelled; if it ever
  charges again the sync raises a danger alert ("Charged after
  cancellation") within minutes of the webhook.
- **Stale-pending check** — the nightly integrity pass now flags
  transactions stuck in `pending` for over 7 days (holds that never cleared
  or sync gaps).

## Session 4 — The final deferred set

- **4.2/4.3 FULL household data sharing** — the big one. Sharing is opt-in
  **per bank connection** ("Share with household" on each bank in
  Settings → `/api/plaid/share`). Additive read-only RLS policies expose a
  shared item's accounts, transactions, and recurring streams to household
  members; `plaid_items` itself gets NO member policy (members must never
  read even the encrypted token). The dashboard defaults to **"Just mine"**
  (explicit user filter, exactly the old behavior) with a **Household**
  scope chip that lets RLS-visible shared rows blend in — no implicit
  blending, ever. Per-person attribution shows "You $X · household $Y this
  month". The cache key carries the scope; service-client callers always
  stay user-scoped. Cross-user isolation remains covered by the RLS CI gate.
- **Goals share checkbox** — "Visible to my household" per goal (the
  budgets-side toggle shipped in session 3).
- **8.5 Bulk tagging** — "Tag all N shown" bar on the ledger: filter first,
  then one-click `tax`/`receipt` or a custom tag applied to every visible
  row via `/api/transactions/annotate-batch` (ownership-filtered, merges
  into existing tags, ≤100/batch).
- **8.6 Dashboard layout prefs** — Settings → "Dashboard sections": hide
  Recent activity, breakdowns, bill calendar, what-if, or debt panels;
  stored in the client-writable `profiles.dashboard_prefs`.
- **7.4 Demo mode** — Settings → "Sample data": loads six months of
  deterministic fake data (seeded by user id — reproducible) under a
  `demo-` prefixed, `status='disconnected'` item that every sync path
  ignores; refused while a real bank is connected; one-click clear
  (cascade delete). Pure generator in `lib/demo-data.ts` (tested).
- **Web push** — `push_subscriptions` table, `/api/push/subscribe`,
  service-worker `push`/`notificationclick` handlers appended to the
  existing sw.js (its no-authenticated-HTML caching rules untouched), an
  enable/disable card on `/notifications`, and every `createNotification`
  now mirrors to push (fire-and-forget; a no-op without VAPID keys; dead
  subscriptions self-prune).
- **/wrapped in the sidebar** — "Year in Money" nav item.
- **Bug fixed en route:** the session-3 liabilities sync matched Plaid's
  `account_id` against our UUID primary key instead of
  `plaid_account_id` — APRs would never have updated.
- **Code-quality guardrails respected:** the dashboard page's ≤240-line
  orchestrator test forced proper extraction (`ScopeChips`,
  `lib/recent-transactions.ts`) instead of inline growth.

### Deferred summary (honest list)

After session 4, the only remaining items are ones requiring **your**
action or credentials: running the authenticated E2E suite in CI (add
`E2E_EMAIL`/`E2E_PASSWORD` repo secrets), enabling the Plaid Liabilities
product + `PLAID_LIABILITIES_ENABLED=1`, and generating VAPID keys for web
push. One scoped code follow-up remains by design: shared *household* rows
are read-only for members everywhere (no member ever writes to a partner's
data) — a deliberate boundary, not a gap.
