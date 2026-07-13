import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("weekly report scheduler", () => {
  it("uses GitHub Actions for the hourly Hobby-compatible trigger", () => {
    const workflow = readFileSync(
      ".github/workflows/weekly-report.yml",
      "utf8",
    );
    const vercel = readFileSync("vercel.json", "utf8");

    expect(workflow).toContain('cron: "0 * * * *"');
    expect(workflow).toContain("secrets.FUNDFLOW_APP_URL");
    expect(workflow).toContain("secrets.CRON_SECRET");
    expect(workflow).toContain("/api/cron/weekly-report");
    expect(vercel).not.toContain('/api/cron/weekly-report');
    expect(vercel).toContain('/api/cron/sync');
  });
});
