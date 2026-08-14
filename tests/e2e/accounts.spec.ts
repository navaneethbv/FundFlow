import { expect, test, type Locator, type Page } from "@playwright/test";
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
const SCREENSHOT_DIR = process.env.ACCOUNTS_E2E_SCREENSHOT_DIR;
const stamp = Date.now();
const password = "AccountsE2E-Password-123!";
const ownerEmail = `accounts-e2e-owner-${stamp}@example.com`;
const memberEmail = `accounts-e2e-member-${stamp}@example.com`;

test.describe.serial("accounts page", () => {
  // Intentional skip: this live acceptance suite needs disposable Supabase credentials.
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
    test.setTimeout(120_000);
    // `url` alongside `text`: a bare message leaves you guessing which of a
    // dozen navigations produced it. Kept as a separate field so the
    // known-noise filter below still matches against the raw message.
    const consoleIssues: Array<{ url: string; text: string }> = [];
    const pageErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") {
        consoleIssues.push({ url: page.url(), text: message.text() });
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

    // The GET filter form lives behind a collapsible "Filters" disclosure,
    // closed by default (no active filter yet) — open it before touching
    // the fields inside.
    await page.getByText("Filters", { exact: true }).click();
    await page.getByLabel("Institution").selectOption({
      label: "Demo Bank (sample data)",
    });
    await page.getByLabel("Account type").selectOption("cash");
    await page.getByLabel("Visibility").selectOption("all");
    // Anchored regex, not a bare string: getByLabel substring-matches, and
    // every row's long sparkline is labelled "<name> full-history trend".
    // `exact` can't be used either — the wrapping <label> puts the option text
    // in the name, so this field's label reads "History30 days90 days12 months".
    await page.getByLabel(/^History/).selectOption("90");
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
    // Account preferences now live inside the same Filters disclosure —
    // open it first.
    await page.getByText("Filters", { exact: true }).click();
    // Locate via the summary's own parent rather than filtering `details`
    // by text content: the outer Filters `<details>` now also contains this
    // phrase (as a nested descendant), so a text-content filter on
    // `details` would match both and be ambiguous.
    const preferencesSummary = page.getByText("Account visibility and order", {
      exact: true,
    });
    const preferences = preferencesSummary.locator("xpath=..");
    await preferencesSummary.click();
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
    // Wait for the scope navigation to land before touching the disclosure.
    // The page we came from (`?visibility=hidden`) has an active filter, so its
    // Filters `<details>` is already open; clicking mid-navigation would toggle
    // that one *closed*, and the scope render then arrives closed too. That
    // race is what made this spec fail intermittently at different lines.
    await expect(page).toHaveURL(/scope=/);
    // Switching scope drops the other filter params, so the disclosure is
    // closed on arrival — open it.
    await page.getByText("Filters", { exact: true }).click();
    // Anchored: the sidebar's "Account menu for <email>" button matches a bare
    // "Owner" whenever the signed-in address happens to contain it, as the
    // throwaway owner fixture's does.
    await page.getByLabel(/^Owner/).selectOption(memberId);
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
    // Open the Filters disclosure so its fields (and the nested account
    // preferences trigger) are actually rendered/interactable for the sweep.
    await page.getByText("Filters", { exact: true }).click();
    // The privacy, theme and sign-out controls moved into the sidebar's account
    // menu popover, so they are not in the DOM until it is opened. Everything
    // else in the sweep lives on the page itself.
    await page.getByRole("button", { name: /^Account menu/ }).click();
    // Named, so a failure says *which* control is undersized rather than just
    // reporting a number.
    const touchTargets: Array<[string, Locator]> = [
      ["Hide amounts", page.getByRole("button", { name: "Hide amounts" })],
      ["Theme switch", page.getByRole("button", { name: /Switch to .* mode/ })],
      ["Sign out", page.getByRole("button", { name: "Sign out" })],
      ["Connect a bank", page.getByRole("button", { name: "Connect a bank" })],
      ["Refresh", page.getByRole("button", { name: "Refresh" })],
      ["Download CSV", page.getByRole("link", { name: "Download CSV" })],
      ["Filters summary", page.getByText("Filters", { exact: true })],
      ["Institution", page.getByLabel("Institution")],
      ["Account type", page.getByLabel("Account type")],
      ["Visibility", page.getByLabel("Visibility")],
      ["History", page.getByLabel(/^History/)],
      ["Apply filters", page.getByRole("button", { name: "Apply filters" })],
      ["Totals", page.getByRole("link", { name: "Totals" })],
      ["Percent", page.getByRole("link", { name: "Percent" })],
    ];
    for (const [name, target] of touchTargets) {
      const box = await target.boundingBox();
      expect(box, `${name} touch target must be rendered`).not.toBeNull();
      expect(
        box!.height,
        `${name} touch target must be at least 44px high`,
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
          // See cash-flow.spec.ts: the default `caret: "hide"` mutates inline
          // styles and races hydration on the next reload.
          caret: "initial",
        });
      }
    }

    const unexpectedConsoleIssues = consoleIssues
      .filter(({ text }) => !isKnownEnvironmentNoise(text))
      .map(({ url, text }) => `[${url}] ${text}`);
    expect(pageErrors).toEqual([]);
    expect(failedAppRequests).toEqual([]);
    expect(failedAppResponses).toEqual([]);
    expect(unexpectedConsoleIssues).toEqual([]);
  });
});
