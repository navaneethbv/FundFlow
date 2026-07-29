"use client";

export default function CumulativeCompareChart({
  series,
}: Readonly<{
  series: { day: number; thisMonth: number | null; lastMonth: number | null }[];
}>) {
  const maxVal = Math.max(
    1,
    ...series.map((s) => Math.max(s.thisMonth || 0, s.lastMonth || 0)),
  );

  const pointsThis: string[] = [];
  const pointsLast: string[] = [];

  const chartWidth = 600;
  const chartHeight = 200;

  series.forEach((s) => {
    const x = ((s.day - 1) / 30) * chartWidth;

    if (s.thisMonth !== null) {
      const yThis = chartHeight - (s.thisMonth / maxVal) * (chartHeight - 20);
      pointsThis.push(`${x},${yThis}`);
    }

    if (s.lastMonth !== null) {
      const yLast = chartHeight - (s.lastMonth / maxVal) * (chartHeight - 20);
      pointsLast.push(`${x},${yLast}`);
    }
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-4 text-xs">
        <span className="flex items-center gap-1.5 font-medium text-foreground">
          <span className="h-2.5 w-2.5 rounded-full bg-accent" /> This Month
        </span>
        <span className="flex items-center gap-1.5 font-medium text-muted">
          <span className="h-2.5 w-2.5 rounded-full bg-panel-border" /> Last Month
        </span>
      </div>

      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full max-w-full">
          {pointsLast.length > 1 && (
            <polyline
              fill="none"
              stroke="var(--panel-border)"
              strokeWidth="2"
              strokeDasharray="4 4"
              points={pointsLast.join(" ")}
            />
          )}
          {pointsThis.length > 1 && (
            <polyline
              fill="none"
              stroke="var(--accent)"
              strokeWidth="2.5"
              points={pointsThis.join(" ")}
            />
          )}
        </svg>
      </div>
    </div>
  );
}
