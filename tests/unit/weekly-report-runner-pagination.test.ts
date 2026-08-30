import { beforeEach, describe, expect, it, vi } from "vitest";

const profileRows = Array.from({ length: 1_001 }, (_, index) => ({
  id: `user-${String(index).padStart(4, "0")}`,
  timezone: "UTC",
}));
const range = vi.fn();

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table !== "profiles") throw new Error(`Unexpected table ${table}`);
      const query = {
        select: vi.fn(),
        eq: vi.fn(),
        in: vi.fn(),
        order: vi.fn(),
        range,
      };
      query.select.mockReturnValue(query);
      query.eq.mockReturnValue(query);
      query.in.mockReturnValue(query);
      query.order.mockReturnValue(query);
      range.mockImplementation((from: number, to: number) =>
        Promise.resolve({ data: profileRows.slice(from, to + 1), error: null }),
      );
      return query;
    },
  }),
}));

vi.mock("@/lib/report-period", () => ({
  getWeeklyReportPeriod: vi.fn(),
  isWeeklyReportDue: () => false,
  normalizeReportTimezone: () => "UTC",
}));
vi.mock("@/lib/report-delivery", () => ({
  claimWeeklyDelivery: vi.fn(),
  markWeeklyDeliveryFailed: vi.fn(),
  markWeeklyDeliverySent: vi.fn(),
  markWeeklyDeliverySkipped: vi.fn(),
}));
vi.mock("@/lib/weekly-report-data", () => ({ getWeeklyReportData: vi.fn() }));
vi.mock("@/lib/report-pdf", () => ({ generateWeeklyReportPdf: vi.fn() }));
vi.mock("@/lib/reporting", () => ({ sendWeeklyReportEmail: vi.fn() }));
vi.mock("@/lib/env.server", () => ({ serverEnv: {} }));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));

import { runWeeklyReports } from "@/lib/weekly-report-runner";

describe("runWeeklyReports pagination", () => {
  beforeEach(() => {
    range.mockClear();
  });

  it("loads every enabled profile with stable pages", async () => {
    const result = await runWeeklyReports(new Date("2026-08-30T00:00:00.000Z"));

    expect(result.users).toBe(1_001);
    expect(range).toHaveBeenNthCalledWith(1, 0, 999);
    expect(range).toHaveBeenNthCalledWith(2, 1000, 1999);
  });
});
