import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readdirSync("supabase/migrations")
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => readFileSync(`supabase/migrations/${file}`, "utf8"))
  .join("\n");

describe("life event schema", () => {
  it("allows a zero amount only for retirement events", () => {
    expect(migrationSql).toMatch(
      /event_type\s*=\s*'retirement'[\s\S]*amount\s*=\s*0[\s\S]*amount\s*>\s*0/,
    );
  });
});
