import { expectNoHorizontalPageScroll } from "./layout-checks";
import { hasLiveCredentials, signIn, test, expect } from "./fixtures/authenticated";

test.describe("goals page", () => {
  // Skipped: E2E test requires live Supabase environment credentials.
  test.skip(!hasLiveCredentials, "Live Supabase credentials are required");

  test("renders shipped artwork and completes the four-step create flow", async ({
    page,
    account,
    seed,
  }) => {
    await seed.linkedAccounts();
    await seed.goal();
    await signIn(page, account);
    await page.goto("/goals");

    await expect(page.getByText("Emergency fund", { exact: true })).toBeVisible();
    await expect(page.locator('img[src="/goals/emergency-fund.svg"]')).toBeVisible();
    await page.getByRole("button", { name: "Add goal" }).first().click();
    const dialog = page.getByRole("dialog", { name: "New goal" });
    await dialog.getByRole("button", { name: /Vacation/ }).click();
    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(dialog.getByLabel("Goal name")).toHaveValue("Vacation");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByRole("button", { name: "Skip" }).click();
    await dialog.getByRole("button", { name: "Create goal" }).click();
    await expect(page.getByText("Vacation", { exact: true })).toBeVisible();

    await page.setViewportSize({ width: 430, height: 932 });
    await expectNoHorizontalPageScroll(page);
  });
});
