import {
  runLiveE2E,
  signIn,
  test,
  expect,
  type UserAccount,
} from "./fixtures/authenticated";
import AxeBuilder from "@axe-core/playwright";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FinanceSeed } from "./fixtures/seed";

/**
 * Persistent transaction review, full user journey (plan AC-03/11/12/17).
 *
 * Runs only against an approved isolated project (`runLiveE2E`) that has the
 * `20260908040000_transaction_review_state.sql` migration applied AND is served
 * with `FUNDFLOW_FEATURE_FLAGS=transactionReview`. Secretless CI skips it, the
 * same as the other credentialed specs. Each test provisions its own throwaway
 * user, matching the rest of the e2e suite.
 */
test.describe("persistent transaction review", () => {
  // Skipped without an approved isolated target because these tests create and
  // delete users and financial records; running them on production is unsafe.
  test.skip(
    !runLiveE2E,
    "Approved isolated Supabase target (TEST_SUPABASE_URL) and credentials are required",
  );

  const MONTH = "2026-08";

  async function seedLedger(
    admin: SupabaseClient,
    account: UserAccount,
    seed: FinanceSeed,
  ): Promise<void> {
    const { checkingId } = await seed.linkedAccounts();
    const rows = [
      { m: "Review Alpha", amount: 12.5, pending: false, day: "05" },
      { m: "Review Beta", amount: 34, pending: false, day: "06" },
      { m: "Review Gamma", amount: 56, pending: false, day: "07" },
      { m: "Review Delta", amount: 78, pending: false, day: "08" },
      { m: "Review Pending", amount: 9, pending: true, day: "09" },
    ];
    const { error } = await admin.from("transactions").insert(
      rows.map((r, i) => ({
        user_id: account.id,
        account_id: checkingId,
        plaid_transaction_id: `review-e2e-${account.stamp}-${i}`,
        date: `${MONTH}-${r.day}`,
        amount: r.amount,
        iso_currency_code: "USD",
        name: r.m.toUpperCase(),
        merchant_name: r.m,
        pfc_primary: "GENERAL_MERCHANDISE",
        pending: r.pending,
      })),
    );
    if (error) throw error;
  }

  test("reviews, persists, and reopens a single entry", async ({
    page,
    admin,
    account,
    seed,
  }) => {
    await seedLedger(admin, account, seed);
    await signIn(page, account);
    await page.goto("/transactions?review=needs_review");

    const alphaRow = page.getByRole("row", { name: /Review Alpha/ });
    await expect(alphaRow).toBeVisible();
    await expect(alphaRow.getByText("Needs review")).toBeVisible();

    await alphaRow.getByRole("button", { name: "Mark transaction as reviewed" }).click();
    // Pessimistic: the row leaves the queue only after the server confirms.
    await expect(page.getByRole("row", { name: /Review Alpha/ })).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole("row", { name: /Review Alpha/ })).toHaveCount(0);

    await page.goto("/transactions?review=reviewed");
    const reviewedAlpha = page.getByRole("row", { name: /Review Alpha/ });
    await expect(reviewedAlpha.getByText("Reviewed")).toBeVisible();

    await reviewedAlpha
      .getByRole("button", { name: "Mark transaction as needs review" })
      .click();
    await page.goto("/transactions?review=needs_review");
    await expect(page.getByRole("row", { name: /Review Alpha/ })).toBeVisible();
  });

  test("bulk-marks only selected eligible rows and clears selection on view change", async ({
    page,
    admin,
    account,
    seed,
  }) => {
    await seedLedger(admin, account, seed);
    await signIn(page, account);
    await page.goto("/transactions?review=needs_review");

    await page.getByRole("row", { name: /Review Beta/ }).getByRole("checkbox").check();
    await page.getByRole("row", { name: /Review Gamma/ }).getByRole("checkbox").check();
    await expect(page.getByText("2 selected")).toBeVisible();

    // Pending rows are never selectable.
    await expect(
      page.getByRole("row", { name: /Review Pending/ }).getByRole("checkbox"),
    ).toHaveCount(0);

    await page.getByRole("button", { name: /Mark 2 selected as reviewed/ }).click();
    await expect(page.getByRole("row", { name: /Review Beta/ })).toHaveCount(0);
    await expect(page.getByRole("row", { name: /Review Gamma/ })).toHaveCount(0);
    // Delta was not selected and stays in the queue.
    await expect(page.getByRole("row", { name: /Review Delta/ })).toBeVisible();

    // Select, then switch view: the selection must not survive the navigation.
    await page.getByRole("row", { name: /Review Delta/ }).getByRole("checkbox").check();
    await expect(page.getByText("1 selected")).toBeVisible();
    await page.getByRole("button", { name: "Reviewed", exact: true }).click();
    await page.getByRole("button", { name: "Needs review", exact: true }).click();
    await expect(page.getByText("1 selected")).toHaveCount(0);
  });

  test("stays usable at 390px with no horizontal overflow", async ({
    page,
    admin,
    account,
    seed,
  }) => {
    await seedLedger(admin, account, seed);
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, account);
    await page.goto("/transactions?review=needs_review");

    await expect(
      page.getByRole("navigation", { name: "Transaction review views" }),
    ).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("invalidates selection when background refresh changes a selected version", async ({ page, admin, account, seed }) => {
    await seedLedger(admin, account, seed);
    await signIn(page, account);
    await page.goto("/transactions?review=needs_review");
    await page.getByRole("row", { name: /Review Alpha/ }).getByRole("checkbox").check();
    const { error } = await admin.from("transactions").update({ amount: 99 }).eq("user_id", account.id).eq("merchant_name", "Review Alpha");
    expect(error).toBeNull();
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(page.getByText("1 selected", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("status")).toContainText("Review the updated entries");
  });

  test("recovers the last page and retains an immediate reverse action", async ({ page, admin, account, seed }) => {
    const { checkingId } = await seed.linkedAccounts();
    const { error } = await admin.from("transactions").insert(Array.from({ length: 51 }, (_, i) => ({
      user_id: account.id, account_id: checkingId, plaid_transaction_id: `review-pages-${account.stamp}-${i}`,
      date: `${MONTH}-05`, amount: i + 1, name: `Page entry ${i}`, pending: false,
    })));
    expect(error).toBeNull();
    await signIn(page, account);
    await page.goto(`/transactions?review=needs_review&month=${MONTH}&page=2`);
    await page.getByRole("button", { name: "Mark transaction as reviewed", exact: true }).click();
    await expect(page).not.toHaveURL(/page=2/);
    await expect(page).toHaveURL(new RegExp(`month=${MONTH}`));
    await expect(page.getByRole("button", { name: "Review again", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Review again", exact: true }).click();
    await expect(page.getByLabel("Global review queue count")).toContainText("51 transactions");
  });

  test("finishes and reverses the queue on a phone with accessible feedback", async ({ page, admin, account, seed }) => {
    await seedLedger(admin, account, seed);
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, account);
    await page.goto("/transactions?review=needs_review");
    await page.getByRole("checkbox", { name: "Select all eligible transactions on this page" }).check();
    const mark = page.getByRole("button", { name: "Mark 4 selected as reviewed", exact: true });
    for (const control of [mark, page.getByRole("button", { name: "Mark as needs review", exact: true }), page.getByRole("button", { name: "Cancel", exact: true })]) {
      const bounds = await control.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    }
    const accessibility = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(accessibility.violations).toEqual([]);
    await mark.click();
    await expect(page.getByRole("heading", { name: "You're all caught up" })).toBeVisible();
    await expect(page.locator("#transaction-review-heading")).toBeFocused();
    await expect(page.getByRole("status")).toContainText("4 transactions marked as reviewed");
    await page.getByRole("button", { name: "Review again", exact: true }).click();
    await expect(page.getByLabel("Global review queue count")).toContainText("4 transactions");
  });

  test("reconciles a lost committed response without replaying or offering a blind reverse", async ({ page, admin, account, seed }) => {
    await seedLedger(admin, account, seed);
    await signIn(page, account);
    await page.goto("/transactions?review=needs_review");
    let writes = 0;
    await page.route("**/api/transactions/review", async (route) => {
      writes++;
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.abort("failed");
    });
    await page.getByRole("row", { name: /Review Alpha/ }).getByRole("button", { name: "Mark transaction as reviewed" }).click();
    await expect(page.getByRole("row", { name: /Review Alpha/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Review again", exact: true })).toHaveCount(0);
    await expect(page.getByRole("row", { name: /Review Beta/ }).getByRole("button", { name: "Mark transaction as reviewed" })).toBeEnabled();
    expect(writes).toBe(1);
  });

});
