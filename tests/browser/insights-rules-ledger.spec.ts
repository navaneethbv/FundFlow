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
  const bundle = await rolldown({ input: "adoption-fixture", platform: "browser", onwarn(warning, warn) { if (warning.code !== "MODULE_LEVEL_DIRECTIVE") warn(warning); }, resolve: { alias: { "@": root } }, transform: { define: { "process.env.NODE_ENV": '"production"' }, jsx: "react-jsx" }, plugins: [{ name: "adoption-fixture", resolveId(id) { if (["adoption-fixture", "next/navigation", "node:crypto"].includes(id)) return `\0${id}`; }, load(id) {
    if (id === "\0next/navigation") return 'export function useRouter() { return { refresh() {} }; }';
    if (id === "\0node:crypto") return 'export function createHash() { throw new Error("Server hashing must not run in this browser fixture"); }';
    if (id === "\0adoption-fixture") return `
      import { createElement as h, useState } from "react";
      import { createRoot } from "react-dom/client";
      import InsightsFeed from ${JSON.stringify(path.join(root, "components/notifications/InsightsFeed.tsx"))};
      import InsightPreferences from ${JSON.stringify(path.join(root, "components/notifications/InsightPreferences.tsx"))};
      import CompoundRulesSection from ${JSON.stringify(path.join(root, "components/settings/CompoundRulesSection.tsx"))};
      import RuleRunHistory from ${JSON.stringify(path.join(root, "components/settings/RuleRunHistory.tsx"))};
      import TransactionEditor from ${JSON.stringify(path.join(root, "components/transactions/TransactionEditor.tsx"))};
      function Fixture() { const [view, setView] = useState("insights"); return h("main", { style: { padding: 16 } }, h("h1", {}, "Finance workspace"), h("nav", { "aria-label": "Fixture surfaces", style: { display: "flex", gap: 12, marginBottom: 20 } }, ...["insights", "rules", "ledger"].map(name => h("button", { key: name, onClick: () => setView(name) }, name))), view === "insights" ? h("div", {}, h(InsightsFeed, { initial: [{ id: "11111111-1111-4111-8111-111111111111", type: "bill_overdue", severity: "warning", title: "A bill has no recorded payment", body: "Rent: $1,000 was due October 1. Check before paying again.", read_at: null, created_at: "2026-10-01T12:00:00Z" }] }), h(InsightPreferences, { initial: {} })) : view === "rules" ? h("div", {}, h(CompoundRulesSection), h(RuleRunHistory)) : h("div", {}, h("p", {}, "Transaction ledger remains visible"), h(TransactionEditor, { detailsEnabled: true, suggestionsEnabled: true, ruleHistoryEnabled: true, transaction: { id: "22222222-2222-4222-8222-222222222222", merchant: "Shop", amount: 42, currency: "USD" }, note: null, tags: [], splits: [], categories: ["FOOD", "TRAVEL"], providerCategory: "FOOD" }))); }
      createRoot(document.getElementById("root")).render(h(Fixture));
    `;
  } }] });
  try { script = (await bundle.generate({ format: "iife" })).output[0]!.code; } finally { await bundle.close(); }
  const source = path.join(root, "app/globals.css"); css = (await postcss([tailwind()]).process(await readFile(source, "utf8"), { from: source })).css;
});
for (const width of [375, 1440]) for (const theme of ["light", "dark"]) {
  test(`insights, compound rules and ledger at ${width}px ${theme}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    const writes: Record<string, unknown>[] = [];
    await page.route("http://fundflow.test/**", async route => {
      const url = new URL(route.request().url());
      if (!url.pathname.startsWith("/api/")) return route.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="en" data-theme="${theme}"><head><title>Adoption workspace</title><style>${css}</style></head><body><div id="root"></div></body></html>` });
      const body = route.request().postDataJSON(); if (body) writes.push({ path: url.pathname, ...body });
      let result: unknown = { ok: true };
      if (url.pathname === "/api/insights/acknowledge") result = { id: body.id, read_at: body.action === "acknowledge" ? "2026-10-01" : null };
      if (url.pathname === "/api/rules/compound") result = route.request().method() === "GET" ? { rules: [] } : (body.action === "save" ? { id: "33333333-3333-4333-8333-333333333333" } : { evaluated: 3, matched: 2, changed: body.action === "apply" ? 2 : 0 });
      if (url.pathname === "/api/rules/history") result = url.search ? { changes: [] } : { runs: [{ id: "run", rule_id: "33333333-3333-4333-8333-333333333333", trigger: "manual", matched: 2, changed: 2, status: "success", error: null, created_at: "2026-10-01T12:00:00Z" }] };
      if (url.pathname === "/api/rules/suggestion") result = { merchant: "Shop", name: "Raw shop", amount: 42, accountId: "account" };
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(result) });
    });
    await page.goto("http://fundflow.test/"); await page.addScriptTag({ content: script });
    await page.getByRole("button", { name: "Acknowledge", exact: true }).focus(); await page.keyboard.press("Enter");
    await expect(page.getByText("No insights in this view.")).toBeVisible();
    await page.getByRole("combobox", { name: "Show" }).selectOption("acknowledged");
    await page.getByRole("button", { name: "Restore", exact: true }).focus(); await page.keyboard.press("Enter");
    await page.getByRole("combobox", { name: "Show" }).selectOption("active"); await expect(page.getByText("A bill has no recorded payment", { exact: true })).toBeVisible();
    await page.getByRole("checkbox", { name: "New Merchant", exact: true }).check(); await page.getByRole("button", { name: "Save insight preferences" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Insight preferences saved." })).toBeVisible();
    await page.getByRole("button", { name: "rules", exact: true }).click();
    await page.getByLabel("Condition 1 value").fill("Shop"); await page.getByLabel("Set category", { exact: true }).fill("FOOD");
    await page.getByRole("button", { name: "Save rule", exact: true }).click(); await expect(page.getByText("Rule saved. Existing transactions change only when you apply it.")).toBeVisible();
    await page.getByRole("button", { name: "Preview saved rules" }).click(); await page.getByRole("button", { name: "Apply saved rules", exact: true }).click();
    await expect(page.getByText("2 matched among 3 transactions; 2 changed.")).toBeVisible();
    await page.getByRole("button", { name: "ledger", exact: true }).click();
    const trigger = page.getByRole("button", { name: "Details for Shop" }); await trigger.focus(); await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog"); await expect(dialog).toBeVisible(); await expect(page.getByRole("button", { name: "Close details" })).toBeFocused();
    await expect(page.getByText("Transaction ledger remains visible")).toBeVisible();
    await page.getByLabel("Display category", { exact: true }).fill("TRAVEL"); await page.getByRole("button", { name: "Save classification" }).click();
    await expect(page.getByRole("region", { name: "Suggested categorization rule" })).toBeVisible();
    await expect(page.getByText("2 matches in the last 30 days (up to 500 transactions).")).toBeVisible();
    await page.getByRole("checkbox", { name: "Also apply this rule to the last 30 days" }).check(); await page.getByRole("button", { name: "Save suggested rule" }).click();
    await expect(page.getByRole("region", { name: "Suggested categorization rule" })).toHaveCount(0);
    const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze(); expect(accessibility.violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("transaction-detail.png"), fullPage: true, caret: "initial" });
    await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
    expect(writes.some(write => write.path === "/api/insights/preferences" && write.new_merchant === true)).toBe(true);
    expect(writes.some(write => write.action === "apply" && write.ruleId === "33333333-3333-4333-8333-333333333333")).toBe(true);
  });
}
