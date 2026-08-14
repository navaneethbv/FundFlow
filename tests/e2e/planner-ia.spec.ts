import { expect, test, type Page } from "@playwright/test";
import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

loadEnvConfig(process.cwd());

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const RUN = Boolean(
  SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY && SUPABASE_SECRET_KEY,
);
const stamp = Date.now();
const password = "PlannerIaE2E-Password-123!";
const email = `planner-ia-e2e-${stamp}@example.com`;

/**
 * Phase 1 (Navigation and Information Architecture) acceptance journey.
 *
 * Follows the same live-Supabase pattern as accounts.spec.ts and
 * cash-flow.spec.ts: a throwaway auth user is created via the admin client,
 * signed in through the real UI, and deleted in afterAll. No household or
 * Plaid data is needed here -- this suite only exercises the app shell
 * (sidebar, its utility icon row, command palette), which renders the same
 * regardless of the signed-in user's data.
 */
test.describe.serial("Phase 1: navigation and information architecture", () => {
  // Intentional skip: this live acceptance suite needs disposable Supabase credentials.
  test.skip(!RUN, "Supabase browser and service credentials are required");

  let admin: SupabaseClient;
  let userId = "";

  test.beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SUPABASE_SECRET_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    userId = data.user.id;
  });

  test.afterAll(async () => {
    if (userId) await admin.auth.admin.deleteUser(userId);
  });

  async function signIn(page: Page) {
    await page.goto("/login");
    await page.getByPlaceholder("you@example.com").fill(email);
    await page.getByPlaceholder("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  }

  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test("every sidebar destination is reachable, not a 404", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    const sidebar = page
      .getByRole("navigation", { name: "Primary" })
      .first();

    // The sidebar hides flag-gated pages, so anything it does show has to
    // actually resolve. Reports used to be asserted absent; it ships now, and
    // the useful invariant is that no visible entry leads nowhere.
    const hrefs = await sidebar.getByRole("link").evaluateAll((links) =>
      links.map((link) => link.getAttribute("href")!).filter(Boolean),
    );
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      const res = await page.request.get(href);
      expect(res.status(), `${href} should not 404`).toBeLessThan(400);
    }

    await expect(sidebar.getByRole("link", { name: "Reports" })).toBeVisible();
    await expect(
      sidebar.getByRole("link", { name: "Recurring" }),
    ).toBeVisible();
    await expect(
      sidebar.getByRole("link", { name: "Dashboard" }),
    ).toBeVisible();
    await expect(
      sidebar.getByRole("link", { name: "Accounts" }),
    ).toBeVisible();
    await expect(
      sidebar.getByRole("link", { name: "Year in Money" }),
    ).toBeVisible();
  });

  test("search opens the command palette via the sidebar button and Cmd+K", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: /Search/ }).click();
    await expect(
      page.getByRole("dialog", { name: "Command palette" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("dialog", { name: "Command palette" }),
    ).toBeHidden();
    await page.keyboard.press("Meta+k");
    await expect(
      page.getByRole("dialog", { name: "Command palette" }),
    ).toBeVisible();
    // Command list is driven by the enabled nav items (Task 2), so the
    // Task 1 /wrapped gap regression is covered here too.
    await expect(
      page.getByRole("option", { name: /Year in Money/ }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("notifications and settings utility-icon links navigate correctly", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    // Notifications and Settings are also sidebar nav-list items (V1 keeps
    // both on purpose, so collapsing the sidebar never hides a
    // destination), so scope to the utility icon row's own nav landmark to
    // disambiguate from the nav-list copy.
    const utilities = page.getByRole("navigation", { name: "Shell utilities" });
    await utilities.getByRole("link", { name: /Notifications/ }).click();
    await expect(page).toHaveURL(/\/notifications$/);
    await page.goBack();
    await utilities.getByRole("link", { name: "Settings" }).click();
    await expect(page).toHaveURL(/\/settings$/);
  });

  test("sidebar collapses and restores, and persists across reload", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    const collapseButton = page.getByRole("button", {
      name: "Collapse sidebar",
    });
    // The toggle optimistically flips local state, then PATCHes
    // profiles.dashboard_prefs directly via supabase-js; wait for that
    // write to land before reloading, or the server-seeded initial state
    // can still reflect the pre-toggle value.
    const persisted = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().includes("/rest/v1/profiles"),
    );
    await collapseButton.click();
    await persisted;
    const expandButton = page.getByRole("button", { name: "Expand sidebar" });
    await expect(expandButton).toBeVisible();
    // Persisted to profiles.dashboard_prefs.sidebarCollapsed and re-seeded
    // server-side, so a reload must not flash back to expanded.
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Expand sidebar" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Expand sidebar" }).click();
    await expect(
      page.getByRole("button", { name: "Collapse sidebar" }),
    ).toBeVisible();
  });

  test("tablet uses the compact sidebar instead of a clipped navigation strip", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 900, height: 1000 });
    await page.goto("/dashboard");

    await expect(page.getByRole("complementary")).toBeVisible();
    const sidebar = page
      .getByRole("navigation", { name: "Primary" })
      .first();
    await expect(sidebar).toBeVisible();
    await expect(
      sidebar.getByRole("link", { name: "Settings" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Collapse sidebar" }),
    ).toBeHidden();
  });

  test("mobile navigation exposes primary destinations and a complete menu", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/dashboard");

    const mobileNav = page.getByRole("navigation", { name: "Primary" }).last();
    await expect(
      mobileNav.getByRole("link", { name: "Dashboard" }),
    ).toBeVisible();
    await expect(
      mobileNav.getByRole("link", { name: "Accounts" }),
    ).toBeVisible();
    await expect(
      mobileNav.getByRole("link", { name: "Transactions" }),
    ).toBeVisible();

    const moreButton = mobileNav.getByRole("button", { name: "More" });
    await expect(moreButton).toBeVisible();
    await moreButton.click();
    const allDestinations = page.getByRole("dialog", {
      name: "All navigation",
    });
    await expect(allDestinations).toBeVisible();
    await expect(
      allDestinations.getByRole("link", { name: "Settings" }),
    ).toBeVisible();
    await allDestinations.getByRole("link", { name: "Settings" }).click();
    await expect(page).toHaveURL(/\/settings$/);

    await page.goto("/dashboard");
    await expect(page.getByRole("button", { name: /Search/ })).toBeHidden();

    for (const theme of ["light", "dark"] as const) {
      await page.evaluate((nextTheme) => {
        localStorage.setItem("fundflow-theme", nextTheme);
      }, theme);
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute(
        "data-theme",
        theme,
      );
      const geometry = await page.evaluate(() => ({
        contentWidth: Math.max(
          document.documentElement.scrollWidth,
          document.body.scrollWidth,
        ),
        viewportWidth: document.documentElement.clientWidth,
      }));
      expect(geometry.contentWidth).toBeLessThanOrEqual(
        geometry.viewportWidth + 1,
      );

      const targets = mobileNav.locator("a, button");
      for (let index = 0; index < (await targets.count()); index += 1) {
        const box = await targets.nth(index).boundingBox();
        expect(box, "mobile navigation target must render").not.toBeNull();
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
    }
  });

  test("signed-out request to a brand-new private path redirects to login", async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    await page.goto("/budget");
    await expect(page).toHaveURL(/\/login$/);
  });
});
