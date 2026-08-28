import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ForecastChart from "@/components/forecasting/ForecastChart";

describe("ForecastChart", () => {
  it("collapses coincident scenarios to one base series", () => {
    const html = renderToStaticMarkup(
      createElement(ForecastChart, {
        currentNetWorth: 1000,
        points: [
          { month: "Month 1", conservative: 1000, base: 1000, optimistic: 1000 },
          { month: "Month 2", conservative: 1000, base: 1000, optimistic: 1000 },
        ],
      }),
    );

    expect(html).toContain(">Base</span>");
    expect(html).not.toContain(">Conservative</span>");
    expect(html).not.toContain(">Optimistic</span>");
    expect(html).toContain("<th>Month</th><th>Base</th>");
    expect(html).not.toContain("<th>Conservative</th>");
  });

  it("keeps all scenario series when their projections differ", () => {
    const html = renderToStaticMarkup(
      createElement(ForecastChart, {
        currentNetWorth: 1000,
        points: [
          { month: "Month 1", conservative: 990, base: 1000, optimistic: 1010 },
          { month: "Month 2", conservative: 980, base: 1000, optimistic: 1020 },
        ],
      }),
    );

    expect(html).toContain(">Conservative</span>");
    expect(html).toContain(">Base</span>");
    expect(html).toContain(">Optimistic</span>");
    expect(html).toContain("<th>Conservative</th>");
    expect(html).toContain("<th>Optimistic</th>");
  });
});
