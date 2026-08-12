import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("budget suggestion history RPC", () => {
  it("requires the requested user id to be the authenticated user", () => {
    const migration = readFileSync(
      "supabase/migrations/20260812120000_budget_suggestion_history.sql",
      "utf8",
    );

    expect(migration).toMatch(/where\s+t\.user_id = p_user_id/);
    expect(migration).toContain("and p_user_id = (select auth.uid())");
  });
});
