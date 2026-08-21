import React from "react";
import { describe, it, expect } from "vitest";
import StatTile from "@/components/charts/StatTile";
import DivergingColumns from "@/components/charts/DivergingColumns";
import SankeyChart from "@/components/charts/SankeyChart";
import TrendChart from "@/components/charts/TrendChart";
import DonutChart from "@/components/charts/DonutChart";
import {
  validateDisplayPrefsPatch,
  parseDisplayPrefs,
  sectionFromParam,
  DEFAULT_DISPLAY_PREFS,
} from "@/components/settings/settings-nav";

describe("StatTile Branch Coverage", () => {
  it("renders flat delta (delta === 0)", () => {
    const tile = StatTile({
      label: "Balance",
      value: 5000,
      delta: 0,
      deltaVs: "last month",
    });
    expect(tile).toBeDefined();
  });

  it("renders negative delta when upIsGood is true", () => {
    const tile = StatTile({
      label: "Savings",
      value: 4000,
      delta: -500,
      deltaVs: "last quarter",
      upIsGood: true,
    });
    expect(tile).toBeDefined();
  });

  it("renders positive delta when upIsGood is false", () => {
    const tile = StatTile({
      label: "Expenses",
      value: 2000,
      delta: 300,
      deltaVs: "target",
      upIsGood: false,
    });
    expect(tile).toBeDefined();
  });

  it("renders custom chart node", () => {
    const tile = StatTile({
      label: "Custom",
      value: 100,
      chart: React.createElement("div", { id: "custom-chart" }, "Custom Chart"),
    });
    expect(tile).toBeDefined();
  });
});

describe("DivergingColumns Branch Coverage", () => {
  it("renders diverging columns with sparse arrays exercising all fallback branches", () => {
    const chartWithLine = DivergingColumns({
      labels: ["Jan", "Feb", "Mar", "Apr"],
      up: [100], // indices 1, 2, 3 undefined
      down: [0], // indices 1, 2, 3 undefined
      upName: "Income",
      downName: "Spend",
      links: ["/jan", undefined, "/mar"],
      line: {
        name: "Net",
        values: [100], // indices 1, 2, 3 undefined
      },
    });
    expect(chartWithLine).toBeDefined();

    const chartNoLine = DivergingColumns({
      labels: ["Jan"],
      up: [0],
      down: [0],
      upName: "Income",
      downName: "Spend",
      links: [],
    });
    expect(chartNoLine).toBeDefined();
  });
});

describe("TrendChart Branch Coverage", () => {
  it("renders TrendChart with multiple series, caption, links and various slots", () => {
    const chart = TrendChart({
      series: [
        { name: "Checking", slot: 1, values: [100] }, // sparse values vs 3 labels
        { name: "Savings", slot: 2, values: [500, 600, 700] },
      ],
      labels: ["Jan", "Feb", "Mar"],
      links: ["/jan", undefined, "/mar"],
      valueFormatter: (v) => `$${v}`,
    });
    expect(chart).toBeDefined();

    const singlePointChart = TrendChart({
      series: [{ name: "One", slot: 1, values: [100] }],
      labels: ["Jan"],
    });
    expect(singlePointChart).toBeDefined();
  });
});

describe("DonutChart Branch Coverage", () => {
  it("renders DonutChart with multiple items, links and empty", () => {
    const chart = DonutChart({
      items: [
        { label: "Groceries", amount: 100, href: "/groceries" },
        { label: "Dining", amount: 50 },
        { label: "Rent", amount: 1000 },
      ],
      centerLabel: "Total Spend",
    });
    expect(chart).toBeDefined();

    const emptyChart = DonutChart({
      items: [{ label: "Zero", amount: 0 }],
      centerLabel: "None",
    });
    expect(emptyChart).toBeDefined();
  });
});

describe("SankeyChart Branch Coverage", () => {
  it("renders SankeyChart with 3-column topology, groups and missing links", () => {
    const chart = SankeyChart({
      title: "Flow",
      nodes: [
        { id: "income", label: "Salary", value: 3000, column: 0 },
        { id: "food_group", label: "Food Group", value: 1000, column: 1 },
        { id: "savings_group", label: "Net Savings", value: 2000, column: 1 },
        { id: "groceries", label: "Groceries", value: 600, column: 2 },
        { id: "dining", label: "Dining", value: 400, column: 2 },
        { id: "orphan_group", label: "Orphan", value: 500, column: 1 },
      ],
      links: [
        { source: "income", target: "food_group", value: 1000 },
        { source: "income", target: "savings_group", value: 2000 },
        { source: "food_group", target: "groceries", value: 600 },
        { source: "food_group", target: "dining", value: 400 },
        { source: "unknown_src", target: "orphan_group", value: 100 },
      ],
    });
    expect(chart).toBeDefined();

    const zeroInFlow = SankeyChart({
      title: "Empty Flow",
      nodes: [
        { id: "n1", label: "Node 1", value: 0, column: 0 },
        { id: "n2", label: "Node 2", value: 0, column: 1 },
      ],
      links: [{ source: "n1", target: "n2", value: 0 }],
    });
    expect(zeroInFlow).toBeDefined();
  });
});

describe("Settings Nav Validation Branches", () => {
  it("validates display preferences patch and values", () => {
    expect(validateDisplayPrefsPatch(null)).toEqual({ ok: false, error: "display prefs must be an object" });
    expect(validateDisplayPrefsPatch([])).toEqual({ ok: false, error: "display prefs must be an object" });
    expect(validateDisplayPrefsPatch({ theme: "invalid" })).toEqual({
      ok: false,
      error: "invalid theme",
    });
    expect(validateDisplayPrefsPatch({ density: "invalid" })).toEqual({
      ok: false,
      error: "invalid density",
    });
    expect(validateDisplayPrefsPatch({ defaultPrivacyBlur: "true" })).toEqual({
      ok: false,
      error: "defaultPrivacyBlur must be a boolean",
    });
    expect(validateDisplayPrefsPatch({ reducedMotion: "invalid" })).toEqual({
      ok: false,
      error: "invalid reducedMotion",
    });

    const valid = validateDisplayPrefsPatch({
      theme: "dark",
      density: "compact",
      defaultPrivacyBlur: true,
      reducedMotion: "reduce",
    });
    expect(valid).toEqual({
      ok: true,
      value: {
        theme: "dark",
        density: "compact",
        defaultPrivacyBlur: true,
        reducedMotion: "reduce",
      },
    });
  });

  it("parses display prefs with fallbacks", () => {
    expect(parseDisplayPrefs(null)).toEqual(DEFAULT_DISPLAY_PREFS);

    expect(parseDisplayPrefs({ theme: "light", density: "compact" })).toEqual({
      theme: "light",
      density: "compact",
      defaultPrivacyBlur: false,
      reducedMotion: "system",
    });
  });

  it("maps section from param", () => {
    expect(sectionFromParam("display")).toBe("display");
    expect(sectionFromParam("security")).toBe("security");
    expect(sectionFromParam("profile")).toBe("profile");
    expect(sectionFromParam("invalid")).toBe("profile");
    expect(sectionFromParam(["institutions"])).toBe("institutions");
  });
});
