import { expect, test, type Page } from "@playwright/test";
import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import path from "node:path";

loadEnvConfig(process.cwd());

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const RUN = Boolean(
  SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY && SUPABASE_SECRET_KEY,
);
const SCREENSHOT_DIR = process.env.BUDGET_E2E_SCREENSHOT_DIR;
const stamp = Date.now();
const password = "BudgetE2E-Password-123!";
const ownerEmail = `budget-e2e-owner-${stamp}@example.com`;
const memberEmail = `budget-e2e-member-${stamp}@example.com`;
const month = new Date().toISOString().slice(0, 7);
const year = Number(month.slice(0, 4));
const decadeStart = Math.floor(year / 10) * 10;

function shiftMonth(value: string, delta: number): string {
  const [baseYear, oneBasedMonth] = value.split("-").map(Number);
  const total = baseYear! * 12 + oneBasedMonth! - 1 + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

function transactionDate(value: string, day: number): string {
  return `${value}-${String(day).padStart(2, "0")}`;
}

test.describe.serial("budget page", () => {
  test.skip(!RUN, "Supabase browser and service credentials are required");
  test.setTimeout(180_000);

  let admin: SupabaseClient;
  let ownerId = "";
  let memberId = "";
  let householdId = "";

  test.beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SUPABASE_SECRET_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: owner, error: ownerError } =
      await admin.auth.admin.createUser({
        email: ownerEmail,
        password,
        email_confirm: true,
      });
    if (ownerError) throw ownerError;
    ownerId = owner.user.id;

    const { data: member, error: memberError } =
      await admin.auth.admin.createUser({
        email: memberEmail,
        password,
        email_confirm: true,
      });
    if (memberError) throw memberError;
    memberId = member.user.id;

    const { data: household, error: householdError } = await admin
      .from("households")
      .insert({
        owner_user_id: ownerId,
        name: "Budget E2E household",
      })
      .select("id")
      .single();
    if (householdError) throw householdError;
    householdId = household.id;

    const { error: membershipError } = await admin
      .from("household_members")
      .insert({
        household_id: householdId,
        user_id: memberId,
        role: "member",
        status: "active",
      });
    if (membershipError) throw membershipError;

    const { data: ownerItem, error: ownerItemError } = await admin
      .from("plaid_items")
      .insert({
        user_id: ownerId,
        plaid_item_id: `budget-owner-item-${stamp}`,
        institution_name: "Budget Test Bank",
        status: "disconnected",
        access_token_ciphertext: "e2e",
        access_token_iv: "e2e",
        access_token_tag: "e2e",
      })
      .select("id")
      .single();
    if (ownerItemError) throw ownerItemError;

    const { data: memberItem, error: memberItemError } = await admin
      .from("plaid_items")
      .insert({
        user_id: memberId,
        plaid_item_id: `budget-member-item-${stamp}`,
        institution_name: "Shared Budget Bank",
        status: "disconnected",
        shared_household_id: householdId,
        access_token_ciphertext: "e2e",
        access_token_iv: "e2e",
        access_token_tag: "e2e",
      })
      .select("id")
      .single();
    if (memberItemError) throw memberItemError;

    const { data: ownerAccounts, error: ownerAccountsError } = await admin
      .from("accounts")
      .insert([
        {
          user_id: ownerId,
          plaid_item_id: ownerItem.id,
          plaid_account_id: `budget-usd-account-${stamp}`,
          name: "USD Checking",
          type: "depository",
          subtype: "checking",
          current_balance: 5000,
          available_balance: 5000,
          iso_currency_code: "USD",
        },
        {
          user_id: ownerId,
          plaid_item_id: ownerItem.id,
          plaid_account_id: `budget-cad-account-${stamp}`,
          name: "CAD Checking",
          type: "depository",
          subtype: "checking",
          current_balance: 1000,
          available_balance: 1000,
          iso_currency_code: "CAD",
        },
      ])
      .select("id,iso_currency_code");
    if (ownerAccountsError) throw ownerAccountsError;
    const usdAccountId = ownerAccounts.find(
      (account) => account.iso_currency_code === "USD",
    )!.id;
    const cadAccountId = ownerAccounts.find(
      (account) => account.iso_currency_code === "CAD",
    )!.id;

    const { data: memberAccount, error: memberAccountError } = await admin
      .from("accounts")
      .insert({
        user_id: memberId,
        plaid_item_id: memberItem.id,
        plaid_account_id: `budget-shared-account-${stamp}`,
        name: "Shared Checking",
        type: "depository",
        subtype: "checking",
        current_balance: 900,
        available_balance: 900,
        iso_currency_code: "USD",
      })
      .select("id")
      .single();
    if (memberAccountError) throw memberAccountError;

    const trailingMonths = [-3, -2, -1].map((offset) =>
      shiftMonth(month, offset),
    );
    const ownerTransactions = [
      {
        key: "paycheck",
        accountId: usdAccountId,
        date: transactionDate(month, 1),
        amount: -3000,
        merchant: "Test Payroll",
        group: "INCOME",
        category: "INCOME_WAGES",
        pending: false,
      },
      {
        key: "split-expense",
        accountId: usdAccountId,
        date: transactionDate(month, 2),
        amount: 100,
        merchant: "Family Market",
        group: "FOOD_AND_DRINK",
        category: "FOOD_AND_DRINK_GROCERIES",
        pending: false,
      },
      {
        key: "ordinary-expense",
        accountId: usdAccountId,
        date: transactionDate(month, 3),
        amount: 200,
        merchant: "Raw Cafe",
        group: "GENERAL_MERCHANDISE",
        category: "GENERAL_MERCHANDISE_OTHER",
        pending: false,
      },
      {
        key: "transfer",
        accountId: usdAccountId,
        date: transactionDate(month, 4),
        amount: 500,
        merchant: "Card Payment",
        group: "LOAN_PAYMENTS",
        category: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
        pending: false,
      },
      {
        key: "charge",
        accountId: usdAccountId,
        date: transactionDate(month, 5),
        amount: 50,
        merchant: "Returned Store",
        group: "GENERAL_MERCHANDISE",
        category: "GENERAL_MERCHANDISE_OTHER",
        pending: false,
      },
      {
        key: "refund",
        accountId: usdAccountId,
        date: transactionDate(month, 6),
        amount: -50,
        merchant: "Returned Store",
        group: "GENERAL_MERCHANDISE",
        category: "GENERAL_MERCHANDISE_OTHER",
        pending: false,
      },
      {
        key: "pending",
        accountId: usdAccountId,
        date: transactionDate(month, 7),
        amount: 25,
        merchant: "Pending Store",
        group: "GENERAL_MERCHANDISE",
        category: "GENERAL_MERCHANDISE_OTHER",
        pending: true,
      },
      {
        key: "cad-expense",
        accountId: cadAccountId,
        date: transactionDate(month, 8),
        amount: 100,
        merchant: "Canadian Store",
        group: "GENERAL_MERCHANDISE",
        category: "GENERAL_MERCHANDISE_OTHER",
        pending: false,
      },
      ...trailingMonths.flatMap((trailingMonth, index) => [
        {
          key: `rent-${index}`,
          accountId: usdAccountId,
          date: transactionDate(trailingMonth, 10),
          amount: 1200,
          merchant: "Test Landlord",
          group: "HOUSING",
          category: "RENT",
          pending: false,
        },
      ]),
      {
        key: "current-rent",
        accountId: usdAccountId,
        date: transactionDate(month, 10),
        amount: 1200,
        merchant: "Test Landlord",
        group: "HOUSING",
        category: "RENT",
        pending: false,
      },
    ];
    const { data: insertedTransactions, error: transactionError } =
      await admin
        .from("transactions")
        .insert(
          ownerTransactions.map((transaction) => ({
            user_id: ownerId,
            account_id: transaction.accountId,
            plaid_transaction_id: `budget-${transaction.key}-${stamp}`,
            date: transaction.date,
            amount: transaction.amount,
            name: transaction.merchant.toUpperCase(),
            merchant_name: transaction.merchant,
            pfc_primary: transaction.group,
            pfc_detailed: transaction.category,
            pending: transaction.pending,
          })),
        )
        .select("id,plaid_transaction_id");
    if (transactionError) throw transactionError;
    const transactionIds = new Map(
      insertedTransactions.map((transaction) => [
        transaction.plaid_transaction_id
          .replace("budget-", "")
          .replace(`-${stamp}`, ""),
        transaction.id,
      ]),
    );

    const { data: sharedTransaction, error: sharedError } = await admin
      .from("transactions")
      .insert({
        user_id: memberId,
        account_id: memberAccount.id,
        plaid_transaction_id: `budget-shared-expense-${stamp}`,
        date: transactionDate(month, 9),
        amount: 75,
        name: "SHARED MARKET",
        merchant_name: "Shared Market",
        pfc_primary: "FOOD_AND_DRINK",
        pfc_detailed: "FOOD_AND_DRINK_GROCERIES",
        pending: false,
      })
      .select("id")
      .single();
    if (sharedError) throw sharedError;

    const { error: splitError } = await admin
      .from("transaction_splits")
      .insert([
        {
          user_id: ownerId,
          transaction_id: transactionIds.get("split-expense"),
          category: "Produce",
          amount: 40,
        },
        {
          user_id: ownerId,
          transaction_id: transactionIds.get("split-expense"),
          category: "Household",
          amount: 60,
        },
        {
          user_id: memberId,
          transaction_id: sharedTransaction.id,
          category: "Shared groceries",
          amount: 30,
        },
        {
          user_id: memberId,
          transaction_id: sharedTransaction.id,
          category: "Shared dining",
          amount: 45,
        },
      ]);
    if (splitError) throw splitError;

    const { error: refundError } = await admin
      .from("linked_refunds")
      .insert({
        user_id: ownerId,
        charge_transaction_id: transactionIds.get("charge"),
        refund_transaction_id: transactionIds.get("refund"),
        amount: 50,
      });
    if (refundError) throw refundError;

    const { error: ruleError } = await admin
      .from("merchant_rules")
      .insert({
        user_id: ownerId,
        match_type: "merchant",
        pattern: "Raw Cafe",
        display_name: "Neighborhood Cafe",
        category: null,
        enabled: true,
      });
    if (ruleError) throw ruleError;

    const { error: overrideError } = await admin
      .from("category_overrides")
      .insert({
        user_id: ownerId,
        source_category: "GENERAL_MERCHANDISE",
        display_category: "Shopping",
      });
    if (overrideError) throw overrideError;

    const { data: budgets, error: budgetError } = await admin
      .from("budgets")
      .insert([
        {
          user_id: ownerId,
          category: "INCOME_WAGES",
          monthly_limit: 3000,
          group_name: "income",
          rollover_enabled: false,
        },
        {
          user_id: ownerId,
          category: "GROCERIES",
          monthly_limit: 500,
          group_name: "flexible",
          rollover_enabled: true,
        },
      ])
      .select("id,category");
    if (budgetError) throw budgetError;
    const groceriesBudgetId = budgets.find(
      (budget) => budget.category === "GROCERIES",
    )!.id;
    const { error: periodError } = await admin
      .from("budget_periods")
      .insert({
        user_id: ownerId,
        budget_id: groceriesBudgetId,
        month: `${shiftMonth(month, -1)}-01`,
        planned: 500,
      });
    if (periodError) throw periodError;

    const dueDate = new Date(`${month}-01T00:00:00.000Z`);
    dueDate.setUTCMonth(dueDate.getUTCMonth() + 6);
    const { error: fundError } = await admin.from("sinking_funds").insert({
      user_id: ownerId,
      name: "Annual Insurance",
      target_amount: 600,
      due_date: dueDate.toISOString().slice(0, 10),
      cycle_anchor_date: dueDate.toISOString().slice(0, 10),
    });
    if (fundError) throw fundError;

    const { error: recurringError } = await admin
      .from("recurring_streams")
      .insert({
        user_id: ownerId,
        plaid_item_id: ownerItem.id,
        stream_id: `budget-rent-stream-${stamp}`,
        stream_type: "outflow",
        description: "Rent",
        merchant_name: "Test Landlord",
        average_amount: 1200,
        last_amount: 1200,
        frequency: "MONTHLY",
        status: "MATURE",
        category: "HOUSING",
        is_active: true,
      });
    if (recurringError) throw recurringError;

    const { error: syncError } = await admin.from("sync_jobs").insert({
      user_id: ownerId,
      plaid_item_id: ownerItem.id,
      status: "done",
      attempts: 1,
    });
    if (syncError) throw syncError;
  });

  test.afterAll(async () => {
    if (memberId) await admin.auth.admin.deleteUser(memberId);
    if (ownerId) await admin.auth.admin.deleteUser(ownerId);
  });

  async function signIn(page: Page) {
    await page.goto("/login");
    await page.getByPlaceholder("you@example.com").fill(ownerEmail);
    await page.getByPlaceholder("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  }

  test("reviews proposals, reconciles actuals, rolls back, and stays responsive", async ({
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
    const failedAppResponses: string[] = [];
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
    page.on("response", (response) => {
      if (
        new URL(response.url()).origin === appOrigin &&
        response.status() >= 500 &&
        response.url() !== `${appOrigin}/api/budget`
      ) {
        failedAppResponses.push(`${response.status()} ${response.url()}`);
      }
    });

    await page.goto(`/budget?month=${month}&currency=USD`);
    await expect(page.getByRole("heading", { name: "Budget" })).toBeVisible();
    await page.getByRole("button", { name: "Create from history" }).click();
    const dialog = page.getByRole("dialog", {
      name: "Review Budget proposals",
    });
    const rent = dialog.getByRole("group", { name: "Rent" });
    await rent.getByRole("spinbutton", { name: "Monthly amount" }).fill("1250");
    const insurance = dialog.getByRole("group", {
      name: "Annual Insurance",
    });
    await insurance.getByRole("checkbox", { name: "Include" }).uncheck();
    await dialog.getByRole("button", { name: "Confirm proposals" }).click();
    await expect(dialog).toBeHidden();
    await page.reload();
    const rentRow = page.getByRole("row", { name: /^Rent / });
    await expect(
      rentRow.getByRole("spinbutton", { name: "Planned amount for Rent" }),
    ).toHaveValue("1250");

    await page.getByRole("link", { name: "Expenses" }).click();
    const budgetActual = page.getByText("Actual Expenses").locator("..");
    await expect(budgetActual).toContainText("$1,525.00");
    await page.goto(
      `/cash-flow?period=monthly&selected=${month}&currency=USD`,
    );
    const cashFlowSummary = page.locator(
      'section[aria-labelledby="cash-flow-summary-heading"]',
    );
    await expect(
      cashFlowSummary.getByText("$1,525.00", { exact: true }),
    ).toBeVisible();

    await page.goto(`/budget?month=${month}&currency=CAD`);
    await page.getByRole("link", { name: "Expenses" }).click();
    await expect(
      page.getByText("Actual Expenses").locator(".."),
    ).toContainText("CA$100.00");
    await page.getByRole("link", { name: "Household" }).click();
    await expect(page).toHaveURL(new RegExp(`scope=${householdId}`));
    await page.goto(
      `/budget?month=${month}&currency=USD&scope=${householdId}&summary=expenses`,
    );
    await expect(
      page.getByText("Actual Expenses").locator(".."),
    ).toContainText("$1,600.00");

    // `summary=expenses` so the right rail is on the Expenses tab: the rollback
    // assertion below reads "Planned expenses", which lives under that tab.
    await page.goto(`/budget?month=${month}&currency=USD&summary=expenses`);
    const plannedInput = page.getByRole("spinbutton", {
      name: "Planned amount for Rent",
    });
    await page.route("**/api/budget", async (route) => {
      if (route.request().method() === "PUT") {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "forced_e2e_failure" }),
        });
        return;
      }
      await route.continue();
    });
    await plannedInput.fill("1400");
    // The per-row Save button is gone: the planned amount is a quiet inline
    // input that commits on blur (BudgetTable's `savePlanned`). Optimistic
    // update and rollback still run in the parent's `onUpdate`, so everything
    // asserted below is unchanged.
    await plannedInput.blur();
    await expect(
      page.getByText("Rent was not saved. All totals were rolled back."),
    ).toBeVisible();
    await expect(plannedInput).toHaveValue("1250");
    await expect(page.getByText("Planned Expenses").locator("..")).toContainText(
      "$2,250.00",
    );
    await page.unroute("**/api/budget");

    await plannedInput.fill("1300");
    await plannedInput.blur();
    await expect(page.getByText("Rent saved.")).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("spinbutton", { name: "Planned amount for Rent" }),
    ).toHaveValue("1300");

    // Group, rollover and sort order moved off the row and into its "⋯" menu,
    // so each needs the menu opened first. It closes on navigation/refresh,
    // which is why it is reopened for the rollover toggle.
    const updatedRentRow = page.getByRole("row", { name: /^Rent / });
    await updatedRentRow
      .getByRole("button", { name: "More options for Rent" })
      .click();
    await updatedRentRow
      .getByRole("combobox", { name: "Group for Rent" })
      .selectOption("non_monthly");
    await expect(page.getByText("Rent saved.")).toBeVisible();
    const movedRentRow = page.getByRole("row", { name: /^Rent / });
    await movedRentRow
      .getByRole("button", { name: "More options for Rent" })
      .click();
    await movedRentRow.getByRole("checkbox", { name: "Rollover" }).check();
    await expect(page.getByText("Rent saved.")).toBeVisible();

    // The row menu stays open after a save, and its click-outside scrim covers
    // the page — dismiss it before touching anything else. Escape rather than a
    // reload, since RowMenu ships a keyboard dismiss and this exercises it.
    await page.keyboard.press("Escape");
    await page.getByRole("link", { name: "Year", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: `${year} monthly plan` }),
    ).toBeVisible();
    await expect(page.locator("tbody tr")).toHaveCount(12);
    await page.getByRole("link", { name: "Decade", exact: true }).click();
    await expect(
      page.getByRole("heading", {
        name: `${decadeStart} to ${decadeStart + 9}`,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("rowheader", { name: String(year) }),
    ).toBeVisible();

    const viewports = [
      { name: "desktop", width: 1440, height: 900 },
      { name: "tablet", width: 768, height: 1024 },
      { name: "mobile", width: 390, height: 844 },
    ] as const;
    await page.goto(`/budget?month=${month}&currency=USD`);
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      for (const theme of ["light", "dark"] as const) {
        await page.evaluate((nextTheme) => {
          localStorage.setItem("fundflow-theme", nextTheme);
        }, theme);
        await page.reload();
        await expect(page.locator("html")).toHaveAttribute(
          "data-theme",
          theme,
        );
        await page.evaluate(() => {
          document.querySelectorAll("nextjs-portal").forEach((element) => {
            (element as HTMLElement).style.display = "none";
          });
        });
        const unexpectedOverflow = await page.evaluate(() => {
          const viewportWidth = document.documentElement.clientWidth;
          return [...document.querySelectorAll<HTMLElement>("body *")]
            .filter((element) => {
              const rect = element.getBoundingClientRect();
              if (rect.left >= -1 && rect.right <= viewportWidth + 1) {
                return false;
              }
              let parent = element.parentElement;
              while (parent && parent !== document.body) {
                const overflowX = getComputedStyle(parent).overflowX;
                if (
                  overflowX === "auto" ||
                  overflowX === "scroll" ||
                  overflowX === "hidden" ||
                  overflowX === "clip"
                ) {
                  return false;
                }
                parent = parent.parentElement;
              }
              return true;
            })
            .map(
              (element) =>
                element.getAttribute("aria-label") ??
                element.textContent?.trim().slice(0, 60) ??
                element.tagName,
            )
            .slice(0, 10);
        });
        expect(
          unexpectedOverflow,
          `${viewport.name} ${theme} must contain horizontal scrolling`,
        ).toEqual([]);
        const controls = page.locator(
          'main a, main button:not([aria-label="Open Next.js Dev Tools"])',
        );
        const controlCount = await controls.count();
        for (let index = 0; index < controlCount; index += 1) {
          const control = controls.nth(index);
          const box = await control.boundingBox();
          if (!box) continue;
          // Name the control in the failure message: an anonymous "expected 44,
          // got 42" over every link and button on the page is unactionable.
          const label = await control.evaluate(
            (element) =>
              element.getAttribute("aria-label") ??
              element.textContent?.trim().slice(0, 60) ??
              element.tagName,
          );
          expect(
            box.height,
            `${viewport.name} ${theme}: "${label}" must be at least 44px high`,
          ).toBeGreaterThanOrEqual(44);
        }
        await page.screenshot({
          path: SCREENSHOT_DIR
            ? path.join(
                SCREENSHOT_DIR,
                `budget-${viewport.name}-${theme}.png`,
              )
            : undefined,
          fullPage: true,
          animations: "disabled",
          // See cash-flow.spec.ts: the default `caret: "hide"` mutates inline
          // styles and races hydration on the next reload.
          caret: "initial",
        });
      }
    }

    const unexpectedConsoleIssues = consoleIssues.filter(
      (message) =>
        !/^\[\.WebGL-/.test(message) &&
        message !== "No available adapters." &&
        !message.includes("Plaid link-initialize.js script was embedded more than once") &&
        !/^Failed to load resource: the server responded with a status of 500/.test(
          message,
        ) &&
        !/^Failed to load resource: net::ERR_NAME_NOT_RESOLVED$/.test(
          message,
        ),
    );
    expect(pageErrors).toEqual([]);
    expect(failedAppRequests).toEqual([]);
    expect(failedAppResponses).toEqual([]);
    expect(unexpectedConsoleIssues).toEqual([]);
  });
});
