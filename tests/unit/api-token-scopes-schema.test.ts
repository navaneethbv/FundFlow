import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("API token scopes migration", () => {
  it("backfills legacy tokens and constrains stored capabilities", () => {
    const sql = readFileSync(
      "supabase/migrations/20261006120000_api_token_scopes.sql",
      "utf8",
    );
    expect(sql).toContain("add column if not exists scopes text[]");
    expect(sql).toContain("array['export:rows']::text[]");
    expect(sql).toContain("cardinality(scopes) = 0");
    expect(sql).toContain("mcp:aggregates");
    expect(sql).toContain("mcp:export-rows");
    expect(sql).toContain("api_tokens_scopes_check");
  });
});
