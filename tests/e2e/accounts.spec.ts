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
const SCREENSHOT_DIR = process.env.ACCOUNTS_E2E_SCREENSHOT_DIR;
const stamp = Date.now();
const password = "AccountsE2E-Password-123!";
const ownerEmail = `accounts-e2e-owner-${stamp}@example.com`;
const memberEmail = `accounts-e2e-member-${stamp}@example.com`;

test.describe.serial("accounts page", () => {
  test.skip(!RUN, "Supabase browser and service credentials are required");

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
        name: "Accounts E2E household",
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

    const { data: item, error: itemError } = await admin
      .from("plaid_items")
      .insert({
        user_id: memberId,
        plaid_item_id: `accounts-e2e-shared-item-${stamp}`,
        institution_name: "Shared Test Bank",
        access_token_ciphertext: "e2e",
        access_token_iv: "e2e",
        access_token_tag: "e2e",
        shared_household_id: household.id,
      })
      .select("id")
      .single();
    if (itemError) throw itemError;

    const { data: account, error: accountError } = await admin
      .from("accounts")
      .insert({
        user_id: memberId,
        plaid_item_id: item.id,
        plaid_account_id: `accounts-e2e-shared-account-${stamp}`,
        name: "Shared Savings",
        type: "depository",
        subtype: "savings",
        current_balance: 900,
        available_balance: 900,
        iso_currency_code: "USD",
      })
      .select("id")
      .single();
    if (accountError) throw accountError;

    const { error: snapshotError } = await admin
      .from("account_balance_snapshots")
      .insert({
        user_id: memberId,
        account_id: account.id,
        snapshot_date: new Date().toISOString().slice(0, 10),
        current_balance: 900,
        available_balance: 900,
        iso_currency_code: "USD",
      });
    if (snapshotError) throw snapshotError;
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

  test("renders, filters, exports, and remains responsive in both themes", async ({
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

    const demoResponse = await page.request.post("/api/demo");
    expect(demoResponse.status()).toBe(200);
    const manualResponse = await page.request.post("/api/manual-accounts", {
      data: {
        name: "Brokerage Reserve",
        accountType: "investment",
        balance: 2000,
        includeInNetWorth: true,
      },
    });
    expect(manualResponse.status()).toBe(201);

    await page.goto("/accounts");
    await expect(page.getByRole("heading", { name: "Accounts" })).toBeVisible();
    await expect(
      page.getByRole("listitem").filter({ hasText: "Demo Checking" }),
    ).toBeVisible();
    await expect(
      page.getByRole("listitem").filter({ hasText: "Demo Rewards Card" }),
    ).toBeVisible();
    await expect(
      page.getByRole("listitem").filter({ hasText: "Brokerage Reserve" }),
    ).toBeVisible();
    await expect(
      page.locator("summary").getByText("Cash", { exact: true }),
    ).toBeVisible();
    await expect(
      page.locator("summary").getByText("Credit cards", { exact: true }),
    ).toBeVisible();
    await expect(
      page.locator("summary").getByText("Investments", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("$5,580.25", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText(/Daily balance history starts on .* Earlier history is unavailable\./),
    ).toBeVisible();

    await page.getByRole("link", { name: "Percent" }).click();
    await expect(page).toHaveURL(/summary=percent/);
    await expect(
      page.getByText("Not enough history", { exact: true }).first(),
    ).toBeVisible();
    await page.getByRole("link", { name: "Totals" }).click();

    await page.getByLabel("Institution").selectOption({
      label: "Demo Bank (sample data)",
    });
    await page.getByLabel("Account type").selectOption("cash");
    await page.getByLabel("Visibility").selectOption("all");
    await page.getByLabel("History").selectOption("90");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page).toHaveURL(/institution=Demo\+Bank/);
    await expect(page).toHaveURL(/type=cash/);
    await expect(page).toHaveURL(/visibility=all/);
    await expect(page).toHaveURL(/range=90/);
    await expect(
      page.getByRole("listitem").filter({ hasText: "Demo Checking" }),
    ).toBeVisible();
    await expect(
      page.getByRole("listitem").filter({ hasText: "Demo Rewards Card" }),
    ).toBeHidden();

    await page.goto("/accounts");
    const preferences = page
      .locator("details")
      .filter({ hasText: "Account visibility and order" });
    await preferences
      .getByText("Account visibility and order", { exact: true })
      .click();
    const checkingPreference = preferences
      .locator("div")
      .filter({ hasText: /^Demo Checking \(\.\.\.0001\)UpDownHide$/ })
      .first();
    await checkingPreference.getByRole("button", { name: "Hide" }).click();
    await page.getByRole("button", { name: "Save preferences" }).click();
    await expect(page.getByText("Account preferences saved.")).toBeVisible();

    await page.goto("/accounts?visibility=hidden");
    await expect(
      page.getByRole("listitem").filter({ hasText: "Demo Checking" }),
    ).toBeVisible();
    await expect(
      page.getByRole("listitem").filter({ hasText: "Demo Rewards Card" }),
    ).toBeHidden();

    await page.getByRole("link", { name: "Household" }).click();
    await page.getByLabel("Owner").selectOption(memberId);
    await page.getByLabel("Visibility").selectOption("visible");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page).toHaveURL(new RegExp(`owner=${memberId}`));
    await expect(
      page.getByRole("listitem").filter({ hasText: "Shared Savings" }),
    ).toBeVisible();
    await expect(
      page.getByRole("listitem").filter({ hasText: "Demo Checking" }),
    ).toBeHidden();

    const csvResponse = await page.request.get("/api/export/accounts-csv");
    expect(csvResponse.status()).toBe(200);
    expect((await csvResponse.text()).split(/\r?\n/, 1)[0]).toBe(
      "group,name,subtype,balance,currency,as_of",
    );

    await page.goto("/accounts");
    const touchTargets = [
      page.getByRole("button", { name: "Hide amounts" }),
      page.getByRole("button", { name: /Switch to .* mode/ }),
      page.getByRole("button", { name: "Sign out" }),
      page.getByRole("button", { name: "Connect a bank" }),
      page.getByRole("button", { name: "Refresh" }),
      page.getByRole("link", { name: "Export CSV" }),
      page.getByLabel("Institution"),
      page.getByLabel("Account type"),
      page.getByLabel("Visibility"),
      page.getByLabel("History"),
      page.getByRole("button", { name: "Apply filters" }),
      page.getByRole("link", { name: "Totals" }),
      page.getByRole("link", { name: "Percent" }),
    ];
    for (const target of touchTargets) {
      const box = await target.boundingBox();
      expect(box, "touch target must be rendered").not.toBeNull();
      expect(box!.height, "touch target must be at least 44px high").toBeGreaterThanOrEqual(
        44,
      );
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
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        const devToolsButton = page.getByRole("button", {
          name: "Open Next.js Dev Tools",
        });
        if ((await devToolsButton.count()) === 1) {
          await devToolsButton.evaluate((element) => {
            element.style.display = "none";
          });
        }
        await page.evaluate(() => {
          document.querySelectorAll("nextjs-portal").forEach((element) => {
            (element as HTMLElement).style.display = "none";
          });
        });
        const hasOverflow = await page.evaluate(
          () =>
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth,
        );
        expect(hasOverflow).toBe(false);
        await expect(
          page.getByRole("heading", { name: "Accounts" }),
        ).toBeVisible();

        const screenshotPath = SCREENSHOT_DIR
          ? path.join(
              SCREENSHOT_DIR,
              `accounts-${viewport.name}-${theme}.png`,
            )
          : undefined;
        await page.screenshot({
          path: screenshotPath,
          fullPage: true,
          animations: "disabled",
        });
      }
    }

    const unexpectedConsoleIssues = consoleIssues.filter(
      (message) =>
        !/^\[\.WebGL-/.test(message) &&
        message !== "No available adapters." &&
        !/^Failed to load resource: net::ERR_NAME_NOT_RESOLVED$/.test(message),
    );
    expect(pageErrors).toEqual([]);
    expect(failedAppRequests).toEqual([]);
    expect(failedAppResponses).toEqual([]);
    expect(unexpectedConsoleIssues).toEqual([]);
  });
});
