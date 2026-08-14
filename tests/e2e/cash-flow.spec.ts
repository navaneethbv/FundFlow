import { expect, test, type Page } from "@playwright/test";
import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import path from "node:path";
import { isKnownEnvironmentNoise } from "./console-noise";

loadEnvConfig(process.cwd());

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const RUN = Boolean(
  SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY && SUPABASE_SECRET_KEY,
);
const SCREENSHOT_DIR = process.env.CASH_FLOW_E2E_SCREENSHOT_DIR;
const stamp = Date.now();
const password = "CashFlowE2E-Password-123!";
const ownerEmail = `cash-flow-e2e-owner-${stamp}@example.com`;
const memberEmail = `cash-flow-e2e-member-${stamp}@example.com`;
const today = new Date().toISOString().slice(0, 10);
const month = today.slice(0, 7);
const [year, monthNumber] = month.split("-").map(Number);
const monthLabel = new Date(
  year!,
  monthNumber! - 1,
  1,
).toLocaleString("en-US", {
  month: "short",
  year: "numeric",
});
const quarterLabel = `Q${Math.ceil(monthNumber! / 3)} ${year}`;

test.describe.serial("cash flow page", () => {
  // Intentional skip: this live acceptance suite needs disposable Supabase credentials.
  test.skip(!RUN, "Supabase browser and service credentials are required");
  test.setTimeout(120_000);

  let admin: SupabaseClient;
  let ownerId = "";
  let memberId = "";

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
        name: "Cash Flow E2E household",
      })
      .select("id")
      .single();
    if (householdError) throw householdError;

    const { error: membershipError } = await admin
      .from("household_members")
      .insert({
        household_id: household.id,
        user_id: memberId,
        role: "member",
        status: "active",
      });
    if (membershipError) throw membershipError;

    const { data: ownerItem, error: ownerItemError } = await admin
      .from("plaid_items")
      .insert({
        user_id: ownerId,
        plaid_item_id: `cash-flow-owner-item-${stamp}`,
        institution_name: "Cash Flow Test Bank",
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
        plaid_item_id: `cash-flow-member-item-${stamp}`,
        institution_name: "Shared Cash Flow Bank",
        status: "disconnected",
        shared_household_id: household.id,
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
          plaid_account_id: `cash-flow-usd-account-${stamp}`,
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
          plaid_account_id: `cash-flow-cad-account-${stamp}`,
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
        plaid_account_id: `cash-flow-shared-account-${stamp}`,
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

    const ownerTransactions = [
      {
        key: "paycheck",
        accountId: usdAccountId,
        amount: -3000,
        merchant: "Test Payroll",
        group: "INCOME",
        category: "INCOME_WAGES",
      },
      {
        key: "split-expense",
        accountId: usdAccountId,
        amount: 100,
        merchant: "Family Market",
        group: "FOOD_AND_DRINK",
        category: "FOOD_AND_DRINK_GROCERIES",
      },
      {
        key: "ordinary-expense",
        accountId: usdAccountId,
        amount: 200,
        merchant: "Raw Cafe",
        group: "GENERAL_MERCHANDISE",
        category: "GENERAL_MERCHANDISE_OTHER",
      },
      {
        key: "transfer",
        accountId: usdAccountId,
        amount: 500,
        merchant: "Card Payment",
        group: "LOAN_PAYMENTS",
        category: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
      },
      {
        key: "charge",
        accountId: usdAccountId,
        amount: 50,
        merchant: "Returned Store",
        group: "GENERAL_MERCHANDISE",
        category: "GENERAL_MERCHANDISE_OTHER",
      },
      {
        key: "refund",
        accountId: usdAccountId,
        amount: -50,
        merchant: "Returned Store",
        group: "GENERAL_MERCHANDISE",
        category: "GENERAL_MERCHANDISE_OTHER",
      },
      {
        key: "cad-income",
        accountId: cadAccountId,
        amount: -500,
        merchant: "Canadian Payroll",
        group: "INCOME",
        category: "INCOME_WAGES",
      },
    ];
    const { data: insertedTransactions, error: transactionError } =
      await admin
        .from("transactions")
        .insert(
          ownerTransactions.map((transaction, index) => ({
            user_id: ownerId,
            account_id: transaction.accountId,
            plaid_transaction_id: `cash-flow-${transaction.key}-${stamp}`,
            date: `${month}-${String(index + 1).padStart(2, "0")}`,
            amount: transaction.amount,
            name: transaction.merchant.toUpperCase(),
            merchant_name: transaction.merchant,
            pfc_primary: transaction.group,
            pfc_detailed: transaction.category,
            pending: false,
          })),
        )
        .select("id,plaid_transaction_id");
    if (transactionError) throw transactionError;
    const transactionId = new Map(
      insertedTransactions.map((transaction) => [
        transaction.plaid_transaction_id
          .replace("cash-flow-", "")
          .replace(`-${stamp}`, ""),
        transaction.id,
      ]),
    );

    const { data: memberTransactions, error: memberTransactionError } = await admin
      .from("transactions")
      .insert([
        {
          user_id: memberId,
          account_id: memberAccount.id,
          plaid_transaction_id: `cash-flow-shared-expense-${stamp}`,
          date: `${month}-08`,
          amount: 75,
          name: "SHARED GROCER",
          merchant_name: "Shared Grocer",
          pfc_primary: "FOOD_AND_DRINK",
          pfc_detailed: "FOOD_AND_DRINK_GROCERIES",
          pending: false,
        },
        {
          user_id: memberId,
          account_id: memberAccount.id,
          plaid_transaction_id: `cash-flow-shared-refund-charge-${stamp}`,
          date: `${month}-09`,
          amount: 25,
          name: "SHARED RETURN CHARGE",
          merchant_name: "Shared Return",
          pfc_primary: "GENERAL_MERCHANDISE",
          pfc_detailed: "GENERAL_MERCHANDISE_OTHER",
          pending: false,
        },
        {
          user_id: memberId,
          account_id: memberAccount.id,
          plaid_transaction_id: `cash-flow-shared-refund-credit-${stamp}`,
          date: `${month}-10`,
          amount: -25,
          name: "SHARED RETURN CREDIT",
          merchant_name: "Shared Return",
          pfc_primary: "GENERAL_MERCHANDISE",
          pfc_detailed: "GENERAL_MERCHANDISE_OTHER",
          pending: false,
        },
      ])
      .select("id,plaid_transaction_id");
    if (memberTransactionError) throw memberTransactionError;
    const memberTransactionId = new Map(
      memberTransactions.map((transaction) => [
        transaction.plaid_transaction_id
          .replace("cash-flow-", "")
          .replace(`-${stamp}`, ""),
        transaction.id,
      ]),
    );

    const { error: splitError } = await admin
      .from("transaction_splits")
      .insert([
        {
          user_id: ownerId,
          transaction_id: transactionId.get("split-expense"),
          category: "Groceries",
          amount: 40,
        },
        {
          user_id: ownerId,
          transaction_id: transactionId.get("split-expense"),
          category: "Dining",
          amount: 60,
        },
        {
          user_id: memberId,
          transaction_id: memberTransactionId.get("shared-expense"),
          category: "Shared groceries",
          amount: 30,
        },
        {
          user_id: memberId,
          transaction_id: memberTransactionId.get("shared-expense"),
          category: "Shared dining",
          amount: 45,
        },
      ]);
    if (splitError) throw splitError;

    const { error: refundError } = await admin
      .from("linked_refunds")
      .insert([
        {
          user_id: ownerId,
          charge_transaction_id: transactionId.get("charge"),
          refund_transaction_id: transactionId.get("refund"),
          amount: 50,
        },
        {
          user_id: memberId,
          charge_transaction_id: memberTransactionId.get(
            "shared-refund-charge",
          ),
          refund_transaction_id: memberTransactionId.get(
            "shared-refund-credit",
          ),
          amount: 25,
        },
      ]);
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

  test("reconciles canonical totals and remains responsive across URL controls", async ({
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
        response.status() >= 500
      ) {
        failedAppResponses.push(`${response.status()} ${response.url()}`);
      }
    });

    await page.goto(`/cash-flow?currency=USD&selected=${month}`);
    await expect(
      page.getByRole("heading", { name: "Cash Flow" }),
    ).toBeVisible();
    const summary = page.locator(
      'section[aria-labelledby="cash-flow-summary-heading"]',
    );
    await expect(summary.getByText(monthLabel, { exact: true })).toBeVisible();
    await expect(summary.getByText("$3,000.00", { exact: true })).toBeVisible();
    await expect(summary.getByText("$300.00", { exact: true })).toBeVisible();
    await expect(summary.getByText("$2,700.00", { exact: true })).toBeVisible();
    await expect(summary.getByText("90%", { exact: true })).toBeVisible();
    await expect(page.getByText("Groceries", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Dining", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Returned Store", { exact: true })).toHaveCount(
      0,
    );

    await page.getByRole("link", { name: "Merchant" }).click();
    await expect(page).toHaveURL(/dimension=merchant/);
    await expect(
      page.getByText("Neighborhood Cafe", { exact: true }).first(),
    ).toBeVisible();

    await page.getByRole("link", { name: "Quarterly" }).click();
    await expect(page).toHaveURL(/period=quarterly/);
    await expect(
      page
        .locator('section[aria-labelledby="cash-flow-summary-heading"]')
        .getByText(quarterLabel, { exact: true }),
    ).toBeVisible();

    await page.getByRole("link", { name: "CAD" }).click();
    await expect(page).toHaveURL(/currency=CAD/);
    await expect(
      page.getByText("CA$500.00", { exact: true }).first(),
    ).toBeVisible();

    await page.getByRole("link", { name: "USD" }).click();
    await expect(page).toHaveURL(/currency=USD/);
    await page.getByRole("link", { name: "Household" }).click();
    await expect(page).toHaveURL(/scope=/);
    const householdSummary = page.locator(
      'section[aria-labelledby="cash-flow-summary-heading"]',
    );
    await expect(
      householdSummary.getByText("$3,000.00", { exact: true }),
    ).toBeVisible();
    await expect(
      householdSummary.getByText("$375.00", { exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Category" }).click();
    await expect(
      page.getByText("Shared Groceries", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("Shared Dining", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("General Merchandise Other", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("GENERAL_MERCHANDISE_OTHER", { exact: true }),
    ).toHaveCount(0);

    await page.getByLabel("Window").selectOption("24");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/range=24/);

    const controlTargets = page.locator(
      '[aria-label="Cash Flow controls"] a, [aria-label="Cash Flow controls"] button, [aria-label="Cash Flow controls"] select',
    );
    const targetCount = await controlTargets.count();
    for (let index = 0; index < targetCount; index += 1) {
      const box = await controlTargets.nth(index).boundingBox();
      expect(box, "control must be rendered").not.toBeNull();
      expect(
        box!.height,
        "control must be at least 44px high",
      ).toBeGreaterThanOrEqual(44);
    }

    const viewports = [
      { name: "desktop", width: 1440, height: 900 },
      { name: "tablet", width: 768, height: 1024 },
      { name: "mobile", width: 390, height: 844 },
    ] as const;
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
        expect(
          await page.evaluate(
            () =>
              document.documentElement.scrollWidth >
              document.documentElement.clientWidth,
          ),
        ).toBe(false);
        await expect(
          page.getByRole("heading", { name: "Cash Flow" }),
        ).toBeVisible();
        await page.screenshot({
          path: SCREENSHOT_DIR
            ? path.join(
                SCREENSHOT_DIR,
                `cash-flow-${viewport.name}-${theme}.png`,
              )
            : undefined,
          fullPage: true,
          animations: "disabled",
          // `caret: "hide"` (the default) sets an inline
          // `caret-color: transparent !important` on every field and restores
          // it afterwards. On the next iteration's reload that mutation races
          // hydration, and React logs an attribute mismatch listing exactly
          // those hidden inputs — a harness artifact that failed this spec
          // roughly three runs in four. Nothing here needs the caret hidden.
          caret: "initial",
        });

        // Sign out is no longer on the page itself — it sits behind the
        // sidebar's account menu above `md`, and behind the mobile nav's "More"
        // sheet below it. Measured after the screenshot so the capture is of
        // the page, not of an open menu; the next iteration's reload closes it.
        if (viewport.width < 768) {
          await page.getByRole("button", { name: "More" }).click();
        } else {
          await page.getByRole("button", { name: /^Account menu/ }).click();
        }
        const signOutLines = await page
          .getByRole("button", { name: "Sign out" })
          .evaluate((button) => {
            const range = document.createRange();
            range.selectNodeContents(button);
            return range.getClientRects().length;
          });
        expect(signOutLines, "Sign out must remain on one line").toBe(1);
      }
    }

    const unexpectedConsoleIssues = consoleIssues.filter(
      (message) => !isKnownEnvironmentNoise(message),
    );
    expect(pageErrors).toEqual([]);
    expect(failedAppRequests).toEqual([]);
    expect(failedAppResponses).toEqual([]);
    expect(unexpectedConsoleIssues).toEqual([]);
  });
});
