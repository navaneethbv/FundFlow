import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readdirSync("supabase/migrations")
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => readFileSync(`supabase/migrations/${file}`, "utf8"))
  .join("\n");

describe("transaction override ownership schema", () => {
  it("requires the referenced transaction to belong to the writer", () => {
    // The insert/update policies must verify the transaction is owned, not
    // just that the annotation's user_id matches (the M8 pattern).
    expect(migrationSql).toMatch(
      /"transaction_annotations_insert_own"[\s\S]{0,400}exists \(\s*select 1 from public\.transactions/,
    );
    expect(migrationSql).toMatch(
      /t\.id = transaction_annotations\.transaction_id\s+and t\.user_id = \(select auth\.uid\(\)\)/,
    );
  });
});