import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["components", "app"];
const BLUR_HOOK = /(data-money|metric-value|<Money|"money|'money| money )/;
const AMOUNT_CALL = /formatCurrency\(/;

/**
 * Files whose amounts render through a hooked wrapper in another file.
 * Each entry names the wrapper that carries the hook.
 */
const DELEGATED_HOOKS: Record<string, string> = {
  // Amount travels as WidgetShell's `value` prop, which carries data-money.
  "components/dashboard/widgets/SpendingCompareWidget.tsx": "WidgetShell value",
};

/**
 * Privacy blur (F-1): every rendered currency amount must sit under a blur
 * hook (data-money, .money, .metric-value, or <Money>), or privacy mode
 * leaves it visible while promising "every amount is hidden".
 */
function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...tsxFiles(path));
    else if (path.endsWith(".tsx")) out.push(path);
  }
  return out;
}

describe("privacy blur coverage", () => {
  it("hooks every rendered amount", () => {
    const cwd = process.cwd();
    const unhooked: string[] = [];
    for (const root of ROOTS) {
      for (const file of tsxFiles(join(cwd, root))) {
        const content = readFileSync(file, "utf8");
        if (!AMOUNT_CALL.test(content)) continue;
        // Test and story files render amounts for assertions, not users.
        if (file.includes(".test.") || file.includes(".stories.")) continue;
        const relative = file.replace(`${cwd}/`, "");
        if (DELEGATED_HOOKS[relative]) continue;
        if (!BLUR_HOOK.test(content)) {
          unhooked.push(relative);
        }
      }
    }
    expect(unhooked).toEqual([]);
  });

  it("blurs the privacy contract hooks in CSS", () => {
    const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
    expect(css).toContain('[data-privacy="blur"]');
    for (const hook of [".metric-value", ".money", "[data-money]"]) {
      expect(css).toContain(hook);
    }
  });
});
