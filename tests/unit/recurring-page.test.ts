import { describe, it, expect } from "vitest";
import { expandStreamsForMonth } from "@/lib/recurring-page";

describe("lib/recurring-page.ts", () => {
  it("expands recurring streams and manual items for a month", () => {
    const res = expandStreamsForMonth({
      streams: [
        {
          id: "rs-1",
          merchant_name: "Netflix",
          description: "Netflix Subscription",
          average_amount: 15.99,
          frequency: "MONTHLY",
          category: "ENTERTAINMENT",
          predicted_next_date: "2026-07-20",
          reviewed_at: null,
        },
      ],
      manualItems: [
        {
          id: "m-1",
          merchant_name: "Gym",
          amount: 50,
          frequency: "MONTHLY",
          next_date: "2026-07-10",
        },
      ],
      month: "2026-07",
      today: "2026-07-15",
    });

    expect(res.month).toBe("2026-07");
    expect(res.occurrences.length).toBe(2);
    expect(res.reviewCount).toBe(1);

    const gym = res.occurrences.find((o) => o.merchant === "Gym");
    expect(gym?.status).toBe("overdue");

    const netflix = res.occurrences.find((o) => o.merchant === "Netflix");
    expect(netflix?.status).toBe("upcoming");
  });
});
