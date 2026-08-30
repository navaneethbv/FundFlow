import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("inferred recurring stream schema", () => {
  it("defines the inferred stream metadata and service-only writes", () => {
    const sql = readFileSync(
      "supabase/migrations/20260830190000_hybrid_recurring_detection.sql",
      "utf8",
    );

    expect(sql).toMatch(/source\s+text\s+not null\s+default 'plaid'/);
    expect(sql).toContain("source in ('plaid', 'inferred')");
    expect(sql).toContain("recurring_streams_inferred_identity_unique");
    expect(sql).toContain(
      "where source = 'inferred' and identity_key is not null",
    );
    expect(sql).toContain(
      "revoke insert, update, delete on public.recurring_streams from authenticated",
    );
    expect(sql).not.toContain("for update to authenticated");
  });
});
