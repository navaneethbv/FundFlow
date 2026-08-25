import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SinkingFundsSection from "@/components/settings/SinkingFundsSection";

describe("SinkingFundsSection", () => {
  it("renders recurrence controls, next due planning, and edit actions", () => {
    const html = renderToStaticMarkup(
      createElement(SinkingFundsSection, {
        initialFunds: [{
          id: "fund-1",
          name: "Insurance",
          target_amount: 1200,
          due_date: "2025-01-31",
          cadence: "annual",
          custom_interval_months: null,
          cycle_anchor_date: "2025-01-31",
        }],
      }),
    );

    expect(html).toContain("Cadence");
    expect(html).toContain("Every year");
    expect(html).toContain("Next due");
    expect(html).toContain("monthly");
    expect(html).toContain("Edit");
    expect(html).toContain("Remove");
  });
});
