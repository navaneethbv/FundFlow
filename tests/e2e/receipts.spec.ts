import { hasLiveCredentials, signIn, test, expect } from "./fixtures/authenticated";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test.describe("receipt inbox", () => {
  test.skip(!hasLiveCredentials, "Live Supabase credentials are required");

  test("uploads, matches, ignores, restores, and deletes a private receipt", async ({ page, account, seed }) => {
    await seed.dashboardAndInvestments();
    await signIn(page, account);
    await page.goto("/transactions/receipts");
    await page.getByLabel("Image").setInputFiles({ name: "receipt.png", mimeType: "image/png", buffer: PNG });
    await page.getByLabel("Merchant (optional)").fill("Market");
    await page.getByLabel("Purchase date (optional)").fill("2026-08-05");
    await page.getByLabel("Total (optional)").fill("320");
    await page.getByRole("button", { name: "Upload receipt" }).click();
    await expect(page.getByRole("heading", { name: "Market" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open image" })).toHaveAttribute("href", /token=/);
    await page.getByRole("button", { name: "Attach" }).click();
    await expect(page.getByText("matched", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Restore" }).click();
    await page.getByRole("button", { name: "Ignore" }).click();
    await expect(page.getByText("ignored", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("No saved receipts", { exact: true })).toBeVisible();
  });
});
