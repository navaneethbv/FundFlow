import { formatCurrency } from "@/lib/format";
import { emojiForLabel } from "@/lib/category-emoji";
import {
  foldSankeyOverflow,
  layoutSankey,
  sankeyCanvasHeight,
  MIN_LABELLED_NODE_HEIGHT,
  type SankeyLink,
  type SankeyNode,
} from "@/lib/sankey";

/**
 * Server-rendered Sankey. No client JS, no chart library — the same contract as
 * every other component in `components/charts/`, which is what keeps the
 * nonce-based CSP in `proxy.ts` free of exceptions.
 *
 * Colour encodes the **spending group**, and a category inherits its parent
 * group's hue, so a column reads as related families rather than as a stack of
 * unrelated bars. This reverses the earlier rule (colour by column).
 *
 * The palette is the seven validated `--viz-*` slots. A group whose identity
 * is in `KNOWN_GROUP_SLOTS` always takes that slot (Shopping is always
 * magenta, whatever else is in the diagram); an unrecognised group fills
 * whichever slots the known ones left, by size, and anything past the
 * seventh takes a neutral rather than an eighth generated hue. Seven is a
 * measured ceiling, not a style choice: an eight-hue set falls to ΔE 2.4
 * under protanopia and a twelve-hue set to 0.4, against a floor of 6.
 * Identity therefore never rests on colour alone — every node is labelled and
 * the table twin repeats every figure, which is also what makes the
 * palette's 6–8 CVD floor band legal here.
 *
 * Below 768px the SVG is replaced by the table rather than squeezed: a Sankey
 * at phone width is unreadable, and `hidden`/`md:hidden` means exactly one of
 * the two is in the accessibility tree at any viewport.
 */

/**
 * Wide on purpose. Labels sit in the gaps *between* columns (sources read
 * rightward, groups and categories leftward), so the gaps — not the outer
 * edges — are what has to fit text. Narrowing this crowds the labels back
 * into each other.
 */
const VIEW_WIDTH = 1280;
/** Floor, not the height: the canvas grows with the busiest column. */
const MIN_VIEW_HEIGHT = 520;
/** Thin and sharp-cornered, matching the reference diagram's bars. */
const NODE_WIDTH = 10;
const NODE_PADDING = 14;
const MARGIN_X = 24;
/**
 * Small breathing room above the topmost node. The hub label used to need
 * headroom above its own bar; it now sits beside the bar like every other
 * node (see `isHub` below), so this is no longer load-bearing height.
 */
const MARGIN_TOP = 12;
const LABEL_GAP = 8;
/** Vertical distance between a label's two stacked lines. */
const LABEL_LINE_GAP = 13;
/** Names are short Title Case now, so this rarely bites. */
const MAX_LABEL_CHARS = 22;
/**
 * Per column, so no column outgrows the canvas. Raised from the original 20:
 * a real cash-flow month has on the order of 30-40 leaf categories, and the
 * reference diagram labels every one of them rather than folding into
 * "Other" this early. `foldSankeyOverflow` stays as the backstop for
 * pathological data; the table twin always carries the unfolded detail.
 */
const DEFAULT_MAX_NODES_PER_COLUMN = 60;
const SOURCE_COLUMN = 0;
const HUB_COLUMN = 1;
const GROUP_COLUMN = 2;
/** Column 3 (categories) has no named constant — nothing branches on it by
 * number; `labelsLeft` below covers it via `column >= GROUP_COLUMN`. */

/**
 * Column x-positions as a fraction of the diagram's usable width. Uneven on
 * purpose: the hub sits in a narrow lane, but the gap right of it carries
 * both the hub's own label and the incoming edges of the group labels to its
 * right, so it gets roughly twice the room of the other two gaps. Sampled
 * from the reference diagram, not derived from anything else in this file.
 */
const COLUMN_X_FRACTIONS = [0, 0.34, 0.72, 1] as const;

/** Terminal nodes that mean surplus and shortfall, not a spending group. */
const NET_INCOME_ID = "grp:__net__";
const UNFUNDED_ID = "src:__unfunded__";

const GROUP_COLOURS = [
  "var(--sankey-group-1)",
  "var(--sankey-group-2)",
  "var(--sankey-group-3)",
  "var(--sankey-group-4)",
  "var(--sankey-group-5)",
  "var(--sankey-group-6)",
  "var(--sankey-group-7)",
] as const;

/**
 * Groups past the palette, and the folded tail, share this. It is a text-ink
 * grey rather than the lighter `--viz-axis`: at the theme ribbon opacity an
 * axis-weight grey washes out to nearly the surface colour, which reads as
 * "no spending here" instead of "no hue left to give this".
 */
const NEUTRAL = "var(--viz-ink-2)";

/**
 * Fixes a group's hue to its identity rather than its rank by size, so
 * "Shopping" is always magenta whether it is this month's largest group or
 * its fifth. Matched case-insensitively against the display label, the same
 * as `emojiForLabel`. A group not listed here — including any group name this
 * mapping has never seen — falls back to size-order assignment among
 * whatever slots the known groups did not already take (see `buildColours`).
 */
const KNOWN_GROUP_SLOTS: Readonly<Record<string, number>> = {
  shopping: 1,
  financial: 2,
  "travel & lifestyle": 3,
  "food & dining": 4,
  housing: 5,
  "health & wellness": 6,
  "auto & transport": 7,
};

/**
 * Node ids carry `:` and `::` separators, which cannot go straight into a
 * `url(#…)` reference, so gradients are keyed by position instead.
 */
function gradientId(index: number): string {
  return `sankey-flow-${index}`;
}

function truncate(value: string): string {
  return value.length > MAX_LABEL_CHARS
    ? `${value.slice(0, MAX_LABEL_CHARS - 1)}…`
    : value;
}

/**
 * Node id → fill. Built once so the ribbons and the rectangles cannot disagree
 * about what colour a node is.
 *
 * A category has no colour of its own: it looks up the group that feeds it, so
 * "Rent" is always the same hue as "Rent And Utilities" whatever else changes.
 */
function buildColours(
  nodes: SankeyNode[],
  links: SankeyLink[],
): Map<string, string> {
  const colours = new Map<string, string>();

  for (const node of nodes) {
    if (node.column === SOURCE_COLUMN) {
      colours.set(node.id, "var(--sankey-source)");
    }
    if (node.column === HUB_COLUMN) {
      colours.set(node.id, "var(--sankey-hub)");
    }
  }
  // Surplus and shortfall are outcomes, not categories, so they take the
  // diverging poles the rest of the app already uses for the same meaning.
  colours.set(NET_INCOME_ID, "var(--sankey-net)");
  colours.set(UNFUNDED_ID, "var(--sankey-unfunded)");

  const groups = nodes
    .filter((node) => node.column === GROUP_COLUMN && node.id !== NET_INCOME_ID)
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));

  // Two passes: pin every group whose identity has a fixed slot first, then
  // fill whatever slots remain, by size order, for groups this month has that
  // the mapping above has never seen.
  const takenSlots = new Set<number>();
  const slotByGroupId = new Map<string, number>();
  for (const group of groups) {
    const slot = KNOWN_GROUP_SLOTS[group.label.trim().toLowerCase()];
    if (slot !== undefined && !takenSlots.has(slot)) {
      slotByGroupId.set(group.id, slot);
      takenSlots.add(slot);
    }
  }
  let nextCandidate = 1;
  const claimNextFreeSlot = (): number => {
    while (takenSlots.has(nextCandidate)) nextCandidate += 1;
    return nextCandidate;
  };
  for (const group of groups) {
    if (slotByGroupId.has(group.id)) continue;
    const slot = claimNextFreeSlot();
    slotByGroupId.set(group.id, slot);
    takenSlots.add(slot);
  }

  for (const group of groups) {
    const slot = slotByGroupId.get(group.id);
    colours.set(
      group.id,
      slot !== undefined ? (GROUP_COLOURS[slot - 1] ?? NEUTRAL) : NEUTRAL,
    );
  }

  // Categories inherit from whichever node feeds them.
  for (const link of links) {
    if (colours.has(link.target)) continue;
    const parent = colours.get(link.source);
    if (parent) colours.set(link.target, parent);
  }

  return colours;
}

export interface SankeyChartProps {
  nodes: SankeyNode[];
  links: SankeyLink[];
  /** Used for the SVG's accessible name. */
  title: string;
  /** ISO code, or `UNKNOWN_CURRENCY` for a bare number. */
  currency?: string;
  maxNodesPerColumn?: number;
}

export default function SankeyChart({
  nodes,
  links,
  title,
  currency = "USD",
  maxNodesPerColumn = DEFAULT_MAX_NODES_PER_COLUMN,
}: Readonly<SankeyChartProps>) {
  if (nodes.length === 0 || links.length === 0) {
    return <p className="py-4 text-sm opacity-60">No data yet.</p>;
  }

  const money = (value: number): string => formatCurrency(value, currency);

  // The chart folds; the table below keeps every original row.
  const folded = foldSankeyOverflow(nodes, links, maxNodesPerColumn);
  const viewHeight = sankeyCanvasHeight(
    folded.nodes,
    NODE_PADDING,
    MIN_VIEW_HEIGHT,
  );
  const layout = layoutSankey(
    folded.nodes,
    folded.links,
    VIEW_WIDTH - MARGIN_X * 2,
    viewHeight,
    NODE_WIDTH,
    NODE_PADDING,
    COLUMN_X_FRACTIONS,
  );

  const colours = buildColours(folded.nodes, folded.links);
  const labelById = new Map(nodes.map((node) => [node.id, node.label]));

  // Every percentage is a share of total money in, so any two ribbons anywhere
  // in the diagram compare directly. A per-column basis would make the same
  // ribbon read as two different percentages at its two ends.
  const totalIn = folded.nodes
    .filter((node) => node.column === HUB_COLUMN)
    .reduce((sum, node) => sum + node.value, 0);
  // Two decimals with trailing zeros trimmed: "92.91%", "20.1%", "100%" —
  // never a fixed one decimal, which turns "100%" into the wrong "100.0%".
  const formatPercent = (fraction: number): string =>
    `${Number(fraction.toFixed(2))}`;
  const share = (value: number): string =>
    totalIn > 0 ? ` (${formatPercent((value / totalIn) * 100)}%)` : "";

  return (
    <div>
      <div className="hidden md:block">
        <svg
          viewBox={`0 0 ${VIEW_WIDTH} ${viewHeight + MARGIN_TOP}`}
          className="h-auto w-full"
          role="img"
          aria-label={`${title}. Flow diagram; the data table below carries the same figures.`}
        >
          <defs>
            {/* A ribbon fades from its source's hue to its target's, which is
                what makes a flow read as travelling rather than as a static
                band sitting between two bars. */}
            {layout.links.map((link, index) => (
              <linearGradient
                key={`${link.source}->${link.target}`}
                id={gradientId(index)}
                x1="0"
                x2="1"
                y1="0"
                y2="0"
              >
                <stop
                  offset="0%"
                  stopColor={colours.get(link.source) ?? NEUTRAL}
                />
                <stop
                  offset="100%"
                  stopColor={colours.get(link.target) ?? NEUTRAL}
                />
              </linearGradient>
            ))}
          </defs>

          <g transform={`translate(${MARGIN_X} ${MARGIN_TOP})`}>
            {/* Ribbons first so node rectangles and labels sit on top. */}
            {layout.links.map((link, index) => {
              const sourceLabel = labelById.get(link.source) ?? link.source;
              const targetLabel = labelById.get(link.target) ?? link.target;
              return (
                <path
                  key={`${link.source}->${link.target}`}
                  d={link.path}
                  fill={`url(#${gradientId(index)})`}
                  fillOpacity="var(--sankey-flow-opacity)"
                >
                  <title>
                    {`${sourceLabel} to ${targetLabel}: ${money(link.value)}`}
                  </title>
                </path>
              );
            })}

            {layout.nodes.map((node) => {
              // Sources read rightward into the ribbon they feed; groups and
              // categories read leftward. Labelling both sides toward the same
              // gap is what made columns 2 and 3 collide.
              const labelsLeft = node.column >= GROUP_COLUMN;
              const isHub = node.column === HUB_COLUMN;
              // Surplus/shortfall are outcomes, not real spending categories,
              // so they never carry an emoji — same rule as the hub.
              const isOutcome =
                node.id === NET_INCOME_ID || node.id === UNFUNDED_ID;
              // Too thin to carry text without overrunning its neighbour: the
              // `<title>` and the table twin still name it.
              const labelled = node.height >= MIN_LABELLED_NODE_HEIGHT;

              let labelX = node.x + NODE_WIDTH + LABEL_GAP;
              let anchor: "start" | "middle" | "end" = "start";
              if (labelsLeft) {
                labelX = node.x - LABEL_GAP;
                anchor = "end";
              }
              // The hub used to sit above its own bar to dodge the source and
              // group labels on either side of it. The widened hub-to-groups
              // gap (`COLUMN_X_FRACTIONS`) now leaves room for its label to
              // sit beside the bar like every other node, so it no longer
              // needs the exception — or the taller `MARGIN_TOP` that made
              // room for it.

              const emoji = isHub || isOutcome ? "" : emojiForLabel(node.label);
              const nameText = emoji
                ? `${emoji} ${truncate(node.label)}`
                : truncate(node.label);
              const centerY = node.y + node.height / 2;

              return (
                <g key={node.id}>
                  <rect
                    x={node.x}
                    y={node.y}
                    width={NODE_WIDTH}
                    height={node.height}
                    rx={1}
                    fill={colours.get(node.id) ?? NEUTRAL}
                  >
                    <title>{`${node.label}: ${money(node.value)}`}</title>
                  </rect>
                  {labelled && (
                    /* A halo keeps labels legible where they cross a ribbon,
                       without the text ever wearing a series colour. Two
                       stacked lines: the name, then the amount and share —
                       both full ink weight, neither muted or smaller, so the
                       figure reads as clearly as the name beside it. */
                    <text
                      textAnchor={anchor}
                      fontSize={12}
                      stroke="var(--sankey-surface)"
                      strokeWidth={3}
                      paintOrder="stroke"
                    >
                      <tspan
                        x={labelX}
                        y={centerY - LABEL_LINE_GAP / 2}
                        dominantBaseline="middle"
                        fill="var(--viz-ink)"
                      >
                        {nameText}
                      </tspan>
                      <tspan
                        x={labelX}
                        y={centerY + LABEL_LINE_GAP / 2}
                        dominantBaseline="middle"
                        className="money"
                        data-money
                        fill="var(--viz-ink)"
                        fontWeight={600}
                      >
                        {`${money(node.value)}${share(node.value)}`}
                      </tspan>
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>

        <details className="mt-1">
          <summary
            className="cursor-pointer text-xs"
            style={{ color: "var(--viz-muted)" }}
          >
            View data table
          </summary>
          <FlowTable links={links} labelById={labelById} money={money} />
        </details>
      </div>

      {/* Table-first below 768px: the diagram is unreadable at phone width. */}
      <div className="md:hidden">
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-1 text-xs text-muted">
          Shown as a table on small screens.
        </p>
        <FlowTable links={links} labelById={labelById} money={money} />
      </div>
    </div>
  );
}

/** Every original link, unfolded — the chart's twin, not a summary of it. */
function FlowTable({
  links,
  labelById,
  money,
}: Readonly<{
  links: SankeyLink[];
  labelById: Map<string, string>;
  money: (value: number) => string;
}>) {
  return (
    <table className="mt-2 w-full text-xs">
      <caption className="sr-only">
        Every flow in the diagram, with its amount.
      </caption>
      <thead>
        <tr className="text-left opacity-60">
          <th className="py-1 pr-2 font-medium">From</th>
          <th className="py-1 pr-2 font-medium">To</th>
          <th className="py-1 pr-2 text-right font-medium">Amount</th>
        </tr>
      </thead>
      <tbody className="tabular-nums">
        {links.map((link) => (
          <tr
            key={`${link.source}->${link.target}`}
            className="border-t border-black/5 dark:border-white/10"
          >
            <td className="py-1 pr-2">{labelById.get(link.source) ?? link.source}</td>
            <td className="py-1 pr-2">{labelById.get(link.target) ?? link.target}</td>
            <td data-money className="py-1 pr-2 text-right">{money(link.value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
