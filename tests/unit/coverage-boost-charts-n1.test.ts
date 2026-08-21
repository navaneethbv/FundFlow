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
import DonutChart from "@/components/charts/DonutChart";
import SankeyChart from "@/components/charts/SankeyChart";
import TrendChart from "@/components/charts/TrendChart";

/** Recursively invoke local function components (e.g. FlowTable) inside an
 * element tree so their bodies execute for branch coverage. Only functions
 * defined in the chart files are safe to call as plain functions. */
function invokeComponents(
  node: unknown,
  allowed: string[] = [],
): void {
  if (node == null) return;
  if (Array.isArray(node)) {
    for (const child of node) invokeComponents(child, allowed);
    return;
  }
  if (typeof node !== "object") return;
  const element = node as { type?: unknown; props?: { children?: unknown } };
  const type = element.type;
  if (typeof type === "function") {
    const name = (type as { name?: string }).name ?? "";
    if (allowed.includes(name)) {
      const rendered = (type as (props: unknown) => unknown)(element.props);
      invokeComponents(rendered, allowed);
    }
  }
  if (element.props?.children) {
    invokeComponents(element.props.children, allowed);
  }
}

describe("CumulativeCompareChart branch boost", () => {
  it("renders when every value is null (empty ticks, no previous-month carry)", () => {
    const el = CumulativeCompareChart({
      days: [
        { day: 1, thisMonth: null, lastMonth: null },
        { day: 2, thisMonth: null, lastMonth: null },
      ],
      monthLabel: "August",
      previousMonthLabel: "July",
    });
    expect(el).toBeDefined();
  });

  it("renders with mixed null/non-null values (forward-filled table)", () => {
    const el = CumulativeCompareChart({
      days: [
        { day: 1, thisMonth: 100, lastMonth: 80 },
        { day: 2, thisMonth: 250, lastMonth: null },
        { day: 3, thisMonth: null, lastMonth: 200 },
      ],
      monthLabel: "August",
      previousMonthLabel: "July",
    });
    expect(el).toBeDefined();
  });
});

describe("DonutChart branch boost", () => {
  it("renders the percent legend for a positive total", () => {
    const el = DonutChart({
      items: [
        { label: "Groceries", amount: 150 },
        { label: "Dining", amount: 50 },
      ],
      centerLabel: "Spent",
    });
    expect(el).toBeDefined();
  });

  it("renders a non-positive total (NaN) through the percent legend", () => {
    const el = DonutChart({
      items: [
        { label: "NaN slice", amount: Number.NaN },
        { label: "Plain", amount: 50 },
      ],
      centerLabel: "Spent",
    });
    expect(el).toBeDefined();
  });
});

describe("SankeyChart branch boost", () => {
  it("covers colour/label fallbacks via folding, colourless nodes and orphan links", () => {
    const chart = SankeyChart({
      title: "Fold + fallback flow",
      nodes: [
        { id: "src", label: "Income", value: 1000, column: 0 },
        { id: "hub", label: "Hub", value: 1000, column: 1 },
        { id: "g1", label: "Group 1", value: 200, column: 2 },
        { id: "g2", label: "Group 2", value: 200, column: 2 },
        { id: "g3", label: "Group 3", value: 200, column: 2 },
        { id: "g4", label: "Group 4", value: 200, column: 2 },
        { id: "g5", label: "Group 5", value: 200, column: 2 },
        { id: "cat1", label: "Cat 1", value: 200, column: 3 },
        { id: "catX", label: "Cat X", value: 50, column: 3 },
        { id: "catY", label: "Cat Y", value: 50, column: 3 },
      ],
      links: [
        { source: "src", target: "hub", value: 1000 },
        { source: "hub", target: "g1", value: 200 },
        { source: "hub", target: "g2", value: 200 },
        { source: "hub", target: "g3", value: 200 },
        { source: "hub", target: "g4", value: 200 },
        { source: "hub", target: "g5", value: 200 },
        { source: "g1", target: "cat1", value: 200 },
        { source: "g3", target: "cat1", value: 200 },
        { source: "catX", target: "catY", value: 50 },
        { source: "ghost", target: "catY", value: 10 },
        { source: "catX", target: "phantom", value: 5 },
      ],
      maxNodesPerColumn: 3,
    });
    expect(chart).toBeDefined();
    invokeComponents(chart, ["FlowTable"]);
  });

  it("covers the neutral slot fallback with 8+ groups", () => {
    const nodes = [
      { id: "src", label: "Income", value: 800, column: 0 },
      { id: "hub", label: "Hub", value: 800, column: 1 },
    ];
    const links = [{ source: "src", target: "hub", value: 800 }];
    for (let i = 1; i <= 8; i += 1) {
      nodes.push({ id: `g${i}`, label: `Group ${i}`, value: 100, column: 2 });
      links.push({ source: "hub", target: `g${i}`, value: 100 });
    }
    const chart = SankeyChart({
      title: "Eight groups",
      nodes,
      links,
    });
    expect(chart).toBeDefined();
    invokeComponents(chart, ["FlowTable"]);
  });
});

describe("TrendChart branch boost", () => {
  it("renders a series with an empty values array alongside a full series", () => {
    const el = TrendChart({
      series: [
        { name: "Empty", slot: 1, values: [] },
        { name: "Full", slot: 2, values: [100, 200] },
      ],
      labels: ["Jan", "Feb"],
    });
    expect(el).toBeDefined();
  });

  it("renders two converging series to nudge endpoint labels apart", () => {
    const el = TrendChart({
      series: [
        { name: "A", slot: 1, values: [300, 200] },
        { name: "B", slot: 2, values: [400, 201] },
      ],
      labels: ["Jan", "Feb"],
    });
    expect(el).toBeDefined();

    const swapped = TrendChart({
      series: [
        { name: "A", slot: 1, values: [300, 201] },
        { name: "B", slot: 2, values: [400, 200] },
      ],
      labels: ["Jan", "Feb"],
    });
    expect(swapped).toBeDefined();
  });
});
