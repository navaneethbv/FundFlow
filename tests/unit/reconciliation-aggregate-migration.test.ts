import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("account reconciliation aggregate migration", () => {
  it("aggregates exact cents behind an authenticated owner-scoped RPC", () => {
    const migration = fs.readFileSync(
      "supabase/migrations/20260829173000_account_reconciliation_aggregate.sql",
      "utf8",
    );

    expect(migration).toContain("create or replace function public.account_reconciliation_aggregates()");
    expect(migration).toContain("a.user_id = (select auth.uid())");
    expect(migration).toContain("round(sum(t.amount) filter (");
    expect(migration).toContain(") * 100)::bigint");
    expect(migration).toContain("grant execute on function public.account_reconciliation_aggregates()");
  });

  it("refreshes a capture boundary and counts only later transaction arrivals", () => {
    const migration = fs.readFileSync(
      "supabase/migrations/20260830100000_reconciliation_same_day_anchor.sql",
      "utf8",
    );

    expect(migration).toContain("add column if not exists captured_at timestamptz");
    expect(migration).toContain("t.created_at > anchor.captured_at");
    expect(migration).not.toContain("t.date > anchor.snapshot_date or");
    expect(migration).toContain("transactions_user_account_created_idx");
  });
});
