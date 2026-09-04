# FundFlow Production-Readiness Review — 2026-08-20

Date: 2026-08-20
Scope: Fresh review of everything shipped since the last full security review
(PR #110, docs dated 2026-08-10, original audit snapshot 2026-07-05): the
remaining 14-phase financial-planner parity program plus the last two weeks of
commits (multi-currency conversion engine, forecasting milestones, multi-format
exports, advanced merchant rules, performance indexes). Read alongside
`docs/archive/Security-Review-2026-08-10.md` and `docs/archive/CODE_REVIEW-2026-08-10.md`, which remain accurate for
the earlier window and whose findings are not re-reported here.
Method: Manual review of the two most recent feature commits
(`29260a4` forecasting-milestones/exports/merchant-rules/perf-indexes and
`75cc8ad` multi-currency/forecasting-presets), the three `20260812*` migrations,
the performance-index migration, takeout/backup coverage, service-client query
scoping, and money-sign / projection wording across the new code.
Status: One finding fixed inline. The rest are documentation/decision items in
`docs/TODO.md` (Phase 3) or informational notes.

## Overall posture

Strong. No cross-user data leak or money-correctness regression was found in the
review window. The three `20260812*` migrations and the `20260814` performance
indexes introduce no new client-writable tables and no new user-owned tables, so
takeout/backup coverage (single source of truth in `lib/user-data.ts`) remains
complete. Every new SECURITY DEFINER RPC is correctly hardened
(`set search_path = ''`, explicit `revoke ... from public, anon`), and the one
RPC that takes a caller-supplied user id (`budget_suggestion_history`) guards it
against `auth.uid()` inside the query. Service-client queries introduced in the
window are either `user_id`-scoped (`/api/export/qif` via
`fetchPrivacySafeRows`) or intentional global reads (`/api/health`).

## Findings

### F1 — MEDIUM — Multi-currency conversion engine is shipped but unwired (inert dead code)
`lib/currency.ts` (added in `75cc8ad`)

`convertCurrency` and `formatMoneyWithFx` are referenced only by
`tests/unit/currency.test.ts`; nothing in `app/`, `components/`, or `lib/`
imports them. The commit message advertises a "multi-currency conversion engine
and scenario preset chips for forecasting", but the forecasting
`AssumptionsPanel` does not import the module, so the engine never runs in
production. This is not an active bug (dead code cannot leak or mis-total), but
it is a shipped-but-inert feature: the advertised multi-currency forecasting
does not exist, and the module carries static hardcoded reference rates
(`DEFAULT_EXCHANGE_RATES`) with no as-of date that would silently drift from
market rates if it were ever wired in. Because wiring it is a product decision
(wire with an "approximate static rates" disclosure vs. remove), this is not
fixed blind; it is queued in `docs/TODO.md` Phase 3.

### F2 — LOW — FIRE milestone wording implied a guarantee — FIXED INLINE
`lib/forecasting.ts` (FIRE milestone description)

"allowing a sustainable 4% withdrawal rate" implied a guarantee the projection
does not back. Rephrased to "using a 4% withdrawal rate as a rough planning
assumption" and a regression test added (`tests/unit/forecasting.test.ts`)
asserting the wording contains no "sustainable" claim and reads as a planning
assumption. The rest of the forecasting surfaces already say "projection" and
disclaim guarantees correctly (`app/forecasting/page.tsx:46-47`).

### F3 — LOW — Two of the three "multi-format exports" are unwired (dead exports)
`lib/export-formats.ts`

`toLedgerCli` and `toTaxCsv` are exported and unit-tested but wired to no route;
only `toQif` is reachable (via `/api/export/qif`). The tax CSV that the UI
exposes uses the separate `/api/export/csv?scope=tax` path, not `toTaxCsv`.
Dead code only; the wired QIF export is correct (expense-negative / income-
positive sign convention verified, `ai_export_enabled` gate applied, no
`user_id` filter gap on the API-token path). Cleanup/decision item for
`docs/TODO.md` Phase 3 rather than a blind delete.

### F4 — INFO — Regex merchant rules run user-supplied patterns with no timeout
`lib/planning.ts` (advanced merchant rules, added `29260a4`)

`matchesRule` compiles a user-supplied `new RegExp(pattern, "i")` server-side
and calls `re.test()` with no ReDoS guard. The blast radius is self-only: rules
are applied to the user's own transactions, so the worst case is a self-inflicted
slow request on a pathological pattern. Not a security boundary; noted for
completeness. If server-side regex ever runs over shared/household data, add a
pattern-length cap or a timeout.

### F5 — INFO — New export routes carry no rate limit (consistent with existing exports)
`app/api/export/qif/route.ts` (and the existing `csv`/`json` routes)

Exports are authenticated, MFA-gated, and not Plaid-cost, and the existing CSV
and JSON exports are also unrate-limited, so this is not a new regression. If
export volume ever becomes a concern, add `checkRateLimit` uniformly across
export routes.

## Positive confirmations (no action needed)

- `public.visible_institutions()` (20260812110000): SECURITY DEFINER, `set
  search_path = ''`, explicit revoke from `public`/`anon`, returns only
  institution metadata (no token ciphertext), and scopes to own items plus
  items backing accounts the caller can read via
  `private.can_read_shared_account`. Correct.
- `public.budget_suggestion_history()` (20260812120000): SECURITY DEFINER, safe
  search path, revoked from `public`/`anon`, and self-guards the caller-supplied
  `p_user_id` with `p_user_id = (select auth.uid())` so it cannot be used to read
  another user's history. Correct.
- `notifications.subject_key` partial unique index (20260812100000): the
  insert path handles the unique-violation race gracefully (returns null on
  `isUniqueViolation`), so concurrent runs cannot double-insert or crash. Correct.
- Performance indexes (20260814100000): indexes only; no Plaid logic, policy, or
  grant change. No interaction with webhook verification or sync isolation.
- Money sign: `computeCumulativeSpendByDay` was moved to `lib/cumulative-spend.ts`
  byte-for-byte and still gates on `flow === "expense"` (EXCLUDED_PFC applied
  upstream). QIF export negation is correct. No `EXCLUDED_PFC` or sign-convention
  regression found.
- Takeout/backup (`lib/user-data.ts`): no new user-owned tables created in the
  window, so coverage is complete for the new work.
- Investment-benchmark exclusion: still respected; no new benchmark wiring in the
  window. `projection`, never "prediction", is used consistently.
- Chart palette: no new chart code touched in the review window; no palette change.
