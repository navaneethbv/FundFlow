import { readFile } from "node:fs/promises";
import path from "node:path";
import { rolldown } from "rolldown";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";

let script: string;
let css: string;
const initial = "start=2028-02-01&end=2028-02-29&tab=spending&mode=trends&dimension=group&pending=exclude&scope=household&sort=amount&dir=asc&interval=weekly&comparison=previous_year&currency=EUR&account=checking&account=archived&merchant=Coffee&category=FOOD&page=7";

test.beforeAll(async () => {
  const root = process.cwd();
  const bundle = await rolldown({
    input: "report-controls-fixture",
    platform: "browser",
    onwarn(warning, warn) { if (warning.code !== "MODULE_LEVEL_DIRECTIVE") warn(warning); },
    resolve: { alias: { "@": root } },
    transform: { define: { "process.env.NODE_ENV": '"production"' }, jsx: "react-jsx" },
    plugins: [{
      name: "report-controls-fixture",
      resolveId(id) { if (["report-controls-fixture", "next/link", "node:crypto"].includes(id)) return `\0${id}`; },
      load(id) {
        if (id === "\0node:crypto") return 'export function createHash() { throw new Error("server hashing must not run in this fixture"); }';
        if (id === "\0next/link") return 'import {createElement} from "react"; export default function Link(props) { return createElement("a", {...props, onClick(event) { event.preventDefault(); history.pushState(null, "", props.href); window.dispatchEvent(new Event("popstate")); }}); }';
        if (id === "\0report-controls-fixture") return `
          import { createElement as h, useSyncExternalStore } from "react";
          import { createRoot } from "react-dom/client";
          import ReportControls from ${JSON.stringify(path.join(root, "components/reports/ReportControls.tsx"))};
          import { defaultReportFilters, reportFiltersFromSearchParams } from ${JSON.stringify(path.join(root, "lib/reports.ts"))};
          function Fixture() {
          const query = useSyncExternalStore(callback => { window.addEventListener("popstate", callback); return () => window.removeEventListener("popstate", callback); }, () => location.search);
          const search = new URLSearchParams(query);
          const params = Object.fromEntries([...new Set(search.keys())].map(key => [key, search.getAll(key)]));
          const filters = reportFiltersFromSearchParams(params, { ...defaultReportFilters("2028-02"), scope: search.get("scope") });
          const facets = { accounts: [{ value: "checking", label: "Everyday checking" }, { value: "cash", label: "Cash wallet" }], categories: [{ value: "FOOD", label: "Food and Drink" }, { value: "TRAVEL", label: "Travel" }], merchants: [{ value: "Coffee", label: "Coffee shop" }, { value: "Market", label: "Market" }] };
          return h("main", { style: { padding: 16 } }, h("h1", {}, "Report controls"), h(ReportControls, { filters, today: "2028-02-29", facets, householdId: "household" }));
          }
          createRoot(document.getElementById("root")).render(h(Fixture));
        `;
      },
    }],
  });
  try { script = (await bundle.generate({ format: "iife" })).output[0]!.code; } finally { await bundle.close(); }
  const source = path.join(root, "app/globals.css");
  css = (await postcss([tailwind()]).process(await readFile(source, "utf8"), { from: source })).css;
});

async function openFixture(page: Page, width: number) {
  await page.setViewportSize({ width, height: 1000 });
  await page.route("http://fundflow.test/**", (route) => route.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="en"><head><title>Reports fixture</title><style>${css}</style></head><body><div id="root"></div><script>${script}</script></body></html>` }));
  await page.goto(`http://fundflow.test/reports?${initial}`);
}

function expectPreserved(page: Page, overrides: Record<string, string | null> = {}) {
  const params = new URL(page.url()).searchParams;
  for (const [key, value] of Object.entries({ tab: "spending", mode: "trends", dimension: "group", pending: "exclude", scope: "household", sort: "amount", dir: "asc", interval: "weekly", comparison: "previous_year", currency: "EUR", ...overrides })) {
    expect(params.get(key), key).toBe(value);
  }
  expect(params.has("page")).toBe(false);
}

for (const width of [375, 1440]) {
  test(`report dates and navigation preserve selections at ${width}px`, async ({ page }) => {
    await openFixture(page, width);
    await page.getByRole("link", { name: "Previous period", exact: true }).click();
    await expect(page.getByLabel("From", { exact: true })).toHaveValue("2028-01-01");
    await expect(page.getByLabel("To", { exact: true })).toHaveValue("2028-01-31");
    expectPreserved(page);
    expect(new URL(page.url()).searchParams.getAll("account")).toEqual(["checking", "archived"]);
    await page.goBack();
    await expect(page.getByLabel("To", { exact: true })).toHaveValue("2028-02-29");

    await page.getByLabel("From", { exact: true }).fill("2028-02-10");
    await page.getByRole("link", { name: "Last 30 days", exact: true }).click();
    await expect(page.getByLabel("From", { exact: true })).toHaveValue("2028-01-31");
    expectPreserved(page);
    await page.getByLabel("From", { exact: true }).fill("2028-02-05");
    await page.getByLabel("To", { exact: true }).fill("2028-02-20");
    await page.getByRole("form", { name: "Report dates", exact: true }).getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page.getByLabel("From", { exact: true })).toHaveValue("2028-02-05");
    expectPreserved(page);
    expect(new URL(page.url()).searchParams.getAll("merchant")).toEqual(["Coffee"]);
    await expect(page.getByLabel("Account", { exact: true })).toHaveValues(["checking", "archived"]);
  });

  test(`report selectors, trend interval, comparison and clearing at ${width}px`, async ({ page }) => {
    const failures: string[] = [];
    page.on("pageerror", (error) => failures.push(error.message));
    await openFixture(page, width);
    await page.getByLabel("Account", { exact: true }).selectOption(["cash", "archived"]);
    await page.getByLabel("Category", { exact: true }).selectOption(["TRAVEL"]);
    await page.getByLabel("Merchant", { exact: true }).selectOption(["Market"]);
    await page.getByRole("button", { name: "Apply selections", exact: true }).click();
    await expect(page.getByLabel("Account", { exact: true })).toHaveValues(["cash", "archived"]);
    expectPreserved(page);
    expect(new URL(page.url()).searchParams.getAll("category")).toEqual(["TRAVEL"]);
    expect(new URL(page.url()).searchParams.getAll("merchant")).toEqual(["Market"]);

    await page.getByLabel("Trend interval", { exact: true }).selectOption("daily");
    await page.getByLabel("Compare with", { exact: true }).selectOption("previous_period");
    await page.getByRole("button", { name: "Apply analysis", exact: true }).click();
    await expect(page.getByLabel("Trend interval", { exact: true })).toHaveValue("daily");
    expectPreserved(page, { interval: "daily", comparison: "previous_period" });
    expect(new URL(page.url()).searchParams.getAll("account")).toEqual(["cash", "archived"]);

    await page.getByRole("link", { name: "archived Remove this filter", exact: true }).click();
    await expect(page.getByLabel("Account", { exact: true })).toHaveValues(["cash"]);
    expectPreserved(page, { interval: "daily", comparison: "previous_period" });
    await page.getByRole("link", { name: "Clear selections", exact: true }).click();
    await expect(page.getByLabel("Account", { exact: true })).toHaveValues([]);
    await expect(page.getByLabel("Category", { exact: true })).toHaveValues([]);
    await expect(page.getByLabel("Merchant", { exact: true })).toHaveValues([]);
    expectPreserved(page, { interval: "daily", comparison: "previous_period" });
    await page.goBack();
    await expect(page.getByLabel("Account", { exact: true })).toHaveValues(["cash"]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
    expect(failures).toEqual([]);
  });
}
