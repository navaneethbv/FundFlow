import { hasLiveCredentials, signIn, test, expect } from "./fixtures/authenticated";

test.describe("duplicate review", () => {
  // Skipped: E2E test requires live Supabase environment credentials.
  test.skip(!hasLiveCredentials, "Live Supabase credentials are required");

  test("confirms a cross-account duplicate, shows exclusion, and undoes it", async ({ page, account, seed }) => {
    await seed.duplicatePair();
    await signIn(page, account);
    await page.goto("/transactions");
    const review = page.getByRole("heading", { name: "Duplicate review" }).locator("xpath=ancestor::section");
    await expect(review.getByText("Corner Cafe", { exact: true }).first()).toBeVisible();
    await review.getByText("Keep this transaction", { exact: true }).first().click();
    await review.getByRole("button", { name: "Confirm duplicate" }).click();
    await expect(review.getByText("1 resolved duplicate", { exact: true })).toBeVisible();
    await expect(
      review.getByRole("status"),
    ).toHaveText(/All duplicate candidates reviewed/);
    await review.getByText("1 resolved duplicate", { exact: true }).click();
    await expect(review.getByText("Excluded duplicate", { exact: true })).toBeVisible();
    await page.reload();
    await page.getByText("1 resolved duplicate", { exact: true }).click();
    await expect(page.getByText("Excluded duplicate", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByRole("button", { name: "Confirm duplicate" })).toBeVisible();
  });

  test("keeps the ledger reachable at 390px with many candidates", async ({ page, account, seed }) => {
    await seed.duplicatePair();
    await seed.secondDuplicatePair();

    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, account);
    await page.goto("/transactions?month=2026-08");

    const review = page.getByRole("heading", { name: "Duplicate review" }).locator("xpath=ancestor::section");
    await expect(review).toBeVisible();
    // Two candidates, but only one full review form in the DOM.
    await expect(review).toContainText("2 duplicate candidates to review");
    await expect(review.getByRole("button", { name: "Confirm duplicate" })).toHaveCount(1);
    await expect(review.getByRole("button", { name: "Dismiss" })).toHaveCount(1);

    // The transaction count line and the ledger are reachable without scrolling
    // past an unbounded candidate stack: the review panel sits above them and
    // stays a single compact card.
    const ledger = page.getByText(/4 transactions in Aug 2026/, { exact: false });
    await expect(ledger).toBeVisible();
    await expect(page.getByText("Corner Cafe", { exact: true }).first()).toBeVisible();
  });
});
