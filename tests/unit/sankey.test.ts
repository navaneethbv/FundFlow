import { describe, it, expect } from "vitest";
import {
  foldSankeyOverflow,
  layoutSankey,
  sankeyCanvasHeight,
  MIN_LABELLED_NODE_HEIGHT,
  MIN_SANKEY_NODE_HEIGHT,
  type SankeyLink,
  type SankeyNode,
} from "@/lib/sankey";

/**
 * Pure geometry, so these tests are the whole safety net for the Sankey: a NaN
 * coordinate or a silently non-conserving ribbon would otherwise only show up
 * as a visually wrong picture that no one can measure.
 */

const WIDTH = 600;
const HEIGHT = 300;
const NODE_WIDTH = 12;
const NODE_PADDING = 8;

function layout(nodes: SankeyNode[], links: SankeyLink[]) {
  return layoutSankey(nodes, links, WIDTH, HEIGHT, NODE_WIDTH, NODE_PADDING);
}

/** Income -> hub -> two expense groups; every value conserves. */
function simpleGraph() {
  const nodes: SankeyNode[] = [
    { id: "salary", label: "Salary", value: 1000, column: 0 },
    { id: "hub", label: "Income", value: 1000, column: 1 },
    { id: "rent", label: "Rent", value: 600, column: 2 },
    { id: "food", label: "Food", value: 400, column: 2 },
  ];
  const links: SankeyLink[] = [
    { source: "salary", target: "hub", value: 1000 },
    { source: "hub", target: "rent", value: 600 },
    { source: "hub", target: "food", value: 400 },
  ];
  return { nodes, links };
}

describe("layoutSankey column positions", () => {
  it("puts the first column at the left edge and the last flush to the right", () => {
    const { nodes, links } = simpleGraph();
    const result = layout(nodes, links);

    const byId = new Map(result.nodes.map((node) => [node.id, node]));
    expect(byId.get("salary")!.x).toBe(0);
    expect(byId.get("hub")!.x).toBeCloseTo((WIDTH - NODE_WIDTH) / 2);
    expect(byId.get("rent")!.x).toBeCloseTo(WIDTH - NODE_WIDTH);
    expect(byId.get("food")!.x).toBeCloseTo(WIDTH - NODE_WIDTH);
  });

  it("keeps a single-column graph at x=0 instead of dividing by zero", () => {
    const result = layout(
      [{ id: "only", label: "Only", value: 10, column: 0 }],
      [],
    );
    expect(result.nodes[0]!.x).toBe(0);
    expect(Number.isFinite(result.nodes[0]!.height)).toBe(true);
  });

  it("returns nodes in input order so callers can zip against their own list", () => {
    const { nodes, links } = simpleGraph();
    const result = layout(nodes, links);
    expect(result.nodes.map((node) => node.id)).toEqual([
      "salary",
      "hub",
      "rent",
      "food",
    ]);
  });
});

describe("layoutSankey heights", () => {
  it("scales height proportionally to value within a column", () => {
    const { nodes, links } = simpleGraph();
    const result = layout(nodes, links);
    const byId = new Map(result.nodes.map((node) => [node.id, node]));

    // 600 : 400 is 3 : 2 regardless of the pixel scale chosen.
    expect(byId.get("rent")!.height / byId.get("food")!.height).toBeCloseTo(1.5);
  });

  it("uses one scale across columns so a node equals the sum of its ribbons", () => {
    const { nodes, links } = simpleGraph();
    const result = layout(nodes, links);
    const byId = new Map(result.nodes.map((node) => [node.id, node]));

    // The hub carries the same 1000 as salary, so both must be equally tall.
    expect(byId.get("hub")!.height).toBeCloseTo(byId.get("salary")!.height);
    expect(byId.get("rent")!.height + byId.get("food")!.height).toBeCloseTo(
      byId.get("hub")!.height,
    );
  });

  it("floors a tiny positive node to a visible height", () => {
    const nodes: SankeyNode[] = [
      { id: "big", label: "Big", value: 100_000, column: 0 },
      { id: "crumb", label: "Crumb", value: 0.01, column: 0 },
    ];
    const result = layout(nodes, []);
    expect(result.nodes[1]!.height).toBe(MIN_SANKEY_NODE_HEIGHT);
  });

  it("gives a zero-value node no height rather than faking one", () => {
    const nodes: SankeyNode[] = [
      { id: "real", label: "Real", value: 100, column: 0 },
      { id: "empty", label: "Empty", value: 0, column: 0 },
    ];
    const result = layout(nodes, []);
    expect(result.nodes[1]!.height).toBe(0);
    expect(result.nodes[1]!.y).not.toBeNaN();
  });

  it("never exceeds the available height once padding is accounted for", () => {
    const nodes: SankeyNode[] = Array.from({ length: 6 }, (_, index) => ({
      id: `n${index}`,
      label: `N${index}`,
      value: 100,
      column: 0,
    }));
    const result = layout(nodes, []);
    const used =
      result.nodes.reduce((sum, node) => sum + node.height, 0) +
      NODE_PADDING * (nodes.length - 1);
    expect(used).toBeLessThanOrEqual(HEIGHT + 0.01);
    expect(result.nodes.at(-1)!.y + result.nodes.at(-1)!.height).toBeLessThanOrEqual(
      HEIGHT + 0.01,
    );
  });
});

describe("layoutSankey weighted column positions", () => {
  it("places each column at its given fraction of the usable width", () => {
    const nodes: SankeyNode[] = [
      { id: "a", label: "A", value: 100, column: 0 },
      { id: "b", label: "B", value: 100, column: 1 },
      { id: "c", label: "C", value: 100, column: 2 },
      { id: "d", label: "D", value: 100, column: 3 },
    ];
    const links: SankeyLink[] = [
      { source: "a", target: "b", value: 100 },
      { source: "b", target: "c", value: 100 },
      { source: "c", target: "d", value: 100 },
    ];
    const result = layoutSankey(
      nodes,
      links,
      WIDTH,
      HEIGHT,
      NODE_WIDTH,
      NODE_PADDING,
      [0, 0.34, 0.72, 1],
    );
    const byId = new Map(result.nodes.map((node) => [node.id, node]));
    const usable = WIDTH - NODE_WIDTH;

    expect(byId.get("a")!.x).toBe(0);
    expect(byId.get("b")!.x).toBeCloseTo(0.34 * usable);
    expect(byId.get("c")!.x).toBeCloseTo(0.72 * usable);
    expect(byId.get("d")!.x).toBeCloseTo(usable);
  });

  it("keeps the original even division when no positions are given", () => {
    const { nodes, links } = simpleGraph();
    // No seventh argument: this must be identical to the pre-existing
    // behaviour, since every caller that predates weighted columns omits it.
    const result = layout(nodes, links);
    const byId = new Map(result.nodes.map((node) => [node.id, node]));
    expect(byId.get("hub")!.x).toBeCloseTo((WIDTH - NODE_WIDTH) / 2);
  });
});

describe("layoutSankey vertical stacking", () => {
  it("stacks a column top to bottom with the padding between neighbours", () => {
    const { nodes, links } = simpleGraph();
    const result = layout(nodes, links);
    const byId = new Map(result.nodes.map((node) => [node.id, node]));

    const rent = byId.get("rent")!;
    const food = byId.get("food")!;
    expect(food.y).toBeCloseTo(rent.y + rent.height + NODE_PADDING);
  });

  it("keeps every node inside the canvas", () => {
    const { nodes, links } = simpleGraph();
    const result = layout(nodes, links);
    for (const node of result.nodes) {
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.y + node.height).toBeLessThanOrEqual(HEIGHT + 0.01);
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.x + NODE_WIDTH).toBeLessThanOrEqual(WIDTH + 0.01);
    }
  });
});

describe("layoutSankey link geometry", () => {
  it("emits a closed cubic ribbon with no NaN coordinates", () => {
    const { nodes, links } = simpleGraph();
    const result = layout(nodes, links);

    expect(result.links).toHaveLength(3);
    for (const link of result.links) {
      expect(link.path).not.toContain("NaN");
      expect(link.path.startsWith("M")).toBe(true);
      expect(link.path).toContain("C");
      expect(link.path.endsWith("Z")).toBe(true);
    }
  });

  it("starts at the source's right edge and ends at the target's left edge", () => {
    const nodes: SankeyNode[] = [
      { id: "a", label: "A", value: 100, column: 0 },
      { id: "b", label: "B", value: 100, column: 1 },
    ];
    const result = layoutSankey(
      nodes,
      [{ source: "a", target: "b", value: 100 }],
      WIDTH,
      HEIGHT,
      NODE_WIDTH,
      NODE_PADDING,
    );
    const [a, b] = result.nodes;
    const path = result.links[0]!.path;

    // First coordinate pair is the source's trailing edge.
    const firstX = Number(path.slice(1).split(" ")[0]);
    expect(firstX).toBeCloseTo(a!.x + NODE_WIDTH, 1);
    expect(path).toContain(String(Math.round((b!.x + Number.EPSILON) * 100) / 100));
  });

  it("stacks multiple ribbons leaving one node without overlapping", () => {
    const { nodes, links } = simpleGraph();
    const result = layout(nodes, links);
    const hub = result.nodes.find((node) => node.id === "hub")!;

    const leaving = result.links.filter((link) => link.source === "hub");
    expect(leaving).toHaveLength(2);

    // Ribbon start offsets are derived from cumulative value, so the second
    // ribbon must begin exactly where the first one ended.
    const startY = leaving.map(
      (link) => Number(link.path.slice(1).split(" ")[1]),
    );
    expect(startY[0]).toBeCloseTo(hub.y, 1);
    const firstThickness =
      (600 / 1000) * hub.height;
    expect(startY[1]).toBeCloseTo(hub.y + firstThickness, 1);
  });

  it("drops links whose endpoints are not in the node list", () => {
    const { nodes } = simpleGraph();
    const result = layout(nodes, [
      { source: "salary", target: "ghost", value: 10 },
      { source: "ghost", target: "hub", value: 10 },
      { source: "salary", target: "hub", value: 1000 },
    ]);
    expect(result.links).toHaveLength(1);
    expect(result.links[0]!.target).toBe("hub");
  });

  it("drops non-positive link values instead of drawing backwards ribbons", () => {
    const { nodes } = simpleGraph();
    const result = layout(nodes, [
      { source: "salary", target: "hub", value: 0 },
      { source: "hub", target: "rent", value: -50 },
    ]);
    expect(result.links).toEqual([]);
  });
});

describe("layoutSankey degenerate input", () => {
  it("returns empty output for empty input", () => {
    expect(layout([], [])).toEqual({ nodes: [], links: [] });
  });

  it("does not produce NaN when every value is zero", () => {
    const nodes: SankeyNode[] = [
      { id: "a", label: "A", value: 0, column: 0 },
      { id: "b", label: "B", value: 0, column: 1 },
    ];
    const result = layoutSankey(
      nodes,
      [{ source: "a", target: "b", value: 0 }],
      WIDTH,
      HEIGHT,
      NODE_WIDTH,
      NODE_PADDING,
    );
    for (const node of result.nodes) {
      expect(node.y).not.toBeNaN();
      expect(node.height).not.toBeNaN();
      expect(node.x).not.toBeNaN();
    }
    expect(result.links).toEqual([]);
  });

  it("survives a column whose padding alone exceeds the canvas height", () => {
    const nodes: SankeyNode[] = Array.from({ length: 100 }, (_, index) => ({
      id: `n${index}`,
      label: `N${index}`,
      value: 10,
      column: 0,
    }));
    const result = layoutSankey(nodes, [], WIDTH, 50, NODE_WIDTH, NODE_PADDING);
    for (const node of result.nodes) {
      expect(node.height).not.toBeNaN();
      expect(node.height).toBeGreaterThanOrEqual(0);
      expect(node.y).not.toBeNaN();
    }
  });
});

describe("foldSankeyOverflow", () => {
  const nodes: SankeyNode[] = [
    { id: "hub", label: "Income", value: 100, column: 0 },
    { id: "a", label: "A", value: 50, column: 1 },
    { id: "b", label: "B", value: 30, column: 1 },
    { id: "c", label: "C", value: 12, column: 1 },
    { id: "d", label: "D", value: 8, column: 1 },
  ];
  const links: SankeyLink[] = [
    { source: "hub", target: "a", value: 50 },
    { source: "hub", target: "b", value: 30 },
    { source: "hub", target: "c", value: 12 },
    { source: "hub", target: "d", value: 8 },
  ];

  it("leaves a column alone when it already fits", () => {
    const result = foldSankeyOverflow(nodes, links, 10);
    expect(result.nodes).toEqual(nodes);
    expect(result.links).toEqual(links);
  });

  it("folds the smallest nodes into a single Other node", () => {
    const result = foldSankeyOverflow(nodes, links, 3);
    const column1 = result.nodes.filter((node) => node.column === 1);

    expect(column1.map((node) => node.label)).toEqual(["A", "B", "Other"]);
    expect(column1.at(-1)!.value).toBe(20);
  });

  it("merges the folded links so total flow is conserved", () => {
    const result = foldSankeyOverflow(nodes, links, 3);
    const total = result.links.reduce((sum, link) => sum + link.value, 0);
    expect(total).toBe(100);

    const toOther = result.links.filter((link) => link.target.startsWith("other"));
    expect(toOther).toHaveLength(1);
    expect(toOther[0]!.value).toBe(20);
  });

  it("keeps the surviving nodes in their original order with Other last", () => {
    const result = foldSankeyOverflow(nodes, links, 3);
    expect(result.nodes.map((node) => node.id).slice(0, 3)).toEqual([
      "hub",
      "a",
      "b",
    ]);
    expect(result.nodes.at(-1)!.label).toBe("Other");
  });

  it("folds independently per column", () => {
    const twoColumns: SankeyNode[] = [
      { id: "i1", label: "I1", value: 60, column: 0 },
      { id: "i2", label: "I2", value: 30, column: 0 },
      { id: "i3", label: "I3", value: 10, column: 0 },
      { id: "e1", label: "E1", value: 70, column: 1 },
      { id: "e2", label: "E2", value: 20, column: 1 },
      { id: "e3", label: "E3", value: 10, column: 1 },
    ];
    const result = foldSankeyOverflow(twoColumns, [], 2);
    expect(
      result.nodes.filter((node) => node.column === 0).map((n) => n.label),
    ).toEqual(["I1", "Other"]);
    expect(
      result.nodes.filter((node) => node.column === 1).map((n) => n.label),
    ).toEqual(["E1", "Other"]);
  });

  it("drops a link that folds into a self-reference", () => {
    const chain: SankeyNode[] = [
      { id: "x", label: "X", value: 5, column: 0 },
      { id: "y", label: "Y", value: 5, column: 0 },
      { id: "z", label: "Z", value: 5, column: 0 },
    ];
    const result = foldSankeyOverflow(
      chain,
      [{ source: "y", target: "z", value: 5 }],
      2,
    );
    expect(result.links).toEqual([]);
  });

  it("treats maxPerColumn below 2 as 2 so Other always has a peer", () => {
    const result = foldSankeyOverflow(nodes, links, 1);
    const column1 = result.nodes.filter((node) => node.column === 1);
    expect(column1.map((node) => node.label)).toEqual(["A", "Other"]);
    expect(column1.at(-1)!.value).toBe(50);
  });

  it("produces a layout that still conserves after folding", () => {
    const folded = foldSankeyOverflow(nodes, links, 3);
    const result = layout(folded.nodes, folded.links);
    const hub = result.nodes.find((node) => node.id === "hub")!;
    const targets = result.nodes.filter((node) => node.column === 1);
    const targetHeight = targets.reduce((sum, node) => sum + node.height, 0);
    expect(targetHeight).toBeCloseTo(hub.height, 1);
  });
});

describe("sankeyCanvasHeight", () => {
  function column(count: number, col: number): SankeyNode[] {
    return Array.from({ length: count }, (_, i) => ({
      id: `${col}-${i}`,
      label: `N${i}`,
      value: 10,
      column: col,
    }));
  }

  it("returns the floor when every column is small", () => {
    expect(sankeyCanvasHeight(column(3, 0), 10, 420)).toBe(420);
  });

  it("returns the floor for an empty graph", () => {
    expect(sankeyCanvasHeight([], 10, 420)).toBe(420);
  });

  it("grows past the floor once a column would be crushed", () => {
    // 25 nodes cannot breathe in 420px: at the old fixed height every one of
    // them collapses toward MIN_SANKEY_NODE_HEIGHT and the labels smear.
    const tall = sankeyCanvasHeight(column(25, 0), 10, 420);
    expect(tall).toBeGreaterThan(420);
  });

  it("sizes to the busiest column, not the node total", () => {
    const spread = [...column(4, 0), ...column(4, 1), ...column(4, 2)];
    const single = column(4, 0);
    expect(sankeyCanvasHeight(spread, 10, 100)).toBe(
      sankeyCanvasHeight(single, 10, 100),
    );
  });

  it("gives every node room for a label at the height it returns", () => {
    const count = 30;
    const height = sankeyCanvasHeight(column(count, 0), NODE_PADDING, 420);
    const result = layoutSankey(
      column(count, 0),
      [],
      WIDTH,
      height,
      NODE_WIDTH,
      NODE_PADDING,
    );
    for (const node of result.nodes) {
      expect(node.height).toBeGreaterThanOrEqual(MIN_LABELLED_NODE_HEIGHT);
    }
  });
});
