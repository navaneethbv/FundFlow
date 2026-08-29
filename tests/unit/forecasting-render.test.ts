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

  it("puts sr-only on a normal wrapper, not on the table, so table layout cannot widen the document", () => {
    const html = renderToStaticMarkup(
      createElement(ForecastChart, {
        currentNetWorth: 1000,
        points: [
          { month: "Month 1", conservative: 990, base: 1000, optimistic: 1010 },
          { month: "Month 2", conservative: 980, base: 1000, optimistic: 1020 },
        ],
      }),
    );

    // The accessible table still carries every period and scenario value...
    expect(html).toContain("Month 1");
    expect(html).toContain("$990.00");
    expect(html).toContain("$1,020.00");
    // ...but the clip lives on a normal div wrapper, with the table inside an
    // overflow-x container so its own column layout cannot escape.
    expect(html).toContain('<div class="sr-only">');
    expect(html).toContain('<div class="overflow-x-auto">');
    expect(html).toContain("<table class=");
    expect(html).not.toContain("<table class=\"sr-only\"");
  });

  it("keeps a long localized value in the accessible table", () => {
    const html = renderToStaticMarkup(
      createElement(ForecastChart, {
        currentNetWorth: 1234567890.5,
        points: [
          { month: "Month 1", conservative: 990, base: 1000, optimistic: 1010 },
        ],
      }),
    );
    expect(html).toContain("$990.00");
    expect(html).toContain(">Conservative</th>");
    expect(html).toContain(">Optimistic</th>");
  });
});
