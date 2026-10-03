import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261003100000_statement_vault.sql",
  "utf8",
);

describe("statement vault migration", () => {
  it("keeps metadata owner-scoped and statement bytes private", () => {
    expect(migration).toContain("create table if not exists public.account_statements");
    expect(migration).toContain("alter table public.account_statements enable row level security");
    expect(migration).toContain("user_id = (select auth.uid())");
    expect(migration).toContain("private.session_not_revoked()");
    expect(migration).toContain("private.mfa_satisfied()");
    expect(migration).toContain("grant select on table public.account_statements to authenticated");
    expect(migration).toContain("revoke all on table public.account_statements from anon");
    expect(migration).toContain("values ('statements', 'statements', false)");
    expect(migration).not.toContain("on storage.objects");
    expect(migration).toContain("size_bytes <= 15728640");
  });

  it("requires exactly one account source and a month start", () => {
    expect(migration).toContain("account_statements_one_account");
    expect(migration).toContain("case when account_id is not null then 1 else 0 end");
    expect(migration).toContain("case when manual_account_id is not null then 1 else 0 end");
    expect(migration).toContain("statement_month = date_trunc('month', statement_month)::date");
  });
});
