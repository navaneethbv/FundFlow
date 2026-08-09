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

test.describe("responsive interaction matrix", () => {
  test.skip(!hasLiveCredentials, "Live Supabase credentials are required");

  test("keeps every primary route usable across themes and viewports", async ({ page, account, seed }) => {
    test.setTimeout(300_000);
    await seed.dashboardAndInvestments();
    await seed.goal();
    await signIn(page, account);
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
      const baseUrl = new URL(page.url());
      if (responseUrl.origin === baseUrl.origin && response.status() >= 400) {
        failedResponses.push(`${response.status()} ${responseUrl.pathname}`);
      }
    });

    for (const viewport of VIEWPORTS) {
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
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
    await page.getByRole("button", { name: /Account menu for/ }).click();
    await expect(page.getByRole("menu", { name: "Account menu" })).toBeVisible();

    await page.setViewportSize({ width: 375, height: 812 });
    await page.reload();
    await page.getByRole("button", { name: "More" }).click();
    await expect(page.getByRole("dialog", { name: "All navigation" })).toBeVisible();

    expect(pageErrors).toEqual([]);
    expect(failedResponses).toEqual([]);
    expect(consoleIssues).toEqual([]);
  });
});
