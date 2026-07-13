import { describe, expect, it } from "vitest";
import { classifyDeliveryClaim } from "@/lib/report-delivery";

describe("weekly report delivery claims", () => {
  const now = new Date("2026-07-13T15:15:00.000Z");

  it("claims a period with no delivery row", () => {
    expect(classifyDeliveryClaim(null, now)).toBe("claim");
  });

  it("skips sent and recently processing deliveries", () => {
    expect(
      classifyDeliveryClaim(
        { status: "sent", attemptedAt: now.toISOString() },
        now,
      ),
    ).toBe("skip");
    expect(
      classifyDeliveryClaim(
        { status: "processing", attemptedAt: "2026-07-13T15:10:00.000Z" },
        now,
      ),
    ).toBe("skip");
  });

  it("retries failed and stale processing deliveries", () => {
    for (const status of ["failed", "processing"]) {
      expect(
        classifyDeliveryClaim(
          { status, attemptedAt: "2026-07-13T13:15:00.000Z" },
          now,
        ),
      ).toBe("retry");
    }
  });
});
