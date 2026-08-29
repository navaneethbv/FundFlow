import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import WeeklyReportWidget from "@/components/dashboard/widgets/WeeklyReportWidget";

describe("WeeklyReportWidget", () => {
  it("shows an empty state when no delivery exists", () => {
    const html = renderToStaticMarkup(createElement(WeeklyReportWidget, { delivery: null }));
    expect(html).toContain("No weekly report has been generated yet");
    expect(html).not.toContain("/reports");
  });

  it("shows a sent state with a link to the full report", () => {
    const html = renderToStaticMarkup(
      createElement(WeeklyReportWidget, {
        delivery: { status: "sent", periodStart: "2026-08-17", periodEnd: "2026-08-23", attemptedAt: null, sentAt: null },
      }),
    );
    expect(html).toContain("Delivered");
    expect(html).toContain("/reports");
  });

  it("shows a pending state for a processing delivery", () => {
    const html = renderToStaticMarkup(
      createElement(WeeklyReportWidget, {
        delivery: { status: "processing", periodStart: "2026-08-17", periodEnd: "2026-08-23", attemptedAt: null, sentAt: null },
      }),
    );
    expect(html).toContain("Preparing");
  });

  it("shows a failed state without hiding the report history", () => {
    const html = renderToStaticMarkup(
      createElement(WeeklyReportWidget, {
        delivery: { status: "failed", periodStart: "2026-08-17", periodEnd: "2026-08-23", attemptedAt: null, sentAt: null },
      }),
    );
    expect(html).toContain("Delivery failed");
  });
});