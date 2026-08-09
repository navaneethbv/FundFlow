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
});
