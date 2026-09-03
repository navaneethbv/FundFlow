import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import PriceSpikeBanner from "@/components/recurring/PriceSpikeBanner";
import type { PriceSpikeAlert } from "@/lib/recurring-alerts";

describe("PriceSpikeBanner Component", () => {
  it("renders null when there are no alerts", () => {
    const html = renderToStaticMarkup(
      createElement(PriceSpikeBanner, { initialAlerts: [] }),
    );
    expect(html).toBe("");
  });

  it("renders banner with price increases, annual cost, and action links", () => {
    const sampleAlerts: PriceSpikeAlert[] = [
      {
        id: "alert-1",
        merchantName: "Streaming Max",
        frequency: "monthly",
        previousAmount: 14.99,
        currentAmount: 17.99,
        increaseAmount: 3.0,
        percentIncrease: 20.0,
        annualizedImpact: 36.0,
      },
    ];

    const html = renderToStaticMarkup(
      createElement(PriceSpikeBanner, { initialAlerts: sampleAlerts }),
    );

    expect(html).toContain("Subscription price increases detected");
    expect(html).toContain("Streaming Max");
    expect(html).toContain("$14.99");
    expect(html).toContain("$17.99");
    expect(html).toContain("+20%");
    expect(html).toContain("+$36.00/yr");
    expect(html).toContain("View history");
    expect(html).toContain("Dismiss all");
  });
});
