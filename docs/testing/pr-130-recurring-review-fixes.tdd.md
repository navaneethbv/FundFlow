# PR #130 Recurring Review Fixes TDD Evidence

## Source

The user journeys and acceptance criteria came from the exact-head review of PR #130 at `326ad5971f292c40bf9f88a9ef792f5d94c05530`.
No external implementation plan was used.

## User journeys

As a FundFlow user, I want a recurring subscription to remain visible after its new price repeats, so a settled price change does not deactivate the stream.
As a FundFlow user, I want discretionary gasoline purchases excluded from utility-bill inference unless the description carries a recurring signifier, so ordinary fuel purchases do not become bills.
As a FundFlow user, I want extreme low and high amount outliers rejected, so variable-bill inference remains bounded.
As a FundFlow operator, I want durable transaction syncs and webhook acknowledgements to survive derived recurring failures, so Plaid does not retry already-persisted work unnecessarily.

## RED evidence

Commit `efa6436` records the failing regression tests before production changes.
`npx vitest run tests/unit/recurring-detection.test.ts tests/unit/plaid-webhook-route.test.ts` produced five intended failures and left 36 neighboring tests passing.
The failures proved that `[10, 10, 12, 12]` produced no stream, `TRANSPORTATION_GAS` was accepted as a utility, `[100, 1, 100]` was accepted as bounded variable data, and both webhook failure cases returned HTTP 500.

## GREEN evidence

Commit `d6c90ec` contains the minimal behavior fixes.
The same targeted command passed 41 tests after the fix.
Commit `d87af68` contains behavior-preserving static-analysis refactors.
The expanded focused command passed 167 tests across seven files after the refactor.

| # | What is guaranteed | Test target | Test type | Result |
|---|---|---|---|---|
| 1 | A repeated new monthly price remains one inferred price-step stream. | `tests/unit/recurring-detection.test.ts` | Unit | PASS |
| 2 | Transportation gasoline without a recurring signifier is not treated as a utility bill. | `tests/unit/recurring-detection.test.ts` | Unit | PASS |
| 3 | A variable sequence with an extreme low outlier is rejected. | `tests/unit/recurring-detection.test.ts` | Unit | PASS |
| 4 | A transaction webhook acknowledges after durable sync even when inference fails. | `tests/unit/plaid-webhook-route.test.ts` | Route integration | PASS |
| 5 | A recurring webhook runs local inference and acknowledges even when provider and inference refreshes fail. | `tests/unit/plaid-webhook-route.test.ts` | Route integration | PASS |

## Full verification

`npm run test:coverage` passed 4,391 tests across 407 files.
Coverage was 98.16% statements, 95.42% branches, 98.83% functions, and 99.21% lines.
`npm run lint`, `npx tsc --noEmit`, `npm run build`, and `npm audit --audit-level=high` passed.
`npx supabase migration list --linked` showed local and remote migration alignment.
`npx supabase db push --linked --dry-run` reported the remote database up to date with no migrations to apply.
`graphify update .` refreshed the repository knowledge graph.

## Known credential-gated gap

The browser test `infers a monthly stream when Plaid omits it` was invoked first as the closest end-user reproduction and self-skipped because matching Plaid sandbox credentials are unavailable.
The test intentionally refuses to use the configured production Plaid environment.
The deterministic unit and route regressions cover the reviewed failures without touching production data.
