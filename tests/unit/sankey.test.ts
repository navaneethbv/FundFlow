import { describe, it, expect } from "vitest";
import { layoutSankey, type SankeyNode, type SankeyLink } from "@/lib/sankey";

describe("lib/sankey.ts", () => {
  it("computes layout node coordinates and path geometry", () => {
    const nodes: SankeyNode[] = [
      { id: "n1", label: "Income", value: 5000, column: 0 },
      { id: "n2", label: "Expenses", value: 3000, column: 1 },
    ];
    const links: SankeyLink[] = [
      { source: "n1", target: "n2", value: 3000 },
    ];

    const result = layoutSankey(nodes, links, 800, 400);

    expect(result.nodes.length).toBe(2);
    expect(result.links.length).toBe(1);

    const n1 = result.nodes.find((n) => n.id === "n1");
    const n2 = result.nodes.find((n) => n.id === "n2");

    expect(n1?.x).toBe(0);
    expect(n2?.x).toBe(776); // 800 - 24
    expect(result.links[0].path).toContain("M 24");
  });
});
