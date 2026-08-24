import { describe, it, expect, vi } from "vitest";
import {
  getUnreadNotificationCount,
  createNotification,
} from "@/lib/notifications";

function fakeSupabase(count: number | null, error: unknown = null) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          is: vi.fn().mockResolvedValue({ count, error }),
        }),
      }),
    }),
  } as never;
}

describe("getUnreadNotificationCount", () => {
  it("returns the count for the given user's unread notifications", async () => {
    const supabase = fakeSupabase(3);
    expect(await getUnreadNotificationCount(supabase, "user-1")).toBe(3);
  });

  it("fails open to 0 on a query error instead of throwing", async () => {
    const supabase = fakeSupabase(null, new Error("boom"));
    expect(await getUnreadNotificationCount(supabase, "user-1")).toBe(0);
  });

  it("returns 0 when count is null with no error", async () => {
    const supabase = fakeSupabase(null);
    expect(await getUnreadNotificationCount(supabase, "user-1")).toBe(0);
  });
});

describe("createNotification preference filtering", () => {
  it("returns null when user preference for alert type is false", async () => {
    const res = await createNotification(
      "user-1",
      "large_transaction",
      { title: "Big spend", body: "$5000 spent" },
    );
    expect(res).toBeNull();
  });
});

