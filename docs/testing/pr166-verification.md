# Transaction review remediation verification

Date: 2026-09-08.
Baseline: PR #166 at `a6b8568`; incoming coverage commit `6c4d125` was incorporated before final validation.

## Implemented corrections

- Selection clears before interaction when the committed query or server ID/version/eligibility set changes.
- The review context lives in the Transactions layout, preserving feedback and authoritative reversal tokens during last-page navigation and queue completion.
- Lost responses clear selection and block another submission until an authoritative server render arrives; a failed refresh remains blocked and offers Refresh status.
- Successful actions focus the next visible actionable row, falling back to the queue heading when empty.
- Out-of-range pages redirect to the last valid page while preserving filters, sort and columns.
- An independent owner-wide missing-state check suppresses reassuring counts and displays a retryable error.
- Empty-state messaging distinguishes global completion from filters hiding remaining work, with Clear filters when applicable.
- Takeout and backups retain review metadata during a UI rollback; only a missing review relation while the feature is disabled is treated as pre-migration compatibility.
- Request bodies are read with a 32 KiB byte limit, oversized streams are cancelled, and every route response carries no-store.
- UUIDs normalize before duplicate detection, and expected versions must be decimal strings within PostgreSQL bigint range.
- Additive migration `20260908050000_transaction_review_version_text.sql` preserves text versions through PostgREST and explicitly grants required service access.

## Browser and database evidence

The local browser run used the actual application, PostgREST and a disposable PostgreSQL 17 database on loopback ports 3016/56432/56433/56434.
Its authentication endpoint was a synthetic local shim, so this is not evidence for full Supabase Auth acceptance.
No production credentials, records or writes were used.

Before the fix, selecting version 1, changing the amount and refreshing retained the selection; the browser submitted version 2 and persisted `reviewed:3`.
After the fix, the following browser journeys passed:

- Source changes followed by background refresh clear selection.
- Reviewing the last item on page 2 returns to page 1 with the month preserved and an enabled immediate reverse action.
- Desktop selection and 390px mobile controls share state; selected action buttons stay inside the viewport.
- Finishing the queue retains the announcement, focuses the queue heading, and supports immediate reversal.
- A deliberately dropped response after a committed write reconciles the page without a second write or blind reverse action.
- Deleting a fixture review row surfaces an integrity error instead of a caught-up claim.
- Automated WCAG 2.1 AA checks on the selected mobile ledger report no violations.

The committed authenticated E2E suite now contains the corresponding refresh, pagination, phone/focus and lost-response journeys.
It remains gated on an explicitly approved isolated Supabase target.

All migrations applied from scratch in a separate disposable database.
`scripts/check-rls.sql`, `scripts/check-financial-writes.sql` and `scripts/check-transaction-review.sql` passed.
The expanded SQL harness covers the material-field/null-transition matrix, precision above JavaScript's safe integer range, annotation independence, identical upsert replay, missing-state source-write rollback, second-write fault injection with whole-batch rollback, revoked sessions, account deletion and user deletion.
Financial-write assertions also verify review initialization for successful manual-entry and reconciliation RPC writes.

Three real two-session contention tests passed: opposing review actions, review blocked behind a material source update, and a batch blocked behind duplicate exclusion.
These tests wait for the lock holder to reach its barrier, then verify the rejected request and persisted state.
Migration CI now executes this suite and the PostgreSQL benchmark against its freshly reset Supabase stack.
The benchmark fixture is excluded from Codacy's SQL Server linter because its dialect-specific recommendation is invalid PostgreSQL; actual database execution remains mandatory.

## Loader and performance evidence

The page regression suite compares direct and rule-remapped projected results across 50-row and 1,000-row boundaries with 1,805 source rows, two account identifiers and mixed review states.
It also checks global empty-state semantics, missing-state failure, last-page redirection and feature-off schema access.
Review archive tests cover 1,205 records, owner scoping, missing-relation compatibility and fail-closed handling of other database errors.

`tests/fixtures/transaction-review-benchmark.sql` is a reproducible rollback-only 10,000-row benchmark with two accounts and mixed pending, excluded and review states.
Five local runs produced these median PostgreSQL execution times:

| Query | Median milliseconds |
| --- | ---: |
| Baseline date page | 1.000 |
| Review-enabled All date page | 0.557 |
| Needs review date page | 13.110 |
| Owner queue count | 11.366 |
| Missing-state count | 4.339 |
| First projection scan chunk | 13.622 |

These EXPLAIN ANALYZE timings are small and sensitive to cache/order effects; the apparent faster All page is not a claimed speedup.
The query plans retain a bounded default page query and chunked facet/projection scans, without per-row network queries.
The default 10,000-row ledger loader uses 14 transaction-source requests with review enabled versus 12 with it disabled, including the existing empty-sentinel facet request.
The two extra requests are the owner queue and integrity counts, executed together.

A separate same-fixture application measurement used two warmup requests and five timed complete server-rendered HTML responses for each flag setting.
The review-enabled samples were 899, 889, 931, 860 and 854 ms; feature-disabled samples were 853, 831, 834, 852 and 875 ms.
Medians were 889 ms enabled versus 852 ms disabled, a 4.3% increase, within the plan's proposed 20% budget for this local fixture.
This development-server result is not a production latency guarantee or a benchmark of the authentication service.

## Toolchain and remaining release gates

The final full unit coverage run passed 5,287 tests in 475 files with 95.88% branch coverage.
Focused regression, lint, typecheck, production build, palette and dependency audit checks passed.
Two incompatible callback annotations introduced by the incoming coverage commit were corrected without changing test behavior.

Safe dependency updates: Supabase SSR 0.12.7, lucide-react 1.43.0 and Nodemailer 10.0.1.
ESLint 10 was deferred because the installed Next.js import plugin declares peers only through ESLint 9 and the dry run reports peer conflicts.
TypeScript 7 was deferred because the installed typescript-eslint packages declare support below 6.1.0.

The transactionReview flag remains off.
Neither new migration was applied to the live project by this task, and its current migration ledger was not claimed to be verified.
Before enabling, apply and verify both review migrations within deployment authorization, run the credentialed full Supabase Auth E2E suite against a throwaway project, and inspect production screens read-only at desktop and phone widths.
