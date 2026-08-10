import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("ReportTransactions responsive table", () => {
  it("contains the wide table in a horizontal scroll region", () => {
    const source = readFileSync("components/reports/ReportTransactions.tsx", "utf8");
    expect(source).toContain('className="overflow-x-auto"');
    expect(source).toContain('className="min-w-[42rem] w-full text-sm"');
  });
});
