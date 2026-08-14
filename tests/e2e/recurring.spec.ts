import { expect, test, type Page } from "@playwright/test";
import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expectNoHorizontalPageScroll } from "./layout-checks";

loadEnvConfig(process.cwd());

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const RUN = Boolean(
  SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY && SUPABASE_SECRET_KEY,
);
const FORECASTING_ON = (process.env.FUNDFLOW_FEATURE_FLAGS ?? "")
  .split(",")
  .map((name) => name.trim())
  .includes("forecastingPage");
const stamp = Date.now();
const password = "RecurringE2E-Password-123!";
const email = `recurring-e2e-${stamp}@example.com`;
const merchantName =
  "PAYPAL 401(K) SAVINGS PLAN AUTOMATIC CONTRIBUTION 7538";
const institutionName =
  "American Express Retirement and Investment Services";
// Anchoring the demo stream on today's date (rather than a fixed day-of-month
// like the 15th) keeps the fixture correct regardless of which day the suite
// actually runs on: a dueDate equal to "today" always resolves to the
// "upcoming" status (see expandStreamsForMonth), and today's date is always
// inside the page's default current-month view, so there is no month-end
// rollover risk from adding days to compute an anchor.
const today = new Date().toISOString().slice(0, 10);
const month = today.slice(0, 7);

/**
 * Phase 5 (Recurring) acceptance journey.
 *
 * Follows the same live-Supabase pattern as planner-ia.spec.ts and
 * budget.spec.ts: a throwaway user is created via the admin client, signed
 * in through the real UI, and deleted in afterAll. A household (owned by
 * the user) and one demo MATURE recurring stream with reviewed_at null are
 * seeded directly through the admin client, mirroring the fixture shape in
 * tests/integration/recurring-stream-rls.test.ts.
 */
test.describe.serial("Phase 5: recurring page", () => {
  // Intentional skip: this live acceptance suite needs disposable Supabase credentials.
  test.skip(!RUN, "Supabase browser and service credentials are required");
  test.setTimeout(120_000);

  let admin: SupabaseClient;
  let userId = "";
  let householdId = "";

  test.beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SUPABASE_SECRET_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: user, error: userError } = await admin.auth.admin.createUser(
      {
        email,
        password,
        email_confirm: true,
      },
    );
    if (userError) throw userError;
    userId = user.user.id;

    // A household the user owns is enough to make the "Household" scope
    // link/param resolve (parseFinancialScope only honors ids the RLS-bound
    // households query actually returns); no household_members row or
    // shared plaid_item is needed since this user's own rows are always
    // visible to themself regardless of scope.
    const { data: household, error: householdError } = await admin
      .from("households")
      .insert({ owner_user_id: userId, name: "Recurring E2E household" })
      .select("id")
      .single();
    if (householdError) throw householdError;
    householdId = household.id;

    const { data: item, error: itemError } = await admin
      .from("plaid_items")
      .insert({
        user_id: userId,
        plaid_item_id: `recurring-e2e-item-${stamp}`,
        institution_name: institutionName,
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
        plaid_account_id: `recurring-e2e-account-${stamp}`,
        name: "E2E Checking",
        type: "depository",
        subtype: "checking",
        current_balance: 2500,
        available_balance: 2500,
        iso_currency_code: "USD",
      })
      .select("id")
      .single();
    if (accountError) throw accountError;

    const { error: streamError } = await admin.from("recurring_streams").insert(
      {
        user_id: userId,
        plaid_item_id: item.id,
        account_id: account.id,
        stream_id: `recurring-e2e-stream-${stamp}`,
        stream_type: "outflow",
        description: merchantName,
        merchant_name: merchantName,
        average_amount: 42,
        last_amount: 42,
        frequency: "MONTHLY",
        status: "MATURE",
        category: "SUBSCRIPTION",
        is_active: true,
        predicted_next_date: today,
        last_date: today,
      },
    );
    if (streamError) throw streamError;

    const { error: syncError } = await admin.from("sync_jobs").insert({
      user_id: userId,
      plaid_item_id: item.id,
      status: "done",
      attempts: 1,
    });
    if (syncError) throw syncError;

    const { error: transactionError } = await admin.from("transactions").insert({
      user_id: userId,
      account_id: account.id,
      plaid_transaction_id: `responsive-e2e-transaction-${stamp}`,
      date: today,
      amount: 42,
      name: merchantName,
      merchant_name: merchantName,
      pfc_primary: "GENERAL_MERCHANDISE",
      pfc_detailed: "GENERAL_MERCHANDISE_OTHER",
      pending: false,
    });
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

  test("is reachable from the sidebar, reviews an occurrence, edits its amount, and preserves scope while navigating months", async ({
    page,
  }) => {
    const consoleIssues: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") {
        consoleIssues.push(message.text());
      }
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await signIn(page);
    const appOrigin = new URL(page.url()).origin;
    const failedAppRequests: string[] = [];
    page.on("requestfailed", (request) => {
      if (
        new URL(request.url()).origin === appOrigin &&
        request.failure()?.errorText !== "net::ERR_ABORTED"
      ) {
        failedAppRequests.push(
          `${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}`,
        );
      }
    });

    // Reachable from the sidebar, with the unreviewed-stream badge showing.
    await page.goto("/dashboard");
    const sidebar = page.getByRole("navigation", { name: "Primary" }).first();
    const recurringLink = sidebar.getByRole("link", { name: /Recurring/ });
    await expect(recurringLink).toBeVisible();
    await expect(recurringLink).toContainText("1");
    await recurringLink.click();
    await expect(page).toHaveURL(/\/recurring/);

    // The demo MATURE stream (reviewed_at null) shows the review banner.
    await expect(
      page.getByText(
        "There is 1 new recurring merchant for you to review.",
      ),
    ).toBeVisible();

    // Confirm it from the "Manage" tab; both the banner and the sidebar
    // badge clear (router.refresh() re-renders the server-rendered page,
    // which includes AppSidebar). "Manage" (the in-page tab, showing a
    // count) is deliberately a different label than the header's "Manage
    // recurring" button, which links to the same tab — same text would make
    // the two links ambiguous to a role-based locator.
    await page.getByRole("link", { name: /^Manage \(/ }).click();
    const manageRow = page.locator("li").filter({ hasText: merchantName });
    await expect(manageRow.getByRole("button", { name: "Confirm" })).toBeVisible();
    const confirmPatch = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().includes("/api/recurring") &&
        response.ok(),
    );
    await manageRow.getByRole("button", { name: "Confirm" }).click();
    await confirmPatch;
    await expect(
      page.getByText(
        "There is 1 new recurring merchant for you to review.",
      ),
    ).toBeHidden();
    await expect(
      page.getByRole("navigation", { name: "Primary" }).first().getByRole(
        "link",
        { name: /Recurring/ },
      ),
    ).not.toContainText(/[0-9]/);
    // The Confirm/Dismiss actions disappear once reviewed; the amount field
    // stays editable.
    await expect(manageRow.getByRole("button", { name: "Confirm" })).toHaveCount(0);

    // Editing the expected amount in "Manage" changes the Upcoming tab's total.
    // The field is untouched (no prior user_amount override), so it starts
    // empty and shows Plaid's tracked average only as a placeholder hint --
    // see Fix 2 of the whole-branch review: seeding the value itself from
    // averageAmount let tabbing past an untouched field silently convert it
    // into a permanent override.
    const amountInput = page.getByRole("spinbutton", {
      name: `Expected amount for ${merchantName}`,
    });
    await expect(amountInput).toHaveValue("");
    await expect(amountInput).toHaveAttribute("placeholder", "42");
    const amountPatch = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().includes("/api/recurring") &&
        response.ok(),
    );
    await amountInput.fill("55");
    await amountInput.blur();
    await amountPatch;
    await page.getByRole("link", { name: /^Upcoming \(/ }).click();
    const upcomingRow = page.locator("tr").filter({ hasText: merchantName });
    await expect(upcomingRow.getByText("$55.00", { exact: true })).toBeVisible();

    // Month navigation preserves scope in the URL.
    await page.goto(`/recurring?month=${month}&scope=${householdId}`);
    await expect(page).toHaveURL(new RegExp(`scope=${householdId}`));
    await page.getByRole("link", { name: "Next month" }).click();
    await expect(page).toHaveURL(new RegExp(`scope=${householdId}`));
    await expect(page).not.toHaveURL(new RegExp(`month=${month}&`));

    // Mobile viewport: no horizontal overflow on the occurrence list.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/recurring?month=${month}`);
    await expect(page.getByRole("heading", { name: "Recurring" })).toBeVisible();
    await expectNoHorizontalPageScroll(page);

    const unexpectedConsoleIssues = consoleIssues.filter(
      (message) =>
        !/^\[\.WebGL-/.test(message) &&
        message !== "No available adapters." &&
        !message.includes("Plaid link-initialize.js script was embedded more than once") &&
        !/^Failed to load resource: net::ERR_NAME_NOT_RESOLVED$/.test(
          message,
        ),
    );
    expect(pageErrors).toEqual([]);
    expect(failedAppRequests).toEqual([]);
    expect(unexpectedConsoleIssues).toEqual([]);
  });

  test("responsive signed-in surfaces contain long labels and preserve mobile interactions", async ({
    page,
  }) => {
    await signIn(page);
    await page.setViewportSize({ width: 390, height: 844 });

    await page.goto("/dashboard");
    // The greeting heading is dynamic (time-of-day word + display name), so
    // match its stable shape rather than a literal string (V1 shell
    // restructure replaced "Financial command center" with this greeting).
    await expect(
      page.getByRole("heading", { name: /^Good (morning|afternoon|evening),/ }),
    ).toBeVisible();

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

    const accountFilters = page
      .getByRole("navigation", { name: "Account filter" })
      .getByRole("link");
    for (let index = 0; index < (await accountFilters.count()); index += 1) {
      const box = await accountFilters.nth(index).boundingBox();
      expect(box, "account filter must render").not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }

    // Institutions explicitly: /settings lands on Profile, so the bare path
    // would not contain the institution row this asserts on.
    await page.goto("/settings?section=institutions");
    await expect(
      page.getByRole("heading", { name: "Settings" }),
    ).toBeVisible();
    const settingsGeometry = await page.evaluate(() => ({
      contentWidth: Math.max(
        document.documentElement.scrollWidth,
        document.body.scrollWidth,
      ),
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(settingsGeometry.contentWidth).toBeLessThanOrEqual(
      settingsGeometry.viewportWidth + 1,
    );

    const institutionRow = page.locator("li").filter({
      hasText: institutionName,
    });
    const institutionNameBox = await institutionRow
      .locator(":scope > span")
      .first()
      .boundingBox();
    const institutionActionsBox = await institutionRow
      .locator(":scope > span")
      .last()
      .boundingBox();
    expect(institutionNameBox).not.toBeNull();
    expect(institutionActionsBox).not.toBeNull();
    expect(institutionActionsBox!.y).toBeGreaterThanOrEqual(
      institutionNameBox!.y + institutionNameBox!.height,
    );

    const sectionPicker = page.getByRole("combobox", {
      name: "Settings section",
    });
    await expect(sectionPicker).toBeVisible();
    await expect(sectionPicker).toHaveValue("institutions");
    await sectionPicker.selectOption("security");
    await expect(page).toHaveURL(/section=security/);

    await page.goto("/transactions");
    const editor = page.getByRole("button", {
      name: "Add notes or splits",
    });
    await expect(editor).toBeVisible();
    const editorBox = await editor.boundingBox();
    expect(editorBox, "transaction editor must render").not.toBeNull();
    expect(editorBox!.width).toBeGreaterThanOrEqual(44);
    expect(editorBox!.height).toBeGreaterThanOrEqual(44);

    if (FORECASTING_ON) {
      await page.goto("/forecasting");
      await expect(
        page.getByRole("heading", { name: "Forecasting" }),
      ).toBeVisible();
      const startingValues = page.locator("dl > div");
      await expect(startingValues).toHaveCount(3);
      for (let index = 0; index < 3; index += 1) {
        const box = await startingValues.nth(index).boundingBox();
        expect(box, "forecast value must render").not.toBeNull();
        expect(box!.width).toBeGreaterThanOrEqual(250);
      }
    }
  });
});
