import { linePath } from "@/lib/chart-utils";

/**
 * Stat-tile sparkline: the history in the de-emphasis hue, the current period
 * as an accent end-dot with a 2px surface ring. Decorative trend context —
 * the tile's value + delta carry the numbers, so no axes or labels here.
 */
export default function Sparkline({ values }: { values: number[] }) {
  const W = 96;
  const H = 30;
  const PAD = 4;
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => ({
    x: PAD + (i / (values.length - 1)) * (W - PAD * 2),
    y: PAD + (1 - (v - min) / range) * (H - PAD * 2),
  }));
  const last = pts[pts.length - 1]!;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-24 h-[30px]" aria-hidden="true">
      <path
        d={linePath(pts)}
        fill="none"
        stroke="var(--viz-muted)"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.7}
      />
      <circle cx={last.x} cy={last.y} r={3} fill="var(--viz-1)" stroke="var(--background)" strokeWidth={2} />
    </svg>
  );
}
