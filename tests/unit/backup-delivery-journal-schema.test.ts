import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * FF-10. Deduplication used to read audit_logs rows written by writeAudit(),
 * which swallows both the error PostgREST returns and any exception. This
 * pins the properties that make the journal durable instead.
 */
const sql = readFileSync(
  "supabase/migrations/20260905110000_backup_delivery_journal.sql",
  "utf8",
);

describe("backup delivery journal schema", () => {
  it("makes one-delivery-per-user-per-period a primary key, not a convention", () => {
    expect(sql).toMatch(/primary key \(user_id, period\)/);
  });

  it("separates the claim from the completion so a lost marker is detectable", () => {
    expect(sql).toMatch(/claimed_at\s+timestamptz not null default now\(\)/);
    expect(sql).toMatch(/delivered_at timestamptz\b/);
    // delivered_at must be nullable: an unclaimed-but-undelivered row is what a
    // retry is allowed to take over.
    expect(sql).not.toMatch(/delivered_at timestamptz not null/);
  });

  it("constrains the period to a calendar month key", () => {
    expect(sql).toMatch(/period\s+text not null check \(period ~ '\^\\d\{4\}-\\d\{2\}\$'\)/);
  });

  it("is cron-only: RLS on, no grants to anon or authenticated", () => {
    expect(sql).toMatch(/alter table public\.backup_deliveries enable row level security/);
    expect(sql).toMatch(/revoke all on table public\.backup_deliveries from anon, authenticated/);
    expect(sql).not.toMatch(/create policy/);
  });

  it("cascades with the user so a deleted account leaves no journal rows", () => {
    expect(sql).toMatch(/references auth\.users \(id\) on delete cascade/);
  });
});
