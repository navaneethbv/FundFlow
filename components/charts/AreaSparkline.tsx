import { areaPath, linePath } from "@/lib/chart-utils";

export default function AreaSparkline({ values }: { values: number[] }) {
  const W = 120;
  const H = 42;
  const PAD = 4;
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
        <linearGradient id="area-sparkline-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.38" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath(pts, baseY)} fill="url(#area-sparkline-fill)" />
      <path
        d={linePath(pts)}
        fill="none"
        stroke="var(--accent)"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
      />
    </svg>
  );
}
