import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("goal import identity migration", () => {
  it("adds a partial unique owner and provider identity index", () => {
    const sql = readFileSync(
      "supabase/migrations/20260829172000_goal_import_identity_unique.sql",
      "utf8",
    ).toLowerCase();

    expect(sql).toMatch(/create unique index/);
    expect(sql).toContain("on public.goals (user_id, import_source, import_ref)");
    expect(sql).toMatch(/where\s+import_source is not null\s+and import_ref is not null/);
    expect(sql).toMatch(/row_number\(\) over/);
    expect(sql).toContain("set import_source = null");
  });
});
