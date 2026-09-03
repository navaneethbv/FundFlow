import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("smart-rules database contract", () => {
  it("allows the regex match type exposed by the settings UI", () => {
    const sql = readdirSync("supabase/migrations")
      .filter((name) => name.endsWith(".sql"))
      .map((name) => readFileSync(`supabase/migrations/${name}`, "utf8"))
      .join("\n");

    expect(sql).toMatch(
      /merchant_rules_match_type_check[\s\S]*match_type\s+in\s*\([^)]*'regex'/i,
    );
  });
});
