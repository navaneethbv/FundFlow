import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { rolldown } from "rolldown";
import { pathToFileURL } from "node:url";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "@playwright/test";

let css: string;
let renderControls: (url: string) => string;
test.beforeAll(async () => {
  const root = process.cwd();
  const bundle = await rolldown({
    input: "report-fixture", platform: "node",
    onwarn(warning, warn) { if (warning.code !== "MODULE_LEVEL_DIRECTIVE") warn(warning); },
    resolve: { alias: { "@": root } },
    transform: { jsx: "react-jsx" },
    plugins: [{
      name: "report-fixture",
      resolveId(id) { if (["report-fixture", "next/link"].includes(id)) return `\0${id}`; },
      load(id) {
        if (id === "\0next/link") return 'import { createElement } from "react"; export default function Link(props) { return createElement("a", props); }';
        if (id === "\0report-fixture") return `
          import { createElement } from "react";
          import { renderToStaticMarkup } from "react-dom/server";
          import ReportControls from ${JSON.stringify(path.join(root, "components/reports/ReportControls.tsx"))};
          import { defaultReportFilters, reportFiltersFromSearchParams } from ${JSON.stringify(path.join(root, "lib/reports.ts"))};
          export function renderControls(url) {
            const params = new URL(url).searchParams;
            const input = Object.fromEntries([...new Set(params.keys())].map(key => [key, params.getAll(key)]));
            const filters = reportFiltersFromSearchParams(input, { ...defaultReportFilters("2026-10"), scope: "household" });
            return renderToStaticMarkup(createElement(ReportControls, {
              filters, today: "2026-10-03", currency: params.get("currency") || "EUR", householdId: "household",
            }));
          }`;
      },
    }],
  });
  const output = path.join(test.info().outputDir, "report-fixture.cjs");
  try { await bundle.write({ format: "cjs", file: output }); }
  finally { await bundle.close(); }
  ({ renderControls } = await import(pathToFileURL(output).href));
  const source = path.join(process.cwd(), "app/globals.css");
  css = (await postcss([tailwind()]).process(await readFile(source, "utf8"), { from: source })).css;
  await writeFile(path.join(test.info().outputDir, "report-controls.html"), html("light", "http://fundflow.test/reports"));
});
function html(theme: string, url: string) {
  const controls = renderControls(url);
  return `<!doctype html><html lang="en" data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Report controls fixture</title><style>${css}</style></head><body><main style="padding:16px;max-width:1100px;margin:auto"><h1>Reports</h1><p>Synthetic report controls, no financial data or service connections.</p>${controls}</main></body></html>`;
}
for (const width of [375, 768, 1440]) for (const theme of ["light", "dark"]) {
  test(`report shortcuts and retained filters at ${width}px ${theme}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route("http://fundflow.test/**", route => route.fulfill({ contentType: "text/html", body: html(theme, route.request().url()) }));
    await page.goto("http://fundflow.test/reports?start=2026-10-01&end=2026-10-31&sort=amount&dir=asc&currency=EUR&account=checking&account=savings&merchant=Shop&pending=exclude&page=3");
    const quarter = page.getByRole("link", { name: "This quarter", exact: true });
    await quarter.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("To", { exact: true })).toHaveValue("2026-12-31");
    await expect(page.getByRole("link", { name: "This quarter", exact: true })).toHaveAttribute("aria-current", "true");
    let params = new URL(page.url()).searchParams;
    expect(params.get("page")).toBeNull();
    expect(params.getAll("account")).toEqual(["checking", "savings"]);
    expect(params.get("currency")).toBe("EUR");
    await page.reload();
    await expect(page.getByLabel("To", { exact: true })).toHaveValue("2026-12-31");
    await page.getByLabel("From", { exact: true }).fill("2024-02-01");
    await page.getByLabel("To", { exact: true }).fill("2024-02-29");
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page.getByLabel("To", { exact: true })).toHaveValue("2024-02-29");
    params = new URL(page.url()).searchParams;
    expect(params.get("sort")).toBe("amount");
    expect(params.get("dir")).toBe("asc");
    expect(params.get("currency")).toBe("EUR");
    expect(params.get("scope")).toBe("household");
    expect(params.get("pending")).toBe("exclude");
    expect(params.getAll("account")).toEqual(["checking", "savings"]);
    await page.goBack();
    await expect(page.getByLabel("To", { exact: true })).toHaveValue("2026-12-31");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath("report-controls.png"), fullPage: true });
  });
}
