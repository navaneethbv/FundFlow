import { readFile } from "node:fs/promises";
import path from "node:path";
import { rolldown } from "rolldown";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";

// Synthetic component integration: no application server, credentials or live data.
let script: string;
let css: string;
const warning = "Some transactions are not shown because this range reached its bounded row limit.";

test.beforeAll(async () => {
  const root = process.cwd();
  const bundle = await rolldown({
    input: "report-print-fixture",
    platform: "browser",
    onwarn(message, warn) { if (message.code !== "MODULE_LEVEL_DIRECTIVE") warn(message); },
    resolve: { alias: { "@": root } },
    transform: { define: { "process.env.NODE_ENV": '"production"' }, jsx: "react-jsx" },
    plugins: [{
      name: "report-print-fixture",
      resolveId(id) {
        if (["report-print-fixture", "next/link", "node:crypto"].includes(id)) return `\0${id}`;
      },
      load(id) {
        if (id === "\0node:crypto") return 'export function createHash() { throw new Error("server hashing must not run in this fixture"); }';
        if (id === "\0next/link") return 'import { createElement } from "react"; export default function Link(props) { return createElement("a", props); }';
        if (id === "\0report-print-fixture") return `
          import { createElement as h } from "react";
          import { createRoot } from "react-dom/client";
          import ReportPrintContext from ${JSON.stringify(path.join(root, "components/reports/ReportPrintContext.tsx"))};
          import PrintReportButton from ${JSON.stringify(path.join(root, "components/reports/PrintReportButton.tsx"))};
          import ReportComparison from ${JSON.stringify(path.join(root, "components/reports/ReportComparison.tsx"))};
          import ReportSpendingHabits from ${JSON.stringify(path.join(root, "components/reports/ReportSpendingHabits.tsx"))};
          import ReportSummaryPanel from ${JSON.stringify(path.join(root, "components/reports/ReportSummaryPanel.tsx"))};
          import ReportTransactions from ${JSON.stringify(path.join(root, "components/reports/ReportTransactions.tsx"))};
          import PeriodBars from ${JSON.stringify(path.join(root, "components/cash-flow/PeriodBars.tsx"))};
          import Panel from ${JSON.stringify(path.join(root, "components/ui/Panel.tsx"))};
          import { defaultReportFilters, summarizeTransactions } from ${JSON.stringify(path.join(root, "lib/reports.ts"))};
          import { computePeriodCashFlow } from ${JSON.stringify(path.join(root, "lib/cash-flow.ts"))};
          import { buildReportComparison, buildReportSpendingHabits } from ${JSON.stringify(path.join(root, "lib/report-analysis.ts"))};
          const incomplete = new URLSearchParams(location.search).has("incomplete");
          const filters = { ...defaultReportFilters("2026-10"), accounts: ["checking"], scope: "household", excludePending: true };
          const rows = Array.from({ length: 55 }, (_, index) => ({
            id: "row-" + index, sourceTransactionId: "source-" + index,
            date: index < 3 ? "2026-10-01" : "2026-10-13",
            signedAmount: index === 0 ? -2000 : index === 1 ? 500 : index === 2 ? -25 : 10,
            flow: index === 0 ? "income" : index === 1 ? "transfer" : "expense",
            merchant: "Merchant " + String(index + 1).padStart(2, "0"),
            groupKey: index === 0 ? "INCOME" : "FOOD_AND_DRINK",
            categoryKey: index === 0 ? "INCOME_WAGES" : "FOOD_AND_DRINK_GROCERIES",
            accountId: "checking", manualAccountId: null, pending: false, source: "plaid",
          }));
          const current = { transactions: rows, startDate: filters.start, endDate: filters.end, currency: "EUR" };
          const reference = { ...current, startDate: "2026-09-01", endDate: "2026-09-30", transactions: [
            { ...rows[0], date: "2026-09-01", signedAmount: -1800 },
            { ...rows[3], date: "2026-09-13", signedAmount: 400 },
          ] };
          window.printCalls = 0;
          window.print = () => { window.printCalls += 1; };
          createRoot(document.getElementById("root")).render(h("div", { className: "reports-print-surface" },
            h("aside", { "aria-label": "Application sidebar", className: "p-4" }, "FundFlow sidebar"),
            h("nav", { "aria-label": "Main navigation", className: "px-4" }, h("a", { href: "/dashboard" }, "Dashboard")),
            h("main", { className: "mx-auto w-full max-w-6xl min-w-0 space-y-5 p-4" },
              h("header", { className: "flex flex-wrap items-center justify-between gap-3" }, h("h1", { className: "text-2xl font-semibold" }, "Reports"), h(PrintReportButton)),
              h("form", { "aria-label": "Fixture report controls" }, h("label", {}, "Report name", h("input", { name: "report-name", defaultValue: "October report", className: "ml-2 border border-panel-border" }))),
              h("p", { "data-report-no-print": true }, "Saved-report controls"),
              h(ReportPrintContext, { filters, currency: "EUR", page: 2, total: rows.length, accountNames: new Map([["checking", "Everyday checking"]]) }),
              incomplete && h(Panel, { tone: "warning" }, h("p", { role: "status" }, ${JSON.stringify(warning)}), h("p", {}, "Narrow the date range for complete totals — the CSV export is bounded the same way.")),
              h(ReportSummaryPanel, { summary: summarizeTransactions(rows), currency: "EUR" }),
              !incomplete && h(ReportComparison, { comparison: buildReportComparison(current, reference), referenceLabel: "Previous period" }),
              !incomplete && h(ReportSpendingHabits, { habits: buildReportSpendingHabits(current, "2026-10-13") }),
              h(Panel, { title: "Weekly cash flow", className: "reports-chart-panel" }, h("div", { className: "reports-chart-content" }, h(PeriodBars, { periods: computePeriodCashFlow(rows, "weekly"), currency: "EUR" }))),
              h(Panel, { title: "Transactions in this report", className: "min-w-0" }, h(ReportTransactions, { transactions: rows, currency: "EUR", page: 2, groupByDate: false, hrefForPage: page => "/reports?page=" + page }))
            )
          ));
        `;
      },
    }],
  });
  try { script = (await bundle.generate({ format: "iife" })).output[0]!.code; } finally { await bundle.close(); }
  const source = path.join(root, "app/globals.css");
  const printSource = path.join(root, "app/reports/print.css");
  const [globals, print] = await Promise.all([readFile(source, "utf8"), readFile(printSource, "utf8")]);
  css = (await postcss([tailwind()]).process(`${globals}\n${print}`, { from: source })).css;
});

async function openFixture(page: Page, width: number, incomplete = false) {
  const failures: string[] = [];
  page.on("pageerror", error => failures.push(error.message));
  page.on("console", message => { if (message.type() === "error" || message.type() === "warning") failures.push(message.text()); });
  await page.setViewportSize({ width, height: 1000 });
  await page.route("http://fundflow.test/**", route => route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><html lang="en" data-theme="light"><head><title>Reports print fixture</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><div id="root"></div></body></html>`,
  }));
  await page.goto(`http://fundflow.test/reports?page=2${incomplete ? "&incomplete=1" : ""}`);
  await page.addScriptTag({ content: script });
  await expect(page).toHaveTitle("Reports print fixture");
  await expect(page).toHaveURL(/\/reports\?page=2/);
  await expect(page.getByRole("heading", { name: "Reports", exact: true })).toBeVisible();
  await expect(page.locator("nextjs-portal, #webpack-dev-server-client-overlay, vite-error-overlay")).toHaveCount(0);
  return failures;
}

async function expectPageScope(page: Page) {
  const context = page.getByRole("region", { name: "Report context" });
  await expect(context).toBeVisible();
  await expect(context).toContainText("Oct 1, 2026 – Oct 31, 2026 · EUR");
  await expect(context).toContainText("Household · Pending excluded");
  await expect(context).toContainText("Filters: Everyday checking");
  await expect(context).toContainText("Transactions 51–55 of 55");
  await expect(context).toContainText("Summary covers all matching transactions; printing includes the displayed transaction page.");
  const transactions = page.getByRole("table", { name: "Transactions matching the current report filters.", exact: true });
  await expect(transactions).toBeVisible();
  await expect(transactions.locator("tbody tr")).toHaveCount(5);
  await expect(transactions.getByText("Merchant 51", { exact: true })).toBeVisible();
  await expect(transactions.getByText("Merchant 55", { exact: true })).toBeVisible();
  await expect(transactions.getByText("Merchant 01", { exact: true })).toHaveCount(0);
}

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

async function expectPrintChromeHidden(page: Page) {
  for (const selector of ["aside", "nav", "button", "form", "[data-report-no-print]"]) {
    const matches = page.locator(`.reports-print-surface ${selector}`);
    expect(await matches.count()).toBeGreaterThan(0);
    for (const element of await matches.all()) await expect(element).toBeHidden();
  }
}

for (const width of [375, 1440]) {
  test(`report analytics and private printing at ${width}px`, async ({ page }, info) => {
    const failures = await openFixture(page, width);
    await expectPageScope(page);
    await expect(page.getByRole("heading", { name: "Period comparison", exact: true })).toBeVisible();
    await expect(page.getByText("Previous period: 2026-09-01 to 2026-09-30", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Spending habits", exact: true })).toBeVisible();
    await expect(page.getByText("Elapsed range: 2026-10-01 to 2026-10-13", { exact: true })).toBeVisible();
    await expect(page.getByRole("table", { name: "Category spending changes in EUR", exact: true })).toBeVisible();
    await expect(page.getByRole("table", { name: "Weekday spending in EUR", exact: true })).toBeVisible();
    await expect(page.getByRole("img", { name: "Income vs Expenses with Net savings", exact: true })).toBeVisible();
    await page.getByText("View data table", { exact: true }).click();
    await expect(page.getByRole("columnheader", { name: "Net savings", exact: true })).toBeVisible();
    await expectNoOverflow(page);
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath(`report-screen-${width}.png`), fullPage: true });

    const printButton = page.getByRole("button", { name: "Print / Save PDF", exact: true });
    await printButton.focus();
    await expect(printButton).toBeFocused();
    await page.keyboard.press("Enter");
    expect(await page.evaluate(() => (window as unknown as { printCalls: number }).printCalls)).toBe(1);
    await page.evaluate(() => { document.documentElement.dataset.privacy = "blur"; });
    expect(await page.locator("[data-money]").count()).toBeGreaterThan(20);
    expect(await page.locator("[data-money], .money").evaluateAll(elements => elements.every(element => getComputedStyle(element).filter === "blur(9px)"))).toBe(true);

    await page.emulateMedia({ media: "print" });
    await expectPrintChromeHidden(page);
    await expectPageScope(page);
    await expect(page.getByRole("heading", { name: "Period comparison", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Spending habits", exact: true })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Net savings", exact: true })).toBeVisible();
    expect(await page.locator("[data-money], .money").evaluateAll(elements => elements.every(element => getComputedStyle(element).filter === "blur(9px)"))).toBe(true);
    await expectNoOverflow(page);
    await page.screenshot({ path: info.outputPath(`report-print-private-${width}.png`), fullPage: true });
    expect(failures).toEqual([]);
  });

  test(`incomplete report warning survives printing at ${width}px`, async ({ page }, info) => {
    const failures = await openFixture(page, width, true);
    await expect(page.getByRole("status")).toHaveText(warning);
    await expect(page.getByRole("heading", { name: "Period comparison", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Spending habits", exact: true })).toHaveCount(0);
    await expectNoOverflow(page);
    await page.getByRole("button", { name: "Print / Save PDF", exact: true }).click();
    expect(await page.evaluate(() => (window as unknown as { printCalls: number }).printCalls)).toBe(1);
    await page.emulateMedia({ media: "print" });
    await expectPrintChromeHidden(page);
    await expect(page.getByRole("status")).toBeVisible();
    await expect(page.getByRole("status")).toHaveText(warning);
    await expect(page.getByText("Narrow the date range for complete totals — the CSV export is bounded the same way.", { exact: true })).toBeVisible();
    await expectPageScope(page);
    await expectNoOverflow(page);
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath(`report-print-warning-${width}.png`), fullPage: true });
    expect(failures).toEqual([]);
  });
}

test("report tables support keyboard scrolling only while overflowing", async ({ page }) => {
  await openFixture(page, 375);
  for (const label of ["Category spending changes table", "Report transaction table"]) {
    const region = page.getByRole("region", { name: label, exact: true });
    await expect(region).toHaveAttribute("tabindex", "0");
    await region.focus();
    await expect(region).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => region.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const label of ["Category spending changes table", "Report transaction table"]) {
    await expect(page.getByRole("region", { name: label, exact: true })).not.toHaveAttribute("tabindex");
  }
});


test("scroll regions track vertical overflow and remove focus when it clears", async ({ page }) => {
  await openFixture(page, 1440);
  const region = page.getByRole("region", { name: "Report transaction table", exact: true });
  await expect(region).not.toHaveAttribute("tabindex");
  await region.evaluate(element => {
    element.style.maxHeight = "150px";
    element.style.overflowY = "auto";
  });
  await expect(region).toHaveAttribute("tabindex", "0");
  expect(await region.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await region.focus();
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => region.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await region.evaluate(element => { element.style.maxHeight = "none"; });
  await expect(region).not.toHaveAttribute("tabindex");
});
