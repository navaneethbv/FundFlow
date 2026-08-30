# Backup Restore Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the loop on the existing backup system: let a user upload their encrypted `.json.enc` archive back into the app, see a dry-run report of what would change, and confirm a per-table, all-or-nothing restore that never breaks Plaid sync state — all behind the same step-up re-authentication and audit discipline as the existing account-deletion flow.

**Architecture:** Decryption reuses `lib/backup.ts::readBackupArchive` directly (never re-implement HKDF/GCM). Restore is driven off `lib/user-data.ts`'s `USER_DATA_TABLES` spec — the same table list takeout and backup already use — so restore automatically stays in sync with whatever those two already cover. The route mirrors `app/api/account/route.ts`'s `DELETE` handler shape exactly: rate limit → fresh step-up re-auth → `writeAudit` (attempt) → do the work → `writeAudit` (result).

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase Postgres, Vitest.

**Spec:** `features.md` §5 ("Backup restore path").

## Global Constraints

- Decrypt with `readBackupArchive` (`lib/backup.ts`) — never reimplement the HKDF/GCM envelope logic a third time (it already exists in the route and in `scripts/restore-backup.mjs`).
- Restore must be all-or-nothing per table (transaction-style), and must never overwrite Plaid-synced rows in a way that breaks the sync cursor — Plaid-synced and re-imported rows keep their deterministic ids, so a restore followed by a sync converges rather than duplicating.
- Every service-client query filters `user_id` explicitly.
- A restore route is one of the most destructive actions in the app; it must reuse `app/api/account/route.ts`'s step-up re-verification pattern, not just the blanket `requireUser()` AAL2 gate.
- `writeAudit` calls happen both on the attempt (before the destructive work, in case anything downstream orphans the record) and on the result, mirroring the account-delete route's ordering rationale.
- Route handlers: `requireUser()` → early-return the `NextResponse` → rate limit → `badRequest()` → work → `writeAudit()` → JSON, wrapped so failures hit `errorResponse(context, error)`.
- Tests mock with `vi.mock` and import route handlers directly, using `tests/fixtures/supabase-query.ts`.
- `npm run lint`, `npm test`, and `npm run build` must pass before this is done.

---

### Task 1: Implement the restore-plan builder as a pure function

**Files:**

- Create: `lib/restore.ts`
- Create: `tests/unit/restore.test.ts`

**Interfaces:** `buildRestorePlan(archive: unknown, tables: UserDataTableSpec[]): RestorePlan`, where `RestorePlan` is `{ tables: Array<{ name: string; rowCount: number; columns: string[] }>; unknownKeys: string[]; totalRows: number }` — the same shape both the dry-run response and the real-restore executor consume, so "what would change" and "what actually changed" are guaranteed to agree.

- [ ] Write failing tests covering: a decrypted archive shaped like `lib/user-data.ts`'s `collectUserData` output (`{ [tableName]: row[] }`) produces one `RestorePlan.tables` entry per table present in both the archive and the `USER_DATA_TABLES` spec, with the archive's actual row count; a table present in `USER_DATA_TABLES` but absent from the archive (e.g. an older backup predating a newer table) is reported with `rowCount: 0`, not an error; a key present in the archive but not in `USER_DATA_TABLES` (a newer backup restored into an older deploy, or a tampered payload) is collected into `unknownKeys` and excluded from `tables`; a non-object archive (garbage after decryption) throws a typed `RestoreValidationError` rather than a generic exception, so the route can turn it into a clean `400` instead of a `500`.
- [ ] Run `npx vitest run tests/unit/restore.test.ts` and confirm failure.
- [ ] Implement `buildRestorePlan`, importing `USER_DATA_TABLES`'s shape from `lib/user-data.ts` (extend that file's exports if the table spec isn't already exported in a form this function can consume — check whether `USER_DATA_TABLES` is exported or module-private and export it if needed, since both `collectUserData` and this new function need to walk the same list).
- [ ] Run the test again and confirm it passes.
- [ ] Commit with `feat(restore): add restore-plan builder`.

### Task 2: Implement the transactional per-table restore executor

**Files:**

- Modify: `lib/restore.ts`
- Modify: `tests/unit/restore.test.ts`

**Interfaces:** `executeRestore(service: SupabaseClient, userId: string, plan: RestorePlan, archive: Record<string, unknown[]>): Promise<RestoreResult>`, where `RestoreResult` is `{ tables: Array<{ name: string; rowsWritten: number }>; failedTable: string | null }`.

- [ ] Write failing tests (using a stubbed service client, per `tests/fixtures/supabase-query.ts`) covering: each table in the plan is deleted-then-reinserted scoped to `user_id` (delete all of the caller's own rows in that table, then bulk-insert the archive's rows for that table, both filtered by/stamped with `user_id`) — never a blind table-wide delete; a table whose insert fails stops the restore for that table but the function reports which table failed rather than throwing uncaught, so the route can decide what "all-or-nothing per table" means for the tables that already completed (this feature is explicitly all-or-nothing *per table*, not across the whole archive — a partial multi-table restore where table 3 of 12 fails is reported, not silently rolled back across all 12, since `lib/user-data.ts`'s tables have no cross-table transactional relationship the app can lean on); a table's rows are chunked on insert (mirror `UPSERT_CHUNK`-style batching from `lib/import.ts`'s callers) so a large table doesn't exceed a single request's row limit; **Plaid-synced rows are never touched by a `transactions` restore** — the executor must filter the archive's `transactions` rows to only those whose `plaid_transaction_id` does *not* look like a live Plaid id it would collide with on next sync, or more precisely: since Plaid/import/manual/scheduled rows all upsert on `plaid_transaction_id`, restoring `transactions` should `upsert(..., { onConflict: "plaid_transaction_id" })` rather than delete-then-insert, so a restore followed by the next cron sync converges instead of fighting the sync cursor (write a test proving a restored `transactions` row with the same `plaid_transaction_id` as a row the (mocked) subsequent sync would produce ends up as one row, not two — this is the single highest-risk correctness property of this whole feature, so it deserves its own explicit test even though the plan-vs-result contract for other tables is delete-then-insert).
- [ ] Run the test file and confirm failure.
- [ ] Implement `executeRestore`: for every table except `transactions`, `delete().eq("user_id", userId)` then chunked `insert()` with `user_id` stamped onto every row; for `transactions` specifically, chunked `upsert(..., { onConflict: "plaid_transaction_id" })` with `user_id` stamped onto every row, skipping the delete step entirely.
- [ ] Run the test again and confirm it passes.
- [ ] Commit with `feat(restore): add transactional per-table restore executor`.

### Task 3: Implement the restore route with step-up re-auth and dry-run

**Files:**

- Create: `app/api/backup/restore/route.ts`
- Create: `tests/unit/backup-restore-route.test.ts`
- Modify: `lib/audit.ts`

**Interfaces:** `POST /api/backup/restore` accepting multipart form data: `file` (the `.json.enc` archive), `dry_run` (`"true"`/`"false"`), and the step-up fields (`method`, `code`) that `app/api/account/route.ts`'s `verifyStepUp` already knows how to consume — reuse that function rather than writing a second copy of the TOTP/password re-verification logic (export it from wherever `app/api/account/route.ts` currently defines it, likely inline in that file or in a shared `lib/step-up.ts` — check which, and factor it out to a shared module if it's currently route-local, since this route now needs the identical logic).

- [ ] Add `"data_restore"`, `"data_restore_failed"`, and `"data_restore_dry_run"` to the `AuditAction` union in `lib/audit.ts`.
- [ ] Write failing tests covering: rate limiting via `checkRateLimit(\`backup-restore:${user.id}\`, 5, 3600)` (matching the account-delete route's `5, 3600` budget for a similarly destructive action) returns `429` past the limit; a missing/invalid step-up code returns `401` and audits `"data_restore_failed"` with `{ reason: "step_up_failed" }` *before* touching any data; a tampered or wrong-user archive (one that fails `readBackupArchive`'s auth-tag check, or whose embedded `user_id` envelope field doesn't match the caller) is rejected with `400`, never partially processed; `dry_run: "true"` calls `buildRestorePlan` and returns it without calling `executeRestore` at all, and audits `"data_restore_dry_run"` (an audit trail even for a preview, since it reveals archive contents); `dry_run: "false"` (or absent) calls `buildRestorePlan` then `executeRestore`, returns the `RestoreResult`, and audits `"data_restore"` with `{ tables, failed_table }` in `metadata` — written before the restore executes, per the account-delete route's ordering rationale, with a second audit call recording the actual result afterward.
- [ ] Run the test file and confirm failure.
- [ ] Implement the route: `requireUser()` → rate limit → parse multipart form (`file`, `dry_run`, step-up fields) → `verifyStepUp()` (on failure: audit `data_restore_failed`, return `401`) → read the file into a `Buffer` → `readBackupArchive(buffer, serverEnv.backupEncKey)` (on decryption failure: `400`, no audit needed since nothing about the caller's own data was touched) → `buildRestorePlan(decrypted, USER_DATA_TABLES)` → if `dry_run`, audit `data_restore_dry_run` and return the plan → else audit `data_restore` (attempt), `executeRestore(createServiceClient(), user.id, plan, decrypted)`, audit `data_restore` again with the result, return the `RestoreResult`.
- [ ] Run the test file again and confirm it passes.
- [ ] Commit with `feat(restore): add restore route`.

### Task 4: Build the Settings restore UI

**Files:**

- Create: `components/settings/RestoreSection.tsx`
- Modify: `app/settings/page.tsx` (mount `RestoreSection` under the Data section, beside `ImportSection`/`ExportSection`)

**Interfaces:** `RestoreSection` is a client component combining `DangerZone.tsx`'s destructive-confirmation-plus-step-up shape with `ImportSection.tsx`'s file-upload shape: choose file → dry-run preview → step-up form → confirm → result.

- [ ] Build the four-stage flow: (1) file picker (`<input type="file" accept=".enc">`, mirroring `ImportSection.tsx`'s drag-and-drop label) plus a "Preview" button that `POST`s with `dry_run: "true"` and no step-up fields yet, rendering the returned `RestorePlan` as a table-by-table row-count list; (2) a prominent warning banner ("Restoring replaces your current data in these tables. This cannot be undone.") gating the next step, mirroring `DangerZone.tsx`'s `window.confirm`-style warning copy but rendered inline since the row-count preview needs to stay visible while the user decides; (3) the step-up form (TOTP code or password, resolved the same way `DangerZone.tsx` calls `resolveStepUpMethod`) — resubmits the same file with `dry_run: "false"` plus the step-up fields; (4) a busy/error/success result state showing rows written per table, or a clear error (rejected archive, step-up failure, or a specific failed table from `RestoreResult.failedTable`).
- [ ] Verify by hand in the dev server against a real exported-then-restored archive: preview shows accurate row counts; step-up rejection blocks the restore and shows an error without touching data; a successful restore round-trips a small dataset back into the app; light/dark themes; 375px mobile layout.
- [ ] Commit with `feat(restore): add restore UI`.

### Task 5: Full verification pass

**Files:** none (verification only)

- [ ] Run `npm run lint`, `npm run test:unit`, and `npm run build`; fix anything this feature introduced.
- [ ] Manually verify the three acceptance criteria from `features.md` §5 against a real backup archive produced by `/api/cron/backup` (or `scripts/restore-backup.mjs`'s test fixture): a freshly-created backup restores to a byte-equivalent dataset, with the validation step explicitly reporting any ids that were necessarily regenerated; a tampered archive (flip one byte) is rejected; a wrong-user archive (decrypted with a different user's derived key) is rejected; the restore is audit-logged and the UI required explicit confirmation before anything destructive happened.
- [ ] Update `docs/archive/CHANGES-roadmap-2026-07-23.md`'s restore runbook section (it currently documents the manual decrypt-then-reimport process) to point at the new in-app flow, keeping the CLI script documented as the offline/emergency fallback.
- [ ] Update `docs/HANDOFF.md` and `docs/TODO.md`.
