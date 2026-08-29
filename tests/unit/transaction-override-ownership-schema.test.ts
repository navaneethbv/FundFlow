import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readdirSync("supabase/migrations")
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => readFileSync(`supabase/migrations/${file}`, "utf8"))
  .join("\n");

describe("transaction override ownership schema", () => {
  it("requires the referenced transaction to belong to the writer", () => {
    const block = migrationSql.split("transaction_annotations").pop() ?? "";
    // The insert/update policies must verify the transaction is owned, not
    // just that the annotation's user_id matches (the M8 pattern).
    expect(block).toMatch(
      /transaction_annotations_insert_own[\s\S]*exists \(/,
    );
    expect(block).toMatch(
      /select 1 from public\.transactions t[\s\S]*t\.user_id = \(select auth\.uid\(\)\)/,
    );
  });
});