import { expect, test, type Page } from "@playwright/test";
import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

loadEnvConfig(process.cwd());

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const RUN = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY && SUPABASE_SECRET_KEY);
const stamp = Date.now();
const email = `transactions-e2e-${stamp}@example.com`;
const password = "TransactionsE2E-Password-123!";
const activeMonth = new Date().toISOString().slice(0, 7);

test.describe.serial("transaction sorting and filters", () => {
  // This skip is intentional because the spec creates and deletes live Auth users and financial rows.
  // Secretless CI runs the non-destructive smoke suite instead.
  test.skip(!RUN, "Supabase browser and service credentials are required");

  let admin: SupabaseClient;
  let userId = "";

  test.beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SUPABASE_SECRET_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userResult, error: userError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (userError) throw userError;
    userId = userResult.user.id;

    const { data: item, error: itemError } = await admin
      .from("plaid_items")
      .insert({
        user_id: userId,
        plaid_item_id: `transactions-e2e-item-${stamp}`,
        institution_name: "Transactions E2E Bank",
        status: "disconnected",
        access_token_ciphertext: "e2e",
        access_token_iv: "e2e",
        access_token_tag: "e2e",
      })
      .select("id")
      .single();
    if (itemError) throw itemError;

    const { data: accounts, error: accountError } = await admin
      .from("accounts")
      .insert([
        {
          user_id: userId,
          plaid_item_id: item.id,
          plaid_account_id: `transactions-e2e-alpha-${stamp}`,
          name: "Alpha Checking",
          mask: "1111",
          type: "depository",
          subtype: "checking",
          current_balance: 1000,
          available_balance: 1000,
          iso_currency_code: "USD",
        },
        {
          user_id: userId,
          plaid_item_id: item.id,
          plaid_account_id: `transactions-e2e-zeta-${stamp}`,
          name: "Zeta Credit",
          mask: "2222",
          type: "credit",
          subtype: "credit card",
          current_balance: 200,
          available_balance: 800,
          iso_currency_code: "USD",
        },
      ])
      .select("id, name");
    if (accountError) throw accountError;
    const accountByName = new Map(accounts.map((account) => [account.name, account.id]));

    const transactions = Array.from({ length: 56 }, (_, index) => {
      const food = index % 2 === 0;
      return {
        user_id: userId,
        account_id: accountByName.get(index % 3 === 0 ? "Zeta Credit" : "Alpha Checking"),
        plaid_transaction_id: `transactions-e2e-${stamp}-${index}`,
        date: `${activeMonth}-${String((index % 28) + 1).padStart(2, "0")}`,
        amount: index === 55 ? -500 : index + 1,
        iso_currency_code: "USD",
        name: index === 0 ? "RAW PRIORITY" : `MERCHANT ${String(index).padStart(2, "0")}`,
        merchant_name: index === 0 ? "Raw Priority" : `Merchant ${String(index).padStart(2, "0")}`,
        pfc_primary: food ? "FOOD_AND_DRINK" : "TRANSPORTATION",
        pfc_detailed: food ? "FOOD_AND_DRINK_GROCERIES" : "TRANSPORTATION_TAXIS_AND_RIDE_SHARES",
        pending: false,
      };
    });
    const { error: transactionError } = await admin.from("transactions").insert(transactions);
    if (transactionError) throw transactionError;

    const { error: ruleError } = await admin.from("merchant_rules").insert({
      user_id: userId,
      match_type: "merchant",
      pattern: "Raw Priority",
      display_name: "AAA Cleaned",
      category: "TRAVEL",
      enabled: true,
    });
    if (ruleError) throw ruleError;
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

  async function applySort(
    page: Page,
    field: "date" | "amount" | "merchant" | "category" | "account",
    direction: "asc" | "desc",
  ) {
    await page.getByRole("button", { name: /^Sort:/ }).click();
    const dialog = page.getByRole("dialog", { name: "Sort transactions" });
    await dialog.getByLabel("Sort by").selectOption(field);
    await dialog.getByLabel("Direction").selectOption(direction);
    await dialog.getByRole("button", { name: "Apply" }).click();
    await expect.poll(() => {
      const params = new URL(page.url()).searchParams;
      return {
        sort: params.get("sort"),
        direction: params.get("direction"),
      };
    }).toEqual({
      sort: field,
      direction,
    });
  }

  test("stages filters, sorts complete pages, restores history, and works at phone width", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const consoleIssues: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") consoleIssues.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await signIn(page);
    await page.goto("/transactions");
    await expect(page.getByText("56 transactions", { exact: false })).toBeVisible();
    await page.evaluate(() => ((window as Window & { transactionControlsStayedMounted?: boolean }).transactionControlsStayedMounted = true));

    await page.getByRole("button", { name: "Filters" }).click();
    const filters = page.getByRole("dialog", { name: "Transaction filters" });
    await filters.getByLabel("Category", { exact: true }).selectOption("FOOD_AND_DRINK");
    expect(new URL(page.url()).searchParams.has("category")).toBe(false);
    await filters.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/category=FOOD_AND_DRINK/);
    expect(await page.evaluate(() => (window as Window & { transactionControlsStayedMounted?: boolean }).transactionControlsStayedMounted)).toBe(true);

    await page.goBack();
    await expect(page).not.toHaveURL(/category=/);
    await page.goForward();
    await expect(page).toHaveURL(/category=FOOD_AND_DRINK/);
    await expect(page.getByRole("button", { name: /Remove category filter Food And Drink/ })).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(page).not.toHaveURL(/category=/);

    for (const field of ["date", "amount", "merchant", "category", "account"] as const) {
      await applySort(page, field, "asc");
      await applySort(page, field, "desc");
    }

    await applySort(page, "merchant", "asc");
    const firstPageMerchants = await page.locator("table tbody tr td:nth-child(2) .font-medium").allTextContents();
    expect(firstPageMerchants[0]).toBe("AAA Cleaned");
    await page.getByRole("link", { name: "Next" }).click();
    await expect(page).toHaveURL(/page=2/);
    const secondPageMerchants = await page.locator("table tbody tr td:nth-child(2) .font-medium").allTextContents();
    const combinedMerchants = [...firstPageMerchants, ...secondPageMerchants];
    expect(combinedMerchants).toHaveLength(56);
    expect(combinedMerchants).toEqual(combinedMerchants.toSorted((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true })));

    await page.getByRole("button", { name: "Save this view" }).click();
    await page.getByPlaceholder("View name").fill("Merchant order");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("link", { name: "Merchant order" })).toBeVisible();
    await page.goto("/transactions");
    await page.getByRole("link", { name: "Merchant order" }).click();
    await expect(page).toHaveURL(/sort=merchant/);
    await expect(page).toHaveURL(/direction=asc/);

    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const theme of ["light", "dark"] as const) {
      await page.evaluate((value) => {
        localStorage.setItem("fundflow-theme", value);
        document.documentElement.dataset.theme = value;
      }, theme);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`transactions-desktop-${theme}.png`), fullPage: true });
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("button", { name: /^Sort:/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Filters" })).toBeVisible();
    await page.getByRole("button", { name: "Filters" }).click();
    await expect(page.getByRole("dialog", { name: "Transaction filters" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Transaction filters" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Filters" })).toBeFocused();
    for (const button of [
      page.getByRole("button", { name: /^Sort:/ }),
      page.getByRole("button", { name: "Filters" }),
    ]) {
      const box = await button.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect(box?.width).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("transactions-phone-dark.png"), fullPage: true });

    expect(pageErrors).toEqual([]);
    const unexpectedConsoleIssues = consoleIssues.filter(
      (message) => !message.includes("Plaid link-initialize.js script was embedded more than once"),
    );
    expect(unexpectedConsoleIssues).toEqual([]);
  });
});
