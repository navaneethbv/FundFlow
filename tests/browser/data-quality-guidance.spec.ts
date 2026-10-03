import { readFile } from "node:fs/promises";
import path from "node:path";
import { rolldown } from "rolldown";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";
let script: string, css: string;
test.beforeAll(async () => {
  const root = process.cwd();
  const bundle = await rolldown({
    input: "guidance-fixture",
    platform: "browser",
    onwarn(warning, warn) {
      if (warning.code !== "MODULE_LEVEL_DIRECTIVE") warn(warning);
    },
    resolve: { alias: { "@": root } },
    transform: {
      define: { "process.env.NODE_ENV": '"production"' },
      jsx: "react-jsx",
    },
    plugins: [
      {
        name: "guidance-fixture",
        resolveId(id) {
          if (["guidance-fixture", "next/navigation", "next/link"].includes(id))
            return `\0${id}`;
          if (/\/(ReconnectBankButton|RepairBankButton)$/.test(id))
            return "\0provider-action";
        },
        load(id) {
          if (id === "\0next/navigation")
            return 'export function useRouter() { return { refresh() { document.body.dataset.refreshed = "true"; } }; }';
          if (id === "\0next/link")
            return 'import { createElement } from "react"; export default function Link(props) { return createElement("a", props); }';
          if (id === "\0provider-action")
            return "export default function ProviderAction() { return null; }";
          if (id === "\0guidance-fixture")
            return `
        import { createElement as h } from "react"; import { createRoot } from "react-dom/client";
        import Reviews from ${JSON.stringify(path.join(root, "components/accounts/BalanceReviewQueue.tsx"))};
        import Connections from ${JSON.stringify(path.join(root, "components/settings/ConnectionHealth.tsx"))};
        import Payday from ${JSON.stringify(path.join(root, "components/settings/PaydaySettingsForm.tsx"))};
        import Plan from ${JSON.stringify(path.join(root, "components/recurring/PaycheckPlan.tsx"))};
        import Allowance from ${JSON.stringify(path.join(root, "components/dashboard/BudgetAllowanceTile.tsx"))};
        import History from ${JSON.stringify(path.join(root, "components/accounts/NetWorthHero.tsx"))};
        import { planPaychecks } from ${JSON.stringify(path.join(root, "lib/paycheck-planner.ts"))};
        const settings = { cadence: "weekly", anchorDate: "2026-10-05", amount: 100, day1: 5, day2: null };
        createRoot(document.getElementById("root")).render(h("div", { className: "space-y-6" },
          h(Reviews, { accounts: { checking: "Checking" }, reviews: [{ id: "review", account_id: "checking", snapshot_date: "2026-10-01", observed_at: "2026-10-01T12:00:00Z", raw_balance: 8000, anchor_balance: 2000, anchor_date: "2026-09-30", currency: "USD", reasons: ["balance_jump"], decision: "pending", version: "version", superseded_at: null }] }),
          h(Connections, { manualAccounts: 1, rows: [{ id: "bank", name: "Example Bank", state: "account_review", linkedAccounts: 1, pendingReviews: 1, lastSuccessAt: null, detail: "Provider balances need review." }] }),
          h(Payday, { stored: null, today: "2026-10-01", suggested: { name: "Salary", amount: 100, frequency: "weekly", nextPayDate: "2026-10-05" } }),
          h(Plan, { cash: null, periods: planPaychecks({ today: "2026-10-01", settings, cash: null, bills: [{ id: "bill", name: "Rent", dueDate: "2026-10-20", amount: 350 }] }) }),
          h(Allowance, { allowance: { budget: 1000, spent: 800, left: 200, daily: 6.45, daysLeft: 31, monthEnd: "2026-10-31", nextPayday: "2026-10-05", daysUntilPayday: 4 } }),
          h(History, { historyStartsOn: "2026-09-30", summary: { currencies: ["USD"], netWorth: [{ currency: "USD", amount: 8000 }], netWorthMonthChange: { USD: null }, netWorthSeries: { USD: [{ date: "2026-09-30", value: 2000, labels: ["Checking: Observed"] }, { date: "2026-10-01", value: 2000, estimated: true, labels: ["Checking: Stale: carried from 2026-09-30"] }] } } })
        ));`;
        },
      },
    ],
  });
  try {
    script = (await bundle.generate({ format: "iife" })).output[0]!.code;
  } finally {
    await bundle.close();
  }
  const source = path.join(root, "app/globals.css");
  css = (
    await postcss([tailwind()]).process(await readFile(source, "utf8"), {
      from: source,
    })
  ).css;
});
for (const width of [375, 1440])
  for (const theme of ["light", "dark"]) {
    test(`six-feature guidance at ${width}px in ${theme}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      const submitted: Array<{ url: string; body: unknown }> = [];
      await page.route("http://fundflow.test/**", async (route) => {
        if (route.request().url().includes("/api/")) {
          submitted.push({
            url: route.request().url(),
            body: route.request().postDataJSON(),
          });
          await route.fulfill({
            contentType: "application/json",
            body: '{"ok":true}',
          });
        } else
          await route.fulfill({
            contentType: "text/html",
            body: `<!doctype html><html lang="en" data-theme="${theme}"><head><title>Data quality and guidance</title><style>${css}</style></head><body><main style="padding:16px;max-width:1100px;margin:auto"><h1>Data quality and guidance</h1><div id="root"></div></main></body></html>`,
          });
      });
      await page.goto("http://fundflow.test/");
      await page.addScriptTag({ content: script });
      await expect(page.getByText("Raw provider value")).toBeVisible();
      // Start at the document and use keyboard navigation for both mutations.
      for (
        let i = 0;
        i < 8 &&
        !(await page
          .getByRole("button", { name: "Keep previous in history" })
          .evaluate((el) => el === document.activeElement));
        i++
      )
        await page.keyboard.press("Tab");
      await expect(
        page.getByRole("button", { name: "Keep previous in history" }),
      ).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.getByText(/Stale history value/)).toBeVisible();
      expect(submitted[0]?.body).toEqual({
        reviewId: "review",
        version: "version",
        decision: "carried",
      });
      await page
        .getByRole("button", { name: "Use suggestion in form" })
        .focus();
      await page.keyboard.press("Enter");
      expect(submitted).toHaveLength(1);
      await expect(page.getByLabel("Next payday", { exact: true })).toHaveValue(
        "2026-10-05",
      );
      await page.getByLabel("Expected take-home pay (USD)").focus();
      await page.keyboard.press("Tab");
      await expect(
        page.getByRole("button", { name: "Confirm payday", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(
        page.getByText(
          "Payday confirmed. Your schedule now drives payday guidance.",
        ),
      ).toBeVisible();
      expect(submitted[1]?.body).toMatchObject({
        cadence: "weekly",
        amount: 100,
        anchorDate: "2026-10-05",
      });
      await expect(
        page.getByText("Cash is unknown; bridge coverage cannot be assessed."),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Budget daily allowance" }),
      ).toBeVisible();
      const summary = page
        .locator("summary")
        .filter({ hasText: /daily balance table/ });
      await summary.focus();
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("cell", {
          name: "Checking: Stale: carried from 2026-09-30",
        }),
      ).toBeVisible();
      expect(
        await page.locator('svg path[stroke-dasharray="5 4"]').count(),
      ).toBeGreaterThan(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.screenshot({
        path: testInfo.outputPath("guidance.png"),
        fullPage: true,
      });
    });
  }
