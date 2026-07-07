# FundFlow Feature Todos

This is the current product roadmap for FundFlow after the dashboard UI overhaul,
hardening work, Plaid production readiness, exports, reporting, and the first
goals slice. Older completed or deferred notes live in `docs/TODO.md`.

## Product Direction

FundFlow is strongest as a private personal finance cockpit:

- Pull real account data through Plaid.
- Keep raw financial data private by default.
- Turn transactions into planning decisions.
- Make recurring bills, goals, budgets, and cash flow visible at a glance.
- Keep the app simple enough for 1-2 real users to trust every day.

## P0: Finish And Stabilize Current Work

### 1. Goals Production Pass

The `goals` table, `/goals` page, dashboard summary, and manual contribution UI
exist. Turn this into a complete daily-use feature.

Implementation notes:

- [x] Confirm `0004_goals.sql` is applied to the live Supabase project.
- [x] Add integration tests for goal RLS isolation and owner-only CRUD.
- [x] Add grants if the Supabase Data API requires explicit `authenticated` access.
- Add edit support for name, target amount, target date, and saved amount.
- Add optimistic UI error recovery for add, update, delete, and contribute.
- Add empty, loading, success, and completion states.
- Add dashboard goal insights: next target date, amount remaining, monthly pace.

Verification:

- `npm test`
- `npm run lint`
- `npm run build`
- Manual smoke: create goal, contribute, edit, delete, refresh page, verify RLS.

### 2. Real Plaid Browser E2E

The handoff still calls out the full browser run as blocked on Plaid Sandbox keys.
This should be closed before real-bank production use.

Implementation notes:

- Add Plaid Sandbox keys to local env.
- Run the full happy path: signup, MFA optional, connect bank, sync, refresh,
  export CSV, export PDF, disconnect bank, delete account.
- Capture any UI friction from the new shell and dashboard.
- Convert the highest-value smoke into a documented checklist or automated test.

Verification:

- Plaid Sandbox connect succeeds with `user_good` and `pass_good`.
- Refresh twice does not duplicate transactions.
- Exports contain only the privacy-safe fields promised in README.

### 3. Mobile QA Pass

The app is responsive, but it needs a deliberate mobile pass.

Implementation notes:

- Audit `/dashboard`, `/transactions`, `/settings`, `/goals`, `/login`, and
  `/signup` at 375px, 430px, 768px, and desktop widths.
- Tighten topbar overflow, card carousels, filters, forms, and charts.
- Ensure touch targets are at least 44px where practical.
- Verify light and dark themes.

Verification:

- Screenshots for key pages at mobile and desktop sizes.
- No clipped text, overlapping controls, horizontal page scroll, or inaccessible
  form controls.

## P1: Planning And Insight Features

### 4. Budget Envelopes

Budgets exist in settings, but the dashboard can become more useful if budgets
behave like envelopes.

Implementation notes:

- Show remaining amount per category for the current month.
- Add projected month-end spend based on current pace.
- Flag categories that are likely to exceed budget.
- Add budget history: last month, current month, average over 3 months.
- Consider optional rollover for underspent categories.

Data model:

- Reuse existing budget storage if present.
- If needed, add budget period rows for monthly snapshots.

Tests:

- Unit tests for pacing math.
- Integration tests for owner-scoped budget reads and writes.

### 5. Cash Flow Forecast

Help answer: "Will my checking account be okay before the next payday?"

Implementation notes:

- Use recent income cadence, recurring bills, and current cash accounts.
- Forecast 7, 14, and 30 day cash balance.
- Show upcoming low-balance risk.
- Add assumptions in plain language so the user trusts the forecast.

Data needs:

- Cash account balances.
- Recurring transactions.
- Expected income cadence.
- Optional manual recurring entries for items Plaid does not detect.

Tests:

- Forecast math for weekly, biweekly, monthly, and irregular income.
- Edge cases for missing balance or missing recurring data.

### 6. Recurring Bills Calendar

Recurring streams are already fetched. Surface them as a calendar and action list.

Implementation notes:

- Show upcoming subscriptions, bills, and income.
- Group by due week.
- Add status: expected, paid, late, unusual amount.
- Link each recurring item to matching transactions.
- Add "review this subscription" prompts for price increases or unused services.

UI:

- Add a dashboard card.
- Add a full recurring page later if the card becomes dense.

### 7. Merchant Cleanup And Rules

Make transaction data feel human instead of raw bank text.

Implementation notes:

- Add merchant aliases: "SQ *COFFEE BAR" becomes "Coffee Bar".
- Add category override rules by merchant, account, or keyword.
- Apply rules to future transactions after sync.
- Provide a preview before bulk applying to history.

Data model:

- `merchant_rules`: user_id, match_type, pattern, display_name, category,
  enabled, created_at, updated_at.

Tests:

- Rule matching order.
- Preview does not mutate data.
- Bulk apply is idempotent.

### 8. Smart Spending Anomalies

Highlight transactions or categories that look different from normal behavior.

Implementation notes:

- Detect unusually large transactions.
- Detect category spikes compared to the prior 3 month average.
- Detect duplicate-looking charges.
- Keep explanations deterministic and non-alarmist.

Privacy:

- Do this locally in server code with no LLM required.

Tests:

- Deterministic anomaly scoring.
- No alert for small normal variance.

## P2: Account And Reporting Features

### 9. Net Worth Snapshot

Give users one top-level view of assets and liabilities.

Implementation notes:

- Use Plaid balances for linked accounts.
- Add manual accounts for assets Plaid does not support.
- Add manual liabilities for debts that are not linked.
- Track net worth over time with monthly snapshots.

Data model:

- `manual_accounts`: name, type, balance, include_in_net_worth.
- `net_worth_snapshots`: user_id, snapshot_month, assets, liabilities.

### 10. Monthly Review

Create a guided review that turns dashboard data into a monthly habit.

Implementation notes:

- Month summary: income, spending, savings, top categories, biggest changes.
- Budget review: over, under, changed categories.
- Goals review: contributions, pace, completion.
- Export to PDF using the existing report path.

UI:

- Add `/review?month=YYYY-MM`.
- Link from dashboard month chips.

### 11. Notification Center

Centralize important app events.

Implementation notes:

- Broken bank needs reconnect.
- Sync failed.
- Goal completed.
- Budget exceeded.
- Large transaction detected.
- Weekly report skipped because SMTP is not configured.

Data model:

- `notifications`: user_id, type, severity, title, body, read_at, created_at.

### 12. Email Alerts

The weekly PDF report exists. Add targeted alerts.

Implementation notes:

- Opt-in toggles for each alert type.
- Alert types: broken bank, budget exceeded, goal reached, large transaction,
  forecasted low cash.
- Reuse safe logging and SMTP environment checks.

Tests:

- Opt-out is respected.
- Missing SMTP vars skip sending safely.
- Emails never include tokens or sensitive raw payloads.

## P3: Optional AI And Advanced Workflows

### 13. Privacy-Safe AI Insights

The README intentionally keeps AI out of the default flow. If added, make it
opt-in and based on the existing privacy-safe export contract.

Implementation notes:

- Add a user setting: AI insights enabled.
- Reuse CSV or JSON export fields only.
- Send no account numbers, Plaid IDs, tokens, raw bank payloads, or user secrets.
- Add provider-neutral adapter so the app is not locked to one model vendor.
- Store generated summaries, not prompts with sensitive raw data.

First insight types:

- "What changed this month?"
- "Where can I save $100?"
- "Which subscriptions should I review?"
- "Am I on pace for my goals?"

### 14. Import Review Queue

CSV import exists. Add a review queue for ambiguous rows before writing them.

Implementation notes:

- Preview parsed rows.
- Let user map columns if auto-detection is wrong.
- Flag suspicious dates, duplicate-looking rows, and unknown accounts.
- Commit only approved rows.

Tests:

- Parser handles common bank CSV formats.
- Re-import remains idempotent.

### 15. Shared Household Mode

FundFlow is built for 1-2 users. Formalize that with household support.

Implementation notes:

- Add household membership.
- Let two users share accounts, goals, budgets, and reports.
- Keep personal auth and audit logs separate.
- Add role options: owner, member, read-only.

Security notes:

- This is a major RLS change. Design and test before implementation.
- Avoid using user-editable metadata for authorization.

## Technical Debt And Hardening

### 16. Supabase Schema Verification

Implementation notes:

- Confirm all migrations are applied in order.
- Confirm grants for browser-written tables.
- Run security and performance advisors when MCP or CLI is available.
- Add tests for every browser-written table with RLS.

### 17. Observability Dashboard

Implementation notes:

- Admin-only page for sync jobs, weekly report attempts, audit events, and bank
  health.
- Filter by user and date.
- Redact sensitive data.

### 18. Dependency And Security Maintenance

Implementation notes:

- Keep Dependabot enabled.
- Keep `npm audit` in CI.
- Track the moderate PostCSS advisory pinned through Next.js and resolve when
  Next bumps its internal dependency.
- Rotate any previously shared Supabase secret keys.

### 19. Browser Smoke Test Suite

Implementation notes:

- Add a minimal smoke suite for auth pages, shell navigation, theme toggle,
  transactions filters, settings forms, and goals.
- Keep Plaid full-link testing as a documented manual flow unless stable sandbox
  automation is available.

## Suggested Build Order

1. Goals production pass.
2. Browser E2E with Plaid Sandbox.
3. Mobile QA pass.
4. Budget envelopes.
5. Cash flow forecast.
6. Recurring bills calendar.
7. Merchant cleanup and rules.
8. Monthly review.
9. Notification center and email alerts.
10. Optional AI insights.

## Definition Of Done For New Features

- Data model has owner-scoped RLS where user data is involved.
- Server code never exposes Plaid tokens, Supabase secret keys, or raw sensitive
  payloads to the browser.
- UI has empty, loading, error, and success states.
- Light and dark themes are checked.
- Mobile layout is checked.
- Tests cover core calculations and permissions.
- `npm run lint`, `npm test`, and `npm run build` pass.
