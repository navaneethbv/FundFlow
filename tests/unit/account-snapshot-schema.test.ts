import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readdirSync("supabase/migrations")
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => readFileSync(`supabase/migrations/${file}`, "utf8"))
  .join("\n");

describe("account snapshot schema", () => {
  it("keeps shared-account authorization outside the exposed API schema", () => {
    expect(migrationSql).toContain("create schema if not exists private");
    expect(migrationSql).toMatch(
      /private\.can_read_shared_account\(\s*target_account_id uuid\s*\)/,
    );
    expect(migrationSql).toContain(
      "drop function public.can_read_shared_account(uuid)",
    );
  });

  it("uses one visible-row policy for each Phase 2 table", () => {
    expect(migrationSql).toContain('"accounts_select_visible"');
    expect(migrationSql).toContain(
      '"account_balance_snapshots_select_visible"',
    );
  });
});
