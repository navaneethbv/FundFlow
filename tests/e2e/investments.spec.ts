import { expectNoHorizontalPageScroll } from "./layout-checks";
import { hasLiveCredentials, signIn, test, expect } from "./fixtures/authenticated";

test.describe("investments page", () => {
  test.skip(!hasLiveCredentials, "Live Supabase credentials are required");

  test("renders holdings, allocation, performance, and movers at desktop and mobile", async ({
    page,
    account,
    seed,
  }) => {
    await seed.dashboardAndInvestments();
    await signIn(page, account);
    await page.goto("/investments");

    await expect(page.getByRole("heading", { name: "Holdings" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Allocation" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Performance" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Top movers" })).toBeVisible();
    await expect(page.getByText("FundFlow Index", { exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "+4.2%" })).toBeVisible();
    await expect(
      page.getByRole("table", { name: /history/, includeHidden: true }),
    ).toContainText("2026-08-09");

    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalPageScroll(page);
  });
});
