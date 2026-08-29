import { hasLiveCredentials, signIn, test, expect } from "./fixtures/authenticated";

test.describe("review PDF export", () => {
  // Skipped: E2E test requires live Supabase environment credentials.
  test.skip(!hasLiveCredentials, "Live Supabase credentials are required");

  test("downloads a valid PDF for the selected month without leaving the app", async ({
    page,
    account,
    seed,
  }) => {
    await seed.dashboardAndInvestments();
    await signIn(page, account);
    await page.goto("/review?month=2026-08");

    await expect(
      page.getByRole("heading", { name: "Aug 2026 review" }),
    ).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export PDF" }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe("fundflow-report-2026-08.pdf");
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(chunks);
    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes.subarray(0, 4).toString("latin1")).toBe("%PDF");

    // The export must not navigate the browser away from FundFlow: the Review
    // page stays mounted and usable after the download fires.
    await expect(page).toHaveURL(/\/review\?month=2026-08/);
    await expect(
      page.getByRole("heading", { name: "Aug 2026 review" }),
    ).toBeVisible();
  });
});