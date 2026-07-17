# Remaining Must-Haves: Revocation Enforcement, Cron Alerts, Mobile Polish

Date: 2026-07-16. Status: approved in conversation, pending spec review.

Three independent gaps, each previously deferred, closed in one branch as three
separate work items. No new external services; no new Plaid calls; one new
mail template; no schema migration.

## 1. Session revocation enforcement on pages

### Problem

Revoking a device in Settings sets `user_session_records.revoked_at`. The
revoked device then gets 401 from every API (`requireUser` in `lib/http.ts`),
but page renders are not gated: the device can still open `/dashboard`,
`/transactions`, etc., and its Supabase access/refresh tokens remain valid.

### Design

Enforce in `proxy.ts`, the same chokepoint that gates MFA step-up:

- After `getUser()` succeeds, for protected **page** requests only (not `/api`,
  not public pages), decode the `session_id` claim from the access token. Reuse
  the decode logic from `currentSessionId` (`lib/http.ts`) by extracting it
  into a small pure helper both call sites share. The decode is
  format-agnostic base64url JSON; `getUser()` already validated the session.
- Look up `revoked_at` with the request's cookie-bound client:
  `select revoked_at from user_session_records where user_id = ? and
  session_id = ?` (RLS-scoped, hits the unique `(user_id, session_id)` index).
  No row means an unrecorded session: allow (the record is created on the
  first API call; treating absence as revoked would lock out fresh logins).
- If `revoked_at` is set: `await supabase.auth.signOut({ scope: "local" })`
  (this request comes from the revoked session itself, so local sign-out
  invalidates its refresh token and clears its cookies via the response
  cookie plumbing already in `proxy.ts`), then redirect to `/login` with
  security headers applied, same as the MFA redirect.
- Fail open on lookup errors, mirroring `requireUser`'s best-effort stance: a
  transient DB error must not lock the user out of the app.

Cost: one indexed select per protected page navigation. Acceptable for a
1-2 user deployment; `/api` requests are unaffected (they already check).

### Testing

- Unit-test the extracted session-id decode helper (valid JWT payload, no
  claim, malformed payload).
- Unit-test the proxy decision logic against a mocked Supabase client:
  revoked row → redirect + signOut called; null row → pass; lookup error →
  pass; API paths and public pages skipped.

## 2. Cron-failure alert email to the admin

### Problem

Per-user sync failures and whole-run cron failures land only in `logError`
and `sync_jobs`; the dashboard stale-data banner is the sole surfacing. If a
cron run breaks entirely, nobody is told.

### Design

- New `sendCronAlertEmail(to, cronName, summary)` in `lib/reporting.ts`,
  reusing `createMailTransport` (production requires real `SMTP_*` exactly as
  today; dev uses Ethereal + preview URL).
- Recipient: the admin profile's auth email. Query
  `profiles.role = 'admin'` with the service client, take the first row,
  resolve the email via `service.auth.admin.getUserById`. If no admin profile
  or no email, `logError` and skip: alerting is best-effort and must never
  fail the cron run itself.
- Trigger points:
  - `/api/cron/sync`: after the user loop, if any user's sync threw (count
    collected in the existing `catch`), and in the whole-run `catch`.
  - `/api/cron/weekly-report`: when a run reports `reports_failed > 0`, and
    in the whole-run `catch`.
- Dedupe: the weekly trigger fires hourly via GitHub Actions, so alerts are
  limited to one per cron name per 24h using the existing Postgres
  fixed-window limiter (`rate_limit_hit` RPC, key `cron-alert:<cron-name>`,
  window 24h, limit 1). The limiter fails open, which here means an extra
  email, never a missed cron run.
- Body: cron name, run timestamp, failed/total counts, and the first error
  code or message line, passed through `redact()`. No PII, no balances, no
  transaction detail, consistent with the existing email contract.
- Known limitation, accepted: if SMTP itself is down, the alert cannot send;
  the existing in-app notification fallback (`Daily digest email skipped`)
  remains the backstop.

### Testing

- Unit-test the alert decision + dedupe wiring with mocked transport and
  RPC (alert sent on failures, skipped when the window is consumed, skipped
  with a log when no admin exists, never throws into the cron handler).

## 3. Mobile responsive polish (scroll-strip nav retained)

### Problem

The UI is Tailwind-responsive but has never had a dedicated phone pass. The
open TODO item asks for polished layouts and touch-friendly controls.

### Design

Bounded pass, no new navigation paradigm (the horizontal scroll-strip mobile
nav in `AppSidebar` stays and gets polished):

- **Transactions ledger**: below `sm`, the table renders as stacked card
  rows (date + merchant on one line, amount right-aligned, category/account
  as muted second line). The table twin remains for `sm` and up. Same data,
  same pagination, no query changes.
- **Touch targets**: interactive chips (month pills, filter badges, drill
  links, icon buttons) get a minimum 44px hit area via padding or
  `min-h`/`min-w`, without changing visual size where a larger transparent
  hit area suffices.
- **Overflow discipline**: every wide element (charts, tables, the dashboard
  toolbar, card carousel) scrolls inside its own `overflow-x-auto` container;
  the page body never scrolls horizontally at 375px.
- **Shell**: scroll strip gets edge-fade affordance and momentum scrolling;
  top bar actions collapse sensibly at narrow widths.
- **Verification**: screenshot-driven QA at 375px and 414px against
  `npm run dev` using the browser tooling, covering dashboard (Monitor, Plan,
  Wealth), transactions (with filters), goals, notifications, settings, and
  login. Fix what the screenshots show; re-shoot until clean.

Out of scope: bottom tab bar, gesture interactions, PWA/manifest changes,
new components beyond the ledger card row.

### Testing

- Unit tests where logic is extracted (e.g. any ledger row formatting
  helper); the primary gate is the screenshot QA pass plus
  `npm run build` / `lint` / `test:unit` staying green.

## Sequencing

1. Session revocation enforcement (smallest, security-relevant).
2. Cron alert email.
3. Mobile polish (largest, isolated from the other two).

Each lands as its own commit(s); `docs/TODO.md` and `docs/HANDOFF.md` are
updated at the end.
