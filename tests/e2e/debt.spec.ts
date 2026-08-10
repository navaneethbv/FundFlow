import { hasLiveCredentials, signIn, test, expect } from "./fixtures/authenticated";

test.describe("debt payoff", () => {
  // Skipped: E2E test requires live Supabase environment credentials.
  test.skip(!hasLiveCredentials, "Live Supabase credentials are required");

  test("compares avalanche and snowball projections with extra payment", async ({ page, account, seed }) => {
    await seed.linkedAccounts();
    await signIn(page, account);
    await page.goto("/debt");
    await expect(page.getByText("Quality Card", { exact: true })).toBeVisible();
    await expect(page.getByText("Debt-free projection", { exact: true })).toBeVisible();
    await page.getByLabel("Extra monthly payment").fill("250");
    await page.getByRole("button", { name: "Update projection" }).click();
    await expect(page).toHaveURL(/extra=250/);
    await page.getByRole("link", { name: "Snowball" }).click();
    await expect(page).toHaveURL(/strategy=snowball/);
    await expect(page.getByText("Snowball payoff order", { exact: true })).toBeVisible();
  });
});
