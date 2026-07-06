# FundFlow — Future Todos

Nice-to-have features and enhancements, deferred out of the initial build.

## Requested enhancements

- **Card designs by network/product** — detect the card network and product
  (e.g. Amex Gold, Chase Sapphire) from Plaid account metadata and render matching
  card artwork; show that specific card's data when selected.
- **Mobile support** — polish responsive layouts for phones (the UI is Tailwind
  responsive today; needs dedicated mobile passes and touch-friendly controls).
- **Monthly history views** — browse spending/income history month by month, not
  just the last 6-month rollup.
- **Current spend indicator** — prominent "spent so far this month" vs budget /
  vs last month (dashboard has current-month totals; make this a first-class view).
- **Spend per card** — break spending down by individual card/account.
- **Spend per bank** — break spending down by institution.
- **Checking-account cash-flow insights** — link checking accounts and show
  incoming vs outgoing (deposits vs withdrawals) trends and net cash flow.

## Previously planned (from the build spec)

- **Email the CSV/report** on a schedule (e.g. Resend) so reports arrive in inbox.
- **Plaid webhooks** with signature verification for real-time sync (currently
  on-demand refresh + daily cron).
- **Optional in-app AI insights** endpoint (provider-agnostic) reusing the export
  data contract, gated by the per-user AI setting.
- **Self-hosted docker-compose** if moving off managed Supabase.
- **Audit MFA enrollment** server-side (currently the TOTP enroll happens via the
  Supabase client and isn't written to `audit_logs`).
