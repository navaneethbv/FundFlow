# CLAUDE.md

How to work in this repository. What the repository *contains* is documented in
`docs/ARCHITECTURE.md`; keep that split when adding to either file.

@AGENTS.md

## Dependency freshness

Run `npx npm-check-updates` before starting a new task to check for newer dependency versions.
Update what is safe; skip a major bump if it breaks the toolchain rather than forcing it through, and record why in the PR description.

## Commands

```bash
npm run dev         # Next.js dev server on http://localhost:3000
npm run build       # production build (also the fastest full type/route check)
npm run lint        # eslint (flat config, eslint.config.mjs)
npx tsc --noEmit    # typecheck only
npm run test:unit   # unit tests only, no external services needed
npm test            # unit + integration tests (integration hits live Supabase)
npm run test:watch  # vitest watch mode
```

Run one file: `npx vitest run tests/unit/csv.test.ts`.

Integration tests (`tests/integration/`) need `.env.local` plus applied
migrations, and they create and delete throwaway users against a real Supabase
project. Because that is destructive, `tests/setup.ts` denies by default: a run
that reaches `tests/integration/` with a `SUPABASE_SECRET_KEY` present **fails**
unless `TEST_SUPABASE_URL` is set and equals the URL under test. Point it at a
throwaway project, never one holding real user data. Unit tests
(`npm run test:unit`) are unaffected and need none of this.

## What this app is

A personal-finance app for 1-2 users: Next.js 16 App Router (TypeScript,
Tailwind 4) on Vercel, Supabase for auth + Postgres, Plaid for bank data.

The default path for AI is still **export, not upload**.
The user downloads a privacy-safe CSV and feeds it to a tool of their choice, and that path needs no key, no consent flag, and no network call to a model.
On top of it sits an **opt-in in-app AI surface** (`app/api/ai/*`), dark unless the deployment sets `ANTHROPIC_API_KEY` *and* the user turns it on.
Treat "no in-app AI" as retired wording: the constraint that survived it is the privacy contract in "In-app AI" below.

## Rules that must not be broken

### Data access

- Two Supabase clients. `lib/supabase/server.ts` `createClient()` is
  cookie-bound and RLS applies; use it for reads. `lib/supabase/service.ts`
  `createServiceClient()` **bypasses RLS** and is only for writes RLS
  intentionally blocks, plus cron. **Every service-client query must filter
  `user_id` explicitly** - a missing filter is exactly how the weekly report
  once leaked cross-user account balances.
- Never import `lib/env.server.ts` (server-only secrets) into client
  components. `lib/env.ts` holds the `NEXT_PUBLIC_*` values.
- Client writes are allowed only on `budgets`, `saved_reports`, `user_tags`,
  and the `profiles` preference columns. User-authored configuration is the
  test for joining that list; a provider-synced table never qualifies.
- Migrations in `supabase/migrations/` are applied by hand (CLI or dashboard).
  Nothing applies them to the live project for you, so code reading a new
  column fails until someone does. CI does verify them: `migration-check.yml`
  applies every migration to a clean local Postgres and runs
  `scripts/check-rls.sql` against the result, so a migration that will not
  apply, or that leaves the schema in a state the script forbids, fails there
  rather than in production.

### Security

- MFA is enforced server-side in both `proxy.ts` (pages) and `requireUser()`
  (APIs). Do not add an auth entry point that skips the AAL check.
- **Every policy granted to `authenticated` also gates on
  `private.session_not_revoked()` and `private.mfa_satisfied()`**, not just
  ownership: `user_id = auth.uid()` is satisfied perfectly well by a revoked
  token, or by an aal1 session belonging to a user with a verified factor.
  `scripts/check-rls.sql` asserts this against the applied schema in CI. The
  only exceptions are `profiles`, `user_session_records` and
  `mfa_backup_codes`, all read before a session can reach aal2; gating them
  would lock an enrolled user out of their own step-up. Copying an owner-only
  policy from an older table is how this hole gets reopened, so let the check
  catch it rather than adding a new exception.
- Plaid `access_token`s are encrypted app-side before insert, and are never
  logged, returned to the browser, or stored plaintext.
- Cron routes authenticate `Authorization: Bearer $CRON_SECRET` via `safeEqual`.
- `/api/plaid/webhook` verifies the JWT outside sandbox. Keep `dsaEncoding:
  "ieee-p1363"`; omitting it rejects all genuine webhooks.
- CSP lives in `proxy.ts` (not `middleware.ts`, Next 16 renamed it) and is
  nonce-based. A new external script or host requires a change there.
- Exports carry only date/merchant/amount/category, gated by `ai_export_enabled`.
- `public/sw.js` caches only content-addressed static assets, only when
  `response.ok`, and **never an HTML document**: documents hold per-user
  financial data that Cache Storage would keep readable after sign-out.
  Nothing is precached. Navigations are network-only.
- The proxy matcher excludes `sw.js` and `manifest.webmanifest`. Matcher values
  must stay plain string literals, because Next statically analyzes them at
  build time and silently ignores anything else - `String.raw` (Sonar S7780)
  would disable the matcher entirely.

### In-app AI

The surface is `app/api/ai/{insights,ask,receipt}`, and `lib/ai-provider.ts` is
the only place an Anthropic client may be constructed. It is `server-only`.

- **Aggregates leave, rows never do.** `buildInsightPayload()` reduces the
  export rows to month/category totals plus top merchants, capped at 6 months
  and 25 merchants. Balances, account names, masks, emails, and
  transaction-level rows must never reach the payload. Widening what is sent
  is a privacy change, not a prompt tweak.
- **Consent is checked per request, server-side.** `ai_settings.enabled` plus
  the `ai_export_enabled` flag behind `fetchPrivacySafeRows()`. A client-side
  toggle is not a gate.
- **Unconfigured means degraded, never broken.** No key: `ask` and `receipt`
  return 503, and `insights` falls back to the rule-based summaries in
  `lib/ai-insights.ts`. A provider error falls back the same way, never a 500.
- **Every route is capped per user per day** (`insights` 4, `ask` 10,
  `receipt` 10) so a stuck retry loop cannot run up a bill.
- **Receipt scanning is the one path that uploads user content.** The image
  goes to the vision model and is never stored. Do not make it automatic, and
  do not reuse it as a general upload channel.

### Knowledge graph (graphify)

Kept here, above the `## graphify` block at the bottom, on purpose: that block
is rewritten by `graphify <agent> install`, which is how the two rules below
were silently dropped once already (commit `a3a2283`). Anything you add inside
it will not survive the next install.

- **Never commit `graphify-out/` or `lib/graphify-out/`.** Both are gitignored
  generated output, together roughly 14 MB. They once landed in a PR and had
  to be stripped. Regenerate with `graphify update .` instead of committing.
- **Dirty `graphify-out/` files are expected** after hooks or incremental
  updates, and are not a reason to skip graphify. Only skip it when the task
  is about stale or wrong graph output, or the user says not to use it.
- `scripts/graphify-hook.sh` is the shim every agent's hook config calls
  (Claude Code `PreToolUse`, Gemini `BeforeTool`, Codex `PreToolUse`). It
  resolves the graphify binary at call time, so no config hardcodes a machine
  path, and it exits 0 on every failure. A hook must never block a tool call.
- `scripts/graphify-session-start.sh` runs on Claude Code `SessionStart`. With
  no graph present it starts an AST-only rebuild in the background and says so,
  rather than blocking startup on the ~10s build.
- Both scripts are committed, so a clone alone is enough. A user-level copy in
  `~/.graphify-agent/` covers every other project and defers to these when they
  exist, so nothing fires twice.
- `GRAPHIFY_BIN` overrides binary resolution when graphify lives somewhere odd.
- **After running `graphify <agent> install`, run
  `sh scripts/graphify-fix-hooks.sh`.** The installer rewrites the three hook
  configs every time and hardcodes an absolute path to its own binary. The fix
  script re-points them at the shim and restores the `SessionStart` entry the
  installer does not know about. It is idempotent.

### Money and correctness

- Amount sign follows Plaid: **positive = money out**, negative = money in.
- Dates are `YYYY-MM-DD` strings end to end; month keys are `YYYY-MM`.
- Every spend total must apply `EXCLUDED_PFC` (`dashboard.ts`), or credit-card
  payments get double-counted.
- Anything that joins a computed result back to its source rows keys on the id,
  never on a display name.
- Say "projection", never "prediction" or a confidence level nothing computes.
- Do not wire up a benchmark comparison until a licensed market-data source is
  provisioned. That is a legal exposure, not a missing feature.

### Charts

- Seven `--viz-*` slots, fixed order, never an 8th hue (fold via `foldTail`).
- `scripts/validate_palette.js` gates CVD separation *and* surface contrast, and
  both must stay green. Re-step with the validator, never by eye, and never
  extend its exception list to make a re-step pass. See `docs/PALETTE.md`.
- Every chart ships direct labels or a table twin. Text never wears series color.

### Plaid frugality

- Auto-pull runs at most once per 30 min, enforced server-side. Don't shorten
  the window without checking quotas, and don't reintroduce a select-all in
  `getDashboardData`.

## Conventions

- Route handlers: `requireUser()` → early-return the `NextResponse` → rate limit
  where sensitive → validate with `badRequest()` → work → `writeAudit()` → JSON,
  wrapped so failures hit `errorResponse(context, error)`.
- Tests mock with `vi.mock` and import route handlers directly rather than
  spinning up a server.
- A bug report starts with reproducing it the way the user hit it. `curl` and
  Playwright load no browser extensions, so a green run there rules out the
  server and proves nothing about the reporter's browser.

## Agent skills

### Documentation governance

- `README.md` is the product and setup overview. `docs/ARCHITECTURE.md` is the
  structural map and invariant reference. `docs/TODO.md` is current status and
  deferred work. `docs/HANDOFF.md` is dated session history and deployment
  context.
- Treat `docs/archive/` and `docs/superpowers/archive/` as historical evidence,
  not current instructions. Keep completed reviews and plans there so active
  documents do not describe merged branches as pending.
- Before claiming a database migration is deployed, verify it with
  `supabase migration list --linked` and record any local/remote mismatch in
  `docs/TODO.md` or `docs/HANDOFF.md`.
- Keep one canonical owner for each fact. Link to the owner from other docs
  instead of copying mutable status or implementation details.

### Issue tracker

Issues are tracked as GitHub issues via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context layout: `CONTEXT.md` + `docs/adr/` at the repo root (created lazily by `/domain-modeling` as terms/decisions resolve). See `docs/agents/domain.md`.

## Where to read more

- `docs/ARCHITECTURE.md` - request path, every `lib/` module, subsystem
  invariants in full. Read the relevant section before changing a subsystem.
- `docs/PALETTE.md` - the measurements behind the chart palette rules.
- `docs/HANDOFF.md` - session-resume note. `docs/TODO.md` - deferred work.
  Update both when finishing significant work.
- `docs/QA.md` - runbook for flows needing live credentials or screenshots.
- `docs/archive/` - closed reviews and superseded changelogs, kept for
  provenance. `docs/superpowers/archive/` - plans and specs whose work has
  shipped. Neither is a source of current truth; do not act on them.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
