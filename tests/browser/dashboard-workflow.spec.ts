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
    input: "workflow-fixture", platform: "browser",
    onwarn(warning, warn) { if (warning.code !== "MODULE_LEVEL_DIRECTIVE") warn(warning); },
    resolve: { alias: { "@": root } },
    transform: { define: { "process.env.NODE_ENV": '"production"' }, jsx: "react-jsx" },
    plugins: [{ name: "fixture", resolveId(id) {
      if (["workflow-fixture", "next/navigation"].includes(id)) return `\0${id}`;
    }, load(id) {
      if (id === "\0next/navigation") return 'export function useRouter() { return { push(url) { history.pushState(null, "", url); } }; }';
      if (id === "\0workflow-fixture") return `
        import { createElement as h, useState } from "react";
        import { createRoot } from "react-dom/client";
        import WidgetChoice from ${JSON.stringify(path.join(root, "components/dashboard/widgets/WidgetChoice.tsx"))};
        import NetWorthWidget from ${JSON.stringify(path.join(root, "components/dashboard/widgets/NetWorthWidget.tsx"))};
        import RouteSelect from ${JSON.stringify(path.join(root, "components/ui/RouteSelect.tsx"))};
        import DetailPane from ${JSON.stringify(path.join(root, "components/ui/DetailPane.tsx"))};
        function Fixture() {
          const [open, setOpen] = useState(false);
          return h("main", {}, h("h1", {}, "Dashboard"),
            h(RouteSelect, {label: "Account filter", value: "/dashboard?scope=household", options: [{label: "All accounts", href: "/dashboard?scope=household"}, {label: "Checking", href: "/dashboard?scope=household&accountId=checking"}]}),
            h(WidgetChoice, { title: "Transactions", label: "Transaction direction", options: [{value: "all", label: "All", content: h("p", {}, "Coffee and payroll")}, {value: "in", label: "Money in", content: h("p", {}, "Payroll only")}]}),
            h(NetWorthWidget, { currency: "USD", history: [{month: "2026-08", netWorth: 100}, {month: "2026-09", netWorth: 200}, {month: "2026-10", netWorth: 300}, {month: "2026-11", netWorth: 400}] }),
            h("button", {onClick: () => setOpen(true)}, "Open details"),
            h(DetailPane, {open, onClose: () => setOpen(false), titleId: "detail-title"}, h("h2", {id: "detail-title"}, "Synthetic transaction"), h("button", {}, "Last control"))
          );
        }
        createRoot(document.getElementById("root")).render(h(Fixture));
      `;
    } }],
  });
  try { script = (await bundle.generate({ format: "iife" })).output[0]!.code; } finally { await bundle.close(); }
  const source = path.join(root, "app/globals.css");
  css = (await postcss([tailwind()]).process(await readFile(source, "utf8"), { from: source })).css;
});

for (const width of [375, 1440]) for (const theme of ["light", "dark"]) {
  test(`dashboard selectors and modal keyboard at ${width}px ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route("http://fundflow.test/**", route => route.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="en" data-theme="${theme}"><head><title>Workflow fixture</title><style>${css}</style></head><body><div id="root"></div></body></html>` }));
    await page.goto("http://fundflow.test/dashboard?scope=household");
    await page.addScriptTag({ content: script });
    await page.getByLabel("Transaction direction").selectOption("in");
    await expect(page.getByText("Payroll only")).toBeVisible();
    await expect(page.getByText("Coffee and payroll")).toHaveCount(0);
    await page.getByLabel("Net worth timeframe").selectOption("all");
    await page.getByText("View net worth history").click();
    await expect(page.getByRole("rowheader", { name: "Aug 2026" })).toBeVisible();
    await page.getByLabel("Account filter").selectOption("/dashboard?scope=household&accountId=checking");
    expect(new URL(page.url()).searchParams.get("scope")).toBe("household");
    expect(new URL(page.url()).searchParams.get("accountId")).toBe("checking");
    await page.getByRole("button", { name: "Open details" }).click();
    await expect(page.getByRole("button", { name: "Close details", exact: true })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByRole("button", { name: "Last control" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Close details", exact: true })).toBeFocused();
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open details" })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
