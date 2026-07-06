import { describe, it, expect } from "vitest";
import {
  niceTicks,
  compactCurrency,
  linePath,
  areaPath,
  donutSegments,
  foldTail,
} from "@/lib/chart-utils";

describe("niceTicks", () => {
  it("produces clean steps covering the max", () => {
    const ticks = niceTicks(970);
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]!).toBeGreaterThanOrEqual(970);
    // steps are uniform
    const step = ticks[1]! - ticks[0]!;
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i]! - ticks[i - 1]!).toBeCloseTo(step);
    }
  });

  it("handles zero/invalid max without NaN", () => {
    expect(niceTicks(0)).toEqual([0]);
    expect(niceTicks(NaN)).toEqual([0]);
  });
});

describe("compactCurrency", () => {
  it("formats magnitudes compactly", () => {
    expect(compactCurrency(340)).toBe("$340");
    expect(compactCurrency(1234)).toBe("$1.2K");
    expect(compactCurrency(2_000_000)).toBe("$2M");
    expect(compactCurrency(-1500)).toBe("-$1.5K");
  });
});

describe("line and area paths", () => {
  const pts = [
    { x: 0, y: 10 },
    { x: 50, y: 5 },
    { x: 100, y: 8 },
  ];

  it("builds a move-then-line path", () => {
    expect(linePath(pts)).toBe("M0 10 L50 5 L100 8");
  });

  it("closes the area to the baseline", () => {
    const path = areaPath(pts, 20);
    expect(path.startsWith("M0 10")).toBe(true);
    expect(path.endsWith("L100 20 L0 20 Z")).toBe(true);
  });

  it("returns empty for no points", () => {
    expect(linePath([])).toBe("");
    expect(areaPath([], 0)).toBe("");
  });
});

describe("donutSegments", () => {
  const items = [
    { label: "a", amount: 50 },
    { label: "b", amount: 30 },
    { label: "c", amount: 20 },
  ];

  it("returns one path per positive item, no NaN coordinates", () => {
    const segs = donutSegments(items, (i) => i.amount, 90, 90, 80, 52);
    expect(segs).toHaveLength(3);
    for (const s of segs) {
      expect(s.path).not.toMatch(/NaN/);
      expect(s.path.startsWith("M")).toBe(true);
    }
  });

  it("skips zero-value items and returns [] for a zero total", () => {
    const withZero = [...items, { label: "z", amount: 0 }];
    expect(donutSegments(withZero, (i) => i.amount, 90, 90, 80, 52)).toHaveLength(3);
    expect(donutSegments([{ label: "z", amount: 0 }], (i) => i.amount, 90, 90, 80, 52)).toEqual([]);
  });

  it("renders a single 100% segment as a full ring without NaN", () => {
    const segs = donutSegments([{ label: "all", amount: 10 }], (i) => i.amount, 90, 90, 80, 52);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.path).not.toMatch(/NaN/);
  });
});

describe("foldTail", () => {
  const ranked = [
    { label: "a", amount: 50 },
    { label: "b", amount: 20 },
    { label: "c", amount: 10 },
    { label: "d", amount: 5 },
    { label: "e", amount: 4 },
    { label: "f", amount: 3 },
    { label: "g", amount: 2 },
  ];

  it("folds the tail into Other at the slice cap", () => {
    const folded = foldTail(ranked, 6, (amount) => ({ label: "Other", amount }));
    expect(folded).toHaveLength(6);
    // 5 items keep slots; "Other" = f (3) + g (2).
    expect(folded[5]).toEqual({ label: "Other", amount: 5 });
    // Nothing lost: totals match.
    const sum = (list: { amount: number }[]) => list.reduce((a, b) => a + b.amount, 0);
    expect(sum(folded)).toBe(sum(ranked));
  });

  it("leaves short lists untouched", () => {
    expect(foldTail(ranked.slice(0, 3), 6, (amount) => ({ label: "Other", amount }))).toHaveLength(3);
  });
});
