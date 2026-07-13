# FundFlow QA Runbook

This runbook covers roadmap items that require live credentials, browser state,
or screenshots. Keep it current when flows change.

## Plaid Sandbox Browser E2E

Prerequisites:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`
- Plaid Sandbox client id and secret
- Local app running with `npm run dev`

Happy path:

1. Sign up with a fresh test email.
2. Complete MFA setup if enabled for the account.
3. Connect a bank through Plaid Sandbox with `user_good` and `pass_good`.
4. Run initial sync from the dashboard action bar.
5. Refresh twice and confirm transaction counts do not duplicate.
6. Open `/transactions`, filter by account and month, and confirm rows remain stable.
7. Export CSV, JSON, and PDF.
8. Confirm CSV and JSON include only privacy-safe export fields.
9. Disconnect the bank from Settings.
10. Delete the account from Settings.

Evidence to capture:

- Browser screenshots for connect, synced dashboard, export result, disconnect,
  and delete account confirmation.
- Sync job ids from the admin Observability page.
- Any Plaid Link error code if the flow fails.

## Mobile QA Matrix

Pages:

- `/dashboard`
- `/transactions`
- `/settings`
- `/goals`
- `/review`
- `/login`
- `/signup`

Widths:

- 375 px
- 430 px
- 768 px
- Desktop width

Checks:

- No horizontal page scroll.
- Topbar email, theme toggle, and page title do not overlap.
- Card carousel and month chips scroll horizontally only within their own row.
- Forms have usable 44 px touch targets where practical.
- Charts remain visible in light and dark mode.
- Long merchant names and categories wrap inside their parent.

## Browser Smoke Suite

Run after major UI work:

1. Load `/login`, `/signup`, and `/dashboard`.
2. Toggle light and dark mode from the topbar.
3. Navigate through dashboard tabs.
4. Visit `/transactions` and change filters.
5. Visit `/settings#budgets`, add and remove a budget.
6. Visit `/goals`, create, edit, contribute to, and delete a goal.
7. Visit `/review?month=YYYY-MM` for the active month.
8. Visit `/admin` with a non-admin account and confirm access is denied.
9. Visit `/admin` with an admin account and confirm operational data is redacted.

## Weekly email visual QA

Prerequisites:

- Apply `20260713051741_weekly_insights_notifications.sql`.
- Configure SMTP credentials or use the local Ethereal fallback.
- Keep the test user's timezone at `America/Los_Angeles` for the baseline run.

Email checks:

1. Render the deterministic fixture with `npx vitest run scripts/render-weekly-report-fixture.test.ts`.
2. Open `/tmp/fundflow-weekly-email.html` at 600 px and 360 px widths.
3. Confirm there is no horizontal scrolling and all currency values remain readable.
4. Confirm category, bank, and credit card bars render in email-safe table markup.
5. Confirm long merchant names wrap or truncate without covering amounts.
6. Confirm zero-data states remain useful and the dashboard link targets `/dashboard`.
7. Confirm merchant content is escaped and no account masks, balances, account numbers, raw transaction ids, Plaid tokens, or secrets appear.
8. Confirm the email recipient is the Supabase Auth signup email.

PDF checks:

1. Render every page of `/tmp/fundflow-weekly-report.pdf` to PNG.
2. Inspect every page for clipping, overlap, poor contrast, broken page transitions, footer placement, and page numbering.
3. Confirm the attachment name contains the previous Monday and Sunday dates.
4. Extract PDF text and repeat the sensitive-data search from the email checks.

Delivery checks:

1. Invoke the weekly route at Monday 8:00 AM in the selected timezone.
2. Repeat the same invocation and confirm the duplicate cron call records zero new sends.
3. Disable weekly email and confirm no delivery row is claimed for that user.
4. Disable the daily digest, generate optional and broken-bank alerts, and confirm only the mandatory broken-bank email is sent.
5. Force one SMTP failure and confirm other due users still receive their reports.

## Dependency And Security Maintenance

Monthly:

- Review Dependabot PRs.
- Run `npm audit`.
- Check whether the PostCSS advisory pinned through Next.js has an upstream fix.
- Rotate any secret key that was copied into chat, logs, or screenshots.
- Run Supabase security and performance advisors when the project is linked.

Release gate:

- `npm test`
- `npm run lint`
- `npm run build`
- `git diff --check`
- Confirm migrations are applied before browser-testing roadmap tables.
- Confirm the hourly weekly scheduler is provided by Vercel Pro or another trusted scheduler.
