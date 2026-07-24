# FundFlow E2E suite

Browser end-to-end tests (Playwright). Specs are `*.spec.ts` so the vitest
unit runner (`tests/**/*.test.ts`) never collides with them.

## Running

```bash
# Against a local dev server (starts `npm run dev` for you; needs .env.local
# with Supabase + Plaid sandbox keys; reuses a dev server that's already up):
npm run test:e2e

# Against any deployment (no server started):
E2E_BASE_URL=https://fund-flow-swart.vercel.app npm run test:e2e

# First time only — install the browser:
npx playwright install chromium
```

## What's covered today (smoke, no auth required)

- `/` redirects signed-out visitors to `/login`
- `/login` renders the sign-in form
- Security headers from `proxy.ts`: nonce-based CSP with `strict-dynamic`,
  `x-content-type-options: nosniff`, `referrer-policy`
- Unauthenticated `/dashboard` redirects to `/login`
- Unauthenticated `POST /api/plaid/sync` and `GET /api/export/csv` are rejected

## Authenticated golden path — `golden-path.spec.ts`

Runs only when credentials are supplied (skips cleanly otherwise):

```bash
E2E_EMAIL=e2e@example.com E2E_PASSWORD=... npm run test:e2e
# add E2E_PLAID=1 to also exercise the Plaid Link sandbox connect flow
```

Covered: sign-in → dashboard (command-center heading + Safe to spend /
Emergency runway / Next paycheck tiles, or the connect CTA on a fresh
account), transactions ledger, settings sections, CSV export privacy
contract (`date,merchant,amount,category` — or the 403 opt-out), the
privacy-blur toggle, and (gated by `E2E_PLAID=1`) connecting a sandbox bank
via Plaid Link with `user_good`/`pass_good`. The Plaid spec is best-effort —
Link's iframe UI changes without notice, so drift there usually means Plaid
changed Link, not that the app broke.

The account must exist already and must **not** have TOTP enrolled (the
sign-in spec stops at the password step). Never point it at real data.

## TODO — destructive/lifecycle specs (need a throwaway user)

Still worth adding, but they mutate or destroy state, so they need the
integration-test pattern (create user in `beforeAll`, delete in `afterAll`,
never against real data):

1. Sign up → confirm → land on dashboard
2. Enroll TOTP → sign out → sign-in resumes at the TOTP prompt (AAL2)
3. Refresh twice → transaction count unchanged (sync idempotency)
4. Disconnect bank → its accounts/transactions disappear
5. Delete account → sign-in no longer works, data gone
6. Revoke session in tab A → tab B's next navigation lands on `/login`
