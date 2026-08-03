import { useId } from "react";
import { areaPath, linePath } from "@/lib/chart-utils";

/**
 * `color` defaults to the accent orange every existing call site (Accounts'
 * per-row balance trend, the Monitor cash-flow strip) already renders in.
 * The Dashboard's net-worth widget is the one deliberate exception — Monarch
 * keeps net worth on `--viz-1` blue rather than the money-accent orange —
 * so it passes its own color instead of a new default changing everyone
 * else's chart. `useId` keys the gradient so two instances on one page (a
 * grouped Accounts list renders one per row) never share a `<linearGradient>`
 * id, which SVG requires to be unique per document.
 */
export default function AreaSparkline({
  values,
  color = "var(--accent)",
}: Readonly<{ values: number[]; color?: string }>) {
  const W = 120;
  const H = 42;
  const PAD = 4;
  const gradientId = `area-sparkline-fill-${useId()}`;
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => ({
    x: PAD + (i / (values.length - 1)) * (W - PAD * 2),
    y: PAD + (1 - (v - min) / range) * (H - PAD * 2),
  }));
  const baseY = H - PAD;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-11 w-32" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.38" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath(pts, baseY)} fill={`url(#${gradientId})`} />
      <path
        d={linePath(pts)}
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
      />
    </svg>
  );
}
