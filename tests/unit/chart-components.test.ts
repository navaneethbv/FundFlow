import { describe, expect, it } from "vitest";
import DonutChart from "@/components/charts/DonutChart";
import Sparkline from "@/components/charts/Sparkline";
import StatTile from "@/components/charts/StatTile";
import SankeyChart from "@/components/charts/SankeyChart";
import TrendChart from "@/components/charts/TrendChart";

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
    const sankey = SankeyChart({
      nodes: [
        { id: "in", label: "Income", value: 500, column: 0 },
        { id: "out", label: "Expenses", value: 500, column: 1 },
      ],
      links: [{ source: "in", target: "out", value: 500 }],
      title: "Cash flow",
    });
    expect(sankey).toBeDefined();
  });
});
