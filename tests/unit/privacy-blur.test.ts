import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Privacy blur mode: a TopBar toggle sets data-privacy="blur" on <html>
 * (persisted per device in localStorage), and globals.css blurs the marked
 * amounts.
 *
 * The blur once keyed on `.metric-value` alone, on the assumption that it was
 * "the class already worn by all major amount displays". It was not: the class
 * appeared on ~44 of ~207 currency renders, so the Transactions ledger blurred
 * nothing at all while the toggle reported amounts hidden. Three hooks now
 * carry it — see the rule in globals.css.
 */
describe("privacy blur mode", () => {
  it("ships a client toggle following the ThemeToggle dataset pattern", () => {
    const source = readFileSync("components/PrivacyToggle.tsx", "utf8");
    expect(source).toContain('"use client"');
    expect(source).toContain("dataset.privacy");
    expect(source).toContain("localStorage");
    expect(source).toContain("aria-pressed");
  });

  it("is mounted in the top bar", () => {
    const source = readFileSync("components/shell/TopBar.tsx", "utf8");
    expect(source).toContain("PrivacyToggle");
  });

  it("blurs metric values via a data attribute, never via JS per amount", () => {
    const css = readFileSync("app/globals.css", "utf8");
    expect(css).toMatch(/\[data-privacy="blur"\][^{]*\.metric-value[^{]*\{[^}]*blur/);
  });

  it("covers the container and one-off hooks too, not just .metric-value", () => {
    const css = readFileSync("app/globals.css", "utf8");
    const rule = /\[data-privacy="blur"\]([^{]*)\{([^}]*)\}/.exec(css);
    expect(rule).not.toBeNull();
    const [, selector, body] = rule!;
    // Narrowing this back to .metric-value alone silently re-exposes the
    // ledger, so all three hooks are pinned.
    expect(selector).toContain(".metric-value");
    expect(selector).toContain(".money");
    expect(selector).toContain("[data-money]");
    expect(body).toContain("blur(");
    // Blurred text stays selectable-looking otherwise; iOS Safari needs the
    // prefix or the amounts can still be dragged out and read.
    expect(body).toContain("-webkit-user-select");
  });

  it("gives Money a marker class so a new amount is covered by default", () => {
    const source = readFileSync("components/ui/Money.tsx", "utf8");
    expect(source).toContain('"money"');
    expect(source).toContain("formatCurrency");
  });

  it("keeps the dense money surfaces marked at container level", () => {
    // These are the surfaces where amounts are too numerous to mark one by
    // one; each regressed to fully-legible when the blur keyed on
    // .metric-value only.
    for (const file of [
      "app/transactions/page.tsx",
      "components/transactions/MobileLedgerList.tsx",
      "components/dashboard/RecentActivity.tsx",
      "components/dashboard/BarList.tsx",
      "components/accounts/AccountRow.tsx",
    ]) {
      expect(readFileSync(file, "utf8"), file).toContain("data-money");
    }
  });
});
