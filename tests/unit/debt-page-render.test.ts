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
