import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readdirSync("supabase/migrations")
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => readFileSync(`supabase/migrations/${file}`, "utf8"))
  .join("\n");

describe("weekly insights schema", () => {
  it("stores delivery preferences and idempotent report attempts", () => {
    expect(sql).toContain(
      "daily_digest_email_enabled boolean not null default true",
    );
    expect(sql).toContain(
      "timezone text not null default 'America/Los_Angeles'",
    );
    expect(sql).toContain("create table public.weekly_report_deliveries");
    expect(sql).toContain("unique (user_id, period_start)");
  });

  it("allows owners to read delivery status without client writes", () => {
    expect(sql).toContain("weekly_report_deliveries_select_own");
    expect(sql).toContain(
      "grant select on public.weekly_report_deliveries to authenticated",
    );
    expect(sql).not.toContain(
      "grant select, insert, update, delete on public.weekly_report_deliveries",
    );
  });
});
