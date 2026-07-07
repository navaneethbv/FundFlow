import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("roadmap QA documentation", () => {
  it("documents Plaid browser E2E, mobile QA, smoke tests, and maintenance", () => {
    expect(existsSync("docs/QA.md")).toBe(true);
    const source = readFileSync("docs/QA.md", "utf8");

    expect(source).toContain("Plaid Sandbox Browser E2E");
    expect(source).toContain("Mobile QA Matrix");
    expect(source).toContain("Browser Smoke Suite");
    expect(source).toContain("Dependency And Security Maintenance");
  });
});
