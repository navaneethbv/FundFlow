import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationSql = readdirSync("supabase/migrations")
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => readFileSync(`supabase/migrations/${file}`, "utf8"))
  .join("\n");

describe("credit card bill schema", () => {
  it("models statement balance, minimum payment, due date, and payment account", () => {
    expect(migrationSql).toContain("create table public.credit_card_bills");
    expect(migrationSql).toMatch(/statement_balance\s+numeric\(14, 2\)/);
    expect(migrationSql).toMatch(/minimum_payment\s+numeric\(14, 2\)/);
    expect(migrationSql).toMatch(/due_date\s+date/);
    expect(migrationSql).toContain("payment_account_id");
    expect(migrationSql).toMatch(/sync_timestamp\s+timestamptz/);
    expect(migrationSql).toContain("unique (user_id, account_id)");
  });

  it("keeps the bill table owner-scoped", () => {
    expect(migrationSql).toContain('"credit_card_bills_select_own"');
    expect(migrationSql).toContain("credit_card_bills_update_own");
    expect(migrationSql).toMatch(/credit_card_bills_update_own[\s\S]*payment_account_id is null/);
    expect(migrationSql).not.toContain("credit_card_bills_payment_account_owns");
  });
});
