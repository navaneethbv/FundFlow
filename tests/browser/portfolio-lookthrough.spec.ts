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
    input: "portfolio-lookthrough-fixture",
    platform: "browser",
    resolve: { alias: { "@": root } },
    onwarn(warning, warn) { if (warning.code !== "MODULE_LEVEL_DIRECTIVE") warn(warning); },
    transform: { define: { "process.env.NODE_ENV": '"production"' }, jsx: "react-jsx" },
    plugins: [{
      name: "portfolio-lookthrough-fixture",
      resolveId(id) { if (id === "portfolio-lookthrough-fixture") return "\0portfolio-lookthrough-fixture"; },
      load(id) {
        if (id !== "\0portfolio-lookthrough-fixture") return;
        return `import { createElement as h } from "react"; import { createRoot } from "react-dom/client";
          import Lookthrough from ${JSON.stringify(path.join(root, "components/investments/PortfolioLookthrough.tsx"))};
          createRoot(document.getElementById("root")).render(h(Lookthrough,{holdings:window.holdings,initialRecords:window.initialRecords}));`;
      },
    }],
  });
  try { script = (await bundle.generate({ format: "iife" })).output[0]!.code; } finally { await bundle.close(); }
  const source = path.join(root, "app/globals.css");
  css = (await postcss([tailwind()]).process(await readFile(source, "utf8"), { from: source })).css;
});

for (const width of [375, 1440]) for (const theme of ["light", "dark"]) {
  test(`look-through remains usable at ${width}px ${theme}`, async ({ page }, testInfo) => {
    const holdingId = "93000000-0000-4000-8000-000000000002";
    const holdings = [
      { id: "93000000-0000-4000-8000-000000000001", securityName: "Apple", ticker: "AAPL", securityType: "equity", value: 100 },
      { id: holdingId, securityName: "Example fund", ticker: "FUND", securityType: "etf", value: 100 },
    ];
    const initialRecords = [{ holdingId, version: 0, source: "manual", asOfDate: "2026-01-01", weights: [{ key: "ticker:AAPL", name: "Apple", sector: "Technology", region: "North America", weight: 1 }] }];
    let conflict = false;
    const failures: string[] = [];
    page.on("pageerror", (error) => failures.push(error.message));
    await page.setViewportSize({ width, height: 1000 });
    await page.route("http://fundflow.test/**", async (route) => {
      if (route.request().url().includes("/api/")) {
        if (conflict) { await route.fulfill({ status: 409, json: { error: "Holding changed. Reload before saving." } }); return; }
        const body = route.request().postDataJSON();
        await route.fulfill({ json: { version: body.data === null ? 0 : 1 } });
        return;
      }
      await route.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="en" data-theme="${theme}"><head><title>Portfolio look-through</title><style>${css}</style></head><body><main style="padding:16px;max-width:1000px;margin:auto"><h1>Portfolio look-through</h1><div id="root"></div></main><script>window.holdings=${JSON.stringify(holdings)};window.initialRecords=${JSON.stringify(initialRecords)}</script></body></html>` });
    });
    await page.goto("http://fundflow.test/");
    await page.addScriptTag({ content: script });
    await expect(page.getByRole("heading", { name: "Portfolio look-through", level: 2 })).toBeVisible();
    await expect(page.getByText("By security", { exact: true })).toBeVisible();
    await expect(page.getByRole("img", { name: "Schematic world map of regional exposure" })).toBeVisible();
    const form = page.locator("form").first();
    await form.getByLabel("Source as-of date").fill("2026-02-01");
    await form.getByLabel(/Weights/).fill('[{"key":"ticker:AAPL","name":"Apple","sector":"Technology","region":"North America","weightPct":100}]');
    await form.getByRole("button", { name: "Save weights" }).click();
    await expect(form.getByRole("status")).toHaveText("Saved.");
    conflict = true;
    await form.getByLabel(/Weights/).fill('[{"key":"ticker:AAPL","name":"Apple","sector":"Technology","region":"North America","weightPct":90},{"key":"ticker:MSFT","name":"Microsoft","sector":"Technology","region":"North America","weightPct":10}]');
    await form.getByRole("button", { name: "Save weights" }).click();
    await expect(form.getByRole("alert")).toHaveText("Holding changed. Reload before saving.");
    await expect(form.getByLabel(/Weights/)).toHaveValue(/90/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(failures).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`lookthrough-${width}-${theme}.png`), fullPage: true });
  });
}
