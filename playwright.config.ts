import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config (roadmap 2.2). Two ways to run:
 *
 * - `E2E_BASE_URL=https://... npm run test:e2e` — against any deployment
 *   (no webServer is started).
 * - `npm run test:e2e` — starts `npm run dev` locally (needs .env.local);
 *   reuses an already-running dev server if one is up.
 *
 * Specs are `*.spec.ts` so the vitest include glob (which only matches
 * `.test.ts` files) never picks them up.
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
