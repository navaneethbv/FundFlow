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
    input: "bills-membership-fixture",
    platform: "browser",
    onwarn(warning, warn) {
      if (warning.code !== "MODULE_LEVEL_DIRECTIVE") warn(warning);
    },
    resolve: { alias: { "@": root } },
    transform: { define: { "process.env.NODE_ENV": '"production"' }, jsx: "react-jsx" },
    plugins: [{
      name: "bills-membership-fixture",
      resolveId(id) {
        if (["bills-membership-fixture", "next/navigation"].includes(id)) return `\0${id}`;
      },
      load(id) {
        if (id === "\0next/navigation") return 'export function useRouter() { return { refresh() { document.body.dataset.refreshed = "true"; } }; }';
        if (id === "\0bills-membership-fixture") {
          return `
            import { createElement as h } from "react";
            import { createRoot } from "react-dom/client";
            import MonthPulse from ${JSON.stringify(path.join(root, "components/recurring/MonthPulse.tsx"))};
            import SubscriptionCatalog from ${JSON.stringify(path.join(root, "components/recurring/SubscriptionCatalog.tsx"))};
            import Membership from ${JSON.stringify(path.join(root, "components/settings/MembershipCardValueSection.tsx"))};
            import PriceHistory from ${JSON.stringify(path.join(root, "components/recurring/PriceChangeHistory.tsx"))};
            const terms = [{ id: "membership-1", membershipName: "Travel membership", cardName: "Travel card", annualFee: 95, baselineAnnualFee: 0, anniversaryDate: "2026-01-01", confirmedOn: "2024-01-01", rewardTiers: [{ id: "base", label: "All eligible spend", rate: 0.02, cap: null, eligibleCategories: [] }], statementCredits: [], perks: [] }];
            const result = { anniversaryStart: "2026-01-01", anniversaryEnd: "2027-01-01", historyCoverage: 0.4, eligibleSpend: 1000, measuredRewards: 20, projectedRewards: 30, statementCredits: 0, subjectivePerks: { low: 0, base: 25, high: 50 }, cardAdvantage: { low: -75, base: -45, high: -25 }, membershipValue: { low: 0, base: 0, high: 0 }, totalValue: { low: -75, base: -45, high: -25 }, breakEvenSpend: 4750, termsStale: true };
            createRoot(document.getElementById("root")).render(h("div", { className: "space-y-6" },
              h(MonthPulse, { currency: "USD", occurrences: [
                { source: "manual", sourceId: "paid", merchant: "Rent", frequency: "monthly", dueDate: "2026-10-01", account: null, category: null, amount: 1200, status: "complete", matchedTransactionId: "paid", isIncome: false, evidenceCount: null },
                { source: "manual", sourceId: "next", merchant: "Internet", frequency: "monthly", dueDate: "2026-10-15", account: null, category: null, amount: 70, status: "upcoming", matchedTransactionId: null, isIncome: false, evidenceCount: null },
                { source: "manual", sourceId: "late", merchant: "Insurance", frequency: "monthly", dueDate: "2026-09-20", account: null, category: null, amount: 140, status: "overdue", matchedTransactionId: null, isIncome: false, evidenceCount: null },
              ] }),
              h(SubscriptionCatalog),
              h(PriceHistory, { currency: "USD", rows: [{ id: "change", recurring_stream_id: "stream", effective_date: "2026-09-01", previous_amount: 10, new_amount: 12 }], streamNames: new Map([["stream", "Music plan"]]) }),
              h(Membership, { initialTerms: terms, result })
            ));`;
        }
      },
    }],
  });
  try {
    script = (await bundle.generate({ format: "iife" })).output[0]!.code;
  } finally {
    await bundle.close();
  }
  const source = path.join(root, "app/globals.css");
  css = (await postcss([tailwind()]).process(await readFile(source, "utf8"), { from: source })).css;
});

for (const width of [375, 1440]) {
  test(`bills and membership surfaces at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const requests: unknown[] = [];
    await page.route("http://fundflow.test/**", async (route) => {
      if (route.request().url().includes("/api/")) {
        requests.push(route.request().postDataJSON());
        await route.fulfill({ contentType: "application/json", body: '{"ok":true}' });
        return;
      }
      await route.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="en"><head><title>Bills and membership</title><style>${css}</style></head><body><main style="padding:16px;max-width:1100px;margin:auto"><h1>Bills and membership</h1><div id="root"></div></main></body></html>` });
    });
    await page.goto("http://fundflow.test/");
    await page.addScriptTag({ content: script });
    await expect(page.getByRole("heading", { name: "Month pulse" })).toBeVisible();
    await expect(page.getByText("Projected bills are reminders only")).toBeVisible();
    await page.getByRole("checkbox", { name: "Streaming service" }).check();
    await page.getByLabel("Subscription first due date").fill("2026-10-20");
    await page.getByRole("button", { name: "Add selected" }).click();
    await expect.poll(() => requests.length).toBe(1);
    await page.getByRole("button", { name: "Add statement credit" }).click();
    await page.getByRole("button", { name: "Add subjective perk" }).click();
    await page.getByLabel("Rate (%)").fill("3");
    await page.getByRole("button", { name: "Save terms" }).click();
    await expect(page.getByRole("status")).toHaveText("Terms saved.");
    await expect(page.getByText("Terms may be stale")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath("bills-membership.png"), fullPage: true });
  });
}
