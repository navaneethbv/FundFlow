import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function findTestFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...findTestFiles(full));
    } else if (entry.endsWith(".test.ts") || entry.endsWith(".test.tsx")) {
      files.push(full);
    }
  }
  return files;
}

describe("Test assertion hygiene (T-7)", () => {
  it("flags test files where a test case body only contains toBeDefined() as its assertion", () => {
    const testFiles = findTestFiles("tests/unit");
    const violations: { file: string; match: string }[] = [];

    const singleToBeDefinedRegex =
      /(?:it|test)\s*\([^,]+,\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{([^}]*)\}\s*\)/g;

    for (const file of testFiles) {
      if (file.endsWith("test-assertion-hygiene.test.ts")) continue;
      const content = readFileSync(file, "utf8");
      let match: RegExpExecArray | null;
      while ((match = singleToBeDefinedRegex.exec(content)) !== null) {
        const body = match[1];
        const expectMatches = body.match(/expect\s*\(/g);
        if (
          expectMatches &&
          expectMatches.length === 1 &&
          body.includes(".toBeDefined()")
        ) {
          const otherAssertions = body.match(
            /\.(?:toBe|toEqual|toContain|toMatch|toBeGreaterThan|toBeLessThan|toThrow|toBeTruthy|toBeFalsy)\s*\(/g,
          );
          if (!otherAssertions || otherAssertions.length === 0) {
            violations.push({
              file,
              match: match[0].slice(0, 80).replace(/\s+/g, " "),
            });
          }
        }
      }
    }

    expect(
      violations,
      "Found tests where toBeDefined() is the sole assertion: " + JSON.stringify(violations, null, 2),
    ).toEqual([]);
  });
});
