import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readdirSync("supabase/migrations")
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => readFileSync(`supabase/migrations/${file}`, "utf8"))
  .join("\n");

describe("import review notes/tags schema", () => {
  it("stages notes and tags on the review row", () => {
    expect(migrationSql).toContain("add column if not exists notes text");
    expect(migrationSql).toContain("add column if not exists tags text[]");
  });
});
