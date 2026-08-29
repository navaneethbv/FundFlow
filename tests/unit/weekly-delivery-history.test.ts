import { describe, expect, it } from "vitest";
import { buildWeeklyDeliveryHistory } from "@/lib/weekly-delivery-history";

describe("buildWeeklyDeliveryHistory", () => {
  const anchorDate = new Date("2026-08-29T12:00:00.000Z");

  it("merges stored deliveries and exposes gaps as missing / No run recorded", () => {
    // Simulates the exact production situation on 2026-08-29:
    // User had delivery on 2026-08-17..2026-08-23 and 2026-07-27..2026-08-02, but missed 2 intermediate weeks
    const stored = [
      {
        period_start: "2026-08-17",
        period_end: "2026-08-23",
        status: "sent",
        sent_at: "2026-08-24T14:00:00Z",
      },
      {
        period_start: "2026-07-27",
        period_end: "2026-08-02",
        status: "sent",
        sent_at: "2026-08-03T14:00:00Z",
      },
    ];

    const history = buildWeeklyDeliveryHistory(
      stored,
      anchorDate,
      "America/Los_Angeles",
      6,
    );
    expect(history).toHaveLength(6);

    // Week 1 (2026-08-17 to 2026-08-23): sent
    expect(history[0]).toMatchObject({
      periodStart: "2026-08-17",
      periodEnd: "2026-08-23",
      status: "sent",
    });

    // Week 2 (2026-08-10 to 2026-08-16): missing (gap in history)
    expect(history[1]).toMatchObject({
      periodStart: "2026-08-10",
      periodEnd: "2026-08-16",
      status: "missing",
      reason: "No run recorded",
    });

    // Week 3 (2026-08-03 to 2026-08-09): missing (gap in history)
    expect(history[2]).toMatchObject({
      periodStart: "2026-08-03",
      periodEnd: "2026-08-09",
      status: "missing",
      reason: "No run recorded",
    });

    // Week 4 (2026-07-27 to 2026-08-02): sent
    expect(history[3]).toMatchObject({
      periodStart: "2026-07-27",
      periodEnd: "2026-08-02",
      status: "sent",
    });
  });

  it("handles failed and skipped deliveries with humanized reasons", () => {
    const stored = [
      {
        period_start: "2026-08-17",
        period_end: "2026-08-23",
        status: "failed",
        error_code: "smtp_error",
        attempted_at: "2026-08-24T14:00:00Z",
      },
      {
        period_start: "2026-08-10",
        period_end: "2026-08-16",
        status: "skipped",
        error_code: "no_data",
        attempted_at: "2026-08-17T14:00:00Z",
      },
    ];

    const history = buildWeeklyDeliveryHistory(
      stored,
      anchorDate,
      "America/Los_Angeles",
      2,
    );
    expect(history[0]!.reason).toBe("Email delivery service issue");
    expect(history[1]!.reason).toBe("No transaction activity");
  });
});
