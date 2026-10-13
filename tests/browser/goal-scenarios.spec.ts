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
    input: "goal-fixture", platform: "browser",
    onwarn(warning, warn) { if (warning.code !== "MODULE_LEVEL_DIRECTIVE") warn(warning); },
    resolve: { alias: { "@": root } },
    transform: { define: { "process.env.NODE_ENV": '\'"production"\'' }, jsx: "react-jsx" },
    plugins: [{ name: "goal-fixture", resolveId(id) { if (id === "goal-fixture") return "\0goal-fixture"; },
      load(id) { if (id === "\0goal-fixture") return `
        import { createElement as h, useState } from "react";
        import { createRoot } from "react-dom/client";
        import Planner from ${JSON.stringify(path.join(root, "components/goals/GoalScenarioPlanner.tsx"))};
        function Fixture() {
          const [funded, setFunded] = useState(100);
          return h("main", {style: {padding: 16}}, h("h1", {}, "Goals"),
            h("button", {onClick: () => setFunded(200)}, "Refresh source"),
            h(Planner, {today: "2028-01-31", goals: [
              {id: "a", name: "Emergency fund", targetAmount: 1000, fundedAmount: funded, targetDate: "2028-03-31"},
              {id: "b", name: "Vacation", targetAmount: 2000, fundedAmount: 0, targetDate: null}
            ]}));
        }
        createRoot(document.getElementById("root")).render(h(Fixture));
      `; }
    }],
  });
  try { script = (await bundle.generate({ format: "iife" })).output[0]!.code; } finally { await bundle.close(); }
  const source = path.join(root, "app/globals.css");
  css = (await postcss([tailwind()]).process(await readFile(source, "utf8"), { from: source })).css;
});
for (const width of [375, 1440]) {
  test(`goal scenarios edit, reset and stay private at ${width}px`, async ({ page }, testInfo) => {
    const errors: string[] = [], requests: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => requests.push(request.url()));
    await page.setViewportSize({width, height: 1000});
    await page.route("http://fundflow.test/**", route => route.fulfill({contentType: "text/html", body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Goal scenarios</title><style>${css}</style></head><body><div id="root"></div><script>${script}</script></body></html>`}));
    await page.goto("http://fundflow.test/goals");
    await page.getByLabel("Contribution amount (USD)").fill("100");
    await expect(page.getByText("2028-10-31", {exact: true}).first()).toBeVisible();
    await page.getByLabel("Immediate lump sum (USD)").fill("400");
    await page.getByLabel("Skip first contributions").fill("2");
    await expect(page.getByText("2028-08-31", {exact: true}).first()).toBeVisible();
    await expect(page.getByText("No scheduled contributions fall on or before this deadline.")).toBeVisible();
    await page.getByLabel("Cadence").selectOption("weekly");
    await expect(page.getByText("2028-03-20", {exact: true}).first()).toBeVisible();
    await page.getByLabel("Skip first contributions").fill("121");
    await expect(page.getByRole("alert")).toContainText("0 and 120");
    await page.getByRole("button", {name: "Reset scenario"}).click();
    await expect(page.getByLabel("Contribution amount (USD)")).toHaveValue("0");
    await page.getByLabel("Contribution amount (USD)").fill("300");
    await page.getByLabel("Savings goal").selectOption("b");
    await expect(page.getByLabel("Contribution amount (USD)")).toHaveValue("0");
    await expect(page.getByLabel("Deadline")).toHaveValue("");
    await page.getByLabel("Savings goal").selectOption("a");
    await page.getByLabel("Contribution amount (USD)").fill("300");
    await page.getByRole("button", {name: "Refresh source"}).click();
    await expect(page.getByLabel("Contribution amount (USD)")).toHaveValue("0");
    await page.getByLabel("Deadline").fill("2027-01-01");
    await expect(page.getByText("This deadline is before today. Choose today or a future date.")).toBeVisible();
    await page.getByLabel("Contribution amount (USD)").fill("-1");
    await expect(page.getByRole("alert")).toContainText("Enter amounts");
    await page.getByRole("button", {name: "Reset scenario"}).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({page}).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`goals-${width}.png`), fullPage: true });
    await page.evaluate(() => { document.documentElement.dataset.privacy = "blur"; });
    expect(await page.locator("[data-money]").evaluateAll(nodes => nodes.every(node => getComputedStyle(node).filter.includes("blur")))).toBe(true);
    await expect(page.locator('input[type="number"]:not([data-money])')).toHaveCount(0);
    expect(page.url()).toBe("http://fundflow.test/goals");
    expect(requests).toEqual(["http://fundflow.test/goals"]);
    expect(await page.evaluate(() => localStorage.length)).toBe(0);
    expect(errors).toEqual([]);
  });
}
