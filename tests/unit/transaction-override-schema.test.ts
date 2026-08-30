import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readdirSync("supabase/migrations")
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => readFileSync(`supabase/migrations/${file}`, "utf8"))
  .join("\n");

describe("transaction classification override schema", () => {
  it("stores the override on the existing owner-scoped annotation table", () => {
    expect(migrationSql).toContain(
      "add column if not exists display_category text",
    );
    expect(migrationSql).toContain(
      "add column if not exists cash_flow_classification text",
    );
  });

  it("restricts the cash-flow classification to explicit spend or income", () => {
    expect(migrationSql).toMatch(
      /cash_flow_classification in \('expense', 'income'\)/,
    );
  });

  it("keeps the annotation table keyed by user and transaction", () => {
    expect(migrationSql).toContain(
      "unique (user_id, transaction_id)",
    );
    expect(migrationSql).toContain(
      '"transaction_annotations_select_own"',
    );
  });
});