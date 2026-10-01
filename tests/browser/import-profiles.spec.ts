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
    input: "import-layout-fixture", platform: "browser",
    onwarn(warning, warn) { if (warning.code !== "MODULE_LEVEL_DIRECTIVE") warn(warning); },
    resolve: { alias: { "@": root } },
    transform: { define: { "process.env.NODE_ENV": '"production"' }, jsx: "react-jsx" },
    plugins: [{
      name: "import-layout-fixture",
      resolveId(id) { if (["import-layout-fixture", "next/navigation"].includes(id)) return `\0${id}`; },
      load(id) {
        if (id === "\0next/navigation") return 'export function useRouter() { return { refresh() {} }; }';
        if (id === "\0import-layout-fixture") return `
          import { createElement } from "react";
          import { createRoot } from "react-dom/client";
          import ImportReviewSection from ${JSON.stringify(path.join(root, "components/settings/ImportReviewSection.tsx"))};
          createRoot(document.getElementById("root")).render(createElement(ImportReviewSection, { profilesEnabled: !location.search.includes("off"), diagnosticsEnabled: !location.search.includes("off"), accounts: [{ id: "account", name: "Test bank", mask: null, kind: "account" }] }));
        `;
      },
    }],
  });
  try { script = (await bundle.generate({ format: "iife" })).output[0]!.code; }
  finally { await bundle.close(); }
  const source = path.join(root, "app/globals.css");
  css = (await postcss([tailwind()]).process(await readFile(source, "utf8"), { from: source })).css;
});

for (const width of [375, 1440]) {
  for (const theme of ["light", "dark"]) {
    test(`saved layout review at ${width}px in ${theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      let submitted: unknown;
      let previews = 0;
      let preflights = 0;
      await page.route("http://fundflow.test/**", async route => {
        const url = route.request().url();
        if (url.endsWith("/api/import/preflight")) {
          preflights++;
          await route.fulfill({ json: { diagnostics: {
            delimiter: "comma", headerRow: 2, totalRows: 1, validRows: preflights === 1 ? 0 : 1,
            signConvention: "positive_deposits", signBasis: "selected", inflowRows: 0, outflowRows: 1,
            issues: preflights === 1 ? [{ code: "ambiguous_date", row: 3, severity: "error", message: "Choose an explicit date format." }] : [],
            issueCount: preflights === 1 ? 1 : 0, truncated: false, canPreview: preflights > 1,
          } } });
        } else if (url.endsWith("/api/import/preview")) {
          previews++;
          await route.fulfill({ json: previews === 1 ? { needs_profile_choice: true, profiles: [{ id: "bank", name: "Bank layout" }, { id: "other", name: "Other layout" }] } : {
            batch_id: "batch", can_save_profile: true, applied_profile: { id: "bank", name: "Bank layout" },
            profile_settings: { dateOrder: "dmy", positiveIsIncome: true, skipRows: 1 },
            rows: [{ id: "row", date: "2026-01-31", description: "Cafe", amount: 12.5, flags: [], status: "pending" }],
          } });
        } else if (url.endsWith("/api/import/commit")) {
          submitted = route.request().postDataJSON();
          await route.fulfill({ json: { ok: true, imported: 1, profile_saved: true } });
        } else await route.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="en" data-theme="${theme}"><head><title>Import layouts</title><style>${css}</style></head><body><main style="padding:16px"><h1>Import settings</h1><div id="root"></div></main></body></html>` });
      });
      await page.goto("http://fundflow.test/");
      await page.addScriptTag({ content: script });
      await page.getByLabel("Statement file").setInputFiles({ name: "bank.csv", mimeType: "text/csv", buffer: Buffer.from("Bank statement\nDate,Description,Amount\n31/01/2026,Cafe,-12.50") });
      await page.getByRole("button", { name: "Preview file" }).focus();
      await page.keyboard.press("Enter");
      await expect(page.getByText("No transactions have been staged.", { exact: false })).toBeVisible();
      expect(previews).toBe(0);
      await page.getByLabel("Date format").selectOption("dmy");
      await page.getByRole("button", { name: "Preview file" }).focus();
      await page.keyboard.press("Enter");
      await expect(page.getByText("Several layouts match.", { exact: false })).toBeVisible();
      const choice = page.getByRole("combobox", { name: "Saved layout", exact: true });
      await choice.focus();
      await page.keyboard.press("b");
      await expect(choice).toHaveValue("bank");
      await page.keyboard.press("Tab");
      await expect(page.getByLabel("Leading rows to skip")).toBeFocused();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Enter");
      await expect(page.getByText("Applied saved layout: Bank layout")).toBeVisible();
      await expect(page.getByLabel("Date format")).toHaveValue("dmy");
      await expect(page.getByLabel("Leading rows to skip")).toHaveValue("1");
      await page.getByLabel("Save layout as (optional)").fill("New layout");
      await page.keyboard.press("Tab");
      await expect(page.getByLabel("Import Cafe on 2026-01-31")).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(page.getByRole("button", { name: "Import 1 selected" })).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath("import-layout-review.png"), fullPage: true });
      await page.keyboard.press("Enter");
      await expect(page.getByText("Imported 1 transaction.")).toBeVisible();
      await expect(page.getByRole("status").filter({ hasText: "Saved this layout" })).toBeVisible();
      expect(submitted).toMatchObject({ batch_id: "batch", account_id: "account", approved_row_ids: ["row"], save_profile_name: "New layout" });
      await page.goto("http://fundflow.test/?off");
      await page.addScriptTag({ content: script });
      await expect(page.getByLabel("Statement file")).toBeVisible();
      await expect(page.getByRole("combobox", { name: "Saved layout", exact: true })).toHaveCount(0);
    });
  }
}
