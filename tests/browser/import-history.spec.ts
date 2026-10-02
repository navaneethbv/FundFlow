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
    input: "import-history-fixture", platform: "browser",
    onwarn(warning, warn) { if (warning.code !== "MODULE_LEVEL_DIRECTIVE") warn(warning); },
    resolve: { alias: { "@": root } },
    transform: { define: { "process.env.NODE_ENV": '"production"' }, jsx: "react-jsx" },
    plugins: [{
      name: "import-history-fixture",
      resolveId(id) { if (["import-history-fixture", "next/navigation", "next/link"].includes(id)) return `\0${id}`; },
      load(id) {
        if (id === "\0next/link") return 'import { createElement } from "react"; export default function Link(props) { return createElement("a", props); }';
        if (id === "\0next/navigation") return 'export function useRouter() { return { refresh() {} }; }';
        if (id === "\0import-history-fixture") return `
          import { createElement } from "react";
          import { createRoot } from "react-dom/client";
          import ImportHistory, { ImportHistoryPagination } from ${JSON.stringify(path.join(root, "components/settings/ImportHistory.tsx"))};
          const legacy = { id: "old", file_name: "bank-".repeat(40)+".csv", created_at: "2026-10-01T00:00:00Z", history_profile_name: null, history_summary: null };
          const current = { ...legacy, id: "new", file_name: "statement.csv", history_profile_name: "My bank", history_summary: { imported: 120, skipped: 3, flagged: 2, targets: [{ account_id: "bank", name: "Checking" }], unknownTargets: 0, committedAt: "2026-10-01T12:00:00Z", committedBy: "owner" } };
          const page = Number(new URLSearchParams(location.search).get("page") ?? 1);
          createRoot(document.getElementById("root")).render(createElement("div", { className: "space-y-4" },
            createElement(ImportHistory, { batches: page === 1 ? [current, legacy] : [] }),
            createElement(ImportHistoryPagination, { page, hasNext: page === 1 })));

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
    test(`history at ${width}px in ${theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.route("http://fundflow.test/**", route => route.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="en" data-theme="${theme}"><head><title>Import history</title><style>${css}</style></head><body><main style="padding:16px"><h1>Import history</h1><div id="root"></div></main></body></html>` }));
      await page.goto("http://fundflow.test/settings/import-history");
      await page.addScriptTag({ content: script });
      await expect(page.getByText("Checking", { exact: true })).toBeVisible();
      await expect(page.getByText("Not recorded", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("120", { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath("import-history.png"), fullPage: true });
      await page.keyboard.press("Tab");
      await expect(page.getByRole("link", { name: "Next page" })).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/page=2/);
      await page.addScriptTag({ content: script });
      await expect(page.getByText("No committed imports on this page.")).toBeVisible();
      await page.keyboard.press("Tab");
      await expect(page.getByRole("link", { name: "Previous page" })).toBeFocused();
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    });
  }
}
