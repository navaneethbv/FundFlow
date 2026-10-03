import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261006130000_household_reports_only.sql",
  "utf8",
);
const rlsCheck = readFileSync("scripts/check-rls.sql", "utf8");

describe("aggregate-only household migration", () => {
  it("defines the role, invite propagation column, and fail-closed helper", () => {
    expect(migration).toContain("'reports_only'");
    expect(migration).toContain("add column if not exists role text not null default 'member'");
    expect(migration).toContain("create or replace function private.is_reports_only()");
    expect(migration).toContain("revoke all on function private.is_reports_only() from public, anon");
  });

  it("exposes only bounded aggregate fields with a minimum group size", () => {
    expect(migration).toContain("create or replace function public.household_report_aggregates");
    expect(migration).toContain("month date");
    expect(migration).toContain("category text");
    expect(migration).toContain("transaction_count bigint");
    expect(migration).toContain("having count(*) >= 3");
    expect(migration).toContain("p_end - p_start > 730");
    expect(migration).toContain("revoke all on function public.household_report_aggregates");
    expect(migration).not.toContain("merchant_name");
    expect(migration).not.toContain("transaction_id");
  });

  it("uses a restrictive authenticated policy to deny reports-only row access", () => {
    expect(migration).toContain("create policy reports_only_access");
    expect(migration).toContain("as restrictive");
    expect(migration).toContain("not (select private.is_reports_only())");
    expect(migration).toContain("private.session_not_revoked");
    expect(migration).toContain("private.mfa_satisfied");
  });

  it("keeps the RLS smoke check aligned with the new policy and RPC", () => {
    expect(rlsCheck).toContain("Aggregate-only reports policy missing");
    expect(rlsCheck).toContain("private.is_reports_only()");
    expect(rlsCheck).toContain("public.household_report_aggregates(uuid,date,date,text)");
    expect(rlsCheck).toContain("transaction_annotations");
    expect(rlsCheck).toContain("recurring_stream_transactions");
  });
});
