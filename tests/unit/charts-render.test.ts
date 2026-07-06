import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import TrendChart from "@/components/charts/TrendChart";
import DonutChart from "@/components/charts/DonutChart";
import DivergingColumns from "@/components/charts/DivergingColumns";
import Sparkline from "@/components/charts/Sparkline";
import StatTile from "@/components/charts/StatTile";

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
    expect(paths.length).toBe(items.length);
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
