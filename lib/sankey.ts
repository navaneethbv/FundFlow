export interface SankeyNode {
  id: string;
  label: string;
  value: number;
  column: number;
}

export interface SankeyLink {
  source: string;
  target: string;
  value: number;
}

export interface PositionedNode extends SankeyNode {
  x: number;
  y: number;
  height: number;
}

export interface PositionedLink extends SankeyLink {
  path: string;
  strokeWidth: number;
}

export function layoutSankey(
  nodes: SankeyNode[],
  links: SankeyLink[],
  width = 800,
  height = 400,
  nodeWidth = 24,
  nodePadding = 12,
): { nodes: PositionedNode[]; links: PositionedLink[] } {
  if (nodes.length === 0) return { nodes: [], links: [] };

  const columns = Array.from(new Set(nodes.map((n) => n.column))).sort((a, b) => a - b);
  const columnCount = columns.length;
  const colSpacing = columnCount > 1 ? (width - nodeWidth) / (columnCount - 1) : 0;

  const nodeMap = new Map<string, PositionedNode>();

  for (const col of columns) {
    const colNodes = nodes.filter((n) => n.column === col);
    const colTotalVal = colNodes.reduce((acc, n) => acc + n.value, 0) || 1;
    const availableHeight = height - (colNodes.length - 1) * nodePadding;

    let yOffset = 0;
    const xPos = col * colSpacing;

    for (const n of colNodes) {
      const nodeH = Math.max(16, (n.value / colTotalVal) * availableHeight);
      const posNode: PositionedNode = {
        ...n,
        x: xPos,
        y: yOffset,
        height: nodeH,
      };
      nodeMap.set(n.id, posNode);
      yOffset += nodeH + nodePadding;
    }
  }

  const positionedLinks: PositionedLink[] = [];

  for (const l of links) {
    const srcNode = nodeMap.get(l.source);
    const tgtNode = nodeMap.get(l.target);
    if (!srcNode || !tgtNode) continue;

    const strokeWidth = Math.max(2, (l.value / (srcNode.value || 1)) * srcNode.height);
    const x0 = srcNode.x + nodeWidth;
    const y0 = srcNode.y + srcNode.height / 2;
    const x1 = tgtNode.x;
    const y1 = tgtNode.y + tgtNode.height / 2;
    const xi = (x0 + x1) / 2;

    const path = `M ${x0} ${y0} C ${xi} ${y0}, ${xi} ${y1}, ${x1} ${y1}`;

    positionedLinks.push({
      ...l,
      path,
      strokeWidth,
    });
  }

  return {
    nodes: Array.from(nodeMap.values()),
    links: positionedLinks,
  };
}
