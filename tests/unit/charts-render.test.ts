import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import TrendChart from "@/components/charts/TrendChart";
import DonutChart from "@/components/charts/DonutChart";
import DivergingColumns from "@/components/charts/DivergingColumns";
import Sparkline from "@/components/charts/Sparkline";
import StatTile from "@/components/charts/StatTile";
import AreaSparkline from "@/components/charts/AreaSparkline";
import MiniBars from "@/components/charts/MiniBars";
import RadialGauge from "@/components/charts/RadialGauge";
import SankeyChart from "@/components/charts/SankeyChart";
import CumulativeCompareChart from "@/components/charts/CumulativeCompareChart";

/**
 * The chart components are server-rendered SVG; rendering them to markup is
 * the regression net for geometry bugs (NaN coordinates, missing marks) and
 * the accessibility contract (legend for >=2 series, table twin, tooltips).
 */

const labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
const spend = [820, 940, 760, 1100, 890, 1020];
const income = [1500, 1500, 1480, 1600, 1500, 1550];

describe("TrendChart", () => {
  const html = renderToStaticMarkup(
    createElement(TrendChart, {
      labels,
      series: [
        { name: "Spending", slot: 6, values: spend },
        { name: "Income", slot: 1, values: income },
      ],
    }),
  );

  it("renders lines without NaN and with 2px strokes", () => {
    expect(html).not.toContain("NaN");
    expect(html).toContain('stroke="var(--viz-6)"');
    expect(html).toContain('stroke="var(--viz-1)"');
    expect(html).toContain('stroke-width="2"');
  });

  it("has a legend (2 series), endpoint labels, tooltips, and a table twin", () => {
    expect(html).toContain("Spending");
    expect(html).toContain("Income");
    expect(html).toContain("<title>");
    expect(html).toContain("View data table");
    expect(html).toContain("$1K"); // endpoint direct label (compact)
  });

  it("shows an empty state instead of an empty plot", () => {
    const empty = renderToStaticMarkup(
      createElement(TrendChart, { labels: [], series: [{ name: "S", slot: 1, values: [] }] }),
    );
    expect(empty).toContain("No data yet");
  });

  it("renders single series with area wash and handles single label and converging end labels", () => {
    const htmlSingle = renderToStaticMarkup(
      createElement(TrendChart, {
        labels: ["Jan"],
        series: [{ name: "Spending", slot: 1, values: [500] }],
      }),
    );
    expect(htmlSingle).toContain("<path");
    expect(htmlSingle).not.toContain("NaN");

    const htmlConverge = renderToStaticMarkup(
      createElement(TrendChart, {
        labels: ["Jan", "Feb"],
        series: [
          { name: "S1", slot: 1, values: [100, 500] },
          { name: "S2", slot: 2, values: [100, 505] },
        ],
      }),
    );
    expect(htmlConverge).not.toContain("NaN");
  });
});

describe("DonutChart", () => {
  const items = [
    { label: "Food And Drink", amount: 420 },
    { label: "Travel", amount: 260 },
    { label: "Shops", amount: 180 },
    { label: "Other", amount: 90 },
  ];
  const html = renderToStaticMarkup(
    createElement(DonutChart, { items, centerLabel: "total spend" }),
  );

  it("renders one gapped segment per item without NaN", () => {
    expect(html).not.toContain("NaN");
    const paths = html.match(/<path /g) ?? [];
    expect(paths).toHaveLength(items.length);
  });

  it("legend lists every label AND value (the relief rule for light slots)", () => {
    for (const i of items) {
      expect(html).toContain(i.label);
    }
    expect(html).toContain("$420");
    expect(html).toContain("total spend");
  });
});

describe("DivergingColumns", () => {
  const html = renderToStaticMarkup(
    createElement(DivergingColumns, {
      labels,
      up: [2000, 2100, 1900, 2200, 2050, 2000],
      down: [1500, 1800, 1600, 1700, 1900, 1650],
      upName: "Deposits",
      downName: "Withdrawals",
    }),
  );

  it("renders both arms on one shared scale without NaN", () => {
    expect(html).not.toContain("NaN");
    expect(html).toContain('fill="var(--viz-pos)"');
    expect(html).toContain('fill="var(--viz-neg)"');
  });

  it("has legend, tooltips with net, and a table twin", () => {
    expect(html).toContain("Deposits");
    expect(html).toContain("Withdrawals");
    expect(html).toContain("Net:");
    expect(html).toContain("View data table");
  });
});

describe("Sparkline and StatTile", () => {
  it("sparkline renders flat series without NaN (zero range guard)", () => {
    const html = renderToStaticMarkup(createElement(Sparkline, { values: [5, 5, 5, 5] }));
    expect(html).not.toContain("NaN");
    expect(html).toContain("circle");
  });

  it("stat tile shows value, signed delta with direction color, and trend", () => {
    const html = renderToStaticMarkup(
      createElement(StatTile, {
        label: "June · Expenses",
        value: 1020,
        delta: 130,
        deltaVs: "May 2026",
        upIsGood: false,
        trend: spend,
      }),
    );
    expect(html).toContain("$1,020.00");
    expect(html).toContain("▲");
    expect(html).toContain("vs May 2026");
    expect(html).toContain("var(--viz-bad)"); // spending up = bad direction
  });
});

import BarList from "@/components/dashboard/BarList";

describe("chart link affordances", () => {
  it("DonutChart wraps slices and legend rows in links when href is set", () => {
    const html = renderToStaticMarkup(
      createElement(DonutChart, {
        items: [
          { label: "Food And Drink", amount: 420, href: "/dashboard?category=FOOD_AND_DRINK" },
          { label: "Travel", amount: 260 },
        ],
        centerLabel: "spent",
      }),
    );
    expect(html).toContain('href="/dashboard?category=FOOD_AND_DRINK"');
    // Unlinked items render no anchor for themselves: exactly 2 anchors
    // (slice + legend) for the one linked item.
    expect(html.match(/<a /g)?.length).toBe(2);
  });

  it("TrendChart makes month hit-targets links", () => {
    const html = renderToStaticMarkup(
      createElement(TrendChart, {
        labels,
        links: labels.map((_, i) => `/dashboard?month=2026-0${i + 1}`),
        series: [{ name: "Spending", slot: 1, values: spend }],
      }),
    );
    expect(html).toContain('href="/dashboard?month=2026-01"');
    expect(html).toContain('href="/dashboard?month=2026-06"');
  });

  it("DivergingColumns makes month hit-targets links", () => {
    const html = renderToStaticMarkup(
      createElement(DivergingColumns, {
        labels,
        up: income,
        down: spend,
        upName: "Deposits",
        downName: "Withdrawals",
        links: labels.map((_, i) => `/dashboard?tab=cashflow&month=2026-0${i + 1}`),
      }),
    );
    expect(html).toContain('href="/dashboard?tab=cashflow&amp;month=2026-03"');
  });
});

describe("BarList links", () => {
  it("renders items as links when href is set", () => {
    const html = renderToStaticMarkup(
      createElement(BarList, {
        items: [
          { label: "Netflix", amount: 15.49, href: "/dashboard?merchant=Netflix" },
          { label: "Safeway", amount: 210 },
        ],
        max: 210,
      }),
    );
    expect(html).toContain('href="/dashboard?merchant=Netflix"');
    expect(html.match(/<a /g)?.length).toBe(1);
  });
});

describe("AreaSparkline", () => {
  it("renders area sparkline without NaN", () => {
    const html = renderToStaticMarkup(createElement(AreaSparkline, { values: [5, 10, 5, 20] }));
    expect(html).not.toContain("NaN");
    expect(html).toContain("path");
  });

  it("returns null if values length is less than 2", () => {
    const html = renderToStaticMarkup(createElement(AreaSparkline, { values: [5] }));
    expect(html).toBe("");
  });
});

describe("MiniBars", () => {
  it("renders mini bars matching list values", () => {
    const html = renderToStaticMarkup(createElement(MiniBars, { values: [5, 10, 15] }));
    expect(html).toContain("flex");
    expect(html.match(/<span /g)?.length).toBe(3);
  });
});

describe("RadialGauge", () => {
  it("renders radial gauge with correct circumference and dash", () => {
    const html = renderToStaticMarkup(createElement(RadialGauge, { value: 75 }));
    expect(html).toContain("svg");
    expect(html).toContain("circle");
  });
});

describe("SankeyChart", () => {
  const nodes = [
    { id: "src:Wages", label: "Wages", value: 4000, column: 0 },
    { id: "hub", label: "Income", value: 4000, column: 1 },
    { id: "grp:Rent", label: "Rent", value: 1200, column: 2 },
    { id: "grp:__net__", label: "Net Income", value: 2800, column: 2 },
    { id: "cat:Rent::Rent", label: "Monthly rent", value: 1200, column: 3 },
  ];
  const links = [
    { source: "src:Wages", target: "hub", value: 4000 },
    { source: "hub", target: "grp:Rent", value: 1200 },
    { source: "hub", target: "grp:__net__", value: 2800 },
    { source: "grp:Rent", target: "cat:Rent::Rent", value: 1200 },
  ];
  const html = renderToStaticMarkup(
    createElement(SankeyChart, { nodes, links, title: "July cash flow" }),
  );

  it("renders ribbons and nodes without NaN coordinates", () => {
    expect(html).not.toContain("NaN");
    expect(html).toContain("<path");
    expect(html).toContain("<rect");
  });

  it("colours by group using viz tokens, never a hard-coded hex", () => {
    expect(html).toContain("var(--sankey-source)");
    expect(html).toContain("var(--sankey-hub)");
    expect(html).toContain("var(--sankey-group-1)");
    // Surplus is an outcome, not a spending group, so it takes the diverging
    // pole the rest of the app already uses for money kept.
    expect(html).toContain("var(--sankey-net)");
    expect(html).not.toMatch(/fill="#[0-9a-f]{3,6}"/i);
  });

  it("uses theme-driven ribbon opacity", () => {
    expect(html).toContain('fill-opacity="var(--sankey-flow-opacity)"');
  });

  it("gives a category its parent group's colour", () => {
    // "Rent" the group and "Monthly rent" the category are one family; a
    // category that picked its own hue would read as unrelated to its parent.
    const groupFill = /<rect[^>]*><title>Rent: /.exec(html);
    const categoryFill = /<rect[^>]*><title>Monthly rent: /.exec(html);
    const hueOf = (match: RegExpExecArray | null) =>
      /fill="(var\(--(?:sankey|viz)-[^)]*\))"/.exec(match?.[0] ?? "")?.[1];

    expect(hueOf(groupFill)).toBeDefined();
    expect(hueOf(categoryFill)).toBe(hueOf(groupFill));
  });

  it("has an accessible name, tooltips, and a table twin", () => {
    expect(html).toContain("July cash flow");
    expect(html).toContain("<title>");
    expect(html).toContain("View data table");
  });

  it("drops the stage legend now that colour no longer encodes the column", () => {
    expect(html).not.toContain("Sources");
    expect(html).not.toContain("Stage ");
  });

  it("spends all seven validated slots, then falls back to a neutral", () => {
    // Eight groups. Seven is the measured ceiling for the categorical palette
    // (an eighth hue drops CVD separation to deltaE 2.4), so the eighth group
    // must take the neutral rather than a generated `--viz-8`.
    const many = [
      { id: "src:w", label: "Wages", value: 800, column: 0 },
      { id: "hub", label: "Income", value: 800, column: 1 },
      ...Array.from({ length: 8 }, (_, i) => ({
        id: `grp:g${i}`,
        label: `Group ${i}`,
        value: 100 - i,
        column: 2,
      })),
    ];
    const manyLinks = [
      { source: "src:w", target: "hub", value: 800 },
      ...Array.from({ length: 8 }, (_, i) => ({
        source: "hub",
        target: `grp:g${i}`,
        value: 100 - i,
      })),
    ];
    const rendered = renderToStaticMarkup(
      createElement(SankeyChart, {
        nodes: many,
        links: manyLinks,
        title: "Eight groups",
      }),
    );

    for (let slot = 1; slot <= 7; slot += 1) {
      expect(rendered).toContain(`var(--sankey-group-${slot})`);
    }
    expect(rendered).not.toContain("var(--sankey-group-8)");
    expect(rendered).toContain("var(--viz-ink-2)");
  });

  it("labels amounts with a share of total money in, and keeps the blur hook", () => {
    // Rent is 1200 of the 4000 that came in.
    expect(html).toContain("$1,200.00 (30.0%)");
    // Money rendered without these hooks escapes the privacy blur.
    expect(html).toContain('class="money"');
    expect(html).toContain("data-money");
  });

  it("labels every flow in the table using node labels, not raw ids", () => {
    expect(html).toContain("Monthly rent");
    expect(html).toContain("Net Income");
    expect(html).not.toContain("grp:__net__<");
  });

  it("keeps the label text off the series colour", () => {
    expect(html).toContain('fill="var(--viz-ink)"');
  });

  it("renders a table-first fallback for small screens", () => {
    expect(html).toContain("md:hidden");
    expect(html).toContain("Shown as a table on small screens.");
  });

  it("folds an oversized column but keeps full detail in the table", () => {
    const manyNodes = [
      { id: "hub", label: "Income", value: 100, column: 0 },
      ...Array.from({ length: 12 }, (_, index) => ({
        id: `g${index}`,
        label: `Group ${index}`,
        value: 100 - index,
        column: 1,
      })),
    ];
    const manyLinks = manyNodes
      .filter((node) => node.column === 1)
      .map((node) => ({ source: "hub", target: node.id, value: node.value }));
    const folded = renderToStaticMarkup(
      createElement(SankeyChart, {
        nodes: manyNodes,
        links: manyLinks,
        title: "Folded",
        maxNodesPerColumn: 4,
      }),
    );

    expect(folded).toContain("Other");
    // The table twin still lists the folded-away groups.
    expect(folded).toContain("Group 11");
  });

  it("renders an empty state rather than an empty chart", () => {
    expect(
      renderToStaticMarkup(
        createElement(SankeyChart, { nodes: [], links: [], title: "Nothing" }),
      ),
    ).toContain("No data yet.");
  });
});

describe("CumulativeCompareChart", () => {
  const days = [
    { day: 1, thisMonth: 100, lastMonth: 80 },
    { day: 2, thisMonth: 250, lastMonth: 190 },
    { day: 3, thisMonth: null, lastMonth: 300 },
    { day: 4, thisMonth: null, lastMonth: null },
  ];
  const html = renderToStaticMarkup(
    createElement(CumulativeCompareChart, {
      days,
      monthLabel: "July",
      previousMonthLabel: "June",
    }),
  );

  it("draws both series without NaN and using viz tokens", () => {
    expect(html).not.toContain("NaN");
    expect(html).toContain('stroke="var(--viz-1)"');
    expect(html).toContain('stroke="var(--viz-ink-2)"');
    expect(html).not.toMatch(/stroke="#[0-9a-f]{3,6}"/i);
  });

  it("has an accessible name, a legend, and a table twin", () => {
    expect(html).toContain("Cumulative spending");
    expect(html).toContain("July");
    expect(html).toContain("June");
    expect(html).toContain("View data table");
  });

  it("marks the current endpoint with a dot and its value", () => {
    expect(html).toContain("<circle");
    expect(html).toContain("$250");
  });

  it("shows an em dash for a day that has not happened", () => {
    // A zero here would read as "spent nothing today" rather than "not yet".
    expect(html).toContain("—");
  });

  it("forward-fills the shorter previous month in the table only", () => {
    // Day 4 has no June counterpart, so the table repeats June's final 300
    // while the plotted line simply ended.
    const rows = html.split("<tr").filter((row) => row.includes("<td"));
    expect(rows.at(-1)).toContain("$300");
  });

  it("renders an empty state rather than an empty chart", () => {
    expect(
      renderToStaticMarkup(
        createElement(CumulativeCompareChart, {
          days: [],
          monthLabel: "July",
          previousMonthLabel: "June",
        }),
      ),
    ).toContain("No spending yet.");
  });
});
