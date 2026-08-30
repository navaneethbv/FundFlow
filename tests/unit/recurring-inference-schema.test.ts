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

  it("defines an atomic service-role-only reconciliation RPC", () => {
    const sql = readFileSync(
      "supabase/migrations/20260830200000_reconcile_inferred_recurring_atomic.sql",
      "utf8",
    );

    expect(sql).toContain("create or replace function public.reconcile_inferred_recurring(");
    expect(sql).toContain("p_payload jsonb");
    expect(sql).toContain("returns jsonb");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("revoke all on function public.reconcile_inferred_recurring(uuid, uuid, jsonb)");
    expect(sql).toContain("from public, anon, authenticated");
    expect(sql).toContain("grant execute on function public.reconcile_inferred_recurring(uuid, uuid, jsonb)");
    expect(sql).toContain("to service_role");
    expect(sql).toContain("candidate_row->>'expected_amount'");
    expect(sql).toContain("coalesce(plaid.reviewed_at, inferred.reviewed_at)");
    expect(sql).toContain("source = 'inferred'");
    expect(sql).toContain("source = 'plaid'");
  });
});
