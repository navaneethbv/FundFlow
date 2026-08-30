import { hasLiveCredentials, test, expect } from "./fixtures/authenticated";

const FORECASTING_ON = (process.env.FUNDFLOW_FEATURE_FLAGS ?? "")
  .split(",")
  .map((name) => name.trim())
  .includes("forecastingPage");

test.describe("life-event forecasting", () => {
  test.skip(
    !hasLiveCredentials || !FORECASTING_ON,
    "Live credentials and the forecasting feature are required",
  );

  test("adds, edits, and removes an assumption while recalibrating the chart", async ({
    authenticatedPage: page,
  }) => {
    let savedStartMonth = 2;
    await page.route("**/api/forecasting/life-events", async (route) => {
      const request = route.request();
      const body = request.postDataJSON() as Record<string, unknown>;
      if (request.method() === "DELETE") {
        await route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
        return;
      }
      savedStartMonth = Number(body.startMonth);
      await route.fulfill({
        status: request.method() === "POST" ? 201 : 200,
        contentType: "application/json",
        body: JSON.stringify({
          event: {
            id: "11111111-1111-4111-8111-111111111111",
            type: body.type,
            startMonth: savedStartMonth,
            amount: body.amount,
            durationMonths: body.durationMonths,
            label: null,
          },
        }),
      });
    });

    await page.goto("/forecasting");
    await expect(page.getByRole("heading", { name: "Forecasting" })).toBeVisible();
    const chartPaths = page.locator('svg[aria-label="Net worth projection"] path');
    const originalPaths = await chartPaths.evaluateAll((paths) =>
      paths.map((path) => path.getAttribute("d")).join("|"),
    );

    await page.getByLabel("Event").selectOption("income_change");
    await page.getByLabel("Start month").fill("2");
    await page.getByLabel("Amount").fill("1000");
    await page.getByRole("button", { name: "Add event" }).click();
    await expect(
      page.getByRole("listitem").filter({ hasText: "Income change" }),
    ).toBeVisible();
    const addedPaths = await chartPaths.evaluateAll((paths) =>
      paths.map((path) => path.getAttribute("d")).join("|"),
    );
    expect(addedPaths).not.toBe(originalPaths);

    await page.getByRole("button", { name: "Edit Income change event" }).click();
    await page.getByLabel("Start month").fill("3");
    await page.getByRole("button", { name: "Save changes" }).click();
    expect(savedStartMonth).toBe(3);

    await page.getByRole("button", { name: "Remove Income change event" }).click();
    await expect(page.getByText("No life events configured.")).toBeVisible();
  });
});
