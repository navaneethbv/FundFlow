import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260729210000_budget_groups.sql",
  "utf8",
);
const selectPolicyMigration = readFileSync(
  "supabase/migrations/20260730015500_budget_select_policy.sql",
  "utf8",
);

describe("Phase 4 budget schema", () => {
  it("secures period rows with explicit grants and owner-linked write policies", () => {
    expect(migration).toContain("create trigger budget_periods_set_updated_at");
    expect(migration).toContain(
      "grant select, insert, update, delete on table public.budget_periods to authenticated",
    );
    expect(migration).toContain(
      "revoke all on table public.budget_periods from anon",
    );
    expect(migration).toContain("alter table public.budget_periods enable row level security");
    expect(migration).toContain(
      "create index if not exists budgets_household_id_idx",
    );
    expect(migration.match(/b\.user_id = \(select auth\.uid\(\)\)/g)).toHaveLength(4);
    expect(migration.match(/user_id = \(select auth\.uid\(\)\)/g)?.length).toBeGreaterThanOrEqual(6);
  });

  it("defines one restricted security-invoker function for atomic updates", () => {
    expect(migration).toContain(
      "create or replace function public.update_budget_period",
    );
    expect(migration).toContain("security invoker");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain(
      "revoke execute on function public.update_budget_period",
    );
    expect(migration).toContain(
      "grant execute on function public.update_budget_period",
    );
    expect(migration).toContain("raise sqlstate 'P0002'");
    expect(migration).toContain(
      "on conflict on constraint budget_periods_budget_id_month_key",
    );
  });

  it("uses one authenticated read policy for own and household budgets", () => {
    expect(selectPolicyMigration).toContain(
      'drop policy if exists "budgets_select_own"',
    );
    expect(selectPolicyMigration).toContain(
      'drop policy if exists "budgets_select_household"',
    );
    expect(selectPolicyMigration).toContain(
      'create policy "budgets_select_visible"',
    );
    expect(selectPolicyMigration).toContain("to authenticated");
    expect(selectPolicyMigration).toContain(
      "user_id = (select auth.uid())",
    );
    expect(selectPolicyMigration).toContain(
      "public.is_household_member(household_id)",
    );
  });
});
