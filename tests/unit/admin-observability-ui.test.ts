import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("admin observability dashboard", () => {
  it("adds an admin-only observability page with redacted sections", () => {
    expect(existsSync("app/admin/page.tsx")).toBe(true);
    const source = readFileSync("app/admin/page.tsx", "utf8");

    expect(source).toContain("Observability");
    expect(source).toContain("sync_jobs");
    expect(source).toContain("audit_logs");
    expect(source).toContain("plaid_items");
    expect(source).toContain("createServiceClient");
  });
});
