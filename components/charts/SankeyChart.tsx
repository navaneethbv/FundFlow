import { compactCurrency } from "@/lib/chart-utils";
import {
  foldSankeyOverflow,
  layoutSankey,
  type SankeyLink,
  type SankeyNode,
} from "@/lib/sankey";

/**
 * Server-rendered Sankey. No client JS, no chart library — the same contract as
 * every other component in `components/charts/`, which is what keeps the
 * nonce-based CSP in `proxy.ts` free of exceptions.
 *
 * Colour encodes the *stage* (which column a node sits in), not the individual
 * category: a flow diagram with one hue per category would blow straight past
 * the six-slot categorical palette the moment a user has seven spending groups.
 * Identity is carried by the visible labels and the table twin instead, so
 * colour never works alone.
 *
 * Below 768px the SVG is replaced by the table rather than squeezed: a Sankey
 * at phone width is unreadable, and `hidden`/`md:hidden` means exactly one of
 * the two is in the accessibility tree at any viewport.
 */

const VIEW_WIDTH = 960;
const VIEW_HEIGHT = 420;
const NODE_WIDTH = 12;
const NODE_PADDING = 10;
const MARGIN_X = 6;
const LABEL_GAP = 6;
/** Longer labels are truncated in the SVG; full text lives in title + table. */
const MAX_LABEL_CHARS = 22;
/** Per column, so no column can outgrow the palette or the canvas. */
const DEFAULT_MAX_NODES_PER_COLUMN = 8;

const DEFAULT_COLUMN_LABELS = ["Sources", "Total", "Groups", "Categories"];

/** Stage hue. Six slots exist; a graph with more columns wraps rather than
 *  inventing a seventh hue. */
function slotForColumn(column: number): number {
  return (column % 6) + 1;
}

function truncate(value: string): string {
  return value.length > MAX_LABEL_CHARS
    ? `${value.slice(0, MAX_LABEL_CHARS - 1)}…`
    : value;
}

export interface SankeyChartProps {
  nodes: SankeyNode[];
  links: SankeyLink[];
  /** Used for the SVG's accessible name. */
  title: string;
  valueFormatter?: (value: number) => string;
  /** Stage names, shown in the legend. Defaults to the cash-flow stages. */
  columnLabels?: string[];
  maxNodesPerColumn?: number;
}

export default function SankeyChart({
  nodes,
  links,
  title,
  valueFormatter = compactCurrency,
  columnLabels = DEFAULT_COLUMN_LABELS,
  maxNodesPerColumn = DEFAULT_MAX_NODES_PER_COLUMN,
}: Readonly<SankeyChartProps>) {
  if (nodes.length === 0 || links.length === 0) {
    return <p className="py-4 text-sm opacity-60">No data yet.</p>;
  }

  // The chart folds; the table below keeps every original row.
  const folded = foldSankeyOverflow(nodes, links, maxNodesPerColumn);
  const layout = layoutSankey(
    folded.nodes,
    folded.links,
    VIEW_WIDTH - MARGIN_X * 2,
    VIEW_HEIGHT,
    NODE_WIDTH,
    NODE_PADDING,
  );

  const lastColumn = Math.max(...folded.nodes.map((node) => node.column));
  const labelById = new Map(nodes.map((node) => [node.id, node.label]));
  const positionedById = new Map(layout.nodes.map((node) => [node.id, node]));
  const usedColumns = [...new Set(folded.nodes.map((node) => node.column))].sort(
    (a, b) => a - b,
  );

  return (
    <div>
      <div className="hidden md:block">
        <svg
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          className="h-auto w-full"
          role="img"
          aria-label={`${title}. Flow diagram; the data table below carries the same figures.`}
        >
          <g transform={`translate(${MARGIN_X} 0)`}>
            {/* Ribbons first so node rectangles and labels sit on top. */}
            {layout.links.map((link) => {
              const source = positionedById.get(link.source);
              const sourceLabel = labelById.get(link.source) ?? link.source;
              const targetLabel = labelById.get(link.target) ?? link.target;
              return (
                <path
                  key={`${link.source}->${link.target}`}
                  d={link.path}
                  fill={`var(--viz-${slotForColumn(source?.column ?? 0)})`}
                  fillOpacity={0.32}
                >
                  <title>
                    {`${sourceLabel} to ${targetLabel}: ${valueFormatter(link.value)}`}
                  </title>
                </path>
              );
            })}

            {layout.nodes.map((node) => {
              const isLast = node.column === lastColumn;
              const labelX = isLast
                ? node.x - LABEL_GAP
                : node.x + NODE_WIDTH + LABEL_GAP;
              return (
                <g key={node.id}>
                  <rect
                    x={node.x}
                    y={node.y}
                    width={NODE_WIDTH}
                    height={node.height}
                    rx={2}
                    fill={`var(--viz-${slotForColumn(node.column)})`}
                  >
                    <title>{`${node.label}: ${valueFormatter(node.value)}`}</title>
                  </rect>
                  {/* A halo keeps labels legible where they cross a ribbon,
                      without the text ever wearing a series colour. */}
                  <text
                    x={labelX}
                    y={node.y + node.height / 2}
                    dominantBaseline="middle"
                    textAnchor={isLast ? "end" : "start"}
                    fontSize={11}
                    fill="var(--viz-ink)"
                    stroke="var(--panel)"
                    strokeWidth={3}
                    paintOrder="stroke"
                  >
                    {truncate(node.label)}
                    <tspan fill="var(--viz-muted)" dx={5} fontSize={10}>
                      {valueFormatter(node.value)}
                    </tspan>
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {usedColumns.map((column) => (
            <li key={column} className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full"
                style={{ background: `var(--viz-${slotForColumn(column)})` }}
              />
              <span style={{ color: "var(--viz-ink-2)" }}>
                {columnLabels[column] ?? `Stage ${column + 1}`}
              </span>
            </li>
          ))}
        </ul>

        <details className="mt-1">
          <summary
            className="cursor-pointer text-xs"
            style={{ color: "var(--viz-muted)" }}
          >
            View data table
          </summary>
          <FlowTable
            links={links}
            labelById={labelById}
            valueFormatter={valueFormatter}
          />
        </details>
      </div>

      {/* Table-first below 768px: the diagram is unreadable at phone width. */}
      <div className="md:hidden">
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-1 text-xs text-muted">
          Shown as a table on small screens.
        </p>
        <FlowTable
          links={links}
          labelById={labelById}
          valueFormatter={valueFormatter}
        />
      </div>
    </div>
  );
}

/** Every original link, unfolded — the chart's twin, not a summary of it. */
function FlowTable({
  links,
  labelById,
  valueFormatter,
}: Readonly<{
  links: SankeyLink[];
  labelById: Map<string, string>;
  valueFormatter: (value: number) => string;
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
            <td className="py-1 pr-2 text-right">{valueFormatter(link.value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
