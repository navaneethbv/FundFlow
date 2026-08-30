import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readdirSync("supabase/migrations")
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => readFileSync(`supabase/migrations/${file}`, "utf8"))
  .join("\n");

describe("item cursor health schema", () => {
  it("records item-scoped cursor metadata on plaid_items", () => {
    expect(migrationSql).toContain(
      "add column if not exists last_sync_attempt_at timestamptz",
    );
    expect(migrationSql).toContain(
      "add column if not exists last_sync_success_at timestamptz",
    );
    expect(migrationSql).toContain(
      "add column if not exists last_sync_completed_pages boolean not null default false",
    );
    expect(migrationSql).toContain(
      "add column if not exists initial_history_incomplete boolean not null default false",
    );
    expect(migrationSql).toContain(
      "add column if not exists cursor_reset_detected_at timestamptz",
    );
  });

  it("keeps cursor health writes scoped by item and user", () => {
    expect(migrationSql).toContain("plaid_items_user_id_idx");
    expect(migrationSql).toContain("create index plaid_items_user_id_idx");
  });
});