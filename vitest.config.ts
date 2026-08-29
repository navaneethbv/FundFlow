import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      // "server-only" throws outside RSC; stub it to a no-op for node tests.
      "server-only": fileURLToPath(
        new URL("./tests/stubs/server-only.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts", "scripts/**/*.test.ts"],
    // Integration tests hit a shared Supabase project (and its Auth rate limits),
    // so run test files sequentially to avoid cross-file interference.
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "lcov"],
      include: [
        "lib/**",
        "app/api/**",
        // Source only: scripts/ also holds .sql (check-rls.sql), which the
        // coverage remapper tries to parse as JS and errors on.
        "scripts/**/*.{ts,mjs,js}",
        "components/charts/**",
        "components/dashboard/metrics.ts",
        "components/dashboard/dashboard-view.ts",
        "components/settings/settings-nav.ts",
        "components/ui/RegisterRow.tsx",
        "components/dashboard/LedgerStrip.tsx",
        "components/accounts/AccountGroup.tsx",
        "components/accounts/NetWorthHero.tsx",
      ],
      exclude: [
        "lib/types.ts",
        "scripts/backfill-institution-logos.ts",
        // Operational one-off QA harness (drives a browser against a live
        // Supabase project); exercised by hand, not by the unit suite.
        "scripts/qa-large-data.mjs",
        "**/.DS_Store",
        "lib/graphify-out/**",
        "**/graphify-out/**",
      ],
      thresholds: {
        statements: 95,
        branches: 95,
        functions: 95,
        lines: 95,
      },
    },
  },
});
