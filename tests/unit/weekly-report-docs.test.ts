import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("weekly report documentation", () => {
  it("documents report timing and scheduler requirements", () => {
    const readme = readFileSync("README.md", "utf8");

    expect(readme).toContain("previous Monday through Sunday");
    expect(readme).toContain("Vercel Pro");
    expect(readme).toContain("signup email");
  });

  it("documents visual, privacy, and timezone QA", () => {
    const qa = readFileSync("docs/QA.md", "utf8");

    expect(qa).toContain("Weekly email visual QA");
    expect(qa).toContain("America/Los_Angeles");
    expect(qa).toContain("account masks");
    expect(qa).toContain("duplicate cron");
  });
});
