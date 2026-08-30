import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("account reconciliation aggregate migration", () => {
  it("aggregates exact cents behind an authenticated owner-scoped RPC", () => {
    const migration = fs.readFileSync(
      path.join(
        process.cwd(),
        "supabase/migrations/20260829173000_account_reconciliation_aggregate.sql",
      ),
      "utf8",
    );

    expect(migration).toContain("create or replace function public.account_reconciliation_aggregates()");
    expect(migration).toContain("a.user_id = (select auth.uid())");
    expect(migration).toContain("round(sum(t.amount) filter (");
    expect(migration).toContain(") * 100)::bigint");
    expect(migration).toContain("grant execute on function public.account_reconciliation_aggregates()");
  });
});
