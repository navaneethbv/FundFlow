# FundFlow QA Runbook

This runbook covers roadmap items that require live credentials, browser state,
or screenshots. Keep it current when flows change.

The dated PR completion sections below are historical evidence.
For current release status and deployment caveats, use `docs/TODO.md` and
`docs/HANDOFF.md` first.

## Diagnosing "the app looks broken" reports

Added 2026-08-10, after a report of broken web login that was an ad blocker.

An app rendering as unstyled HTML (serif text, native buttons, an oversized logo) is a blocked stylesheet, not an auth or deployment failure.
Sign-in keeps working underneath the missing styles, so confirm what is actually broken before debugging the server.

Order of checks:

1. Ask for the reporter's Network tab. A blocked request reads as blocked, not as a 404, and an extension's request log names the filter rule that matched.
2. Check whether an ad blocker, content blocker, or filtering VPN is active. These affect every browser on the machine, including private windows, while leaving mobile unaffected, which makes a client-side block look like a server-side outage.
3. Only then check the deployment.

`curl` and Playwright load no browser extensions.
A passing reproduction in either one rules out the server and proves nothing about the reporter's browser.
Treating a green Playwright run as "production is healthy, so it must be their cache" is what sent the 2026-08-10 investigation down two wrong root causes.

Useful commands:

```bash
curl -sS -D - -o /tmp/page.html https://<host>/login | head -20   # status, CSP, cache headers
curl -sS -o /dev/null -w '%{http_code}\n' https://<host>/_next/static/chunks/<hash>.css
```

## PR #99 Completion Evidence

The approved shipped-defect program was verified on branch `fix/shipped-defects` on 2026-08-09.

Repository gates:

- `npm run lint` passed with zero findings.
- `npx tsc --noEmit` passed.
- `npm test` passed 2,186 tests across 247 files, including the live integration suites.
- `npm run build` passed and generated 57 application routes.
- `npm run validate:palette` passed the dark and light categorical-palette checks.
- `git diff --check` passed.

Browser acceptance:

- The complete Playwright suite passed twice consecutively with `--retries=0`: 49 passed and one explicitly opt-in Plaid Sandbox test skipped on each run.
- The authenticated golden path used the dedicated non-MFA CI account and passed sign-in, dashboard, transactions, task-specific Settings sections, export, and privacy controls.
- The Reports suite ran with `FUNDFLOW_FEATURE_FLAGS=reportsPage` and passed all nine cases.
- New journeys cover dashboard persistence, investments, goals, debt payoff, private receipt lifecycle, cross-source duplicate decisions, recurring sinking funds, OFX/QFX preview, and two named TOTP factors.
- The responsive matrix covers 14 primary routes at 375, 430, 768, and 1440 pixels in light and dark themes.
- Shell acceptance covers collapsed and expanded desktop navigation, the account menu, and the mobile destination dialog.
- Twenty-six reviewed desktop screenshots cover 13 authenticated routes in both themes and match deterministically on repeated runs.

Live Supabase evidence:

- Migrations `20260809191458`, `20260809192302`, `20260809193528`, `20260809194242`, and `20260809195308` are applied to the linked project.
- The obsolete `mfa_backup_codes` table is absent after migration `20260809195308`.
- Passkeys are enabled for RP ID `fund-flow-swart.vercel.app` and origin `https://fund-flow-swart.vercel.app`.
- The institution backfill updated all six items, with four logos and six brand colours populated.
- GitHub Actions has a dedicated non-MFA E2E login plus the public Supabase URL and publishable key.
- The Supabase service key remains local and is not exposed to the pull-request workflow.

### Post-review repair pass, 2026-08-09

A code review of the completed branch found nine defects; all were fixed on the same branch.

- `npx tsc --noEmit` was failing on the newest unit tests. Two of those tests also passed a
  `{ type, userId }` object where `FinancialScope` is `{ kind, ownerUserId }`, so `scopeQueryUserId`
  returned undefined and the tests exercised the unscoped accounts query while reading as coverage
  of the scoped one. Both now assert the scoping they claim.
- The dark categorical re-step cleared every pairwise gate and still put `--viz-1`, `--viz-4`, and
  `--viz-6` at 2.33:1, 2.56:1, and 2.48:1 against the dark panel, under WCAG 1.4.11's 3:1 minimum.
  `scripts/validate_palette.js` measured only pairwise ΔE, so "validation passed" never covered it.
  The validator now gates surface contrast as well, and the dark set was re-stepped again to
  `#77a9ea`, `#55c795`, `#f1a824`, `#299525`, `#755efd`, `#d57c75`, `#d33ea7` — both gates green on
  all seven slots (worst 3.62:1), at the light palette's own hues. Light `--viz-2` and `--viz-3` are
  carried as two named, pre-existing exceptions.
- Five dark visual baselines (dashboard, accounts, transactions, investments, forecasting) were
  regenerated for the new palette and matched deterministically on a second run. The other 21 were
  unaffected.
- `/debt` joined payoff rows back to accounts by name, so two liability accounts sharing a name
  rendered duplicated figures and a duplicate React key. Plan identity is now the account id.
- `buildDebtPlannerData` took `Math.abs` of the balance, turning an overpaid card into a debt with
  an assumed 22% APR. Overpaid cards are now excluded, matching `lib/dashboard.ts`.
- `loadDashboardInvestmentSummary` select-alled `holding_snapshots` to keep two dates, on a page
  that re-renders every two minutes. It is now bounded to a 30-day window.
- The duplicates route still offered transactions already in `linked_duplicates`; confirming one
  tripped the RPC's unique constraint and surfaced as an opaque 500. Linked transactions are now
  withheld from new pairs, and a genuine race returns 409.
- Receipt matching paged an unordered `.limit(100)` over the ±3-day window, so past 100 rows the
  true match could be truncated away silently. Both call sites now push the ±1% amount band into
  the query.
- The MFA factor cap ran after the client had already verified the new factor and only unenrolled
  unverified ones, so a refused eleventh factor stayed active while the response reported failure.

Plan-completeness gap closed in the same pass:

- Phase C1 required an RLS integration test proving cross-user isolation for both the receipts table
  and the Storage bucket. It did not exist. `tests/integration/receipts-rls.test.ts` now covers
  owner read, cross-user read, the absence of any client write path, a cross-user insert under the
  owner's id, direct object download by both users, and a server-minted signed URL. Six cases pass
  against the live project.

## Accounts Phase 2 Release Evidence

Live migrations:

- Apply `20260729182910_account_snapshots.sql`.
- Apply `20260729183248_shared_account_rls.sql`.
- Apply `20260729193500_private_shared_account_authorization.sql`.
- Confirm all three are recorded on FundFlow project `zrxbmmtqqhlwtrinocww`.
- Never apply them to the inactive project `ofyyjzjjmopwvfqlhnyc`.

Live database checks:

1. Confirm RLS is enabled on `account_balance_snapshots`.
2. Confirm `authenticated` has `SELECT` and lacks `INSERT`, `UPDATE`, and `DELETE`.
3. Confirm `service_role` has `SELECT`, `INSERT`, `UPDATE`, and `DELETE`.
4. Confirm duplicate source-day rows and invalid source rows are both zero.
5. Confirm the current-day snapshot count matches every eligible Plaid and included manual account with a non-null balance.
6. Run `npx vitest run tests/integration/account-snapshot-rls.test.ts`.
7. Run Supabase security and performance advisors.
8. Confirm neither advisor reports `account_balance_snapshots` or `can_read_shared_account`.

History semantics:

- History starts on `2026-07-29`.
- Earlier history is unavailable.
- Never fabricate or interpolate earlier balances.
- The current-state backfill is one day only.
- Ongoing daily history requires the application cron and refresh writers to be deployed.

Automated browser acceptance:

```bash
ACCOUNTS_E2E_SCREENSHOT_DIR=/tmp/fundflow-accounts-e2e npm run test:e2e -- tests/e2e/accounts.spec.ts
```

The suite provisions and deletes throwaway users through the Supabase admin client.
It uses demo and manual accounts, plus one explicitly shared household account.
It checks the page at 1440 by 900, 768 by 1024, and 390 by 844 in light and dark themes.
It covers mine and household scope, institution, type, visibility, owner, and range filters.
It covers totals and Percent modes, account preferences, the exact CSV header, 44 px touch targets, and horizontal overflow.
It fails on browser exceptions, same-origin request failures other than navigation aborts, same-origin 5xx responses, and unexpected application console warnings or errors.
Headless Chromium GPU diagnostics and unreachable third-party DNS noise are excluded, while application-level Plaid loader errors remain failures.

Manual visual evidence:

- Inspect all six screenshots for spacing, hierarchy, contrast, clipping, focus, wrapping, and overflow.
- Verify empty one-day sparkline slots do not leave blank rows on phones.
- Verify account amounts remain readable in both themes.
- Verify the honest earlier-history disclosure appears.
- Use an interactive browser to switch Totals to Percent and confirm the URL and visible state update.
- Confirm the browser warning and error console is empty.

Production follow-up after merge:

1. Deploy the application code.
2. Run one explicit Plaid refresh and confirm a same-day upsert rather than a duplicate.
3. After the next scheduled sync day, confirm a new date exists for eligible accounts.
4. Confirm the first chart appears only after at least two real daily points exist.

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
- Confirm `weekly-report.yml` has access to the `FUNDFLOW_APP_URL` and `CRON_SECRET` repository secrets.
