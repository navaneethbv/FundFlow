import { expectNoHorizontalPageScroll } from "./layout-checks";
import { hasLiveCredentials, signIn, test, expect } from "./fixtures/authenticated";

test.describe("dashboard completion", () => {
  // Skipped: E2E test requires live Supabase environment credentials.
  test.skip(!hasLiveCredentials, "Live Supabase credentials are required");

  test("renders grouped budgets and investment movement, then persists customization", async ({
    page,
    account,
    seed,
  }) => {
    await seed.dashboardAndInvestments();
    await signIn(page, account);
    await page.goto("/dashboard");

    await expect(page.getByText("Fixed", { exact: true })).toBeVisible();
    await expect(page.getByText("Flexible", { exact: true })).toBeVisible();
    await expect(page.getByText("Non-monthly", { exact: true })).toBeVisible();
    await expect(page.getByText("Top movers", { exact: true })).toBeVisible();
    await expect(page.getByText("+$500.00 today", { exact: false })).toBeVisible();

    await page.getByRole("button", { name: "Customize" }).click();
    const dialog = page.getByRole("dialog", { name: "Customize widgets" });
    await dialog.getByLabel(/Investments/).uncheck();
    await dialog.getByRole("button", { name: "Save layout" }).click();
    await expect(page.getByText("Top movers", { exact: true })).toBeHidden();
    await page.reload();
    await expect(page.getByText("Top movers", { exact: true })).toBeHidden();

    await page.setViewportSize({ width: 375, height: 812 });
    await expectNoHorizontalPageScroll(page);
  });

  test("shows ledger account picker with multiple depository accounts and switches without narrowing dashboard filters", async ({
    page,
    account,
    seed,
    admin,
  }) => {
    await seed.dashboardAndInvestments();

    // Add a second depository account (Quality Savings) before first dashboard visit
    const { data: item } = await admin
      .from("plaid_items")
      .select("id")
      .eq("user_id", account.id)
      .single();

    const { data: savingsAcct } = await admin
      .from("accounts")
      .insert({
        user_id: account.id,
        plaid_item_id: item!.id,
        plaid_account_id: `savings-${account.stamp}`,
        name: "Quality Savings",
        mask: "3003",
        type: "depository",
        subtype: "savings",
        current_balance: 15000,
        available_balance: 15000,
        iso_currency_code: "USD",
      })
      .select("id")
      .single();

    await admin.from("transactions").insert({
      user_id: account.id,
      account_id: savingsAcct!.id,
      plaid_transaction_id: `interest-${account.stamp}`,
      date: "2026-08-02",
      amount: -25,
      name: "Interest Payment",
      merchant_name: "Quality Bank",
      pending: false,
    });

    await signIn(page, account);
    await page.goto("/dashboard?month=2026-08");

    // With 2 depository accounts, the dropdown button appears in the Account activity panel
    const dropdownTrigger = page.getByRole("button", { name: /Quality Checking •1001/ });
    await expect(dropdownTrigger).toBeVisible();

    // Click dropdown and select Quality Savings
    await dropdownTrigger.click();
    const savingsOption = page.getByRole("link", { name: /Quality Savings •3003/ });
    await expect(savingsOption).toBeVisible();
    await savingsOption.click();

    // URL has ledgerAccount param
    await page.waitForURL(/ledgerAccount=/);
    expect(page.url()).toContain(`ledgerAccount=${savingsAcct!.id}`);
    expect(page.url()).not.toContain("accountId=");

    // The ledger strip now anchors to Quality Savings
    await expect(page.getByRole("button", { name: /Quality Savings •3003/ })).toBeVisible();

    // Dashboard global widgets remain unaffected (budgets still visible)
    await expect(page.getByText("Fixed", { exact: true })).toBeVisible();
    await expect(page.getByText("Flexible", { exact: true })).toBeVisible();

    // Clicking the active account clears ledgerAccount back to default
    await page.getByRole("button", { name: /Quality Savings •3003/ }).click();
    const activeOption = page.getByRole("link", { name: /Quality Savings •3003/ });
    await activeOption.click();

    await page.waitForURL((url) => !url.searchParams.has("ledgerAccount"));
    expect(page.url()).not.toContain("ledgerAccount=");
    await expect(page.getByRole("button", { name: /Quality Checking •1001/ })).toBeVisible();
  });
});

