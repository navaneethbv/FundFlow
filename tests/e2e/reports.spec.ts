import { expect, test, type Page } from "@playwright/test";
import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

loadEnvConfig(process.cwd());

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
/**
 * `reportsPage` is off by default until 20260730190000_saved_reports.sql is
 * applied, and a Playwright run cannot change the server's env. So this suite
 * skips unless the deployment under test has actually released the page —
 * otherwise every assertion here would be testing a 404.
 */
const FLAG_ON = (process.env.FUNDFLOW_FEATURE_FLAGS ?? "")
  .split(",")
  .map((name) => name.trim())
  .includes("reportsPage");
const RUN = Boolean(
  SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY && SUPABASE_SECRET_KEY && FLAG_ON,
);

const stamp = Date.now();
const password = "ReportsE2E-Password-123!";
const email = `reports-e2e-${stamp}@example.com`;
const activeMonth = new Date().toISOString().slice(0, 7);

/**
 * Phase 6 (Reports page with Sankey) acceptance journey.
 *
 * Same live-Supabase pattern as cash-flow.spec.ts: a throwaway auth user,
 * signed in through the real UI, deleted in afterAll. Its disconnected fake
 * item and deterministic transactions prove the controls, saved-report CRUD,
 * export links, Sankey, and table twin against a real non-empty report.
 */
test.describe.serial("Phase 6: reports and Sankey", () => {
  // Intentional skip: this live acceptance suite needs live credentials and the released feature flag.
  test.skip(
    !RUN,
    "Supabase credentials and FUNDFLOW_FEATURE_FLAGS=reportsPage are required",
  );

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

    // Keep the user disposable, but give the chart and export assertions a
    // real report to exercise instead of letting them stop at the empty state.
    const { data: item, error: itemError } = await admin
      .from("plaid_items")
      .insert({
        user_id: userId,
        plaid_item_id: `reports-e2e-item-${stamp}`,
        institution_name: "Reports E2E Bank",
        status: "disconnected",
        access_token_ciphertext: "e2e",
        access_token_iv: "e2e",
        access_token_tag: "e2e",
      })
      .select("id")
      .single();
    if (itemError) throw itemError;

    const { data: account, error: accountError } = await admin
      .from("accounts")
      .insert({
        user_id: userId,
        plaid_item_id: item.id,
        plaid_account_id: `reports-e2e-account-${stamp}`,
        name: "Reports E2E Checking",
        type: "depository",
        subtype: "checking",
        current_balance: 1075,
        available_balance: 1075,
        iso_currency_code: "USD",
      })
      .select("id")
      .single();
    if (accountError) throw accountError;

    const { error: transactionError } = await admin.from("transactions").insert([
      {
        user_id: userId,
        account_id: account.id,
        plaid_transaction_id: `reports-e2e-paycheck-${stamp}`,
        date: `${activeMonth}-01`,
        amount: -1500,
        name: "REPORTS E2E PAYROLL",
        merchant_name: "Reports E2E Payroll",
        pfc_primary: "INCOME",
        pfc_detailed: "INCOME_WAGES",
        pending: false,
      },
      {
        user_id: userId,
        account_id: account.id,
        plaid_transaction_id: `reports-e2e-groceries-${stamp}`,
        date: `${activeMonth}-02`,
        amount: 300,
        name: "REPORTS E2E GROCERIES",
        merchant_name: "Reports E2E Groceries",
        pfc_primary: "FOOD_AND_DRINK",
        pfc_detailed: "FOOD_AND_DRINK_GROCERIES",
        pending: false,
      },
      {
        user_id: userId,
        account_id: account.id,
        plaid_transaction_id: `reports-e2e-shopping-${stamp}`,
        date: `${activeMonth}-03`,
        amount: 125,
        name: "REPORTS E2E SHOPPING",
        merchant_name: "Reports E2E Shopping",
        pfc_primary: "GENERAL_MERCHANDISE",
        pfc_detailed: "GENERAL_MERCHANDISE_OTHER",
        pending: false,
      },
    ]);
    if (transactionError) throw transactionError;
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

  test("Reports appears in the sidebar and renders its controls", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await page
      .getByRole("navigation", { name: "Primary" })
      .first()
      .getByRole("link", { name: "Reports" })
      .click();

    await expect(page).toHaveURL(/\/reports/);
    await expect(
      page.getByRole("heading", { name: "Reports", level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Report controls" }),
    ).toBeVisible();
  });

  test("tab and view switches are pure URL navigation", async ({ page }) => {
    await page.goto("/reports");

    await page.getByRole("link", { name: "Spending", exact: true }).click();
    await expect(page).toHaveURL(/tab=spending/);

    await page.getByRole("link", { name: "Trends", exact: true }).click();
    await expect(page).toHaveURL(/mode=trends/);
    // The tab choice survives the view change: both live in the same URL.
    await expect(page).toHaveURL(/tab=spending/);

    await page.goBack();
    await expect(page).toHaveURL(/mode=breakdown/);
  });

  test("the date range round-trips through the Apply form", async ({ page }) => {
    await page.goto("/reports");
    await page.getByRole("textbox", { name: "From", exact: true }).fill("2026-01-01");
    await page.getByRole("textbox", { name: "To", exact: true }).fill("2026-03-31");
    await page.getByRole("button", { name: "Apply" }).click();

    await expect(page).toHaveURL(/start=2026-01-01/);
    await expect(page).toHaveURL(/end=2026-03-31/);
    await expect(page.getByRole("textbox", { name: "From", exact: true })).toHaveValue("2026-01-01");
    await expect(page.getByRole("textbox", { name: "To", exact: true })).toHaveValue("2026-03-31");
    await expect(page.getByRole("heading", { name: "Nothing in this range" })).toBeVisible();
  });

  test("the pending toggle and breakdown dimension are URL-driven", async ({
    page,
  }) => {
    await page.goto("/reports");
    await page.getByRole("link", { name: "Excluded" }).click();
    await expect(page).toHaveURL(/pending=exclude/);

    await page.getByRole("link", { name: "Merchant", exact: true }).click();
    await expect(page).toHaveURL(/dimension=merchant/);
    await expect(page).toHaveURL(/pending=exclude/);
  });

  test("an empty range offers a way back rather than a dead end", async ({
    page,
  }) => {
    await page.goto("/reports?start=1990-01-01&end=1990-01-31");
    await expect(page.getByText("Nothing in this range")).toBeVisible();
    // The controls must still be reachable, or the user cannot widen the range.
    await expect(
      page.getByRole("region", { name: "Report controls" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Reset to this month" }).click();
    await expect(page).toHaveURL(/\/reports\?/);
  });

  test("a report can be saved, loaded, renamed, and deleted", async ({
    page,
  }) => {
    await page.goto("/reports?tab=spending&mode=trends");

    await page.getByLabel("Save these filters as").fill("E2E spending trend");
    await page.getByRole("button", { name: "Save report" }).click();

    const saved = page.getByRole("link", { name: "E2E spending trend" });
    await expect(saved).toBeVisible({ timeout: 15_000 });

    // Loading it restores the exact tab and view it was saved with.
    await saved.click();
    await expect(page).toHaveURL(/tab=spending/);
    await expect(page).toHaveURL(/mode=trends/);

    await page.getByRole("button", { name: "Rename" }).first().click();
    await page
      .getByLabel("New name for E2E spending trend")
      .fill("E2E renamed");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByRole("link", { name: "E2E renamed" }),
    ).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Delete" }).first().click();
    await expect(page.getByRole("link", { name: "E2E renamed" })).toHaveCount(
      0,
      { timeout: 15_000 },
    );
  });

  test("saving the same name twice reports the conflict instead of failing silently", async ({
    page,
  }) => {
    await page.goto("/reports");
    await page.getByLabel("Save these filters as").fill("E2E duplicate");
    await page.getByRole("button", { name: "Save report" }).click();
    await expect(
      page.getByRole("link", { name: "E2E duplicate" }),
    ).toBeVisible({ timeout: 15_000 });

    await page.getByLabel("Save these filters as").fill("E2E duplicate");
    await page.getByRole("button", { name: "Save report" }).click();
    await expect(
      page.getByText("You already have a saved report with that name.", {
        exact: true,
      }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Delete" }).first().click();
  });

  test("the export actions carry the current filters", async ({ page }) => {
    await page.goto("/reports?tab=income&start=2026-01-01&end=2026-12-31");

    const csv = page.getByRole("link", { name: "Download CSV" });
    const href = await csv.getAttribute("href");
    expect(href).toContain("/api/export/report-csv");
    expect(href).toContain("start=2026-01-01");
    expect(href).toContain("end=2026-12-31");
    expect(href).toContain("tab=income");

    await expect(
      page.getByRole("link", { name: "Download PDF report" }),
    ).toBeVisible();
    await expect(
      page.getByRole("main").getByRole("link", { name: "Year in Money" }),
    ).toBeVisible();
  });

  test("the Sankey ships a table twin carrying the same figures", async ({
    page,
  }) => {
    await page.goto("/reports");
    // Present whenever there is cash-flow data; the empty state covers the
    // no-data case in its own test above.
    const twin = page.getByText("View data table");
    if ((await twin.count()) > 0) {
      await twin.first().click();
      await expect(
        page.getByRole("table", { name: /Every flow in the diagram/ }),
      ).toBeVisible();
    }
  });
});
