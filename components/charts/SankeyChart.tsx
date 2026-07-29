"use client";

import { layoutSankey, type SankeyNode, type SankeyLink } from "@/lib/sankey";
import { formatCurrency } from "@/lib/format";

export default function SankeyChart({
  nodes,
  links,
  width = 800,
  height = 400,
}: Readonly<{
  nodes: SankeyNode[];
  links: SankeyLink[];
  width?: number;
  height?: number;
}>) {
  const { nodes: posNodes, links: posLinks } = layoutSankey(nodes, links, width, height);

  return (
    <div className="space-y-6">
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full max-w-full text-xs font-medium"
          style={{ minWidth: "600px", minHeight: `${height}px` }}
        >
          {posLinks.map((link, idx) => (
            <path
              key={`${link.source}-${link.target}-${idx}`}
              d={link.path}
              fill="none"
              stroke="var(--accent)"
              strokeOpacity={0.25}
              strokeWidth={link.strokeWidth}
            />
          ))}

          {posNodes.map((node) => (
            <g key={node.id} transform={`translate(${node.x}, ${node.y})`}>
              <rect
                width={24}
                height={node.height}
                rx={4}
                fill="var(--accent)"
                className="transition-colors duration-150"
              />
              <text
                x={node.column === 0 ? 32 : -8}
                y={node.height / 2 + 4}
                textAnchor={node.column === 0 ? "start" : "end"}
                fill="currentColor"
                className="fill-foreground font-semibold"
              >
                {node.label} ({formatCurrency(node.value)})
              </text>
            </g>
          ))}
        </svg>
      </div>

      {/* Accessible Table Twin */}
      <div className="sr-only">
        <table>
          <caption>Sankey Cash Flow Breakdown</caption>
          <thead>
            <tr>
              <th>Node</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {nodes.map((n) => (
              <tr key={n.id}>
                <td>{n.label}</td>
                <td>{formatCurrency(n.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
