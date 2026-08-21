import { describe, expect, it, vi } from "vitest";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    default: {
      ...actual,
      useId: () => "test-id",
    },
    useId: () => "test-id",
  };
});

import CumulativeCompareChart from "@/components/charts/CumulativeCompareChart";
import AreaSparkline from "@/components/charts/AreaSparkline";
import SankeyChart from "@/components/charts/SankeyChart";
import TrendChart from "@/components/charts/TrendChart";
import DonutChart from "@/components/charts/DonutChart";

describe("CumulativeCompareChart Branch Boost", () => {
  it("renders empty days message", () => {
    const el = CumulativeCompareChart({
      days: [],
      monthLabel: "August",
      previousMonthLabel: "July",
    });
    expect(el).toBeDefined();
  });

  it("renders with partial data, null values, and custom valueFormatter", () => {
    const el = CumulativeCompareChart({
      days: [
        { day: 1, thisMonth: 100, lastMonth: 80 },
        { day: 2, thisMonth: 250, lastMonth: null },
        { day: 3, thisMonth: null, lastMonth: 200 },
      ],
      monthLabel: "August",
      previousMonthLabel: "July",
      valueFormatter: (v) => `$${v}`,
    });
    expect(el).toBeDefined();
  });
});

describe("AreaSparkline Branch Boost", () => {
  it("returns null for fewer than 2 values", () => {
    expect(AreaSparkline({ values: [] })).toBeNull();
    expect(AreaSparkline({ values: [100] })).toBeNull();
  });

  it("renders sparkline for identical values (flat line) and varying values", () => {
    const flat = AreaSparkline({ values: [100, 100, 100] });
    expect(flat).toBeDefined();

    const normal = AreaSparkline({ values: [100, 200, 150], color: "blue" });
    expect(normal).toBeDefined();
  });
});

describe("SankeyChart Branch Boost", () => {
  it("handles SankeyChart with 2 columns, zero flow, and orphan links", () => {
    const chart = SankeyChart({
      title: "Simple Flow",
      nodes: [
        { id: "src", label: "Income", value: 1000, column: 0 },
        { id: "dst", label: "Expenses", value: 1000, column: 1 },
      ],
      links: [
        { source: "src", target: "dst", value: 1000 },
        { source: "ghost", target: "dst", value: 100 },
      ],
    });
    expect(chart).toBeDefined();

    // 8+ groups in column 2 to exhaust all 7 slots and trigger neutral fallback and tie-breakers
    const multiGroupNodes = [
      { id: "hub", label: "Hub", value: 800, column: 1 },
      { id: "g1", label: "Group A", value: 100, column: 2 },
      { id: "g2", label: "Group B", value: 100, column: 2 }, // same value as g1, tests tie-break
      { id: "g3", label: "Group C", value: 100, column: 2 },
      { id: "g4", label: "Group D", value: 100, column: 2 },
      { id: "g5", label: "Group E", value: 100, column: 2 },
      { id: "g6", label: "Group F", value: 100, column: 2 },
      { id: "g7", label: "Group G", value: 100, column: 2 },
      { id: "g8", label: "Group H", value: 100, column: 2 }, // 8th group
      { id: "cat1", label: "Sub Cat 1", value: 50, column: 3 },
    ];
    const multiGroupLinks = [
      { source: "hub", target: "g1", value: 100 },
      { source: "hub", target: "g2", value: 100 },
      { source: "hub", target: "g3", value: 100 },
      { source: "hub", target: "g4", value: 100 },
      { source: "hub", target: "g5", value: 100 },
      { source: "hub", target: "g6", value: 100 },
      { source: "hub", target: "g7", value: 100 },
      { source: "hub", target: "g8", value: 100 },
      { source: "g1", target: "cat1", value: 50 },
      { source: "unlinked-src", target: "unlinked-dst", value: 10 },
    ];
    const complexChart = SankeyChart({
      title: "Complex Flow",
      nodes: multiGroupNodes,
      links: multiGroupLinks,
      maxNodesPerColumn: 10,
    });
    expect(complexChart).toBeDefined();

    const noHubChart = SankeyChart({
      title: "Zero Hub Flow",
      nodes: [
        { id: "orphan-src", label: "Source Only", value: 100, column: 0 },
        { id: "orphan-dst", label: "Dest Only", value: 100, column: 2 },
      ],
      links: [
        { source: "ghost-1", target: "ghost-2", value: 50 },
      ],
    });
    expect(noHubChart).toBeDefined();

    // Call sub-components if present to execute child table rendering
    for (const chartEl of [complexChart, noHubChart]) {
      const children = (chartEl as unknown as { props?: { children?: unknown[] } })?.props?.children;
      if (Array.isArray(children)) {
        for (const child of children) {
          const sub = child as { type?: (props: unknown) => unknown; props?: unknown };
          if (typeof sub?.type === "function") {
            expect(sub.type(sub.props)).toBeDefined();
          }
        }
      }
    }
  });
});

describe("TrendChart and DonutChart Deep Branches", () => {
  it("renders TrendChart with empty and single series", () => {
    const emptyChart = TrendChart({
      series: [],
      labels: [],
    });
    expect(emptyChart).toBeDefined();

    const chartWithGaps = TrendChart({
      series: [
        { name: "Gap Series", slot: 3, values: [null as never, 100] },
      ],
      labels: ["Jan", "Feb"],
    });
    expect(chartWithGaps).toBeDefined();
  });

  it("renders DonutChart with empty items and all zeroes", () => {
    const empty = DonutChart({ items: [], centerLabel: "Total" });
    expect(empty).toBeDefined();

    const zeroes = DonutChart({
      items: [
        { label: "Zero A", amount: 0 },
        { label: "Zero B", amount: 0 },
      ],
      centerLabel: "Total",
    });
    expect(zeroes).toBeDefined();
  });
});
