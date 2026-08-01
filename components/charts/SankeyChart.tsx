import { formatCurrency } from "@/lib/format";
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
 * The palette is the seven validated `--viz-*` slots, assigned to the seven
 * largest groups; anything past the seventh takes a neutral rather than an
 * eighth generated hue. Seven is a measured ceiling, not a style choice: an
 * eight-hue set falls to ΔE 2.4 under protanopia and a twelve-hue set to 0.4,
 * against a floor of 6. Identity therefore never rests on colour alone —
 * every node is labelled and the table twin repeats every figure, which is
 * also what makes the palette's 6–8 CVD floor band legal here.
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
const NODE_WIDTH = 18;
const NODE_PADDING = 14;
const MARGIN_X = 24;
/** Headroom for the hub label, which sits above its bar. */
const MARGIN_TOP = 28;
const LABEL_GAP = 8;
/** Names are short Title Case now, so this rarely bites. */
const MAX_LABEL_CHARS = 22;
/** Per column, so no column outgrows the canvas. */
const DEFAULT_MAX_NODES_PER_COLUMN = 20;
const SOURCE_COLUMN = 0;
const HUB_COLUMN = 1;
const GROUP_COLUMN = 2;

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

  groups.forEach((group, index) => {
    colours.set(group.id, GROUP_COLOURS[index] ?? NEUTRAL);
  });

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
  );

  const colours = buildColours(folded.nodes, folded.links);
  const labelById = new Map(nodes.map((node) => [node.id, node.label]));

  // Every percentage is a share of total money in, so any two ribbons anywhere
  // in the diagram compare directly. A per-column basis would make the same
  // ribbon read as two different percentages at its two ends.
  const totalIn = folded.nodes
    .filter((node) => node.column === HUB_COLUMN)
    .reduce((sum, node) => sum + node.value, 0);
  const share = (value: number): string =>
    totalIn > 0 ? ` (${((value / totalIn) * 100).toFixed(1)}%)` : "";

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
              // The hub is the exception: it is one full-height bar with the
              // source labels in the gap to its left and the group labels in
              // the gap to its right, so either side would collide. It sits
              // above its own bar instead, where nothing else ever is.
              const isHub = node.column === HUB_COLUMN;
              // Too thin to carry text without overrunning its neighbour: the
              // `<title>` and the table twin still name it.
              const labelled = node.height >= MIN_LABELLED_NODE_HEIGHT;

              let labelX = node.x + NODE_WIDTH + LABEL_GAP;
              let anchor: "start" | "middle" | "end" = "start";
              if (labelsLeft) {
                labelX = node.x - LABEL_GAP;
                anchor = "end";
              } else if (isHub) {
                labelX = node.x + NODE_WIDTH / 2;
                anchor = "middle";
              }

              return (
                <g key={node.id}>
                  <rect
                    x={node.x}
                    y={node.y}
                    width={NODE_WIDTH}
                    height={node.height}
                    rx={2}
                    fill={colours.get(node.id) ?? NEUTRAL}
                  >
                    <title>{`${node.label}: ${money(node.value)}`}</title>
                  </rect>
                  {labelled && (
                    /* A halo keeps labels legible where they cross a ribbon,
                       without the text ever wearing a series colour. */
                    <text
                      x={labelX}
                      y={isHub ? node.y - LABEL_GAP : node.y + node.height / 2}
                      dominantBaseline={isHub ? "auto" : "middle"}
                      textAnchor={anchor}
                      fontSize={12}
                      fill="var(--viz-ink)"
                      stroke="var(--sankey-surface)"
                      strokeWidth={3}
                      paintOrder="stroke"
                    >
                      {truncate(node.label)}
                      <tspan
                        className="money"
                        data-money
                        fill="var(--viz-muted)"
                        dx={5}
                        fontSize={10.5}
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
