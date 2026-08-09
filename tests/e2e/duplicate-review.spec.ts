import { hasLiveCredentials, signIn, test, expect } from "./fixtures/authenticated";

test.describe("duplicate review", () => {
  test.skip(!hasLiveCredentials, "Live Supabase credentials are required");

  test("confirms a cross-account duplicate, shows exclusion, and undoes it", async ({ page, account, seed }) => {
    await seed.duplicatePair();
    await signIn(page, account);
    await page.goto("/transactions");
    const review = page.getByRole("heading", { name: "Duplicate review" }).locator("xpath=ancestor::section");
    await expect(review.getByText("Corner Cafe", { exact: true }).first()).toBeVisible();
    await review.getByText("Keep this transaction", { exact: true }).first().click();
    await review.getByRole("button", { name: "Confirm duplicate" }).click();
    await expect(review.getByText("Excluded duplicate", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText("Excluded duplicate", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByRole("button", { name: "Confirm duplicate" })).toBeVisible();
  });
});
