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
          import ReceiptScanSection from ${JSON.stringify(path.join(root, "components/settings/ReceiptScanSection.tsx"))};
          createRoot(document.getElementById("root")).render(window.receiptFixture ? createElement(ReceiptScanSection, { enabled: true }) : createElement(ImportReviewSection, { wizardEnabled: !location.search.includes("off"), profilesEnabled: !location.search.includes("off"), diagnosticsEnabled: !location.search.includes("off"), accounts: [{ id: "account", name: "Test bank", mask: null, kind: "account" }] }));
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
  test(`receipt upload stays contained and recovers from request failures at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    let offline = true;
    await page.route("http://fundflow.test/**", route => {
      if (route.request().url().includes("/api/")) {
        return offline ? route.abort("failed") : route.fulfill({ json: { merchant: "Test shop", amount: 12, date: "2026-10-01", lineItems: ["Lunch"], matchedTransactionId: "transaction" } });
      }
      return route.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="en"><head><title>Receipt test</title><style>${css}</style></head><body><main style="padding:16px"><h1>Receipt test</h1><div id="root"></div></main><script>window.receiptFixture=true</script></body></html>` });
    });
    await page.goto("http://fundflow.test/");
    await page.addScriptTag({ content: script });
    const picker = page.getByLabel("Choose a receipt photo", { exact: true });
    await expect(picker).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await picker.focus();
    await expect(picker).toBeFocused();
    await picker.setInputFiles({ name: "receipt.png", mimeType: "image/png", buffer: Buffer.from("synthetic receipt fixture") });
    await page.getByRole("button", { name: "Scan", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Could not read the receipt");
    await expect(page.getByText("receipt.png", { exact: true })).toBeVisible();
    offline = false;
    await page.getByRole("button", { name: "Scan", exact: true }).click();
    await expect(page.getByRole("button", { name: "Attach to matching transaction" })).toBeVisible();
    offline = true;
    await page.getByRole("button", { name: "Attach to matching transaction" }).click();
    await expect(page.getByRole("status")).toContainText("Could not attach the note");
    await page.getByRole("button", { name: "Save to receipt inbox" }).click();
    await expect(page.getByRole("status")).toContainText("Could not save the receipt");
    offline = false;
    await page.getByRole("button", { name: "Save to receipt inbox" }).click();
    await expect(page.getByRole("status")).toHaveText("Saved to the receipt inbox.");
    expect(errors).toEqual([]);
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  });
}

for (const width of [375, 1440]) {
  for (const theme of ["light", "dark"]) {
    test(`saved layout review at ${width}px in ${theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      let submitted: unknown;
      let previews = 0;
      let preflights = 0;
      let mappedRequest = "";
      await page.route("http://fundflow.test/**", async route => {
        const url = route.request().url();
        if (url.endsWith("/api/import/preflight")) {
          preflights++;
          if (preflights === 4) {
            await route.fulfill({ json: { needs_mapping: true, headers: ["When", "What", "Money"], sample: [["2026-02-01", "Next", "2"]], diagnostics: null } });
            return;
          }
          if (preflights === 5) mappedRequest = route.request().postData() ?? "";
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
      await expect(page.getByLabel("Import steps").locator('[aria-current="step"]')).toHaveText("1. Choose file");
      if (width === 375) {
        await page.evaluate(() => {
          const transfer = new DataTransfer();
          transfer.items.add(new File(["Bank statement\nDate,Description,Amount\n31/01/2026,Cafe,-12.50"], "bank.csv", { type: "text/csv" }));
          window.dispatchEvent(new DragEvent("dragover", { dataTransfer: transfer, cancelable: true }));
        });
        await expect(page.getByText("Drop one statement file to begin review")).toBeVisible();
        await page.evaluate(() => {
          const transfer = new DataTransfer();
          transfer.items.add(new File(["Bank statement\nDate,Description,Amount\n31/01/2026,Cafe,-12.50"], "bank.csv", { type: "text/csv" }));
          window.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, cancelable: true }));
        });
        await expect(page.getByLabel("Statement file")).toBeFocused();
      } else await page.getByLabel("Statement file").setInputFiles({ name: "bank.csv", mimeType: "text/csv", buffer: Buffer.from("Bank statement\nDate,Description,Amount\n31/01/2026,Cafe,-12.50") });
      await expect(page.getByLabel("Import steps").locator('[aria-current="step"]')).toHaveText("2. Map and check");
      await page.getByRole("button", { name: "Preview file" }).focus();
      await page.keyboard.press("Enter");
      await expect(page.getByText("No transactions have been staged.", { exact: false })).toBeVisible();
      expect(previews).toBe(0);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
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
      await expect(page.getByRole("heading", { name: "Review selected transactions" })).toBeFocused();
      await expect(page.getByLabel("Import steps").locator('[aria-current="step"]')).toHaveText("3. Review");
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
      await expect(page.getByText("Imported 1 transaction.")).toBeFocused();
      await expect(page.getByLabel("Import steps").locator('[aria-current="step"]')).toHaveText("4. Complete");
      await expect(page.getByRole("status").filter({ hasText: "Saved this layout" })).toBeVisible();
      expect(submitted).toMatchObject({ batch_id: "batch", account_id: "account", approved_row_ids: ["row"], save_profile_name: "New layout" });
      await page.getByLabel("Statement file").setInputFiles({ name: "next.csv", mimeType: "text/csv", buffer: Buffer.from("Date,Description,Amount\n2026-02-01,Next,2") });
      await expect(page.getByText("Imported 1 transaction.")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Import 1 selected" })).toHaveCount(0);
      await expect(page.getByLabel("Import steps").locator('[aria-current="step"]')).toHaveText("2. Map and check");
      await page.getByRole("button", { name: "Preview file" }).focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("heading", { name: "Map file columns" })).toBeFocused();
      await page.getByRole("combobox", { name: "Date column", exact: true }).selectOption("0");
      await page.getByRole("combobox", { name: "Description column", exact: true }).selectOption("1");
      await page.getByRole("combobox", { name: "Amount column", exact: true }).selectOption("2");
      await page.getByRole("button", { name: "Preview with this mapping" }).focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("heading", { name: "Review selected transactions" })).toBeFocused();
      expect(mappedRequest).toContain('name="column_map"');
      expect(mappedRequest).toContain('"date":0,"description":1,"amount":2');
      await page.getByLabel("Positive amounts are deposits").uncheck();
      await expect(page.getByRole("button", { name: "Import 1 selected" })).toHaveCount(0);
      await expect(page.getByLabel("Import steps").locator('[aria-current="step"]')).toHaveText("2. Map and check");
      await page.getByLabel("Statement file").setInputFiles([]);
      await expect(page.getByRole("button", { name: "Import 1 selected" })).toHaveCount(0);
      await expect(page.getByLabel("Import steps").locator('[aria-current="step"]')).toHaveText("1. Choose file");
      await page.goto("http://fundflow.test/?off");
      await page.addScriptTag({ content: script });
      await expect(page.getByLabel("Statement file")).toBeVisible();
      await expect(page.getByRole("combobox", { name: "Saved layout", exact: true })).toHaveCount(0);
      await expect(page.getByLabel("Import steps")).toHaveCount(0);
      expect(await page.evaluate(() => {
        const transfer = new DataTransfer();
        transfer.items.add(new File(["ignored"], "off.csv", { type: "text/csv" }));
        const event = new DragEvent("drop", { dataTransfer: transfer, cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      })).toBe(false);
    });
  }
}
