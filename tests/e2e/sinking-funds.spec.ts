import { hasLiveCredentials, test, expect } from "./fixtures/authenticated";

test.describe("recurring sinking funds", () => {
  test.skip(!hasLiveCredentials, "Live Supabase credentials are required");

  test("creates, edits, and removes an annual sinking fund", async ({ authenticatedPage: page }) => {
    test.setTimeout(60_000);
    await page.goto("/settings?section=categories");
    const panel = page.getByRole("heading", { name: "Sinking funds" }).locator("xpath=ancestor::section");
    await panel.getByLabel("Name").fill("Car insurance");
    await panel.getByLabel("Amount").fill("1200");
    await panel.getByLabel("Due date").fill("2027-01-15");
    await panel.getByLabel("Cadence").selectOption("annual");
    await panel.getByRole("button", { name: "Add fund" }).click();
    await expect(panel.getByText("Car insurance", { exact: true })).toBeVisible();
    await expect(panel.getByRole("listitem").getByText("Every year", { exact: true })).toBeVisible();
    await panel.getByRole("button", { name: "Edit" }).click();
    await panel.getByLabel("Amount").fill("1800");
    await panel.getByRole("button", { name: "Save changes" }).click();
    await expect(panel.getByText("$1,800.00", { exact: true })).toBeVisible();
    const deleteResponse = page.waitForResponse((response) =>
      response.request().method() === "DELETE" &&
      /\/api\/sinking-funds\/[^/]+$/.test(new URL(response.url()).pathname),
    );
    await panel.getByRole("button", { name: "Remove" }).click();
    expect((await deleteResponse).ok()).toBe(true);
    await expect(panel.getByText("Car insurance", { exact: true })).toBeHidden();
  });
});
