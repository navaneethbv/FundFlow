import { describe, expect, it } from "vitest";
import {
  classifyDeliveryClaim,
  claimWeeklyDelivery,
  markWeeklyDeliverySent,
  markWeeklyDeliveryFailed,
} from "@/lib/report-delivery";
import { clientStub } from "../fixtures/supabase-query";

describe("report-delivery", () => {
  it("classifies delivery claim decisions correctly", () => {
    const now = new Date("2026-07-15T12:00:00Z");
    expect(classifyDeliveryClaim(null, now)).toBe("claim");
    expect(classifyDeliveryClaim({ status: "sent", attemptedAt: now.toISOString() }, now)).toBe(
      "skip",
    );
    expect(classifyDeliveryClaim({ status: "failed", attemptedAt: now.toISOString() }, now)).toBe(
      "retry",
    );
    expect(classifyDeliveryClaim({ status: "unknown", attemptedAt: now.toISOString() }, now)).toBe(
      "skip",
    );
    expect(
      classifyDeliveryClaim(
        { status: "processing", attemptedAt: new Date("2026-07-15T10:00:00Z").toISOString() },
        now,
      ),
    ).toBe("retry");
  });

  it("claims delivery when insert succeeds", async () => {
    const supabase = clientStub({
      weekly_report_deliveries: { data: { id: "del-1" } },
    });
    const period = { start: "2026-07-06", end: "2026-07-12", previousStart: "", previousEnd: "" };

    const res = await claimWeeklyDelivery(
      supabase as never,
      "user-1",
      period,
      new Date("2026-07-15T12:00:00Z"),
    );

    expect(res.claimed).toBe(true);
    expect(res.deliveryId).toBe("del-1");
  });

  it("marks delivery as sent or failed", async () => {
    const supabase = clientStub({
      weekly_report_deliveries: { data: {} },
    });

    await markWeeklyDeliverySent(
      supabase as never,
      "user-1",
      "del-1",
      "msg-123",
      new Date("2026-07-15T12:00:00Z"),
    );
    await markWeeklyDeliveryFailed(supabase as never, "user-1", "del-1", "ERR_SMTP");
    expect(supabase.writtenTo("weekly_report_deliveries")).toEqual({
      status: "sent",
      provider_message_id: "msg-123",
      sent_at: "2026-07-15T12:00:00.000Z",
      error_code: null,
    });
  });

  it("handles conflict retry in claimWeeklyDelivery and throws query errors", async () => {
    const period = { start: "2026-07-06", end: "2026-07-12", previousStart: "", previousEnd: "" };
    const now = new Date("2026-07-15T12:00:00Z");

    const mockInsert = () => ({
      select: () => ({
        single: () => Promise.resolve({ data: null, error: { code: "23505" } }),
      }),
    });

    const mockSelect = () => ({
      eq: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({
            data: { id: "del-1", status: "failed", attempted_at: "2026-07-15T10:00:00Z" },
            error: null,
          }),
        }),
      }),
    });
    const mockUpdate = () => ({
      eq: () => ({
        eq: () => ({
          eq: () => ({
            select: () => ({
              maybeSingle: () => Promise.resolve({ data: { id: "del-1" }, error: null }),
            }),
          }),
        }),
      }),
    });

    const supabaseRetry = {
      from: (table: string) => {
        if (table === "weekly_report_deliveries") {
          return { insert: mockInsert, select: mockSelect, update: mockUpdate };
        }
        return {};
      },
    };

    const res = await claimWeeklyDelivery(supabaseRetry as never, "user-1", period, now);
    expect(res.claimed).toBe(true);
    expect(res.deliveryId).toBe("del-1");
  });

  it("returns not claimed when existing row is null after conflict", async () => {
    const period = { start: "2026-07-06", end: "2026-07-12", previousStart: "", previousEnd: "" };
    const now = new Date("2026-07-15T12:00:00Z");

    const supabase = {
      from: () => ({
        insert: () => ({
          select: () => ({
            single: () => Promise.resolve({ data: null, error: { code: "23505" } }),
          }),
        }),
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
        }),
      }),
    };

    const res = await claimWeeklyDelivery(supabase as never, "user-1", period, now);
    expect(res.claimed).toBe(false);
  });

  it("throws when update errors in claimWeeklyDelivery", async () => {
    const period = { start: "2026-07-06", end: "2026-07-12", previousStart: "", previousEnd: "" };
    const now = new Date("2026-07-15T12:00:00Z");

    const supabase = {
      from: () => ({
        insert: () => ({
          select: () => ({
            single: () => Promise.resolve({ data: null, error: { code: "23505" } }),
          }),
        }),
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { id: "del-1", status: "failed", attempted_at: "2026-07-15T10:00:00Z" },
                  error: null,
                }),
            }),
          }),
        }),
        update: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                select: () => ({
                  maybeSingle: () =>
                    Promise.resolve({ data: null, error: { message: "update failed" } }),
                }),
              }),
            }),
          }),
        }),
      }),
    };

    await expect(
      claimWeeklyDelivery(supabase as never, "user-1", period, now),
    ).rejects.toEqual({ message: "update failed" });
  });

  it("throws when existingError is returned from select after conflict", async () => {
    const period = { start: "2026-07-06", end: "2026-07-12", previousStart: "", previousEnd: "" };
    const now = new Date("2026-07-15T12:00:00Z");

    const supabase = {
      from: () => ({
        insert: () => ({
          select: () => ({
            single: () => Promise.resolve({ data: null, error: { code: "23505" } }),
          }),
        }),
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: null, error: { message: "select failed" } }),
            }),
          }),
        }),
      }),
    };

    await expect(
      claimWeeklyDelivery(supabase as never, "user-1", period, now),
    ).rejects.toEqual({ message: "select failed" });
  });

  it("throws when markWeeklyDeliverySent encounters an error", async () => {
    const supabase = {
      from: () => ({
        update: () => ({
          eq: () => ({
            eq: () => Promise.resolve({ error: { message: "sent error" } }),
          }),
        }),
      }),
    };

    await expect(
      markWeeklyDeliverySent(supabase as never, "user-1", "del-1", "msg-1", new Date()),
    ).rejects.toEqual({ message: "sent error" });
  });

  it("throws when markWeeklyDeliveryFailed encounters an error", async () => {
    const supabase = {
      from: () => ({
        update: () => ({
          eq: () => ({
            eq: () => Promise.resolve({ error: { message: "fail error" } }),
          }),
        }),
      }),
    };

    await expect(
      markWeeklyDeliveryFailed(supabase as never, "user-1", "del-1", "ERR_SMTP"),
    ).rejects.toEqual({ message: "fail error" });
  });
});
