import { describe, it, expect } from "vitest";
import {
  detectPriceSpikes,
  totalAnnualPriceHikeImpact,
  type RecurringStreamCandidate,
} from "@/lib/recurring-alerts";

describe("Subscription Price Spike Alerts", () => {
  it("detects price hikes that exceed $1.00 and 4%", () => {
    const streams: RecurringStreamCandidate[] = [
      {
        id: "stream-netflix",
        merchantName: "Netflix",
        averageAmount: 15.49,
        lastAmount: 17.99, // +$2.50 (+16.14%)
        frequency: "monthly",
        status: "active",
      },
      {
        id: "stream-spotify",
        merchantName: "Spotify",
        averageAmount: 10.99,
        lastAmount: 10.99, // no change
        frequency: "monthly",
        status: "active",
      },
      {
        id: "stream-small",
        merchantName: "Tiny Service",
        averageAmount: 1.0,
        lastAmount: 1.03, // only +$0.03, below $1.00 threshold
        frequency: "monthly",
        status: "active",
      },
      {
        id: "stream-small-pct",
        merchantName: "Expensive Server",
        averageAmount: 1000.0,
        lastAmount: 1002.0, // +$2.00 but only +0.2% (< 4%)
        frequency: "monthly",
        status: "active",
      },
    ];

    const alerts = detectPriceSpikes(streams);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.merchantName).toBe("Netflix");
    expect(alerts[0]!.increaseAmount).toBe(2.5);
    expect(alerts[0]!.percentIncrease).toBe(16.14);
    expect(alerts[0]!.annualizedImpact).toBe(30.0); // 2.50 * 12
  });

  it("calculates accurate annual impacts across all cadence frequencies", () => {
    const streams: RecurringStreamCandidate[] = [
      {
        id: "s-weekly",
        merchantName: "Meal Kit",
        averageAmount: 60.0,
        lastAmount: 65.0, // +$5 * 52 = 260
        frequency: "WEEKLY",
      },
      {
        id: "s-biweekly-1",
        merchantName: "Gym",
        averageAmount: 40.0,
        lastAmount: 45.0, // +$5 * 26 = 130
        frequency: "BIWEEKLY",
      },
      {
        id: "s-biweekly-2",
        merchantName: "Biweekly Cleaning",
        averageAmount: 80.0,
        lastAmount: 90.0, // +$10 * 26 = 260
        frequency: "BI-WEEKLY",
      },
      {
        id: "s-semimonthly",
        merchantName: "Semi Monthly Box",
        averageAmount: 30.0,
        lastAmount: 35.0, // +$5 * 24 = 120
        frequency: "SEMI_MONTHLY",
      },
      {
        id: "s-quarterly",
        merchantName: "Quarterly Software",
        averageAmount: 100.0,
        lastAmount: 120.0, // +$20 * 4 = 80
        frequency: "QUARTERLY",
      },
      {
        id: "s-annually",
        merchantName: "Annual Domain",
        averageAmount: 50.0,
        lastAmount: 70.0, // +$20 * 1 = 20
        frequency: "ANNUALLY",
      },
      {
        id: "s-yearly",
        merchantName: "Yearly Sub",
        averageAmount: 80.0,
        lastAmount: 100.0, // +$20 * 1 = 20
        frequency: "YEARLY",
      },
      {
        id: "s-unknown-freq",
        description: "Fallback Description Service",
        averageAmount: 10.0,
        lastAmount: 15.0, // +$5 * 12 (default) = 60
        frequency: "CUSTOM_CADENCE",
      },
      {
        id: "s-no-name",
        averageAmount: 20.0,
        lastAmount: 30.0, // +$10 * 12 = 120
      },
    ];

    const alerts = detectPriceSpikes(streams);
    expect(alerts).toHaveLength(9);

    const noNameAlert = alerts.find((a) => a.id === "s-no-name");
    expect(noNameAlert?.merchantName).toBe("Subscription");

    const descAlert = alerts.find((a) => a.id === "s-unknown-freq");
    expect(descAlert?.merchantName).toBe("Fallback Description Service");

    const total = totalAnnualPriceHikeImpact(alerts);
    expect(total).toBeGreaterThan(0);
  });

  it("skips inactive streams or zero balances", () => {
    const streams: RecurringStreamCandidate[] = [
      {
        id: "stream-cancelled",
        merchantName: "Old Service",
        averageAmount: 20.0,
        lastAmount: 30.0,
        frequency: "monthly",
        status: "inactive",
      },
      {
        id: "stream-zero",
        merchantName: "Zero Stream",
        averageAmount: 0,
        lastAmount: 0,
        frequency: "monthly",
        status: "active",
      },
      {
        id: "stream-negative",
        merchantName: "Negative Stream",
        averageAmount: 10,
        lastAmount: 5, // price decreased
        frequency: "monthly",
      },
    ];

    expect(detectPriceSpikes(streams)).toHaveLength(0);
  });
});
