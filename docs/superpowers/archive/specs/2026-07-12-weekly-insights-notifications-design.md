# Weekly Insights Email And Notifications Design

**Date:** 2026-07-12
**Status:** Approved design, pending written-spec review

## Objective

Upgrade FundFlow's existing weekly PDF email into a reliable weekly insights
experience with useful visualizations in the email body, a polished PDF
attachment, accurate categorized spending, bank and credit-card breakdowns,
and a first-class Notifications page for delivery preferences and in-app alerts.

The report is sent to the email address on the user's Supabase Auth account. It
does not collect or store a second delivery address.

## Product Decisions

- Reporting period: the previous Monday through Sunday.
- Delivery target: Monday at approximately 8:00 AM in the user's timezone.
- Default timezone: `America/Los_Angeles`.
- Weekly report and daily financial digest emails are optional.
- Bank connection and sync-failure alerts are always enabled.
- Authentication, password, and MFA messages remain mandatory and continue to
  be managed by Supabase Auth.
- Reports include bank and credit-card spending breakdowns.
- Reports exclude individual account balances, full account numbers, raw Plaid
  data, access tokens, and transaction-level details.
- The PDF is attached automatically to each weekly email.
- Existing SMTP delivery through Nodemailer remains in place.

## Existing System

FundFlow already has:

- A cron-protected `/api/cron/weekly-report` route.
- Weekly aggregation in `lib/reporting.ts`.
- Nodemailer SMTP delivery with a production safety guard.
- A PDFKit report attachment.
- A weekly-report opt-out stored on `profiles.weekly_report_enabled`.
- In-app notifications and per-alert preferences.
- A Settings notification feed and planning preferences panel.

The current weekly report needs four targeted corrections:

1. The email body is mostly prose and contains no useful visualization.
2. Weekly totals do not apply merchant rules, category splits, or linked-refund
   decisions, so they can disagree with the dashboard.
3. The rolling date window is not a precise calendar week in the user's
   timezone.
4. There is no delivery record or unique period key to prevent duplicate sends
   when a scheduler retries.

## Architecture

### Report Domain Model

Create one presentation-neutral weekly report model used by both HTML email and
PDF rendering. It contains:

- Period start and end dates.
- Total categorized spend and previous-week comparison.
- Week-over-week amount and percentage change.
- Category totals and percentage shares.
- Top merchants.
- Spending grouped by bank institution.
- Spending grouped by credit card.
- Budget pacing for categories that have budgets.
- Depository inflows, outflows, and net cash flow.

The model does not include individual account balances or raw transactions.
Rendering functions receive the completed model and do not query the database.
Budget pacing converts each monthly category limit to a weekly allowance using
`monthly_limit * 12 / 52`, then compares the report week's categorized spend
with that allowance. This keeps the comparison aligned to the weekly period,
including weeks that cross a month boundary.

### Aggregation Accuracy

The weekly query remains explicitly scoped by `user_id` because the report cron
uses the RLS-bypassing service client. The aggregation must use the same rules
as dashboard spending:

- Exclude transfer and loan-payment categories from spend.
- Apply enabled merchant rules in first-match order.
- Use category splits when present and avoid counting the parent twice.
- Exclude linked charge/refund pairs from spending totals.
- Exclude transactions confirmed as duplicates.
- Preserve literal depository cash movement for cash-flow totals.

The report receives an explicit timezone and reference time. Pure date-window
helpers calculate the completed Monday-to-Sunday period and previous comparison
period. Tests use fixed times and cover daylight-saving transitions.

### Email Rendering

Keep Nodemailer and generate standards-oriented HTML with inline styles and
table layouts. No JavaScript, external CSS, remote tracking pixels, or chart
library is used.

The email includes:

1. Header with date range and short summary.
2. KPI row for total spend, previous week, and change.
3. Category distribution rendered as accessible horizontal bars with text and
   numeric values.
4. Bank and credit-card breakdown tables with proportional bars.
5. Budget pacing rows with spent amount, limit, and status.
6. Top merchants.
7. Cash-flow summary.
8. Link to the FundFlow dashboard and a note that the PDF is attached.

All user-influenced strings are HTML-escaped. The plain-text alternative
contains the same key values without visual decoration.

### PDF Rendering

Refactor the existing PDFKit renderer to consume the shared report model. The
PDF uses the same information hierarchy as the email with additional space for
labels and charts. It contains:

- Branded header and reporting period.
- Summary cards.
- Category distribution bars.
- Bank and credit-card breakdowns.
- Budget pacing.
- Top merchants and cash flow.
- Confidentiality footer and page numbering.

PDF rendering remains server-only and returns a Buffer for both email attachment
and on-demand export.

### Notifications Page

Add `/notifications` as a first-class authenticated page and add a Notifications
entry to the desktop and mobile primary navigation. The page contains:

- Email preferences:
  - Weekly spending report, optional.
  - Daily financial digest, optional.
  - Bank connection and sync failures, always enabled with explanatory copy.
  - Security and account messages, always enabled with explanatory copy.
- In-app alert preferences:
  - Budget exceeded.
  - Goal reached.
  - Large transaction.
  - Low cash forecast.
- Timezone selector with `America/Los_Angeles` as the default.
- Recent in-app notification feed with unread state and mark-read action.
- Most recent weekly delivery status when available.

The existing Settings notification feed and alert controls move to this page.
Settings retains a short link to Notifications so existing navigation anchors
do not become dead ends.

### Data Model

Add profile preferences:

- `timezone text not null default 'America/Los_Angeles'`
- `daily_digest_email_enabled boolean not null default true`

Keep the existing `weekly_report_enabled` field for compatibility.

Add `weekly_report_deliveries`:

- `id uuid primary key`
- `user_id uuid not null references auth.users on delete cascade`
- `period_start date not null`
- `period_end date not null`
- `status text` constrained to `processing`, `sent`, `failed`, or `skipped`
- `provider_message_id text null`
- `error_code text null` containing only a safe stable code
- `attempted_at timestamptz not null`
- `sent_at timestamptz null`
- Unique constraint on `(user_id, period_start)`

Enable RLS. Authenticated users receive SELECT-only access to their own delivery
rows. Trusted server code performs inserts and updates with explicit `user_id`
filters. No email content or financial totals are stored in delivery records.

### Scheduling And Idempotency

The route becomes scheduler-independent. On each invocation it:

1. Verifies `CRON_SECRET`.
2. Finds opted-in users.
3. Uses each user's timezone to determine whether it is Monday at the target
   delivery hour and identifies the completed report period.
4. Atomically claims the `(user_id, period_start)` delivery record.
5. Builds the model, renders HTML and PDF, and sends the message.
6. Marks the delivery sent or failed.
7. Continues processing other users if one user fails.

The unique period key prevents retries and overlapping invocations from sending
the same report twice. A stale `processing` record can be retried after a fixed
timeout; a `sent` record cannot.

Exact per-user 8:00 AM delivery requires an hourly scheduler. Vercel Pro supports
this cadence. Vercel Hobby permits only daily cron execution and cannot provide
exact local-time delivery for arbitrary timezones. The route remains callable by
any trusted hourly scheduler, and the deployment documentation must state this
constraint. The repository schedule targets hourly invocation for the approved
behavior.

### Email Delivery

Keep the existing SMTP environment contract:

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`

The transporter is created through one shared helper used by weekly reports and
daily digests. Production never falls back to a public test inbox. Development
may continue using Ethereal. Provider message IDs may be stored in the delivery
record, but SMTP credentials and recipient addresses are never logged.

### Error Handling

- Missing SMTP configuration in production marks the report failed with a safe
  code and creates an in-app operational notification.
- A user with no reportable activity receives a zero-activity report rather
  than being silently skipped, provided the account is opted in.
- Invalid stored timezone values fall back to `America/Los_Angeles` and emit a
  redacted warning.
- PDF rendering failure prevents email delivery so the promised attachment is
  never missing.
- Email send failure records a safe error code and leaves the period eligible
  for a controlled retry.
- Database errors return a generic production response and use existing redacted
  logging.

## Testing Strategy

Implementation follows test-first slices.

### Unit Tests

- Monday-to-Sunday windows in multiple timezones.
- Daylight-saving boundary behavior.
- Scheduler due and not-due decisions.
- Merchant rules, splits, linked refunds, and duplicate exclusions.
- Category, bank, card, budget, merchant, and cash-flow aggregation.
- HTML escaping and absence of sensitive fields.
- Email visual sections and plain-text parity.
- PDF output signature and key section labels.
- Delivery-state transition and duplicate-claim behavior.
- Navigation and Notifications page preference controls.

### Integration Tests

- Owner-scoped RLS for delivery records.
- Cron authorization.
- Opted-out users are not sent weekly or daily email.
- Mandatory bank and sync alerts cannot be disabled.
- Auth email is used as the report recipient.
- One send per user and report period across retries.
- One user's failure does not prevent another user's delivery.

### Verification Gate

- `npm run lint`
- `npm test`
- `npm run build`
- `git diff --check`
- Render a fixture PDF and inspect every page as an image.
- Preview the fixture HTML at desktop and narrow email widths.
- Confirm no secrets or raw transaction data appear in generated artifacts.

## Repository Review: Must-Have Priorities

The repository already covers most core personal-finance functionality. The
remaining must-have work is concentrated in reliability and production proof,
not a broad new feature slate.

### P0: Required Before Real-Bank Reliance

1. Complete the Plaid Sandbox browser run in `docs/QA.md`, including repeat sync,
   exports, reconnect, disconnect, and deletion evidence.
2. Complete mobile visual QA at the documented breakpoints and both themes.
3. Ensure revoked sessions are rejected consistently on server-rendered page
   access, not only API requests.
4. Run Supabase security and performance advisors against the linked production
   project and resolve actionable findings.
5. Rotate any secret previously exposed in chat, logs, or screenshots.

### P1: Required For Trustworthy Ongoing Use

1. Deliver this reconciled, idempotent weekly insights system.
2. Add whole-cron failure monitoring so a scheduler or provider outage is
   visible even when no per-user notification can be written.
3. Add automated browser smoke coverage for authentication, dashboard,
   transactions, reports, and settings flows.
4. Establish migration verification as a release gate so deployed code cannot
   reference unapplied tables.

### P2: Valuable After Production Readiness

1. Finish household collaboration beyond schema and creation scaffolding.
2. Add passkey enrollment when Supabase support and the chosen deployment path
   are verified end to end.
3. Add a user-facing report history view only if delivery history proves useful;
   do not store report contents by default.

## Out Of Scope

- Changing email providers.
- Marketing email campaigns or mailing lists.
- User-entered alternate delivery addresses.
- Transaction-level details in email or PDF.
- Individual account balances in email or PDF.
- Remote chart images, tracking pixels, or open tracking.
- Refactoring unrelated dashboard, Plaid, or authentication code.

## Success Criteria

- An opted-in user receives one report for the previous Monday through Sunday.
- The report is sent to the Supabase Auth email.
- Email totals match dashboard rules for categorization, splits, and refunds.
- The email contains readable visual breakdowns in common clients without
  scripts or remote images.
- The attached PDF is polished, complete, and visually verified.
- Bank and credit-card spend are clearly separated without exposing account
  numbers or balances.
- Optional email channels can be changed from `/notifications`.
- Critical bank, sync, and security messages remain enabled.
- Cron retries cannot produce duplicate weekly reports.
- Existing lint, test, build, security, and RLS gates remain green.
