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
    expect(sql).toContain("p_payload is null");
    expect(sql).toContain("jsonb_typeof(p_payload) <> 'object'");
    expect(sql).toContain("not (p_payload ? 'candidates')");
    expect(sql).toContain("not (p_payload ? 'deduplications')");
    expect(sql).toContain("not (candidate_row ? 'stream_type')");
    expect(sql).toContain("jsonb_typeof(candidate_row->'stream_type') is distinct from 'string'");
    expect(sql).toContain("nullif(candidate_row->>'stream_type', '') is null");
    expect(sql).toContain("not (candidate_row ? 'transaction_ids')");
    expect(sql).toContain("jsonb_typeof(candidate_row->'transaction_ids') is distinct from 'array'");
    expect(sql).toContain("jsonb_array_length(candidate_row->'transaction_ids')");
    expect(sql).toContain("raise exception 'recurring_inferred_stream_not_owned'");
    expect(sql).toContain("on conflict (user_id, identity_key)");
    expect(sql).toContain("where source = 'inferred' and identity_key is not null");
    expect(sql).toContain("do nothing");
    expect(sql).toContain("returning id into stream_row_id");
    expect(sql).not.toContain("unique_violation");
    expect(sql).toContain("candidate_row->>'expected_amount'");
    expect(sql).toContain("coalesce(plaid.reviewed_at, inferred.reviewed_at)");
    expect(sql).toContain("source = 'inferred'");
    expect(sql).toContain("source = 'plaid'");
    expect(sql.indexOf("p_payload is null")).toBeLessThan(sql.indexOf("-- Candidate writes"));
    expect(sql.indexOf("-- Candidate writes")).toBeLessThan(sql.indexOf("-- Plaid state"));
    expect(sql.indexOf("raise exception 'recurring_inferred_stream_not_owned'")).toBeLessThan(sql.indexOf("update public.recurring_streams plaid"));
  });

  it("defines an atomic service-role-only Plaid snapshot RPC", () => {
    const sql = readFileSync(
      "supabase/migrations/20260830210000_reconcile_plaid_recurring_atomic.sql",
      "utf8",
    );

    expect(sql).toContain("create or replace function public.reconcile_plaid_recurring(");
    expect(sql).toContain("jsonb_typeof(p_payload->'streams') <> 'array'");
    expect(sql).toContain("jsonb_typeof(p_payload->'joins') <> 'array'");
    expect(sql).toContain("source = 'plaid'");
    expect(sql).toContain("recurring_plaid_account_not_owned");
    expect(sql).toContain("recurring_plaid_transaction_not_owned");
    expect(sql).toContain("delete from public.recurring_stream_transactions");
    expect(sql).toContain("update public.recurring_streams");
    expect(sql).toContain("revoke all on function public.reconcile_plaid_recurring(uuid, uuid, jsonb)");
    expect(sql).toContain("grant execute on function public.reconcile_plaid_recurring(uuid, uuid, jsonb)");
    expect(sql).toContain("set search_path = ''");
  });
});
