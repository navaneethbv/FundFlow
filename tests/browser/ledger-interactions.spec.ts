import { readFile } from "node:fs/promises";
import path from "node:path";
import { rolldown } from "rolldown";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";

let script: string;
let css: string;

test.beforeAll(async () => {
  const root = process.cwd();
  const bundle = await rolldown({
    input: "ledger-interactions-fixture",
    platform: "browser",
    onwarn(warning, warn) { if (warning.code !== "MODULE_LEVEL_DIRECTIVE") warn(warning); },
    resolve: { alias: { "@": root } },
    transform: { define: { "process.env.NODE_ENV": '"production"' }, jsx: "react-jsx" },
    plugins: [{
      name: "ledger-interactions-fixture",
      resolveId(id) {
        if (["ledger-interactions-fixture", "next/navigation", "node:crypto"].includes(id)) return `\0${id}`;
      },
      load(id) {
        if (id === "\0next/navigation") return 'export function useRouter() { return { refresh() {}, push(url) { history.pushState(null, "", url); window.dispatchEvent(new Event("popstate")); } }; }';
        if (id === "\0node:crypto") return 'export function createHash() { throw new Error("server hashing must not run in this fixture"); }';
        if (id === "\0ledger-interactions-fixture") return `
          import { createElement as h, useState, useSyncExternalStore } from "react";
          import { createRoot } from "react-dom/client";
          import LedgerKeyboardNavigation from ${JSON.stringify(path.join(root, "components/transactions/LedgerKeyboardNavigation.tsx"))};
          import BulkEditBar from ${JSON.stringify(path.join(root, "components/transactions/BulkEditBar.tsx"))};
          import TransactionEditor from ${JSON.stringify(path.join(root, "components/transactions/TransactionEditor.tsx"))};
          import TransactionQueryControls from ${JSON.stringify(path.join(root, "components/transactions/TransactionQueryControls.tsx"))};
          import AddManualHoldingForm from ${JSON.stringify(path.join(root, "components/investments/AddManualHoldingForm.tsx"))};
          import { parseLedgerQuery, ledgerQueryEntries } from ${JSON.stringify(path.join(root, "lib/ledger-query.ts"))};
          function FiltersFixture() {
            const search = useSyncExternalStore(callback => { window.addEventListener("popstate", callback); return () => window.removeEventListener("popstate", callback); }, () => location.search);
            const state = parseLedgerQuery(Object.fromEntries(new URLSearchParams(search)));
            return h("main", { style: { padding: 16 } }, h("h1", {}, "Transaction filters"), h(TransactionQueryControls, { key: search, committed: state, entries: ledgerQueryEntries(state), options: { accounts: [], categories: [], subcategoriesByCategory: {}, merchants: [] } }));
          }
          function Fixture() {
            const [selected, setSelected] = useState(false);
            return h("main", { style: { padding: 16 } },
              h("h1", {}, "Ledger interactions"),
              h(BulkEditBar, { enabled: true }),
              h(LedgerKeyboardNavigation, { enabled: true },
                h("div", { "data-ledger-row": true, "data-ledger-row-id": "11111111-1111-4111-8111-111111111111", tabIndex: 0, "aria-label": "Transaction Coffee" },
                  h("input", { type: "checkbox", "data-bulk-select": true, "data-transaction-id": "11111111-1111-4111-8111-111111111111", "aria-label": "Select Coffee", onChange: event => setSelected(event.currentTarget.checked) }), h("span", {}, "Coffee"),
                  h(TransactionEditor, { detailsEnabled: true, undoEnabled: true, cleared: true, transaction: { id: "11111111-1111-4111-8111-111111111111", merchant: "Coffee", amount: 4.5, currency: "USD" }, note: null, tags: [], splits: [], categories: ["FOOD"], providerCategory: "FOOD" })
                ),
                h("div", { "data-ledger-row": true, "data-ledger-row-id": "22222222-2222-4222-8222-222222222222", tabIndex: 0, "aria-label": "Transaction Rent" }, h("span", {}, "Rent"), h("button", { type: "button", "data-transaction-detail-trigger": true }, "Details for Rent"))
              ),
              h("p", {}, selected ? "selected" : "not selected")
            );
          }
          createRoot(document.getElementById("root")).render(window.filtersFixture ? h(FiltersFixture) : window.holdingFixture ? h("main", { style: { padding: 16 } }, h("h1", {}, "Investments"), h(AddManualHoldingForm, { accounts: [{ source: "manual", id: "account", name: "Brokerage" }] })) : h(Fixture));
        `;
      },
    }],
  });
  try { script = (await bundle.generate({ format: "iife" })).output[0]!.code; } finally { await bundle.close(); }
  const source = path.join(root, "app/globals.css");
  css = (await postcss([tailwind()]).process(await readFile(source, "utf8"), { from: source })).css;
});

for (const width of [375, 1440]) {
  test(`ledger keyboard and bulk interactions at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const writes: string[] = [];
    await page.route("http://fundflow.test/**", async (route) => {
      const url = new URL(route.request().url());
      if (!url.pathname.startsWith("/api/")) return route.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="en"><head><title>Ledger interactions</title><style>${css}</style></head><body><div id="root"></div></body></html>` });
      writes.push(url.pathname);
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ updated: 1 }) });
    });
    await page.goto("http://fundflow.test/");
    await page.evaluate(() => {
      const listeners = new Set<EventListenerOrEventListenerObject>();
      const add = window.addEventListener.bind(window);
      const remove = window.removeEventListener.bind(window);
      window.addEventListener = (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
        if (type.startsWith("fundflow:transaction-detail")) listeners.add(listener);
        add(type, listener, options);
      };
      window.removeEventListener = (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => {
        if (type.startsWith("fundflow:transaction-detail")) listeners.delete(listener);
        remove(type, listener, options);
      };
      Object.assign(window, { detailListenerCount: () => listeners.size });
    });
    await page.addScriptTag({ content: script });
    const row = page.locator("[data-ledger-row]").first();
    await expect(row).toHaveCount(1);
    const listenerCount = () => page.evaluate(() => (window as unknown as { detailListenerCount: () => number }).detailListenerCount());
    await expect.poll(listenerCount).toBe(0);
    await row.focus();
    await page.keyboard.press("j");
    await expect(page.locator("[data-ledger-row]").nth(1)).toBeFocused();
    await page.keyboard.press("k");
    await expect(row).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect.poll(listenerCount).toBe(2);
    await expect(page.getByRole("checkbox", { name: "Cleared" })).toBeChecked();
    await page.getByRole("checkbox", { name: "Cleared" }).uncheck();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect.poll(listenerCount).toBe(0);
    await row.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("checkbox", { name: "Cleared" })).toBeChecked();
    await page.keyboard.press("Escape");
    await page.keyboard.press("x");
    await expect(page.getByText("1 selected")).toBeVisible();
    await page.getByRole("button", { name: "Add tag" }).click();
    await page.getByLabel("Tag").fill("trip");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByText("1 transaction updated")).toBeVisible();
    expect(writes).toContain("/api/transactions/bulk-edit");
    const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(accessibility.violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

for (const width of [375, 640, 768, 1440]) {
  test(`amount, status and date filters at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.route("http://fundflow.test/**", route => route.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="en"><head><title>Filters</title><style>${css}</style></head><body><div id="root"></div><script>window.filtersFixture=true</script></body></html>` }));
    await page.goto("http://fundflow.test/transactions?year=2026&day=2026-09-01&page=3");
    await page.addScriptTag({ content: script });
    await expect(page.getByRole("button", { name: "Remove day filter 2026-09-01" })).toBeVisible();
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    const withinViewport = () => page.getByRole("dialog").evaluate(el => {
      const rect = el.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= innerWidth;
    });
    expect(await withinViewport()).toBe(true);
    await page.getByLabel("Minimum amount").fill("50");
    await page.getByLabel("Maximum amount").fill("10");
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText("Minimum amount cannot exceed maximum amount.");
    await page.getByLabel("Minimum amount").fill("1.001");
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("at most two decimal places");
    await page.getByLabel("Minimum amount").fill("0");
    await page.getByLabel("Posting status").selectOption("pending");
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page).toHaveURL(/minAmount=0&maxAmount=10&status=pending/);
    expect(new URL(page.url()).searchParams.has("page")).toBe(false);
    await expect(page.getByRole("button", { name: "Remove posting status filter" })).toBeVisible();
    await page.getByRole("button", { name: "Filters (3)", exact: true }).click();
    await page.screenshot({ path: info.outputPath("amount-status-filters.png"), fullPage: true });
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Date", exact: true }).click();
    expect(await withinViewport()).toBe(true);
    await page.getByLabel("Month", { exact: true }).fill("2026-10");
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page.getByRole("button", { name: "Remove day filter 2026-09-01" })).toHaveCount(0);
    expect(new URL(page.url()).searchParams.has("year")).toBe(false);
    await page.getByRole("button", { name: "Clear filters", exact: true }).click();
    await expect(page).toHaveURL("http://fundflow.test/transactions");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("manual holding network failure preserves the accessible draft for retry", async ({ page }) => {
  const failures: string[] = [];
  page.on("pageerror", error => failures.push(error.message));
  let offline = true;
  await page.route("http://fundflow.test/**", route => {
    if (route.request().url().includes("/api/")) return offline ? route.abort("failed") : route.fulfill({ json: { ok: true } });
    return route.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="en"><head><title>Holdings</title><style>${css}</style></head><body><div id="root"></div><script>window.holdingFixture=true</script></body></html>` });
  });
  await page.goto("http://fundflow.test/");
  await page.addScriptTag({ content: script });
  await page.getByRole("button", { name: "Add holding" }).click();
  await page.getByLabel("Security name", { exact: true }).fill("Private fund");
  await page.getByLabel("Quantity", { exact: true }).fill("2");
  await page.getByLabel("Price", { exact: true }).fill("100");
  await expect(page.getByLabel("Account", { exact: true })).toHaveValue("manual:account");
  await expect(page.getByLabel("As of", { exact: true })).toHaveValue(/\d{4}-\d{2}-\d{2}/);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Check your connection");
  await expect(page.getByLabel("Security name", { exact: true })).toHaveValue("Private fund");
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  offline = false;
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(failures).toEqual([]);
});
