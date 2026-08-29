import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientStub } from "../fixtures/supabase-query";
import { getWeeklyReportPeriod, isWeeklyReportDue, normalizeReportTimezone } from "@/lib/report-period";
import { renderWeeklyReportEmail, renderDailyDigestEmail, type DigestNotification } from "@/lib/report-email";
import {
  classifyDeliveryClaim,
  claimWeeklyDelivery,
  markWeeklyDeliverySent,
  markWeeklyDeliverySkipped,
  markWeeklyDeliveryFailed,
} from "@/lib/report-delivery";
import type { WeeklyReportData } from "@/lib/weekly-report";

describe("report-period", () => {
  it("computes weekly periods for a Monday reference and mid-week references", () => {
    const mon = getWeeklyReportPeriod(new Date("2026-07-06T12:00:00Z"), "UTC");
    expect(mon.start).toBe("2026-06-29");
    expect(mon.end).toBe("2026-07-05");
    expect(mon.previousStart).toBe("2026-06-22");
    const wed = getWeeklyReportPeriod(new Date("2026-07-08T12:00:00Z"), "UTC");
    expect(wed.end).toBe("2026-07-05");
  });

  it("isWeeklyReportDue distinguishes Monday-before-target from other days", () => {
    expect(isWeeklyReportDue(new Date("2026-07-06T07:00:00Z"), "UTC", 8)).toBe(false);
    expect(isWeeklyReportDue(new Date("2026-07-06T09:00:00Z"), "UTC", 8)).toBe(true);
    expect(isWeeklyReportDue(new Date("2026-07-08T09:00:00Z"), "UTC", 8)).toBe(true);
  });

  it("normalizeReportTimezone falls back to the default for invalid zones", () => {
    expect(normalizeReportTimezone("America/New_York")).toBe("America/New_York");
    expect(normalizeReportTimezone("Not/AZone")).toBe("America/Los_Angeles");
    expect(normalizeReportTimezone(null)).toBe("America/Los_Angeles");
  });
});

function makeData(overrides: Partial<WeeklyReportData> = {}): WeeklyReportData {
  return {
    userId: "u1",
    userEmail: "u@fundflow.dev",
    period: {
      start: "2026-07-06",
      end: "2026-07-12",
      previousStart: "2026-06-29",
      previousEnd: "2026-07-05",
    },
    totalSpend: 100,
    previousTotalSpend: 80,
    changeAmount: 20,
    changePercent: 0.25,
    categories: [{ category: "Food and Drink", amount: 60, share: 0.6 }],
    merchants: [{ merchant: "Grocery", amount: 40 }],
    banks: [{ name: "Chase", amount: 70 }],
    cards: [{ name: "•••• 1234", amount: 30 }],
    budgets: [
      { category: "Food and Drink", spent: 60, allowance: 50, percentage: 1.2, status: "over" },
    ],
    cashFlow: { inflows: 500, outflows: 200, net: 300 },
    ...overrides,
  };
}

describe("report-email", () => {
  it("renders a weekly email and escapes HTML in the dashboard url", () => {
    const result = renderWeeklyReportEmail(makeData(), "https://fundflow.dev/dashboard?x=1&y=<2>");
    expect(result.subject).toContain("FundFlow weekly insights");
    expect(result.html).toContain("amp;");
    expect(result.text).toContain("Spent");
  });

  it("handles a null change percent", () => {
    const result = renderWeeklyReportEmail(makeData({ changePercent: null, changeAmount: 0 }), "u");
    expect(result.html).toContain("No prior data");
  });

  it("handles a negative net cash flow for the danger color branch", () => {
    const result = renderWeeklyReportEmail(
      makeData({ cashFlow: { inflows: 100, outflows: 400, net: -300 } }),
      "u",
    );
    expect(result.html).toContain("-");
  });

  it("period label spans two months when start and end differ", () => {
    const data = makeData({
      period: {
        start: "2026-06-29",
        end: "2026-07-05",
        previousStart: "2026-06-22",
        previousEnd: "2026-06-28",
      },
    });
    const result = renderWeeklyReportEmail(data, "u");
    expect(result.html).toContain("June 29-July 5");
  });

  it("renders the daily digest for one and multiple notifications", () => {
    const one: DigestNotification[] = [{ type: "budget", title: "Over budget", body: "Watch it" }];
    const r1 = renderDailyDigestEmail(one, "2026-07-08", "https://fundflow.dev/notifications");
    expect(r1.subject).toContain("2026-07-08");
    expect(r1.html).toContain("alert");

    const many: DigestNotification[] = [
      { type: "budget", title: "Over", body: "b1" },
      { type: "login_alert", title: "New device", body: "b2" },
    ];
    const r2 = renderDailyDigestEmail(many, "2026-07-08", "https://fundflow.dev/notifications");
    expect(r2.html).toContain("alerts");
    expect(r2.text).toContain("Login Alert");
  });
});

describe("report-delivery", () => {
  const now = new Date("2026-07-08T12:00:00Z");
  const period = { start: "2026-07-06", end: "2026-07-12", previousStart: "2026-06-29", previousEnd: "2026-07-05" };

  function claimStub(options: {
    insertError?: { code: string; message?: string } | null;
    existing: { id: string; status: string; attempted_at: string; error_code: string | null } | null;
    updated?: { id: string } | null;
  }) {
    const from = () => {
      const calls: string[] = [];
      const builder = new Proxy({} as Record<string, unknown>, {
        get(_t, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => unknown) => {
              if (calls.includes("insert")) {
                return resolve({ data: null, error: options.insertError });
              }
              if (calls.includes("update")) {
                return resolve({ data: options.updated ?? null, error: null });
              }
              return resolve({ data: options.existing, error: null });
            };
          }
          return () => {
            calls.push(String(prop));
            return builder;
          };
        },
      });
      return builder;
    };
    return { from };
  }

  it("classifyDeliveryClaim covers every status", () => {
    expect(classifyDeliveryClaim(null, now)).toBe("claim");
    expect(classifyDeliveryClaim({ status: "sent", attemptedAt: now.toISOString() }, now)).toBe("skip");
    expect(classifyDeliveryClaim({ status: "skipped", attemptedAt: now.toISOString() }, now)).toBe("skip");
    expect(classifyDeliveryClaim({ status: "failed", attemptedAt: now.toISOString(), errorCode: "smtp_550" }, now)).toBe("skip");
    expect(classifyDeliveryClaim({ status: "failed", attemptedAt: now.toISOString(), errorCode: "smtp_450" }, now)).toBe("retry");
    expect(classifyDeliveryClaim({ status: "weird", attemptedAt: now.toISOString() }, now)).toBe("skip");
    const stale = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    expect(classifyDeliveryClaim({ status: "processing", attemptedAt: stale }, now)).toBe("retry");
    expect(classifyDeliveryClaim({ status: "processing", attemptedAt: now.toISOString() }, now)).toBe("skip");
  });

  it("claims a fresh insert", async () => {
    const supabase = clientStub({
      weekly_report_deliveries: { data: { id: "d1" } },
    });
    const res = await claimWeeklyDelivery(supabase as unknown as SupabaseClient, "u1", period, now);
    expect(res).toEqual({ claimed: true, deliveryId: "d1" });
  });

  it("retries a stale processing row and claims the update", async () => {
    const stale = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const existing = { id: "d1", status: "processing", attempted_at: stale, error_code: null };
    const supabase = claimStub({ insertError: { code: "23505" }, existing, updated: { id: "d1" } });
    const res = await claimWeeklyDelivery(supabase as unknown as SupabaseClient, "u1", period, now);
    expect(res).toEqual({ claimed: true, deliveryId: "d1" });
  });

  it("throws when the insert error is not a unique violation", async () => {
    const supabase = claimStub({ insertError: { code: "OTHER", message: "boom" }, existing: null });
    await expect(claimWeeklyDelivery(supabase as unknown as SupabaseClient, "u1", period, now)).rejects.toMatchObject({ code: "OTHER" });
  });

  it("returns not claimed when the existing decision is not retry", async () => {
    const existing = { id: "d1", status: "sent", attempted_at: now.toISOString(), error_code: null };
    const supabase = claimStub({ insertError: { code: "23505" }, existing });
    const res = await claimWeeklyDelivery(supabase as unknown as SupabaseClient, "u1", period, now);
    expect(res.claimed).toBe(false);
  });

  it("returns not claimed when the update returns no row", async () => {
    const stale = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const existing = { id: "d1", status: "processing", attempted_at: stale, error_code: null };
    const supabase = claimStub({ insertError: { code: "23505" }, existing, updated: null });
    const res = await claimWeeklyDelivery(supabase as unknown as SupabaseClient, "u1", period, now);
    expect(res.claimed).toBe(false);
  });

  it("markWeeklyDeliverySent, markWeeklyDeliverySkipped, markWeeklyDeliveryFailed succeed and throw on error", async () => {
    const ok = clientStub();
    await markWeeklyDeliverySent(ok as unknown as SupabaseClient, "u1", "d1", "msg", now);
    await markWeeklyDeliverySkipped(ok as unknown as SupabaseClient, "u1", "d1", "reason");
    await markWeeklyDeliveryFailed(ok as unknown as SupabaseClient, "u1", "d1", "smtp_550");

    const fail = clientStub({ weekly_report_deliveries: { error: { message: "boom" } } });
    await expect(markWeeklyDeliverySkipped(fail as unknown as SupabaseClient, "u1", "d1", "r")).rejects.toMatchObject({ message: "boom" });
    await expect(markWeeklyDeliveryFailed(fail as unknown as SupabaseClient, "u1", "d1", "c")).rejects.toMatchObject({ message: "boom" });
    await expect(markWeeklyDeliverySent(fail as unknown as SupabaseClient, "u1", "d1", "m", now)).rejects.toMatchObject({ message: "boom" });
  });
});
