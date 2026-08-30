import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import LifeEventsPanel from "@/components/forecasting/LifeEventsPanel";

const points = [
  { month: "Month 1", conservative: 1000, base: 1200, optimistic: 1400 },
  { month: "Month 2", conservative: 1100, base: 1400, optimistic: 1700 },
];

describe("LifeEventsPanel", () => {
  it("renders the adjusted projection and editable event controls", () => {
    const html = renderToStaticMarkup(
      createElement(LifeEventsPanel, {
        basePoints: points,
        monthlySavings: 100,
        currentNetWorth: 800,
        currency: "USD",
        initialEvents: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            type: "retirement",
            startMonth: 1,
            amount: 0,
            durationMonths: null,
          },
        ],
      }),
    );

    expect(html).toContain("Net worth projection");
    expect(html).toContain("$1,400.00");
    expect(html).toContain("$1,200.00");
    expect(html).toContain("Stops monthly savings");
    expect(html).toContain("Edit Retirement event");
    expect(html).toContain('aria-label="Net worth projection"');
  });
});
