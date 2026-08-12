import { expectNoHorizontalPageScroll } from "./layout-checks";
import { hasLiveCredentials, signIn, test, expect } from "./fixtures/authenticated";

test.describe("dashboard completion", () => {
  // Skipped: E2E test requires live Supabase environment credentials.
  test.skip(!hasLiveCredentials, "Live Supabase credentials are required");

  test("renders grouped budgets and investment movement, then persists customization", async ({
    page,
    account,
    seed,
  }) => {
    await seed.dashboardAndInvestments();
    await signIn(page, account);
    await page.goto("/dashboard");

    await expect(page.getByText("Fixed", { exact: true })).toBeVisible();
    await expect(page.getByText("Flexible", { exact: true })).toBeVisible();
    await expect(page.getByText("Non-monthly", { exact: true })).toBeVisible();
    await expect(page.getByText("Top movers", { exact: true })).toBeVisible();
    await expect(page.getByText("+$500.00 today", { exact: false })).toBeVisible();

    await page.getByRole("button", { name: "Customize" }).click();
    const dialog = page.getByRole("dialog", { name: "Customize widgets" });
    await dialog.getByLabel(/Investments/).uncheck();
    await dialog.getByRole("button", { name: "Save layout" }).click();
    await expect(page.getByText("Top movers", { exact: true })).toBeHidden();
    await page.reload();
    await expect(page.getByText("Top movers", { exact: true })).toBeHidden();

    await page.setViewportSize({ width: 375, height: 812 });
    await expectNoHorizontalPageScroll(page);
  });
});
