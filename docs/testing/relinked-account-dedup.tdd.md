# Relinked account deduplication TDD evidence

## Source and user journey

The journey was derived from the production screenshot and a read-only authenticated browser reproduction on 2026-09-07.

As a user who accidentally connects the same Plaid Item twice, I want FundFlow to use the uniquely freshest complete account set so that balances, account lists, and financial planning do not count the same money twice.

## Task report

The RED checkpoint added the production-shaped IBM and PayPal retirement account pairs before the deduplication helper existed.
`npx vitest run tests/unit/relinked-accounts.test.ts` failed because `@/lib/relinked-accounts` did not exist.

The GREEN checkpoint introduced conservative full-Item matching and integrated it into the dashboard, Investments, Accounts, net-worth snapshots, forecasting, debt planning, goals, advice, and account exports.
`npx vitest run tests/unit/relinked-accounts.test.ts tests/unit/investments-data.test.ts` passed after the implementation.

A second RED check proved that matching account sets owned by different household members could initially collide.
The implementation now includes account ownership in the Item signature, and the focused suite passes with that isolation guarantee.

## Test specification

| # | What is guaranteed | Test file or command | Test type | Result | Evidence |
|---|--------------------|----------------------|-----------|--------|----------|
| 1 | Two complete matching Plaid Item account sets retain only the uniquely freshest set | `tests/unit/relinked-accounts.test.ts` | Unit | PASS | Four production-shaped rows reduce to the two current rows and $45,240.00 |
| 2 | A partial account-set match is not treated as a duplicate Item | `tests/unit/relinked-accounts.test.ts` | Unit | PASS | Different savings masks preserve all rows |
| 3 | Missing masks and tied freshness remain visible instead of being guessed away | `tests/unit/relinked-accounts.test.ts` | Unit | PASS | Both ambiguous cases preserve all rows |
| 4 | Identical account sets owned by different household members remain separate | `tests/unit/relinked-accounts.test.ts` | Unit | PASS | Ownership is part of the Item signature |
| 5 | The Investments loader uses the deduplicated rows and corrected total | `tests/unit/investments-data.test.ts` | Integration-style unit | PASS | The loader returns two current accounts totaling $45,240.00 |

## Coverage and gates

`npm run test:unit` passed 469 files and 5,170 tests on the final implementation.
`npm run test:coverage` passed 471 files and 5,175 tests with 97.93% statement, 95.06% branch, 98.43% function, and 99.17% line coverage on the final implementation.
Typecheck, lint, and the production build also passed.
The full final gates are recorded in `docs/HANDOFF.md`.

The live production browser reproduction was read-only.
No production financial row, Plaid Item, or account setting was changed.
