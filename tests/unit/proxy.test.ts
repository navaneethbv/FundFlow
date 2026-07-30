import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("proxy.ts default-deny for new private paths", () => {
  const proxyPath = resolve(process.cwd(), "proxy.ts");
  const source = readFileSync(proxyPath, "utf8");

  it("keeps PUBLIC_PAGE_PATHS to its exact known contents", () => {
    // Extract PUBLIC_PAGE_PATHS array from the source.
    // This guards against any accidental addition to the public allowlist,
    // including phase-1 destinations that should remain private.
    const allowlistMatch = source.match(
      /const\s+PUBLIC_PAGE_PATHS\s*=\s*\[([^\]]*)\]/,
    );
    expect(allowlistMatch).not.toBeNull();

    const allowlistString = allowlistMatch![1];

    // Parse the array: split by comma, trim whitespace, and remove quotes.
    const paths = allowlistString
      .split(",")
      .map((entry) => entry.trim().replace(/^"|"$/g, ""))
      .filter(Boolean);

    // Assert exact contents: only /login and /signup are public.
    // Any addition (e.g., /goals, /planner, or other phase-1 paths)
    // will fail this test, catching the regression at test time.
    expect(paths).toEqual(["/login", "/signup"]);
  });
});
