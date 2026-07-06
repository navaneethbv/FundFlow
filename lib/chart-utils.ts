/**
 * Pure geometry/format helpers for the SVG chart components. No imports, no
 * DOM — unit-tested alongside the other pure modules.
 */

/** "Nice" axis ticks from 0 to a rounded-up max: [0, step, 2*step, ...]. */
export function niceTicks(maxValue: number, tickCount = 4): number[] {
  if (!Number.isFinite(maxValue) || maxValue <= 0) return [0];
  const rough = maxValue / tickCount;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const residual = rough / magnitude;
  const niceStep =
    (residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 2.5 ? 2.5 : residual <= 5 ? 5 : 10) *
    magnitude;
  const ticks: number[] = [];
  for (let v = 0; v <= maxValue + niceStep * 0.999; v += niceStep) {
    ticks.push(Math.round(v * 100) / 100);
  }
  return ticks;
}

/** $1.2K / $340 / $2.1M — compact money for labels and tiles. */
export function compactCurrency(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return `${sign}$${Math.round(abs)}`;
}

export interface Point {
  x: number;
  y: number;
}

/** SVG path ("M x y L x y ...") through the points. */
export function linePath(points: Point[]): string {
  if (points.length === 0) return "";
  return points
    .map((p, i) => `${i === 0 ? "M" : "L"}${round2(p.x)} ${round2(p.y)}`)
    .join(" ");
}

/** Closed path: the line plus a baseline return, for a 10%-opacity area wash. */
export function areaPath(points: Point[], baselineY: number): string {
  if (points.length === 0) return "";
  const first = points[0]!;
  const last = points[points.length - 1]!;
  return `${linePath(points)} L${round2(last.x)} ${round2(baselineY)} L${round2(first.x)} ${round2(baselineY)} Z`;
}

export interface DonutSegment<T> {
  item: T;
  path: string;
  /** Mid-angle in radians — where a label/leader would anchor. */
  midAngle: number;
}

/**
 * Donut segment paths with a constant surface gap between segments (the 2px
 * spacer rule — separation by gap, never by stroke). Angles start at 12
 * o'clock, clockwise. Returns [] when the total is not positive.
 */
export function donutSegments<T>(
  items: T[],
  getValue: (item: T) => number,
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  gapPx = 2,
): DonutSegment<T>[] {
  const values = items.map((i) => Math.max(0, getValue(i)));
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return [];

  const midR = (outerR + innerR) / 2;
  // A full-circle single segment gets no gap (nothing to separate).
  const visible = values.filter((v) => v > 0).length;
  const gapAngle = visible > 1 ? gapPx / midR : 0;

  const segments: DonutSegment<T>[] = [];
  let angle = -Math.PI / 2; // 12 o'clock
  for (let i = 0; i < items.length; i++) {
    const fraction = values[i]! / total;
    const sweep = fraction * Math.PI * 2;
    if (sweep <= 0) {
      continue;
    }
    const a0 = angle + gapAngle / 2;
    const a1 = angle + sweep - gapAngle / 2;
    angle += sweep;
    if (a1 <= a0) continue; // segment thinner than the gap — legend carries it

    segments.push({
      item: items[i]!,
      path: annularSectorPath(cx, cy, outerR, innerR, a0, a1),
      midAngle: (a0 + a1) / 2,
    });
  }
  return segments;
}

function annularSectorPath(
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  a0: number,
  a1: number,
): string {
  // Near-full circles need two arcs each (SVG arcs can't draw 360°).
  if (a1 - a0 >= Math.PI * 2 - 1e-4) {
    const mid = a0 + Math.PI;
    return [
      annularSectorPath(cx, cy, outerR, innerR, a0, mid),
      annularSectorPath(cx, cy, outerR, innerR, mid, a1),
    ].join(" ");
  }
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const ox0 = cx + outerR * Math.cos(a0);
  const oy0 = cy + outerR * Math.sin(a0);
  const ox1 = cx + outerR * Math.cos(a1);
  const oy1 = cy + outerR * Math.sin(a1);
  const ix0 = cx + innerR * Math.cos(a1);
  const iy0 = cy + innerR * Math.sin(a1);
  const ix1 = cx + innerR * Math.cos(a0);
  const iy1 = cy + innerR * Math.sin(a0);
  return [
    `M${round2(ox0)} ${round2(oy0)}`,
    `A${outerR} ${outerR} 0 ${large} 1 ${round2(ox1)} ${round2(oy1)}`,
    `L${round2(ix0)} ${round2(iy0)}`,
    `A${innerR} ${innerR} 0 ${large} 0 ${round2(ix1)} ${round2(iy1)}`,
    "Z",
  ].join(" ");
}

/**
 * Fold a ranked list into at most `maxSlices` items, summing the tail into an
 * "Other" entry (never generate a 7th+ categorical hue).
 */
export function foldTail<T extends { amount: number }>(
  items: T[],
  maxSlices: number,
  makeOther: (amount: number) => T,
): T[] {
  if (items.length <= maxSlices) return items;
  const head = items.slice(0, maxSlices - 1);
  const tailSum = items.slice(maxSlices - 1).reduce((a, b) => a + b.amount, 0);
  return [...head, makeOther(Math.round(tailSum * 100) / 100)];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
