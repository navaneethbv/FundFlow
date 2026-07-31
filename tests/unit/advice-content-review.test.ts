import { describe, it, expect } from "vitest";
import { ADVICE_LIBRARY } from "@/lib/advice-content";
import { validateAdviceLibrary } from "@/lib/advice";

/**
 * A content-editorial gate, not a code-correctness test: this fails the
 * build the moment ADVICE_LIBRARY gains a source that's gone stale, a
 * duplicate task id, an unsupported host, or language that oversteps general
 * education into a guarantee or a specific recommendation. Bump the date
 * below only alongside actually re-reviewing every source's reviewedAt.
 */
const ASOF = "2026-07-30";
const MAX_REVIEW_AGE_DAYS = 365;

describe("ADVICE_LIBRARY content review", () => {
  it("has at least two items per category", () => {
    const counts = new Map<string, number>();
    for (const item of ADVICE_LIBRARY) {
      counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
    }
    for (const category of ["save_up", "spend", "pay_down", "protect", "invest", "wellness"]) {
      expect(counts.get(category) ?? 0).toBeGreaterThanOrEqual(2);
    }
  });

  it("has globally unique item ids", () => {
    const ids = ADVICE_LIBRARY.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every item at least one task", () => {
    for (const item of ADVICE_LIBRARY) {
      expect(item.tasks.length).toBeGreaterThan(0);
    }
  });

  it("passes the full content-review guard with no violations", () => {
    const violations = validateAdviceLibrary(ADVICE_LIBRARY, {
      asOf: ASOF,
      maxReviewAgeDays: MAX_REVIEW_AGE_DAYS,
    });
    expect(violations).toEqual([]);
  });
});
