import { hasLiveCredentials, signIn, test, expect } from "./fixtures/authenticated";

test.describe("settings completion", () => {
  // Skipped: E2E test requires live Supabase environment credentials.
  test.skip(!hasLiveCredentials, "Live Supabase credentials are required");

  test("previews QFX without CSV controls and explains local passkey availability", async ({
    page,
    account,
    seed,
  }) => {
    await seed.linkedAccounts();
    await signIn(page, account);
    await page.goto("/settings?section=data");
    const importPanel = page
      .getByRole("heading", { name: "Import with review" })
      .locator("xpath=ancestor::section");
    await importPanel.locator('input[name="file"]').setInputFiles({
      name: "checking.qfx",
      mimeType: "application/x-ofx",
      buffer: Buffer.from(
        "OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\n\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260805120000<TRNAMT>-12.34<FITID>qfx-1<NAME>Quality Coffee</STMTTRN></BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>",
      ),
    });
    await expect(page.getByText("OFX sign conventions are detected automatically.")).toBeVisible();
    await importPanel.getByRole("button", { name: "Preview file" }).click();
    await expect(page.getByText("Quality Coffee", { exact: true })).toBeVisible();

    await page.goto("/settings?section=security");
    await expect(page.getByText("No passkeys added yet.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Add passkey" })).toBeEnabled();
  });

  test("annotation conflicts can skip the edited row and import the safe remainder", async ({
    page,
    account,
    seed,
  }) => {
    await seed.linkedAccounts();
    await signIn(page, account);
    await page.route("**/api/import/preview", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          batch_id: "batch-e2e",
          source_accounts: [],
          source_account_mappings: {},
          rows: [
            {
              id: "row-conflict",
              date: "2026-08-01",
              description: "Edited note",
              amount: 10,
              status: "ready",
              flags: [],
            },
            {
              id: "row-safe",
              date: "2026-08-02",
              description: "Safe row",
              amount: 20,
              status: "ready",
              flags: [],
            },
          ],
        }),
      });
    });
    const commitBodies: Array<Record<string, unknown>> = [];
    await page.route("**/api/import/commit", async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      commitBodies.push(body);
      if (commitBodies.length === 1) {
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({ conflicts: ["row-conflict"] }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, imported: 1 }),
      });
    });

    await page.goto("/settings?section=data");
    const importPanel = page
      .getByRole("heading", { name: "Import with review" })
      .locator("xpath=ancestor::section");
    await importPanel.locator('input[name="file"]').setInputFiles({
      name: "notes.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("Date,Description,Amount\n2026-08-01,Edited note,10"),
    });
    await importPanel.getByRole("button", { name: "Preview file" }).click();
    await importPanel.getByRole("button", { name: "Import 2 selected" }).click();
    await expect(importPanel.getByText(/1 row was edited in FundFlow/)).toBeVisible();

    await importPanel.getByRole("button", { name: "Skip those rows" }).click();
    await expect(importPanel.getByText("Imported 1 transaction.")).toBeVisible();
    expect(commitBodies).toHaveLength(2);
    expect(commitBodies[1]?.approved_row_ids).toEqual(["row-safe"]);
  });
});
