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
    expect(migrationSql).toContain("statement_balance numeric(14, 2)");
    expect(migrationSql).toContain("minimum_payment numeric(14, 2)");
    expect(migrationSql).toContain("due_date date");
    expect(migrationSql).toContain("payment_account_id");
    expect(migrationSql).toContain("sync_timestamp timestamptz");
    expect(migrationSql).toContain("unique (user_id, account_id)");
  });

  it("keeps the bill table owner-scoped", () => {
    expect(migrationSql).toContain('"credit_card_bills_select_own"');
    expect(migrationSql).toContain("credit_card_bills_payment_account_owns");
  });
});