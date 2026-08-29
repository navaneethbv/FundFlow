import { describe, expect, it } from "vitest";
import { loadLatestWeeklyDelivery } from "@/lib/weekly-delivery-history";
import { clientStub } from "../fixtures/supabase-query";

describe("loadLatestWeeklyDelivery", () => {
  it("returns the newest delivery scoped to the caller", async () => {
    const supabase = clientStub({
      weekly_report_deliveries: {
        data: [
          { period_start: "2026-08-17", period_end: "2026-08-23", status: "sent", attempted_at: "2026-08-24T08:00:00Z", sent_at: "2026-08-24T08:00:01Z" },
        ],
      },
    });
    const result = await loadLatestWeeklyDelivery(supabase as never, "user-1");
    expect(supabase.scopedToUser("weekly_report_deliveries", "user-1")).toBe(true);
    expect(result).toMatchObject({ status: "sent", periodStart: "2026-08-17" });
  });

  it("returns null when no delivery has been recorded", async () => {
    const supabase = clientStub({ weekly_report_deliveries: { data: [] } });
    expect(await loadLatestWeeklyDelivery(supabase as never, "user-1")).toBeNull();
  });
});