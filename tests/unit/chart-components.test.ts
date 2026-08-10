import { describe, expect, it } from "vitest";
import DonutChart from "@/components/charts/DonutChart";
import Sparkline from "@/components/charts/Sparkline";
import StatTile from "@/components/charts/StatTile";
import SankeyChart from "@/components/charts/SankeyChart";
import TrendChart from "@/components/charts/TrendChart";
import DivergingColumns from "@/components/charts/DivergingColumns";

describe("Chart React Components Unit Tests", () => {
  it("renders DonutChart with empty items and with items", () => {
    const emptyResult = DonutChart({ items: [], centerLabel: "Total" });
    expect(emptyResult).toBeDefined();

    const withItems = DonutChart({
      items: [
        { label: "Groceries", amount: 150, href: "/ledger?cat=groceries" },
        { label: "Dining", amount: 50 },
      ],
      centerLabel: "Spent",
    });
    expect(withItems).toBeDefined();
  });

  it("renders Sparkline with values", () => {
    const emptySpark = Sparkline({ values: [] });
    expect(emptySpark).toBeNull();

    const spark = Sparkline({ values: [10, 25, 15, 40] });
    expect(spark).toBeDefined();
  });

  it("renders StatTile with label, value, and change", () => {
    const tile = StatTile({
      label: "Net Worth",
      value: 100000,
      delta: 12000,
      deltaVs: "last month",
      trend: [98000, 100000],
    });
    expect(tile).toBeDefined();
  });

  it("renders TrendChart with series data", () => {
    const empty = TrendChart({ series: [], labels: [] });
    expect(empty).toBeDefined();

    const trend = TrendChart({
      series: [
        { name: "Checking", slot: 1, values: [100, 200, 300] },
        { name: "Savings", slot: 2, values: [500, 600, 700] },
      ],
      labels: ["May", "Jun", "Jul"],
    });
    expect(trend).toBeDefined();
  });

  it("renders SankeyChart with nodes and links", () => {
    const emptySankey = SankeyChart({ nodes: [], links: [] });
    expect(emptySankey).toBeDefined();

    const sankey = SankeyChart({
      nodes: [
        { id: "in", label: "Income Very Long Category Label Exceeding Max Chars", value: 500, column: 0, href: "/income" },
        { id: "hub", label: "Hub", value: 500, column: 1 },
        { id: "group:net-income", label: "Net Income", value: 300, column: 2 },
        { id: "group:unfunded", label: "Unfunded", value: 200, column: 2 },
        { id: "cat:rent", label: "Rent", value: 200, column: 3 },
      ],
      links: [
        { source: "in", target: "hub", value: 500 },
        { source: "hub", target: "group:net-income", value: 300 },
        { source: "hub", target: "group:unfunded", value: 200 },
        { source: "group:unfunded", target: "cat:rent", value: 200 },
      ],
      title: "Cash flow",
      currency: "EUR",
      maxNodesPerColumn: 5,
    });
    expect(sankey).toBeDefined();
  });

  it("renders DivergingColumns with all combinations of line, links, and values", () => {
    const empty = DivergingColumns({
      labels: [],
      up: [],
      down: [],
      upName: "Income",
      downName: "Expenses",
    });
    expect(empty).toBeDefined();

    const zeroMax = DivergingColumns({
      labels: ["Jan"],
      up: [0],
      down: [0],
      upName: "Income",
      downName: "Expenses",
    });
    expect(zeroMax).toBeDefined();

    const withLinks = DivergingColumns({
      labels: ["Jan", "Feb"],
      up: [1000, 500],
      down: [800, 600],
      upName: "Inflow",
      downName: "Outflow",
      links: ["/link-1", undefined],
      line: {
        name: "Net",
        values: [200, -100],
      },
    });
    expect(withLinks).toBeDefined();

    const negativeAndZero = DivergingColumns({
      labels: ["Jan", "Feb"],
      up: [0, 100],
      down: [200, 0],
      upName: "Inflow",
      downName: "Outflow",
      valueFormatter: (v) => `$${v}`,
    });
    expect(negativeAndZero).toBeDefined();
  });
});
