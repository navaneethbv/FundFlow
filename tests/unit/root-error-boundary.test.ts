import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Root error boundary (frontend-review R1): a crash on any route without its
 * own error.tsx must land in the app's shell-styled boundary, not Next's
 * default production error page. Source-level checks per the
 * command-palette.test.ts convention.
 */
describe("root error boundary", () => {
  it("exists at the app root", () => {
    expect(existsSync("app/error.tsx")).toBe(true);
  });

  it("is a client component with a retry", () => {
    const source = readFileSync("app/error.tsx", "utf8");
    expect(source).toContain('"use client"');
    expect(source).toContain("retry");
    expect(source).not.toContain("reset");
    expect(source).toContain("Try again");
  });

  it("uses the re-fetching recovery prop in every touched route boundary", () => {
    for (const file of [
      "app/budget/error.tsx",
      "app/cash-flow/error.tsx",
      "app/recurring/error.tsx",
    ]) {
      const source = readFileSync(file, "utf8");
      expect(source, file).toContain("retry");
      expect(source, file).not.toContain("reset");
    }
  });

  it("speaks the register's error voice: what happened, what was not affected", () => {
    const source = readFileSync("app/error.tsx", "utf8");
    // Error copy does not apologize and does not blame the user; it states
    // the state and the recovery. The data-unchanged reassurance is the
    // register's established pattern (see app/budget/error.tsx).
    expect(source).toMatch(/not (changed|affected)/);
  });

  it("stays generic about the surface, since it can fire on any route", () => {
    const source = readFileSync("app/error.tsx", "utf8");
    // A root boundary must not name a specific feature.
    expect(source).not.toMatch(/Budget|Transactions|Dashboard|Reports/);
  });
});
