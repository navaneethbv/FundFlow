import { defineConfig, devices } from "@playwright/test";

// Synthetic component fixtures only. No application server or database access.
export default defineConfig({
  testDir: "tests/browser",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: { ...devices["Desktop Chrome"], screenshot: "only-on-failure" },
});
