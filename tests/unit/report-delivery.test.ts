import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  classifyDeliveryClaim,
  claimWeeklyDelivery,
  markWeeklyDeliverySent,
  markWeeklyDeliveryFailed,
} from "@/lib/report-delivery";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("weekly report delivery claims", () => {
  const now = new Date("2026-07-13T15:15:00.000Z");
  const period = {
    start: "2026-07-06",
    end: "2026-07-12",
    previousStart: "2026-06-29",
    previousEnd: "2026-07-05",
    label: "Jul 6 - 12",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  describe("claimWeeklyDelivery DB operations", () => {
    it("successfully inserts processing row on first claim", async () => {
      const single = vi.fn().mockResolvedValue({ data: { id: "delivery-1" }, error: null });
      const select = vi.fn().mockReturnValue({ single });
      const insert = vi.fn().mockReturnValue({ select });
      const from = vi.fn().mockReturnValue({ insert });

      const mockSupabase = { from } as unknown as SupabaseClient;

      const result = await claimWeeklyDelivery(mockSupabase, "user-1", period, now);
      expect(result).toEqual({ claimed: true, deliveryId: "delivery-1" });
    });

    it("handles conflict (code 23505) and retries when status is failed", async () => {
      const singleInsert = vi.fn().mockResolvedValue({
        data: null,
        error: { code: "23505", message: "duplicate" },
      });
      const selectInsert = vi.fn().mockReturnValue({ single: singleInsert });
      const insert = vi.fn().mockReturnValue({ select: selectInsert });

      const maybeSingleExisting = vi.fn().mockResolvedValue({
        data: { id: "delivery-1", status: "failed", attempted_at: "2026-07-13T10:00:00.000Z" },
        error: null,
      });
      const eqStart = vi.fn().mockReturnValue({ maybeSingle: maybeSingleExisting });
      const eqUser = vi.fn().mockReturnValue({ eq: eqStart });
      const selectExisting = vi.fn().mockReturnValue({ eq: eqUser });

      const maybeSingleUpdate = vi.fn().mockResolvedValue({
        data: { id: "delivery-1" },
        error: null,
      });
      const selectUpdate = vi.fn().mockReturnValue({ maybeSingle: maybeSingleUpdate });
      const eqAttempted = vi.fn().mockReturnValue({ select: selectUpdate });
      const eqUserUpdate = vi.fn().mockReturnValue({ eq: eqAttempted });
      const eqIdUpdate = vi.fn().mockReturnValue({ eq: eqUserUpdate });
      const update = vi.fn().mockReturnValue({ eq: eqIdUpdate });

      const from = vi.fn().mockImplementation((table: string) => {
        if (table === "weekly_report_deliveries") {
          return { insert, select: selectExisting, update };
        }
        throw new Error(`Unexpected table ${table}`);
      });

      const mockSupabase = { from } as unknown as SupabaseClient;

      const result = await claimWeeklyDelivery(mockSupabase, "user-1", period, now);
      expect(result).toEqual({ claimed: true, deliveryId: "delivery-1" });
    });

    it("returns claimed: false when existing delivery is active and skip decision is made", async () => {
      const singleInsert = vi.fn().mockResolvedValue({
        data: null,
        error: { code: "23505", message: "duplicate" },
      });
      const selectInsert = vi.fn().mockReturnValue({ single: singleInsert });
      const insert = vi.fn().mockReturnValue({ select: selectInsert });

      const maybeSingleExisting = vi.fn().mockResolvedValue({
        data: { id: "delivery-1", status: "sent", attempted_at: now.toISOString() },
        error: null,
      });
      const eqStart = vi.fn().mockReturnValue({ maybeSingle: maybeSingleExisting });
      const eqUser = vi.fn().mockReturnValue({ eq: eqStart });
      const selectExisting = vi.fn().mockReturnValue({ eq: eqUser });

      const from = vi.fn().mockImplementation((table: string) => {
        if (table === "weekly_report_deliveries") {
          return { insert, select: selectExisting };
        }
        throw new Error(`Unexpected table ${table}`);
      });

      const mockSupabase = { from } as unknown as SupabaseClient;

      const result = await claimWeeklyDelivery(mockSupabase, "user-1", period, now);
      expect(result).toEqual({ claimed: false });
    });
  });

  describe("markWeeklyDeliverySent and markWeeklyDeliveryFailed", () => {
    it("markWeeklyDeliverySent updates status to sent", async () => {
      const eqUser = vi.fn().mockResolvedValue({ error: null });
      const eqId = vi.fn().mockReturnValue({ eq: eqUser });
      const update = vi.fn().mockReturnValue({ eq: eqId });

      const mockSupabase = {
        from: vi.fn().mockReturnValue({ update }),
      } as unknown as SupabaseClient;

      await markWeeklyDeliverySent(mockSupabase, "user-1", "del-1", "msg-123", now);
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "sent",
          provider_message_id: "msg-123",
        }),
      );
    });

    it("markWeeklyDeliveryFailed updates status to failed and truncates error code", async () => {
      const eqUser = vi.fn().mockResolvedValue({ error: null });
      const eqId = vi.fn().mockReturnValue({ eq: eqUser });
      const update = vi.fn().mockReturnValue({ eq: eqId });

      const mockSupabase = {
        from: vi.fn().mockReturnValue({ update }),
      } as unknown as SupabaseClient;

      const longError = "ERR_".padEnd(100, "X");
      await markWeeklyDeliveryFailed(mockSupabase, "user-1", "del-1", longError);
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "failed",
          error_code: longError.slice(0, 80),
        }),
      );
    });
  });
});
