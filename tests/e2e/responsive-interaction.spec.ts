import type { Page } from "@playwright/test";
import { expectNoHorizontalPageScroll } from "./layout-checks";
import { isKnownEnvironmentNoise } from "./console-noise";
import { hasLiveCredentials, signIn, test, expect } from "./fixtures/authenticated";

const ROUTES = [
  "/dashboard",
  "/accounts",
  "/transactions",
  "/cash-flow",
  "/reports",
  "/budget",
  "/recurring",
  "/goals",
  "/investments",
  "/debt",
  "/forecasting",
  "/advice",
  "/notifications",
  "/settings",
] as const;

const VIEWPORTS = [
  { name: "phone", width: 375, height: 812 },
  { name: "wide-phone", width: 430, height: 932 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

function observePage(page: Page) {
  const consoleIssues: string[] = [];
  const pageErrors: string[] = [];
  const failedResponses: string[] = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type()) && !isKnownEnvironmentNoise(message.text())) {
      consoleIssues.push(message.text());
    }
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    const responseUrl = new URL(response.url());
    const pageUrl = new URL(page.url());
    if (responseUrl.origin === pageUrl.origin && response.status() >= 400) {
      failedResponses.push(`${response.status()} ${responseUrl.pathname}`);
    }
  });
  return { consoleIssues, pageErrors, failedResponses };
}

test.describe("responsive interaction matrix", () => {
  // Skipped: E2E test requires live Supabase environment credentials.
  test.skip(!hasLiveCredentials, "Live Supabase credentials are required");

  for (const viewport of VIEWPORTS) {
    test(`${viewport.name} keeps every primary route usable in both themes`, async ({ page, account, seed }) => {
      test.setTimeout(180_000);
      await seed.dashboardAndInvestments();
      await seed.goal();
      await signIn(page, account);
      const issues = observePage(page);
      await page.setViewportSize(viewport);

      for (const theme of ["light", "dark"] as const) {
        for (const route of ROUTES) {
          await page.goto(route);
          await page.evaluate((value) => {
            localStorage.setItem("fundflow-theme", value);
            document.documentElement.dataset.theme = value;
            document.querySelectorAll("nextjs-portal").forEach((element) => {
              (element as HTMLElement).style.display = "none";
            });
          }, theme);
          await expect(page.locator("main h1")).toBeVisible();
          await expectNoHorizontalPageScroll(page);
        }
      }

      expect(issues.pageErrors).toEqual([]);
      expect(issues.failedResponses).toEqual([]);
      expect(issues.consoleIssues).toEqual([]);
    });
  }

  test("desktop and mobile shell states remain reachable", async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard");
    await page.evaluate(() => {
      document.querySelectorAll("nextjs-portal").forEach((element) => {
        (element as HTMLElement).style.display = "none";
      });
    });
    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
    await page.getByRole("button", { name: /Account menu for/ }).click();
    await expect(page.getByRole("menu", { name: "Account menu" })).toBeVisible();

    await page.setViewportSize({ width: 375, height: 812 });
    await page.reload();
    await page.getByRole("button", { name: "More" }).click();
    await expect(page.getByRole("dialog", { name: "All navigation" })).toBeVisible();
  });
});
