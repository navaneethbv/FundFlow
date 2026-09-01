import { existsSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CumulativeCompareChart from "@/components/charts/CumulativeCompareChart";
import DivergingColumns from "@/components/charts/DivergingColumns";
import StatTile from "@/components/charts/StatTile";
import TrendChart from "@/components/charts/TrendChart";
import SegmentedControl from "@/components/ui/SegmentedControl";

/**
 * Small semantics and dead code cleanup (frontend-review R11, R12):
 * - SegmentedControl active item carries aria-current="page".
 * - StatTile arrow glyphs carry aria-hidden="true".
 * - Chart fallback tables (TrendChart, DivergingColumns, CumulativeCompareChart)
 *   are wrapped in overflow-x-auto containers.
 * - SectionHeading.tsx is dead code and deleted.
 */

describe("small semantics and cleanups", () => {
  it("SegmentedControl active item has aria-current='page'", () => {
    const html = renderToStaticMarkup(
      createElement(SegmentedControl, {
        ariaLabel: "Timeframe",
        items: [
          { label: "Month", href: "?t=month", active: true },
          { label: "Year", href: "?t=year", active: false },
        ],
      }),
    );
    expect(html).toContain('aria-current="page"');
  });

  it("StatTile arrow glyphs are wrapped with aria-hidden", () => {
    const html = renderToStaticMarkup(
      createElement(StatTile, {
        label: "Net Income",
        value: 5000,
        delta: 250,
        deltaVs: "last month",
      }),
    );
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("▲");
  });

  it("TrendChart data table is wrapped in overflow-x-auto", () => {
    const html = renderToStaticMarkup(
      createElement(TrendChart, {
        labels: ["Jan", "Feb"],
        series: [{ name: "Income", values: [100, 200], slot: 1 }],
      }),
    );
    expect(html).toContain('class="overflow-x-auto"');
  });

  it("DivergingColumns data table is wrapped in overflow-x-auto", () => {
    const html = renderToStaticMarkup(
      createElement(DivergingColumns, {
        labels: ["Jan", "Feb"],
        up: [100, 200],
        down: [50, 75],
        upName: "Income",
        downName: "Expenses",
      }),
    );
    expect(html).toContain('class="overflow-x-auto"');
  });

  it("CumulativeCompareChart data table is wrapped in overflow-x-auto", () => {
    const html = renderToStaticMarkup(
      createElement(CumulativeCompareChart, {
        monthLabel: "Aug",
        previousMonthLabel: "Jul",
        days: [{ day: 1, thisMonth: 50, lastMonth: 40 }],
      }),
    );
    expect(html).toContain('class="overflow-x-auto"');
  });

  it("SectionHeading.tsx does not exist", () => {
    expect(existsSync("components/ui/SectionHeading.tsx")).toBe(false);
  });
});
