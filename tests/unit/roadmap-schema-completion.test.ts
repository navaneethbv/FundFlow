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
      "mfa_backup_codes",
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

  it("keeps active-session and backup-code rows user-owned", () => {
    expect(migration).toContain("user_session_records_select_own");
    expect(migration).toContain("mfa_backup_codes_update_own");
    expect(migration).toContain("code_hash");
  });
});
