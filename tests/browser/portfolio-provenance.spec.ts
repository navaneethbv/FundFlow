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
  const bundle = await rolldown({ input: "portfolio-fixture", platform: "browser", resolve: { alias: { "@": root } },
    onwarn(warning, warn) { if (warning.code !== "MODULE_LEVEL_DIRECTIVE") warn(warning); },
    transform: { define: { "process.env.NODE_ENV": '"production"' }, jsx: "react-jsx" },
    plugins: [{ name: "portfolio-fixture", resolveId(id) { if (["portfolio-fixture", "next/navigation"].includes(id)) return `\0${id}`; },
      load(id) {
        if (id === "\0next/navigation") return 'export function useRouter() { return { refresh() {} }; }';
        if (id === "\0portfolio-fixture") return `import { createElement as h } from "react"; import { createRoot } from "react-dom/client";
          import Form from ${JSON.stringify(path.join(root, "components/investments/PortfolioAnnotationForm.tsx"))};
          import Summary from ${JSON.stringify(path.join(root, "components/investments/TaxBucketSummary.tsx"))};
          const options=[{id:"92000000-0000-4000-8000-000000000004",name:"Home mortgage",source:"manual"}];
          createRoot(document.getElementById("root")).render(h("div",{className:"space-y-6"},
            ...window.configs.map((initial,index)=>h("section",{key:initial.kind,className:"rounded-md border border-panel-border p-4"},h(Form,{initial,name:["Index fund","Brokerage","Property mortgage"][index],quantity:2,liabilities:options,today:"2026-10-02"}))),
            h(Summary,{summary:{buckets:{taxable:1000,deferred:2000,roth:3000,hsa:0,education:0,unknown:500},unavailable:1}})));`;
      } }],
  });
  try { script = (await bundle.generate({ format: "iife" })).output[0]!.code; } finally { await bundle.close(); }
  const source = path.join(root, "app/globals.css");
  css = (await postcss([tailwind()]).process(await readFile(source, "utf8"), { from: source })).css;
});

for (const width of [375, 1440]) for (const theme of ["light", "dark"]) {
  test(`portfolio configuration saves, reloads and preserves rejected drafts at ${width}px ${theme}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1100 });
    const configs = ["basis", "tax", "mortgage"].map((kind, i) => ({ kind, id: `92000000-0000-4000-8000-00000000000${i + 1}`, version: 0, data: null as unknown }));
    let conflict = false;
    const failures: string[] = [];
    page.on("pageerror", (error) => failures.push(error.message));
    await page.route("http://fundflow.test/**", async (route) => {
      if (route.request().url().includes("/api/")) {
        if (conflict) { await route.fulfill({ status: 409, json: { error: "Record changed. Reload before saving." } }); return; }
        const body = route.request().postDataJSON(); const config = configs.find((c) => c.kind === body.kind)!;
        config.data = body.data; config.version = body.data === null ? 0 : config.version + 1;
        await route.fulfill({ json: { version: config.version } });
      } else await route.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="en" data-theme="${theme}"><head><title>Portfolio configuration</title><style>${css}</style></head><body><main style="padding:16px;max-width:900px;margin:auto"><h1>Portfolio configuration</h1><div id="root"></div></main><script>window.configs=${JSON.stringify(configs)}</script></body></html>` });
    });
    await page.goto("http://fundflow.test/"); await page.addScriptTag({ content: script });
    await page.keyboard.press("Tab"); await expect(page.getByLabel("Total cost basis (USD)")).toBeFocused();
    const basis = page.getByRole("form", { name: "Index fund configuration" });
    await basis.getByLabel("Total cost basis (USD)").fill("0"); await basis.getByLabel("Basis source").selectOption("imported");
    await basis.getByRole("button", { name: "Save configuration" }).focus(); await page.keyboard.press("Enter");
    await expect(basis.getByRole("status")).toHaveText("Configuration saved.");
    expect(configs[0].data).toEqual({ amount: 0, quantity: 2, source: "imported" });
    const tax = page.getByRole("form", { name: "Brokerage configuration" });
    await tax.getByLabel("Tax treatment").selectOption("roth"); await tax.getByRole("button", { name: "Save configuration" }).click();
    await expect(tax.getByRole("status")).toHaveText("Configuration saved.");
    const mortgage = page.getByRole("form", { name: "Property mortgage configuration" });
    await mortgage.getByLabel("Existing liability").selectOption("92000000-0000-4000-8000-000000000004");
    await mortgage.getByLabel("First payment date").fill("2026-01-31");
    await mortgage.getByLabel("Principal before first payment (USD)").fill("1200");
    await mortgage.getByLabel("Fixed annual interest (%)").fill("0");
    await mortgage.getByLabel("Monthly principal and interest payment (USD)").fill("100");
    await mortgage.getByLabel("Maximum payments (months)").fill("12");
    await mortgage.getByRole("button", { name: "Save configuration" }).click();
    await expect(mortgage.getByRole("status")).toHaveText("Configuration saved.");
    expect(configs[2].data).toMatchObject({ liabilitySource: "manual", terms: { principal: 1200, annualRate: 0, paymentAmount: 100, startDate: "2026-01-31", termMonths: 12 } });
    await page.reload(); await page.addScriptTag({ content: script });
    await expect(basis.getByLabel("Total cost basis (USD)")).toHaveValue("0"); await expect(tax.getByLabel("Tax treatment")).toHaveValue("roth");
    await expect(mortgage.getByLabel("Principal before first payment (USD)")).toHaveValue("1200");
    await tax.getByRole("button", { name: "Remove override" }).click(); await expect(tax.getByRole("status")).toHaveText("Override removed."); expect(configs[1].data).toBeNull();
    await page.reload(); await page.addScriptTag({ content: script }); await expect(tax.getByLabel("Tax treatment")).toHaveValue("unknown");
    conflict = true; await basis.getByLabel("Total cost basis (USD)").fill("999"); await basis.getByRole("button", { name: "Save configuration" }).click();
    await expect(basis.getByRole("alert")).toHaveText("Record changed. Reload before saving."); await expect(basis.getByLabel("Total cost basis (USD)")).toHaveValue("999");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]); expect(failures).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`portfolio-${width}-${theme}.png`), fullPage: true });
  });
}
