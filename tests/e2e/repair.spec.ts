import { hasLiveCredentials, signIn, test, expect } from "./fixtures/authenticated";

test.describe("repair", () => {
  // Intentional credential-gated live acceptance suite; it cannot run without
  // the external Supabase and Plaid test environment.
  test.skip(!hasLiveCredentials, "Live Supabase credentials are required"); // NOSONAR

  test("repair control reaches settings and surfaces bounded backfill progress", async ({
    page,
    account,
    seed,
  }) => {
    await seed.linkedAccounts();
    await signIn(page, account);
    await page.route("**/api/plaid/repair", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          status: "backfill_incomplete",
          pagesCompleted: 5,
          maxPages: 8,
          completed: false,
          added: 40,
          modified: 0,
          removed: 0,
        }),
      });
    });

    await page.goto("/settings?section=institutions");
    const row = page.getByText("Quality Bank").locator("xpath=ancestor::li");
    await row.getByRole("button", { name: "Repair" }).click();
    await expect(row.getByText(/History backfill reached 5 of 8 pages/)).toBeVisible();
    await expect(row.getByRole("button", { name: "Repair" })).toBeVisible();
  });

  test("repair explains when the provider still requires login and offers reconnect", async ({
    page,
    account,
    seed,
  }) => {
    await seed.linkedAccounts();
    await signIn(page, account);
    await page.route("**/api/plaid/repair", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          status: "institution_login_required",
          message: "Your bank requires you to log in again. Reconnect this institution to restore access.",
        }),
      });
    });

    await page.goto("/settings?section=institutions");
    const row = page.getByText("Quality Bank").locator("xpath=ancestor::li");
    await row.getByRole("button", { name: "Repair" }).click();
    await expect(row.getByText(/log in again/)).toBeVisible();
    // The repair state hands off to the Link update (reconnect) flow.
    await expect(row.getByRole("button", { name: "Reconnect" })).toBeVisible();
  });
});
