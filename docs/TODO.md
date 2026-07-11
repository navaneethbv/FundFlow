# FundFlow — Future Todos

Nice-to-have features and enhancements, deferred out of the initial build.

## Must-have before real-bank production use

Gaps found in the 2026-07-05 review, ranked. These are not polish — each one
is a hole a real deployment would fall into.

1. ~~**Server-side MFA (AAL2) enforcement.**~~ **Done (2026-07-05):**
   `lib/mfa.ts` (`needsMfaStepUp`) is checked in `proxy.ts` (aal1-pending
   users are redirected to `/login`, which resumes at the TOTP prompt) and in
   `requireUser()` (401 `MFA verification required` from every API).
2. ~~**Bank reconnection (Plaid Link update mode).**~~ **Done (2026-07-05):**
   the webhook handles `ITEM` codes (`ERROR`, `PENDING_EXPIRATION`,
   `LOGIN_REPAIRED`, `USER_PERMISSION_REVOKED`); sync failures store the real
   Plaid error code; `/api/plaid/link-token` accepts `item_id` for update
   mode; `ReconnectBankButton` in Settings + `/api/plaid/reconnect` finalize.
3. ~~**Weekly-report email opt-out.**~~ **Done (2026-07-05):**
   `profiles.weekly_report_enabled` (migration `0003_hardening.sql`), toggle
   in Settings (`ReportsSection`), checked by the weekly cron.
4. ~~**Cron/sync failure observability.**~~ **Done (2026-07-05):** every item
   sync writes a `sync_jobs` row (running → done/failed with the Plaid error
   code); the dashboard shows a stale-data banner when a bank is broken or no
   sync succeeded in 48h; the daily cron prunes jobs older than 30 days.
   *Still optional:* an alert email when a whole cron run fails.
5. ~~**Origin check on mutating API routes.**~~ **Done (2026-07-05):**
   `lib/origin.ts` + `proxy.ts` reject cross-origin mutating `/api` requests
   (403); requests without an Origin header (webhooks, cron, curl) pass.
6. ~~**Encryption-key rotation support.**~~ **Done (2026-07-05):**
   `PLAID_TOKEN_ENC_KEY_PREVIOUS` gives a two-key decrypt window
   (`decryptSecretDetailed`), and the daily sync re-encrypts fallback-decrypted
   tokens with the current key (`decryptItemTokenAndUpgrade`).
7. ~~**Server-side MFA audit verification**~~ **Done (PR #11,
   `hardening/mfa-server-finalization`):** `/api/settings/mfa` now verifies
   the factor via `listFactors()` on enroll, performs unenroll server-side,
   and owns the `mfa_enrolled` profile flag.

Minor (same bucket): ~~prune `rate_limit_counters` periodically~~ (done — the
daily cron deletes windows older than a day), and finish the browser E2E run
from `docs/HANDOFF.md` (still pending Plaid Sandbox keys). **Remember to apply
`0003_hardening.sql` to the live Supabase project** — the weekly-report cron
and Settings read `profiles.weekly_report_enabled`.

## Requested enhancements

- ~~**Card designs by network/product**~~ Done — card-deck carousel
  (`lib/card-design.ts`), card selection filters the dashboard.
- **Mobile support** — polish responsive layouts for phones (the UI is Tailwind
  responsive today; needs dedicated mobile passes and touch-friendly controls).
- ~~**Monthly history views**~~ Done — month browser on the dashboard plus the
  `/transactions` ledger with month/account/search filters.
- ~~**Current spend indicator**~~ Done — pacing widget (vs budget and vs
  pro-rated last month) + stat tiles with deltas and sparklines.
- ~~**Spend per card / per bank**~~ Done — Cards & Banks tab.
- ~~**Checking-account cash-flow insights**~~ Done — Cash Flow tab with a
  6-month diverging deposits/withdrawals chart.

## Added 2026-07-11 (drill-down & ledger filters)

- **Category & Merchant drilldown:** Interactive SVG category donut and merchant lists drill down in-place into subcategories, top merchants, and 6-month trends.
- **Interactive month/column links:** Charts preserve drill down states when pivoting months.
- **Exact ledger filters:** Ledger page supports filtering by `category`, `sub`, `merchant`, `flow`, and `accountType` with tag badges to clear filters.

## Added 2026-07-05 (charts / ledger / exports session)

- Server-rendered SVG chart kit (`components/charts/`): trend lines, category
  donut, diverging columns, sparklines, stat tiles — palette validated for
  CVD + contrast in light and dark (see `app/globals.css` viz tokens).
- `/transactions` ledger: search, month, account filters, pagination.
- In-app exports: CSV + JSON (privacy-safe contract in `lib/export.ts`) and
  the weekly PDF on demand (`/api/export/report`).

## Previously planned (from the build spec)

- ~~**Email the CSV/report** on a schedule so reports arrive in inbox.~~ Done:
  weekly PDF report cron (`/api/cron/weekly-report` + `lib/reporting.ts`).
- ~~**Plaid webhooks** with signature verification for real-time sync.~~ Done:
  `/api/plaid/webhook` verifies ES256 signatures outside sandbox.
- **Optional in-app AI insights** endpoint (provider-agnostic) reusing the export
  data contract, gated by the per-user AI setting.
- ~~**CSV import for pre-Plaid history**~~ Done (2026-07-05):
  `lib/import.ts` + `/api/import/csv` + Settings Import section. Dedupe: rows
  on/after the account's earliest Plaid-synced date are skipped; deterministic
  `import-<hash>` ids make re-imports idempotent.
- **Self-hosted docker-compose** if moving off managed Supabase.
- **Audit MFA enrollment** server-side — promoted to the must-have list above
  (item 7).
