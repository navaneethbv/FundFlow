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
        if (id === "\0next/navigation") return 'export function useRouter() { return { refresh() {} }; }';
        if (id === "\0node:crypto") return 'export function createHash() { throw new Error("server hashing must not run in this fixture"); }';
        if (id === "\0ledger-interactions-fixture") return `
          import { createElement as h, useState } from "react";
          import { createRoot } from "react-dom/client";
          import LedgerKeyboardNavigation from ${JSON.stringify(path.join(root, "components/transactions/LedgerKeyboardNavigation.tsx"))};
          import BulkEditBar from ${JSON.stringify(path.join(root, "components/transactions/BulkEditBar.tsx"))};
          import TransactionEditor from ${JSON.stringify(path.join(root, "components/transactions/TransactionEditor.tsx"))};
          function Fixture() {
            const [selected, setSelected] = useState(false);
            return h("main", { style: { padding: 16 } },
              h("h1", {}, "Ledger interactions"),
              h(BulkEditBar, { enabled: true }),
              h(LedgerKeyboardNavigation, { enabled: true },
                h("div", { "data-ledger-row": true, "data-ledger-row-id": "11111111-1111-4111-8111-111111111111", tabIndex: 0, "aria-label": "Transaction Coffee" },
                  h("input", { type: "checkbox", "data-bulk-select": true, "data-transaction-id": "11111111-1111-4111-8111-111111111111", "aria-label": "Select Coffee", onChange: event => setSelected(event.currentTarget.checked) }), h("span", {}, "Coffee"),
                  h(TransactionEditor, { detailsEnabled: true, undoEnabled: true, transaction: { id: "11111111-1111-4111-8111-111111111111", merchant: "Coffee", amount: 4.5, currency: "USD" }, note: null, tags: [], splits: [], categories: ["FOOD"], providerCategory: "FOOD" })
                ),
                h("div", { "data-ledger-row": true, "data-ledger-row-id": "22222222-2222-4222-8222-222222222222", tabIndex: 0, "aria-label": "Transaction Rent" }, h("span", {}, "Rent"), h("button", { type: "button", "data-transaction-detail-trigger": true }, "Details for Rent"))
              ),
              h("p", {}, selected ? "selected" : "not selected")
            );
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
    await page.addScriptTag({ content: script });
    const row = page.locator("[data-ledger-row]").first();
    await expect(row).toHaveCount(1);
    await row.focus();
    await page.keyboard.press("j");
    await expect(page.locator("[data-ledger-row]").nth(1)).toBeFocused();
    await page.keyboard.press("k");
    await expect(row).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
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
