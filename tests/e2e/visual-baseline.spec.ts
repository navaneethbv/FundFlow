import { hasLiveCredentials, signIn, test, expect } from "./fixtures/authenticated";

const ROUTES = [
  ["dashboard", "/dashboard"],
  ["accounts", "/accounts"],
  ["transactions", "/transactions"],
  ["cash-flow", "/cash-flow"],
  ["reports", "/reports"],
  ["budget", "/budget"],
  ["recurring", "/recurring"],
  ["goals", "/goals"],
  ["investments", "/investments"],
  ["debt", "/debt"],
  ["forecasting", "/forecasting"],
  ["advice", "/advice"],
  ["settings", "/settings"],
] as const;

test.describe("authenticated visual baseline", () => {
  test.skip(!hasLiveCredentials, "Live Supabase credentials are required");

  test("matches reviewed desktop routes in both themes", async ({ page, account, seed }) => {
    test.setTimeout(240_000);
    await seed.dashboardAndInvestments();
    await seed.goal();
    await signIn(page, account);
    await page.setViewportSize({ width: 1440, height: 900 });

    for (const theme of ["light", "dark"] as const) {
      for (const [name, route] of ROUTES) {
        await page.goto(route);
        await page.evaluate((value) => {
          localStorage.setItem("fundflow-theme", value);
          document.documentElement.dataset.theme = value;
          document.querySelectorAll("nextjs-portal").forEach((element) => {
            (element as HTMLElement).style.display = "none";
          });
        }, theme);
        await expect(page.locator("main h1")).toBeVisible();
        await expect(page).toHaveScreenshot(`${name}-${theme}-desktop.png`, {
          animations: "disabled",
          caret: "initial",
          fullPage: true,
          mask: [page.getByRole("button", { name: /Account menu for/ })],
        });
      }
    }
  });
});
