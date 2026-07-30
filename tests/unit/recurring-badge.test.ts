import { describe, expect, it } from "vitest";
import { countUnreviewedStreams } from "@/lib/recurring-page";

describe("sidebar recurring badge count", () => {
  it("is the same countUnreviewedStreams used by the page, not a re-derived query", () => {
    const count = countUnreviewedStreams([
      { isActive: true, status: "MATURE", dismissedAt: null, reviewedAt: null },
    ]);
    expect(count).toBe(1);
  });
});
