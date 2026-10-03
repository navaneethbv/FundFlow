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
  const bundle = await rolldown({ input: "asset-fixture", platform: "browser", resolve: { alias: { "@": root } },
    onwarn(warning, warn) { if (warning.code !== "MODULE_LEVEL_DIRECTIVE") warn(warning); },
    transform: { define: { "process.env.NODE_ENV": '"production"' }, jsx: "react-jsx" },
    plugins: [{ name: "asset-fixture", resolveId(id) { if (["asset-fixture", "next/navigation"].includes(id)) return `\0${id}`; },
      load(id) {
        if (id === "\0next/navigation") return 'export function useRouter() { return { push() {}, refresh() {} }; }';
        if (id === "\0asset-fixture") return `import { createElement as h } from "react"; import { createRoot } from "react-dom/client";
          import Form from ${JSON.stringify(path.join(root, "components/accounts/ManualAssetForm.tsx"))};
          import Move from ${JSON.stringify(path.join(root, "components/budget/MoveMoneyButton.tsx"))};
          import Collection from ${JSON.stringify(path.join(root, "components/transactions/CollectionBudgetForm.tsx"))};
          import Wizard from ${JSON.stringify(path.join(root, "components/budget/BudgetSetupWizard.tsx"))};
          const proposals = [
            { category: "INCOME", group_name: "income", suggested_amount: 1000, reason: "Trailing average", rollover_enabled: false, sort_order: 0 },
            { category: "RENT", group_name: "fixed", suggested_amount: 900, reason: "Trailing average", rollover_enabled: false, sort_order: 1 },
            { category: "FOOD", group_name: "flexible", suggested_amount: 200, reason: "Trailing average", rollover_enabled: false, sort_order: 2 }
          ];
          const content = window.budgetFixture ? h("div", { className: "space-y-6" },
            h(Move, { month: "2026-10", currency: "USD", lines: [{ budgetId: "from", label: "Food", basePlanned: 200 }, { budgetId: "to", label: "Travel", basePlanned: 100 }] }),
            h(Collection, { name: "Trip", budget: null }), h(Wizard, { proposals, month: "2026-10", currency: "USD" }))
            : h(Form, { today: "2026-10-02", initial: window.asset });
          createRoot(document.getElementById("root")).render(content);`;
      } }],
  });
  try { script = (await bundle.generate({ format: "iife" })).output[0]!.code; } finally { await bundle.close(); }
  const source = path.join(root, "app/globals.css");
  css = (await postcss([tailwind()]).process(await readFile(source, "utf8"), { from: source })).css;
});

for (const width of [375, 1440]) for (const theme of ["light", "dark"]) {
  test(`manual valuation saves and reloads at ${width}px in ${theme}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1100 });
    let saved: Record<string, unknown> | undefined;
    let conflict = false;
    const failures: string[] = [];
    page.on("pageerror", (error) => failures.push(error.message));
    await page.route("http://fundflow.test/**", async (route) => {
      if (route.request().url().includes("/api/")) {
        if (conflict) { await route.fulfill({ status: 409, json: { error: "Asset changed. Reload before saving." } }); return; }
        saved = { ...route.request().postDataJSON(), id: "91000000-0000-4000-8000-000000000001", version: 1 };
        await route.fulfill({ status: 201, json: { id: "91000000-0000-4000-8000-000000000001" } });
      } else await route.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="en" data-theme="${theme}"><head><title>Assets</title><style>${css}</style></head><body><main style="padding:16px;max-width:900px;margin:auto"><h1>Manual assets</h1><div id="root"></div></main><script>window.asset=${JSON.stringify(saved) ?? "undefined"}</script></body></html>` });
    });
    await page.goto("http://fundflow.test/"); await page.addScriptTag({ content: script });
    await page.keyboard.press("Tab"); await expect(page.getByLabel("Name", { exact: true })).toBeFocused();
    await page.getByLabel("Name", { exact: true }).fill("Shared home");
    await page.getByLabel("Full value (USD)", { exact: true }).fill("200000");
    await page.getByLabel("Value source", { exact: true }).fill("Independent appraisal");
    await page.getByLabel("Ownership (%)", { exact: true }).fill("50");
    await page.getByLabel("Growth assumption", { exact: true }).selectOption("percent");
    await page.getByLabel("Growth amount (negative for depreciation)").fill("3");
    await page.getByRole("button", { name: "Save valuation" }).focus(); await page.keyboard.press("Enter");
    await expect(page.getByText("Valuation saved.")).toBeVisible();
    expect(saved).toMatchObject({ value: 200000, ownershipPercentage: 50, growth: { kind: "percent", amount: 3, period: "year" } });
    await page.reload(); await page.addScriptTag({ content: script });
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Shared home");
    await expect(page.getByLabel("Ownership (%)", { exact: true })).toHaveValue("50");
    conflict = true;
    await page.getByLabel("Full value (USD)", { exact: true }).fill("210000");
    await page.getByRole("button", { name: "Save valuation" }).click();
    await expect(page.getByText("Asset changed. Reload before saving.")).toBeVisible();
    await expect(page.getByLabel("Full value (USD)", { exact: true })).toHaveValue("210000");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(failures).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`assets-${width}-${theme}.png`), fullPage: true });
  });
}

for (const width of [375, 1440]) for (const theme of ["light", "dark"]) {
  test(`budget moves, setup, and collections at ${width}px in ${theme}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const submitted: Array<{ url: string; body: unknown }> = [];
    await page.route("http://fundflow.test/**", async (route) => {
      if (route.request().url().includes("/api/")) {
        submitted.push({ url: route.request().url(), body: route.request().postDataJSON() });
        await route.fulfill({ json: { ok: true } });
      } else await route.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="en" data-theme="${theme}"><head><title>Budget</title><style>${css}</style></head><body><main style="padding:16px;max-width:900px;margin:auto"><h1>Budget and collections</h1><div id="root"></div></main><script>window.budgetFixture=true</script></body></html>` });
    });
    await page.goto("http://fundflow.test/"); await page.addScriptTag({ content: script });
    await page.getByRole("button", { name: "Move money", exact: true }).click();
    await page.getByLabel("To", { exact: true }).selectOption("to");
    await page.getByLabel("Amount", { exact: true }).fill("0.29");
    await page.getByRole("button", { name: "Move", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(submitted[0]?.body).toEqual({ month: "2026-10", from_budget_id: "from", to_budget_id: "to", amount: 0.29 });
    await page.getByLabel("Budget for Trip").fill("500");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Budget saved.")).toBeVisible();
    expect(submitted[1]?.body).toEqual({ name: "Trip", budget: 500 });
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Fixed costs" })).toBeFocused();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByText(/over income/)).toBeVisible();
    await page.getByRole("button", { name: "Save budget", exact: true }).click();
    await expect.poll(() => submitted.length).toBe(3);
    expect(submitted[2]?.body).toMatchObject({ month: "2026-10", items: [{ monthly_limit: 1000 }, { monthly_limit: 900 }, { monthly_limit: 200 }] });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`budgets-${width}-${theme}.png`), fullPage: true });
  });
}
