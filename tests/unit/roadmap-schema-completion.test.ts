import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("roadmap completion schema", () => {
  const migration = readdirSync("supabase/migrations")
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => readFileSync(`supabase/migrations/${file}`, "utf8"))
    .join("\n");

  it("defines owner-scoped transaction quality and account security tables", () => {
    for (const table of [
      "transaction_annotations",
      "transaction_splits",
      "linked_refunds",
      "transaction_review_decisions",
      "user_session_records",
    ]) {
      expect(migration).toContain(`create table public.${table}`);
      expect(migration).toContain(`alter table public.${table} enable row level security`);
      expect(migration).toContain(`grant select, insert, update, delete on public.${table} to authenticated`);
    }
  });

  it("validates split totals and stores review decisions uniquely", () => {
    expect(migration).toContain("public.validate_transaction_split_total");
    expect(migration).toContain("transaction_splits_validate_total");
    expect(migration).toContain("unique (user_id, kind, subject_id)");
  });

  it("keeps active-session rows user-owned and removes unsupported backup codes", () => {
    expect(migration).toContain("user_session_records_select_own");
    expect(migration).toContain("drop table if exists public.mfa_backup_codes");
    expect(migration.lastIndexOf("drop table if exists public.mfa_backup_codes")).toBeGreaterThan(
      migration.lastIndexOf("create table public.mfa_backup_codes"),
    );
  });

  it("extends sinking funds with recurrence and requires server-side writes", () => {
    expect(migration).toContain("add column cadence text");
    expect(migration).toContain("add column custom_interval_months integer");
    expect(migration).toContain("add column cycle_anchor_date date");
    expect(migration).toContain("cadence in ('one_time', 'annual', 'semiannual', 'quarterly', 'custom')");
    expect(migration).toContain("custom_interval_months between 1 and 120");
    expect(migration).toContain("drop policy if exists \"sinking_funds_insert_own\"");
    expect(migration).toContain("revoke insert, update, delete on public.sinking_funds from authenticated");
    expect(migration).toContain("grant select on public.sinking_funds to authenticated");
  });

  it("limits receipt rows and objects to server-side mutations", () => {
    expect(migration).toContain("drop policy if exists \"receipts_all_own\"");
    expect(migration).toContain("create policy \"receipts_select_own\"");
    expect(migration).toContain("revoke insert, update, delete on public.receipts from authenticated");
    expect(migration).toContain("grant select on public.receipts to authenticated");
    expect(migration).toContain("drop policy if exists \"receipt_objects_all_own\" on storage.objects");
  });

  it("stores optional Plaid institution branding on each item", () => {
    expect(migration).toContain("add column institution_logo text");
    expect(migration).toContain("add column institution_brand_color text");
  });

  it("persists duplicate links through service-only atomic functions", () => {
    expect(migration).toContain("create table public.linked_duplicates");
    expect(migration).toContain("unique (user_id, kept_transaction_id)");
    expect(migration).toContain("unique (user_id, excluded_transaction_id)");
    expect(migration).toContain("create policy \"linked_duplicates_select_own\"");
    expect(migration).toContain("revoke insert, update, delete on public.linked_duplicates from authenticated");
    expect(migration).toContain("create or replace function private.confirm_transaction_duplicate");
    expect(migration).toContain("create or replace function private.undo_transaction_duplicate");
    expect(migration).toContain("grant execute on function private.confirm_transaction_duplicate(uuid, text, uuid, uuid) to service_role");
    expect(migration).toContain("grant execute on function private.undo_transaction_duplicate(uuid, text) to service_role");
  });

  it("enforces one-use transfer and refund links at the database boundary", () => {
    const hardening = readFileSync(
      "supabase/migrations/20260904120000_session_revocation_and_mfa_hardening.sql",
      "utf8",
    );
    for (const indexName of [
      "linked_transfers_user_out_transaction_unique",
      "linked_transfers_user_in_transaction_unique",
      "linked_refunds_user_charge_transaction_unique",
      "linked_refunds_user_refund_transaction_unique",
    ]) {
      expect(hardening).toContain(indexName);
    }
    expect(hardening).toContain("create or replace function public.confirm_transfer_link(");
    expect(hardening).toContain("on conflict (user_id, out_transaction_id, in_transaction_id)");
    expect(hardening).toContain("transfer_link_conflict");
  });
});
