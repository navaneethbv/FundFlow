import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const MIGRATION = "20260830190000_hybrid_recurring_detection.sql";

const sql = readFileSync(
  path.join(process.cwd(), "supabase", "migrations", MIGRATION),
  "utf8",
);

describe("hybrid recurring detection migration contract", () => {
  it("adds source with plaid default and inferred membership", () => {
    expect(sql).toMatch(/source\s+text\s+not null\s+default 'plaid'/);
    expect(sql).toContain("source in ('plaid', 'inferred')");
  });

  it("adds identity_key, detection_version, and detection_evidence", () => {
    expect(sql).toContain("add column identity_key text");
    expect(sql).toMatch(/add column detection_version integer/);
    expect(sql).toMatch(/detection_version is null or detection_version > 0/);
    expect(sql).toMatch(/add column detection_evidence jsonb not null default '\{\}'::jsonb/);
    expect(sql).toContain("jsonb_typeof(detection_evidence) = 'object'");
  });

  it("prevents duplicate inferred rows per user identity with a partial unique index", () => {
    expect(sql).toContain("recurring_streams_inferred_identity_unique");
    expect(sql).toContain("where source = 'inferred' and identity_key is not null");
  });

  it("keeps an item+source+activity index for scoped reads", () => {
    expect(sql).toContain("recurring_streams_item_source_idx");
  });

  it("revokes direct authenticated writes on both recurring tables", () => {
    expect(sql).toContain("revoke insert, update, delete on public.recurring_streams from authenticated");
    expect(sql).toContain("revoke insert, update, delete on public.recurring_stream_transactions from authenticated");
  });

  it("does not add a row-level lock grant to authenticated", () => {
    expect(sql).not.toContain("for update to authenticated");
  });
});
