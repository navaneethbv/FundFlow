import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("proxy.ts default-deny for new private paths", () => {
  it("does not add a hypothetical new phase-1 path to the public allowlist", () => {
    const proxyPath = resolve(process.cwd(), "proxy.ts");
    const source = readFileSync(proxyPath, "utf8");

    // Extract PUBLIC_PAGE_PATHS array from the source
    const allowlistMatch = source.match(
      /const\s+PUBLIC_PAGE_PATHS\s*=\s*\[([^\]]*)\]/,
    );
    expect(allowlistMatch).not.toBeNull();
    expect(allowlistMatch).toBeDefined();

    const allowlist = allowlistMatch![1];

    // Guard against accidental additions of phase-1 nav paths to the public allowlist.
    // This path should remain private (protected by the default-deny redirect in proxy.ts).
    expect(allowlist).not.toContain("/planner-ia-check");
    expect(allowlist).not.toContain("/goals-check");
    expect(allowlist).not.toContain("/milestones-check");
  });

  it("preserves the intended public paths", () => {
    const proxyPath = resolve(process.cwd(), "proxy.ts");
    const source = readFileSync(proxyPath, "utf8");

    const allowlistMatch = source.match(
      /const\s+PUBLIC_PAGE_PATHS\s*=\s*\[([^\]]*)\]/,
    );
    expect(allowlistMatch).not.toBeNull();

    const allowlist = allowlistMatch![1];

    // Verify that intended public paths remain (regression guard for the opposite direction).
    expect(allowlist).toContain("/login");
    expect(allowlist).toContain("/signup");
  });
});
