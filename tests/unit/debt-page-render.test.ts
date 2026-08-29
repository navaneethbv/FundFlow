import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import DebtPlannerView from "@/components/debt/DebtPlannerView";
import CardAprSection from "@/components/settings/CardAprSection";
import { buildDebtPlannerData } from "@/lib/debt-data";

describe("DebtPlannerView", () => {
  it("renders shareable strategy controls and projection totals", () => {
    const data = buildDebtPlannerData(
      [
        { id: "card", name: "Card", balance: 1000, apr: 20 },
        { id: "loan", name: "Loan", balance: 500, apr: 8 },
      ],
      50,
    );

    const html = renderToStaticMarkup(
      createElement(DebtPlannerView, {
        data,
        strategy: "avalanche",
        extraMonthly: 50,
        scopeParam: "household-1",
      }),
    );

    expect(html).toContain("Debt payoff projection");
    expect(html).toContain("Avalanche");
    expect(html).toContain("Snowball");
    expect(html).toContain("Total projected interest");
    expect(html).toContain("Debt-free projection");
    expect(html).toContain("strategy=snowball");
    expect(html).toContain("extra=50");
    expect(html).toContain("scope=household-1");
    expect(html).not.toContain("prediction");
    expect(html).toContain("not a guarantee");
  });

  it("identifies each assumed APR and links to the APR settings section", () => {
    const data = buildDebtPlannerData(
      [{ id: "card", name: "Card", balance: 1000, apr: null }],
      0,
    );
    const html = renderToStaticMarkup(
      createElement(DebtPlannerView, {
        data,
        strategy: "avalanche",
        extraMonthly: 0,
      }),
    );

    expect(html).toContain("22% assumed APR");
    expect(html).toContain("/settings?section=institutions#card-aprs");
  });

  it("keeps two same-named debts as distinct rows", () => {
    const data = buildDebtPlannerData(
      [
        { id: "visa-a", name: "Visa", balance: 1000, apr: 24 },
        { id: "visa-b", name: "Visa", balance: 4000, apr: 10 },
      ],
      100,
    );
    const html = renderToStaticMarkup(
      createElement(DebtPlannerView, {
        data,
        strategy: "avalanche",
        extraMonthly: 100,
      }),
    );

    // Both balances have to appear: a name-keyed join renders the same debt
    // twice and drops the other one entirely.
    expect(html).toContain("$1,000.00");
    expect(html).toContain("$4,000.00");
    expect(html).toContain("24.00%");
    expect(html).toContain("10.00%");
  });

  it("renders an honest empty state", () => {
    const html = renderToStaticMarkup(
      createElement(DebtPlannerView, {
        data: buildDebtPlannerData([], 100),
        strategy: "avalanche",
        extraMonthly: 100,
      }),
    );

    expect(html).toContain("No debt accounts found");
    expect(html).not.toContain("Total projected interest");
  });

  it("explains when the monthly budget cannot outrun interest", () => {
    const data = buildDebtPlannerData(
      [{ id: "trap", name: "High-interest loan", balance: 10000, apr: 99.99 }],
      0,
    );
    const html = renderToStaticMarkup(
      createElement(DebtPlannerView, {
        data,
        strategy: "snowball",
        extraMonthly: 0,
      }),
    );

    expect(html).toContain("does not cover the projected interest");
    expect(html).not.toContain("Debt-free projection</dt><dd>0");
  });

  it("colors balance and interest figures with the negative money-direction token and wraps them in the privacy-blur hook", () => {
    const data = buildDebtPlannerData(
      [{ id: "card", name: "Card", balance: 1000, apr: 20 }],
      50,
    );
    const html = renderToStaticMarkup(
      createElement(DebtPlannerView, {
        data,
        strategy: "avalanche",
        extraMonthly: 50,
      }),
    );

    // Stat-grid Total balance and Total projected interest, plus the
    // table's Balance and Projected interest cells: 4 occurrences.
    const occurrences = html.match(/data-money/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(4);
    expect(html).toContain("var(--viz-neg)");
    expect(html).not.toContain("text-danger");
  });

  it("keeps dt/dd as valid direct dl children (no section between them)", () => {
    const data = buildDebtPlannerData(
      [{ id: "card", name: "Card", balance: 1000, apr: 20 }],
      50,
    );
    const html = renderToStaticMarkup(
      createElement(DebtPlannerView, {
        data,
        strategy: "avalanche",
        extraMonthly: 50,
      }),
    );

    // The dl's direct children are neutral divs, each pairing one dt with one
    // dd — a Panel (section) between dl and dt/dd is invalid markup.
    expect(html).toContain("<dl class=\"grid gap-3 sm:grid-cols-2 xl:grid-cols-4\">");
    const dlStart = html.indexOf("<dl class=");
    const dlEnd = html.indexOf("</dl>");
    const dlBody = html.slice(dlStart, dlEnd);
    expect(dlBody).not.toContain("<section");
    expect(dlBody).toMatch(/<div class="min-w-0 rounded-card/);
    // Every dt inside the dl is followed by its dd in the same div group.
    expect(dlBody).toContain("<dt ");
    expect(dlBody).toContain("<dd ");
    expect(dlBody.match(/<dt /g) ?? []).toHaveLength(4);
    expect(dlBody.match(/<dd /g) ?? []).toHaveLength(4);
  });

  it("sets the table header and stat-grid labels in the mono face", () => {
    const data = buildDebtPlannerData(
      [{ id: "card", name: "Card", balance: 1000, apr: 20 }],
      50,
    );
    const html = renderToStaticMarkup(
      createElement(DebtPlannerView, {
        data,
        strategy: "avalanche",
        extraMonthly: 50,
      }),
    );
    expect(html).toContain('class="border-b border-panel-border text-xs uppercase tracking-wide text-muted font-mono"');
    expect(html).toContain('class="text-xs font-semibold uppercase tracking-wide text-muted font-mono"');
  });
});

describe("CardAprSection debt-planner anchor", () => {
  it("provides the direct fragment targeted by assumed APR links", () => {
    const html = renderToStaticMarkup(
      createElement(CardAprSection, {
        initialAccounts: [
          { id: "card", name: "Card", mask: "1234", apr: null },
        ],
      }),
    );

    expect(html).toContain('id="card-aprs"');
  });
});
