/**
 * Pure Sankey geometry. No imports, no DOM, no data access — the same contract
 * as `lib/chart-utils.ts`, kept in its own module because chart-utils is
 * already dense and none of this is reusable outside a flow diagram.
 *
 * Two invariants the tests pin down, because breaking either produces a
 * picture that looks plausible and is wrong:
 *
 * 1. One value→pixel scale is shared by every column. Scale per column and a
 *    ribbon leaving a node no longer matches the ribbon arriving at the next,
 *    so the diagram stops conserving value while still rendering cleanly.
 * 2. Ribbon thickness is never floored. Node *heights* are floored to
 *    `MIN_SANKEY_NODE_HEIGHT` so a tiny-but-real category stays visible, and
 *    that floor is deliberately not applied to links: doing so would make the
 *    ribbons arriving at a node sum to more than the node itself. Genuinely
 *    tiny slices are handled before layout by `foldSankeyOverflow`.
 */

export interface SankeyNode {
  id: string;
  label: string;
  value: number;
  /** 0-based left-to-right position. Columns need not be contiguous. */
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
  /** Closed cubic ribbon: thickness is encoded in the geometry, not a stroke. */
  path: string;
}

export interface SankeyLayout {
  nodes: PositionedNode[];
  links: PositionedLink[];
}

/** A positive node thinner than this would be invisible, so it gets this. */
export const MIN_SANKEY_NODE_HEIGHT = 3;

/**
 * A node shorter than this cannot carry a legible label beside it, so the
 * chart renders it unlabelled and leaves its identity to the `<title>` and the
 * table twin. Set from the 11px label plus its leading.
 */
export const MIN_LABELLED_NODE_HEIGHT = 16;

/**
 * Vertical room one node needs before its label starts colliding with its
 * neighbour's. Drives `sankeyCanvasHeight`, not the layout itself.
 */
const COMFORTABLE_ROW_HEIGHT = 22;

/**
 * The canvas height a graph needs so its busiest column can breathe.
 *
 * A fixed height silently crushes a tall column: every node collapses toward
 * `MIN_SANKEY_NODE_HEIGHT`, the labels overlap into a smear, and the diagram
 * still renders, so nothing announces the failure. Growing the canvas instead
 * keeps the shared value→pixel scale honest.
 */
export function sankeyCanvasHeight(
  nodes: SankeyNode[],
  nodePadding: number,
  minHeight: number,
): number {
  if (nodes.length === 0) return minHeight;

  const perColumn = new Map<number, number>();
  for (const node of nodes) {
    perColumn.set(node.column, (perColumn.get(node.column) ?? 0) + 1);
  }
  const busiest = Math.max(...perColumn.values());

  return Math.max(
    minHeight,
    busiest * COMFORTABLE_ROW_HEIGHT + (busiest - 1) * nodePadding,
  );
}

/** The label a folded overflow bucket carries. */
export const SANKEY_OTHER_LABEL = "Other";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function layoutSankey(
  nodes: SankeyNode[],
  links: SankeyLink[],
  width: number,
  height: number,
  nodeWidth: number,
  nodePadding: number,
): SankeyLayout {
  if (nodes.length === 0) return { nodes: [], links: [] };

  const columns = [...new Set(nodes.map((node) => node.column))].sort(
    (a, b) => a - b,
  );
  const maxColumn = columns.at(-1)!;

  // A single column has nowhere to spread to; dividing by maxColumn would be a
  // divide-by-zero.
  const columnStride = maxColumn > 0 ? (width - nodeWidth) / maxColumn : 0;

  // One shared scale: the tightest column decides it, so no column overflows.
  let scale = Number.POSITIVE_INFINITY;
  for (const column of columns) {
    const inColumn = nodes.filter((node) => node.column === column);
    const sum = inColumn.reduce(
      (total, node) => total + Math.max(0, node.value),
      0,
    );
    if (sum <= 0) continue;
    const available = Math.max(
      0,
      height - nodePadding * (inColumn.length - 1),
    );
    scale = Math.min(scale, available / sum);
  }
  if (!Number.isFinite(scale)) scale = 0;

  const heightFor = (value: number): number =>
    value > 0 ? Math.max(value * scale, MIN_SANKEY_NODE_HEIGHT) : 0;

  const positioned = new Map<string, PositionedNode>();
  for (const column of columns) {
    const inColumn = nodes.filter((node) => node.column === column);
    const columnHeight =
      inColumn.reduce((total, node) => total + heightFor(node.value), 0) +
      nodePadding * (inColumn.length - 1);
    // Centre the column, but never start above the canvas when a column is
    // taller than the space available.
    let y = Math.max(0, (height - columnHeight) / 2);

    for (const node of inColumn) {
      const nodeHeight = heightFor(node.value);
      positioned.set(node.id, {
        ...node,
        x: round2(column * columnStride),
        y: round2(y),
        height: round2(nodeHeight),
      });
      y += nodeHeight + nodePadding;
    }
  }

  // Ribbons leave a source and arrive at a target stacked in link order, so a
  // node's outgoing ribbons exactly tile its height when the values conserve.
  const sourceOffsets = new Map<string, number>();
  const targetOffsets = new Map<string, number>();
  const positionedLinks: PositionedLink[] = [];

  for (const link of links) {
    if (link.value <= 0) continue;
    const source = positioned.get(link.source);
    const target = positioned.get(link.target);
    if (!source || !target) continue;

    const thickness = link.value * scale;
    const sourceOffset = sourceOffsets.get(link.source) ?? 0;
    const targetOffset = targetOffsets.get(link.target) ?? 0;
    sourceOffsets.set(link.source, sourceOffset + thickness);
    targetOffsets.set(link.target, targetOffset + thickness);

    const sx = source.x + nodeWidth;
    const tx = target.x;
    const mx = (sx + tx) / 2;
    const sy0 = source.y + sourceOffset;
    const sy1 = sy0 + thickness;
    const ty0 = target.y + targetOffset;
    const ty1 = ty0 + thickness;

    positionedLinks.push({
      ...link,
      path: [
        `M${round2(sx)} ${round2(sy0)}`,
        `C${round2(mx)} ${round2(sy0)} ${round2(mx)} ${round2(ty0)} ${round2(tx)} ${round2(ty0)}`,
        `L${round2(tx)} ${round2(ty1)}`,
        `C${round2(mx)} ${round2(ty1)} ${round2(mx)} ${round2(sy1)} ${round2(sx)} ${round2(sy1)}`,
        "Z",
      ].join(" "),
    });
  }

  return {
    // Input order out, so a caller can zip against the list it passed in.
    nodes: nodes.map((node) => positioned.get(node.id)!),
    links: positionedLinks,
  };
}

/**
 * Fold each column down to `maxPerColumn` entries, summing the tail into one
 * "Other" node and re-pointing its links. Same intent as `foldTail` in
 * chart-utils (never generate a 7th categorical hue), but a Sankey also has to
 * rewrite the edges, and a fold can collapse an edge's two ends into the same
 * bucket — those self-references are dropped rather than drawn as a loop.
 *
 * The table twin on the chart keeps the unfolded detail.
 */
export function foldSankeyOverflow(
  nodes: SankeyNode[],
  links: SankeyLink[],
  maxPerColumn: number,
): { nodes: SankeyNode[]; links: SankeyLink[] } {
  // Below 2 there is no room for "Other" plus a real peer, and a column of
  // nothing but "Other" tells the reader nothing.
  const limit = Math.max(2, Math.floor(maxPerColumn));
  const columns = [...new Set(nodes.map((node) => node.column))].sort(
    (a, b) => a - b,
  );

  /** Folded node id → the Other id that replaced it. */
  const remap = new Map<string, string>();
  const otherNodes: SankeyNode[] = [];

  for (const column of columns) {
    const inColumn = nodes.filter((node) => node.column === column);
    if (inColumn.length <= limit) continue;

    const ranked = [...inColumn].sort(
      (a, b) => b.value - a.value || a.label.localeCompare(b.label),
    );
    const folded = ranked.slice(limit - 1);
    const otherId = `other:${column}`;
    for (const node of folded) remap.set(node.id, otherId);

    otherNodes.push({
      id: otherId,
      label: SANKEY_OTHER_LABEL,
      value: round2(folded.reduce((sum, node) => sum + node.value, 0)),
      column,
    });
  }

  if (remap.size === 0) return { nodes, links };

  const keptNodes = nodes.filter((node) => !remap.has(node.id));

  // Merge links that now share endpoints, preserving first-seen order.
  const mergedOrder: string[] = [];
  const merged = new Map<string, SankeyLink>();
  for (const link of links) {
    const source = remap.get(link.source) ?? link.source;
    const target = remap.get(link.target) ?? link.target;
    if (source === target) continue;

    const key = `${source} ${target}`;
    const existing = merged.get(key);
    if (existing) {
      existing.value = round2(existing.value + link.value);
      continue;
    }
    mergedOrder.push(key);
    merged.set(key, { source, target, value: link.value });
  }

  return {
    // Other last within its column: `layoutSankey` stacks a column in array
    // order, so appending puts the bucket at the bottom where it reads as a
    // remainder rather than a peer.
    nodes: [...keptNodes, ...otherNodes],
    links: mergedOrder.map((key) => merged.get(key)!),
  };
}
