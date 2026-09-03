# PR #149 review: unified frontend motion, accessibility & power automation

Reviewed 2026-09-02 against `main`.
Scope: PR #149 (`feat/frontend-motion-and-power-features`, 126 files, +12,503 / -522), the unpushed local commit `4c1156e`, and the uncommitted working tree.

## Verdict

You are on the right track. The architecture is sound and the invariants this repo cares about are, with one large exception, respected: every new route filters `user_id` explicitly, transfer net-out is wired through `loadCanonicalProjection` rather than bolted onto one surface, the palette validator is green, no CSP change was needed, the reduced-motion block is correct, and the FIRE simulator says "projection" throughout.

The exception is the encrypted backup restore. As written, `executeRestore` deletes the user's accounts (and cascade-deletes their entire transaction history) and then fails to reinsert them, on every run. That is a data-destruction path, not a restore path, and it must not ship in this state.

Beyond that, three tests you already wrote in `4c1156e` are still red, and the reconcile adjustment leaks into spending totals.

## State of the branch

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean |
| `npm run test:unit` | **3 failed**, 4,718 passed (435 files) |
| `node scripts/validate_palette.js` | passed, no new exceptions |
| GitHub CI on #149 | all green |

CI is green only because it last ran on `f30d637`. Local `HEAD` is `4c1156e` ("test: reproduce PR 149 review defects"), which is unpushed and contains the red tests. The uncommitted working tree holds partial fixes for a previous review round (rules-batch column name, `planning.ts` regex guard, restore empty-section handling, scheduled-date validation, tax-export split counting, `RestoreSection` stage). Those partial fixes are correct as far as they go.

---

## Blockers

### B1. Restore deletes accounts, cascade-wipes the ledger, then fails to reinsert

`lib/restore.ts:180-203` (`restoreUserTable`), `lib/user-data.ts:57`

`RESTORE_ORDER` puts `accounts` first. `restoreUserTable` runs `DELETE FROM accounts WHERE user_id = X`, and `accounts` is the cascade root for most of the schema:

- `transactions.account_id` → `on delete cascade` (the entire ledger)
- and transitively `transaction_annotations`, `transaction_splits`, `linked_refunds`, `linked_transfers`, `receipts`, `recurring_stream_transactions`
- plus `holdings`, `account_balance_snapshots`, `scheduled_transactions`, `account_reconciliations`

The insert that follows carries only the archived columns plus `user_id`:

```
name, official_name, mask, type, subtype, current_balance,
available_balance, credit_limit, iso_currency_code, id
```

`public.accounts` also declares `plaid_item_id uuid not null` and `plaid_account_id text not null unique` (`supabase/migrations/0001_init.sql:116`). Neither is in `spec.select` and neither is in `restoreKeys`. The insert fails on a NOT NULL violation, `executeRestore` sets `failedTable: "accounts"` and returns.

Net effect of pressing "Restore": accounts and every transaction are gone, nothing is written back. This fires on the first table of every restore, so it is not an edge case.

`tests/unit/restore.test.ts` is green because the Supabase client is mocked, so neither the NOT NULL constraint nor the cascade is exercised.

The uncommitted removal of `if (entry.rowCount === 0) continue;` widens this: an empty `accounts: []` section now also triggers the delete.

**Fix direction:** decide whether restore is per-table replace or merge. If replace, the archive must carry every NOT NULL column (`restoreKeys` needs `plaid_item_id, plaid_account_id` for accounts, and the equivalent for every other table), and the delete+insert pair has to run inside one Postgres transaction via an RPC so a failure rolls back. If that is too much for this PR, ship restore behind a flag or drop it from #149.

### B2. Restore also breaks on the investments tables

Same mechanism, three more tables (all behind the `investmentsPage` flag, so only live when it is on):

- `holdings.security_id` is `not null` and is not in the select or `restoreKeys` → delete succeeds, insert fails.
- `holding_snapshots.holding_id` references `holdings(id)`, but `holdings` has no `id` in `restoreKeys`, so ids are regenerated and the FK cannot resolve.
- `investment_transactions.account_id` (`not null`) and `plaid_investment_transaction_id` (`not null unique`) are both absent from the select.

`securities` is ordered before `holdings`, and `holdings.security_id` cascades, so deleting `securities` wipes `holdings` before `holdings`' own turn.

### B3. `executeRestore`'s "all-or-nothing per table" claim is false

`lib/restore.ts:16-25`

The docstring promises "a per-table, all-or-nothing restore" and "a failure in one table stops the run". The run does stop, but delete-then-chunked-insert (`INSERT_CHUNK = 500`) is not atomic. A failure on chunk 3 of 7 leaves the table with the first 1,000 rows and no way back. `restoreUserTable` also returns `rowsWritten: 0` on error, which hides how many rows did land.

Either make it genuinely atomic (single RPC in a transaction) or change the docstring and the UI copy to say what it actually does.

### B4. Reconcile inserts a balance adjustment with no opt-in - and it counts as spending

`app/api/accounts/reconcile/route.ts:262-286`
Red test: `tests/unit/accounts-reconcile-route.test.ts:305` "does not create an adjustment unless the user explicitly requests one"

Two problems, one line apart:

1. `adjustmentAmount` is derived purely from `bookBalance - statementBalance`, and any nonzero difference inserts a synthetic `transactions` row. There is no `create_adjustment` flag in `parseReconcilePayload`. A user who mistypes a statement balance gets a permanent fake ledger entry with no delete path. Your own test already specifies the intended contract (`create_adjustment: true`).
2. The row is written with `pfc_primary: "RECONCILE_ADJUSTMENT"`, which is **not** in `TRANSFER_GROUPS` / `EXCLUDED_PFC` (`lib/finance-domain.ts:24`). Per CLAUDE.md every spend total must apply `EXCLUDED_PFC`; because this code is not in the set, a reconcile adjustment is counted as real spending or income in every dashboard total, category breakdown, and report.

Fix both: gate the insert on an explicit `create_adjustment`, and add `RECONCILE_ADJUSTMENT` to `TRANSFER_GROUPS`.

### B5. Transfer confirmation persists the decision before validating the pair

`app/api/transactions/transfers/route.ts:161-180`
Red test: `tests/unit/transactions-transfers-route.test.ts:121`

`POST` upserts into `transaction_review_decisions` first, then calls `linkConfirmedTransfer`, which can still return a 400 (`out_id`/`in_id` missing, `subject_id` mismatch, transactions not owned). On that path the decision row is already committed as `confirmed`, so the pair is filtered out of the `GET` suggestion list by `resolved`, while no `linked_transfers` row exists to net it out. The transfer silently stops being reviewable and never nets out.

Validate and link first, then record the decision.

### B6. Transfer link amount is taken from the request body

`app/api/transactions/transfers/route.ts:110, 138`
Red test: `tests/unit/transactions-transfers-route.test.ts` "derives the linked amount from the owned transactions"

`amount` comes straight from the client and is written to `linked_transfers.amount` after only a `Number.isFinite` check. The route already fetches both owned rows to verify ownership; derive the amount from those rows instead. Right now a client can persist a link whose recorded amount has nothing to do with either transaction.

---

## High

### H1. Reconcile un-clears transactions the UI never showed

`app/api/accounts/reconcile/route.ts:199-217`

`GET` scopes its working set to `sinceDate` = the last statement date (falling back to 120 days). `syncClearedStatus` un-marks everything in scope that is not in `cleared_ids`, but computes its scope as a flat `isoDaysAgo(LOOKBACK_DAYS)` (120 days) regardless of the last statement.

So on the second and later reconciliations, saving un-clears every transaction between 120 days ago and the previous statement date - rows the client never received and therefore never sent back in `cleared_ids`. Prior reconciliation work is silently undone. Use the same `sinceDate` derivation in both handlers.

### H2. The batch rules apply swallows write errors and reports success

`app/api/rules/batch/route.ts:128-172`

```ts
if (!upsertError) { appliedCount += annotationRows.length; }
```

Both the annotation upsert and the merchant update discard their errors. The route then returns `success: true` with a silently lower `appliedCount`, and writes an audit row saying the batch was applied. A user who runs a live apply against a failing table is told it worked. Propagate the error, or at minimum return a per-table failure list.

### H3. Tag automation in the rules engine is wired to nothing

`app/api/rules/batch/route.ts:44` vs `lib/rules-engine.ts:225-240`

`loadUserRules` selects `id, match_type, pattern, display_name, category, enabled` - there is no `tags` column in the query (or in `merchant_rules`). `SmartRule.tags` is therefore always `undefined`, `nextTags` always equals `originalTags`, and the auto-tagging the PR description advertises never fires through this path.

The consequence is not just a dead feature: the annotation upsert filter is `r.updated.tags.length > 0 || category changed`, so every transaction that already has tags gets a no-op annotation rewrite and inflates `appliedCount`.

Relatedly, `applyRulesToTransaction` detects tag changes with `nextTags.length !== originalTags.length`, which cannot see a same-count tag swap. Compare contents.

---

## Medium

### M1. The regex match-type migration is uncommitted and unapplied

`supabase/migrations/20260902220000_smart_rules_regex.sql` is untracked. Until it is committed *and* applied by hand, `merchant_rules_match_type_check` rejects `'regex'`, so every regex rule the settings UI offers fails on insert. This is exactly the "code reading a new column fails until someone applies it" trap in CLAUDE.md. Commit it, apply it, and note it in the PR body's migration list.

### M2. The ReDoS guard is narrower than the PR claims

`lib/rules-engine.ts:48-59`

`hasAmbiguousQuantifiedGroup` matches `\(([^()]*)\)([*+{])`, so the body may not itself contain parentheses. `((a+))+` therefore passes the guard: the inner `(a+)` is not followed by a quantifier, and the outer group's body contains parens so it never matches. There is also no execution budget, so a pattern that backtracks polynomially (`[a-z]+[a-z]+[a-z]+…`) is unaffected by the check.

With a 120-character cap and a single trusted user the practical risk is low, but the PR body states this "eliminates super-linear evaluation" and cites CWE-730. Either tighten the check (reject any quantifier applied to a group containing a quantifier or alternation at any depth) or soften the claim.

### M3. Regex rules mean different things on different surfaces

`lib/rules-engine.ts:180-184` tests `merchant` and `name`.
`lib/planning.ts:385-391` tests `merchant` and `accountName`.

The same saved rule matches different transactions depending on which code path evaluates it. Pick one definition and share it.

### M4. No rate limit on the two heaviest new write routes

`/api/accounts/reconcile` inserts ledger rows; `/api/rules/batch` reads up to 5,000 transactions and bulk-writes annotations plus merchant renames. Neither calls `checkRateLimit`, while `/api/transactions/transfers` and `/api/backup/restore` in this same PR both do.

Rate limiting is selectively applied repo-wide (21 of 74 routes), so this is a judgment call rather than a broken convention - but these two are the ones that warrant it.

### M5. Type escape hatch in the transfers route

`app/api/transactions/transfers/route.ts:100-133`

`linkConfirmedTransfer` takes a conditional-type-derived parameter, then casts it to a hand-written structural type, and the call site passes `supabase as never`. This turns off type checking exactly where the query shapes matter. Type the parameter as `SupabaseClient`, as every other route in the PR does.

### M6. `?` cannot close the shortcuts modal

`lib/use-keyboard-shortcuts.ts:113-119`

`useKeyboardShortcuts` returns early whenever `isDialogOpen()` is true, and the help modal renders a `<dialog>`. So `?` opens the sheet but cannot toggle it shut, despite `toggleHelp` being written as a toggle. Escape still works via `Modal`, so this is cosmetic, but it contradicts the documented behaviour.

---

## Low / documentation

- **L1.** `promoteDueScheduledTransactions` does `promoted += chunk.length` after an `ignoreDuplicates: true` upsert (`lib/scheduled-promotion.ts:59`), so a re-run reports rows it skipped. Use the returned row count.
- **L2.** Scheduled-date validation compares against server UTC "today" (`lib/scheduled-transactions.ts:57`). A user in PDT after 17:00 cannot schedule anything for their own today. The repo already fixed a family of these in #145; worth using the same timezone helper.
- **L3.** `GET /api/transactions/transfers` filters `user_id` on `transactions` but not on `transaction_review_decisions` or `linked_transfers` (`route.ts:45-47`). RLS covers it today, but `transactions` already carries a household-widened SELECT policy, and the house rule is that personal reads filter explicitly. Add the filters for consistency.
- **L4.** `pairs.find(...)` inside a `.map` over the same list (`route.ts:81`) and `new Set(clearedIds)` rebuilt per `.filter` iteration (`reconcile/route.ts:208`) are both accidental O(n²). Harmless at current scale, trivial to hoist.
- **L5.** `getDashboardData` reads `linked_transfers` with no `42P01` fallback, while `loadCanonicalProjection` has one (`lib/finance-query.ts:436-445`). It degrades quietly rather than erroring, so this is only an inconsistency - but the string-sniffing fallback (`error.message.includes("linked_transfers:42P01")`) is fragile either way.
- **L6.** `20260902120000_linked_transfers.sql` drops `transaction_review_decisions_kind_check` without `if exists`, unlike the sibling migration. Re-running it fails.

### PR description corrections

The body overstates three things. Since this is the record that survives the branch, worth fixing before merge:

1. **"'Once' and recurring frequencies"** for scheduled transactions. `scheduled_transactions` has no frequency column, and `toRecurringItem` hardcodes `frequency: "once"` (`lib/scheduled-transactions.ts:170`). One-off only.
2. **The chord table.** Actual mapping is `g c` → Cash Flow and `g r` → Recurring (`NAVIGATION_ROUTES`, `lib/use-keyboard-shortcuts.ts:25`). There is no Reports chord at all.
3. **"Resolved all SonarCloud and CodeFactor alerts"** is accurate for the pushed commit, but the branch as it stands locally has three failing tests and an uncommitted migration.

---

## What is genuinely good

Worth saying, because it is most of the diff:

- Every new route filters `user_id` explicitly, including the service-client paths. No repeat of the weekly-report leak class.
- Transfer net-out lands in `projectFinanceTransactions` via `nettedIds` alongside refunds, so it applies to every surface at once rather than being patched per view. That is the right seam.
- `/api/backup/restore` itself is well built: step-up re-auth before *any* data work including the dry run, rate limiting shared with account deletion via `lib/step-up.ts`, envelope user-binding checked before planning, audit rows on attempt and result. The problem is in `executeRestore`, not the route.
- `/api/export/tax` correctly reuses the canonical projection, holds the date/merchant/amount/category privacy contract, keeps the `ai_export_enabled` gate, and chunks the annotation read. The uncommitted split-dedupe fix is right.
- Merchant logos ship as offline Simple Icons data URIs - no CSP change, no external host, deterministic fallback.
- Motion: reduced-motion override is correct (`animation-duration: 0.01ms` with `forwards` fill leaves the end state visible), and no chart or palette rule was touched.
- 4,718 passing tests, and `4c1156e` shows you were already reproducing defects as red tests before fixing them.

---

## Suggested order

1. B1 / B2 / B3 - restore. Biggest blast radius, and it decides whether restore ships in #149 at all.
2. B4 - reconcile adjustment opt-in plus `EXCLUDED_PFC`. Two small changes, one red test, one money invariant.
3. B5 / B6 - transfers ordering and derived amount. Two red tests, same file.
4. H1 - reconcile un-clear window.
5. H2 / H3 - batch rules error handling and the dead tag path.
6. M1 - commit and apply the regex migration.
7. Everything else, then rewrite the three PR-body claims.
