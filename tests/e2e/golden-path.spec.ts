import { expect, test, type Page } from "@playwright/test";

/**
 * Authenticated golden path. Runs only when credentials are provided:
 *
 *   E2E_EMAIL=you@example.com E2E_PASSWORD=... npm run test:e2e
 *
 * Requirements for the account:
 * - It must exist already (user creation belongs to the integration tests,
 *   which manage throwaway users; this suite never signs up or deletes).
 * - It must NOT have TOTP enrolled — the sign-in spec stops at the password
 *   step and an MFA prompt would stall it by design (AAL2 enforcement).
 * - Never point this at an account with real financial data you wouldn't
 *   want a CI log to mention counts/headers about.
 *
 * The Plaid Link spec additionally requires E2E_PLAID=1 and sandbox keys in
 * the server env. All specs share one signed-in browser context (serial).
 */

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const RUN_PLAID = process.env.E2E_PLAID === "1";

test.describe.serial("authenticated golden path", () => {
  test.skip(!EMAIL || !PASSWORD, "set E2E_EMAIL/E2E_PASSWORD to run");

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    page = await context.newPage();
  });

  test.afterAll(async () => {
    await page?.context().close();
  });

  test("signs in with email + password and lands on the dashboard", async () => {
    await page.goto("/login");
    await page.getByPlaceholder("you@example.com").fill(EMAIL!);
    await page.getByPlaceholder("Password").fill(PASSWORD!);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  });

  test("dashboard renders the command center (tiles when banks exist)", async () => {
    await page.goto("/dashboard");
    await expect(page.getByText("Financial command center")).toBeVisible();

    const emptyState = page.getByText("No banks connected");
    if (await emptyState.isVisible().catch(() => false)) {
      // Fresh account: the connect CTA replaces the tiles.
      await expect(page.getByRole("button", { name: "Connect a bank" })).toBeVisible();
      test.info().annotations.push({
        type: "note",
        description: "no banks connected — tile assertions skipped",
      });
      return;
    }
    // "—" values are fine; the tiles must render.
    await expect(page.getByText("Safe to spend")).toBeVisible();
    await expect(page.getByText("Emergency runway")).toBeVisible();
    await expect(page.getByText("Next paycheck")).toBeVisible();
  });

  test("transactions ledger renders with its search box", async () => {
    await page.goto("/transactions");
    await expect(page.getByPlaceholder("Search transactions")).toBeVisible();
  });

  test("settings renders budgets, export, and calendar-feed sections", async () => {
    await page.goto("/settings");
    await expect(page.getByText("Budget limits", { exact: true })).toBeVisible();
    await expect(page.getByText("Export data", { exact: true })).toBeVisible();
    await expect(page.getByText("Calendar feed", { exact: true })).toBeVisible();
  });

  test("CSV export honors the privacy contract (or the opt-out)", async () => {
    // page.request shares the signed-in context's cookies.
    const response = await page.request.get("/api/export/csv");
    expect([200, 403]).toContain(response.status());
    if (response.status() === 403) {
      test.info().annotations.push({
        type: "note",
        description: "export toggle is off for this account — 403 asserted",
      });
      return;
    }
    const body = await response.text();
    const header = body.split(/\r?\n/, 1)[0];
    expect(header).toBe("date,merchant,amount,category");
  });

  test("privacy blur toggle blurs and unblurs amounts", async () => {
    await page.goto("/dashboard");
    const html = page.locator("html");

    await page.getByRole("button", { name: "Hide amounts" }).click();
    await expect(html).toHaveAttribute("data-privacy", "blur");

    await page.getByRole("button", { name: "Show amounts" }).click();
    await expect(html).toHaveAttribute("data-privacy", "");
  });

  test("connects a sandbox bank through Plaid Link", async () => {
    test.skip(!RUN_PLAID, "set E2E_PLAID=1 (needs Plaid sandbox keys server-side)");
    // Plaid Link's iframe flow changes without notice (institution search,
    // phone-number pane, OAuth interstitials), so this spec is best-effort:
    // generous timeouts, and selector drift here means Plaid changed Link,
    // not that the app broke. Sandbox creds: user_good / pass_good.
    test.setTimeout(180_000);

    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Connect a bank" }).first().click();

    const link = page.frameLocator('iframe[id^="plaid-link"]');
    await link.getByRole("button", { name: /continue/i }).click({ timeout: 60_000 });

    // Pick the first sandbox institution surfaced by Link.
    await link.getByRole("button", { name: /continue|select/i }).first().click({ timeout: 30_000 }).catch(() => {});
    await link.locator('input[name="username"], #username').fill("user_good", { timeout: 30_000 });
    await link.locator('input[name="password"], #password').fill("pass_good");
    await link.getByRole("button", { name: /submit|sign in|continue/i }).click();
    await link.getByRole("button", { name: /continue|finish|done/i }).click({ timeout: 60_000 });

    // Back in the app: the exchange completes and accounts appear.
    await expect(page.getByText("No banks connected")).toBeHidden({ timeout: 60_000 });
  });
});
