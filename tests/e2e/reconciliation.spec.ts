import { test, expect } from "./fixtures/authenticated";

// This workflow writes financial fixtures and must never target the normal linked project.
const isolatedUrl = process.env.TEST_SUPABASE_URL;
const runIsolated = Boolean(isolatedUrl && isolatedUrl === process.env.NEXT_PUBLIC_SUPABASE_URL);

test.describe("statement reconciliation", () => {
  // Skipped without explicit isolation because these fixtures modify financial records.
  test.skip(!runIsolated, "Set TEST_SUPABASE_URL to the same isolated project used by the local app");
  test("clears an actual statement and carries outstanding activity to the next period", async ({ authenticatedPage: page, admin, account }) => {
    const { data: cash, error } = await admin.from("manual_accounts").insert({ user_id: account.id, name: "Statement cash", account_type: "cash", balance: 123 }).select("id").single();
    if (error) throw error;
    const { data: transactions, error: txnError } = await admin.from("transactions").insert([
      { user_id: account.id, manual_account_id: cash.id, plaid_transaction_id: `manual-${account.stamp}-expense`, amount: 100, date: "2026-08-02", name: "Statement expense", source: "manual", pending: false },
      { user_id: account.id, manual_account_id: cash.id, plaid_transaction_id: `manual-${account.stamp}-outstanding`, amount: 20, date: "2026-08-03", name: "Outstanding expense", source: "manual", pending: false },
    ]).select("id,name");
    if (txnError) throw txnError;
    await page.goto("/accounts");
    await page.getByRole("button", { name: "Reconcile an account", exact: true }).click();
    await page.getByLabel("Account", { exact: true }).selectOption(`manual:${cash.id}`);
    await page.getByLabel("Statement date", { exact: true }).fill("2026-08-31");
    await page.getByLabel("Statement ending balance").fill("900");
    await page.getByRole("button", { name: "Load transactions", exact: true }).click();
    await page.getByLabel("Opening balance date").fill("2026-07-31");
    await page.getByLabel("Opening balance", { exact: true }).fill("1000");
    await page.getByRole("button", { name: "Load transactions", exact: true }).click();
    await expect(page.getByText("Difference from statement: $100.00", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save reconciliation" })).toBeDisabled();
    await page.getByRole("checkbox", { name: "Statement expense 2026-08-02" }).check();
    await expect(page.getByText("Difference from statement: $0.00", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Save reconciliation" }).click();
    await expect(page.getByRole("status")).toContainText("Statement reconciled.");
    const { data: statements, error: statementError } = await admin.from("account_reconciliations").select("statement_balance,basis").eq("user_id", account.id);
    expect(statementError).toBeNull(); expect(statements).toHaveLength(1); expect(Number(statements![0].statement_balance)).toBe(900);
    const cleared = transactions!.find(row => row.name === "Statement expense")!.id;
    const { data: annotation, error: annotationError } = await admin.from("transaction_annotations").select("cleared_at").eq("transaction_id", cleared).single();
    expect(annotationError).toBeNull(); expect(annotation!.cleared_at).toBeTruthy();
    await page.getByLabel("Statement date", { exact: true }).fill("2026-09-30");
    await page.getByRole("button", { name: "Load transactions", exact: true }).click();
    await expect(page.getByText(/Opening cleared balance: \$900.00/)).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Outstanding expense 2026-08-03" })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Statement expense 2026-08-02" })).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    const dialog = page.getByRole("dialog");
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  });
});
