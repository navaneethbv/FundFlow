import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sw = readFileSync("public/sw.js", "utf8");

describe("service worker cache invalidation", () => {
  // A precached HTML document outlives the build that produced it: `CACHE_NAME`
  // is a constant, so the activate handler's cleanup (which only deletes caches
  // whose name differs) never fires. The stale document keeps referencing
  // hashed /_next chunks that the next deploy deletes, and those 404 — which
  // renders the app completely unstyled until the user clears their cache.
  it("never precaches HTML documents", () => {
    expect(sw).not.toContain("OFFLINE_URLS");
    expect(sw).not.toMatch(/addAll\(/);
  });

  it("caches only content-addressed asset types", () => {
    expect(sw).toContain("CACHEABLE_DESTINATIONS");
    // Documents render per-user financial data; they must stay out of the cache
    // both for staleness and because Cache Storage survives logout.
    expect(sw).not.toMatch(/CACHEABLE_DESTINATIONS\s*=\s*new Set\(\[[^\]]*"document"/);
  });

  it("serves navigations from the network only", () => {
    const navigationHandler = sw.slice(sw.indexOf('=== "navigate"'), sw.indexOf("CACHEABLE_DESTINATIONS.has"));
    expect(navigationHandler).not.toContain("caches.match");
  });

  it("does not write failed responses into the cache", () => {
    expect(sw).toMatch(/response\.ok/);
  });
});
