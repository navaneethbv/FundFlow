import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  deriveCursorHealth,
  recordCursorAttempt,
  recordCursorSuccess,
  recordCursorFailure,
  recordCursorPartialSuccess,
  type CursorHealthInput,
} from "@/lib/cursor-health";
import { clientStub } from "../fixtures/supabase-query";

const NOW = new Date("2026-08-29T12:00:00.000Z");

function input(overrides: Partial<CursorHealthInput> = {}): CursorHealthInput {
  return {
    plaidItemId: "",
    itemStatus: "active",
    itemErrorCode: null,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastSyncCompletedPages: false,
    initialHistoryIncomplete: false,
    cursorResetDetectedAt: null,
    now: NOW,
    ...overrides,
  };
}

describe("deriveCursorHealth", () => {
  it("reports never_synced when no attempt exists", () => {
    expect(deriveCursorHealth(input())).toEqual({
      plaidItemId: "",
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastSyncCompletedPages: false,
      initialHistoryIncomplete: false,
      cursorResetDetectedAt: null,
      safeErrorCode: null,
      state: "never_synced",
    });
  });

  it("reports healthy when the last sync drained every page", () => {
    expect(
      deriveCursorHealth(
        input({
          lastAttemptAt: "2026-08-29T11:00:00.000Z",
          lastSuccessAt: "2026-08-29T11:00:00.000Z",
          lastSyncCompletedPages: true,
        }),
      ).state,
    ).toBe("healthy");
  });

  it("reports partial_page when the last sync stopped before has_more=false", () => {
    expect(
      deriveCursorHealth(
        input({
          lastAttemptAt: "2026-08-29T11:00:00.000Z",
          lastSuccessAt: "2026-08-29T11:00:00.000Z",
          lastSyncCompletedPages: false,
        }),
      ).state,
    ).toBe("partial_page");
  });

  it("reports backfill_incomplete when the initial history never fully backfilled", () => {
    expect(
      deriveCursorHealth(
        input({
          lastAttemptAt: "2026-08-29T11:00:00.000Z",
          lastSuccessAt: "2026-08-29T11:00:00.000Z",
          lastSyncCompletedPages: false,
          initialHistoryIncomplete: true,
        }),
      ).state,
    ).toBe("backfill_incomplete");
  });

  it("reports cursor_reset when an established cursor was cleared", () => {
    expect(
      deriveCursorHealth(
        input({
          lastAttemptAt: "2026-08-29T11:00:00.000Z",
          lastSuccessAt: "2026-08-29T11:00:00.000Z",
          lastSyncCompletedPages: true,
          cursorResetDetectedAt: "2026-08-29T10:00:00.000Z",
        }),
      ).state,
    ).toBe("cursor_reset");
  });

  it("reports failed for a non-active item", () => {
    expect(
      deriveCursorHealth(
        input({
          itemStatus: "error",
          itemErrorCode: "ITEM_LOGIN_REQUIRED",
          lastAttemptAt: "2026-08-29T11:00:00.000Z",
        }),
      ),
    ).toMatchObject({ state: "failed", safeErrorCode: "ITEM_LOGIN_REQUIRED" });
  });

  it("reports failed when an attempt exists but no success was recorded", () => {
    expect(
      deriveCursorHealth(
        input({
          lastAttemptAt: "2026-08-29T11:00:00.000Z",
        }),
      ).state,
    ).toBe("failed");
  });

  it("does not expose arbitrary stored error text", () => {
    expect(
      deriveCursorHealth(
        input({
          itemStatus: "error",
          itemErrorCode: "token=secret customer@example.com",
        }),
      ),
    ).toMatchObject({ state: "failed", safeErrorCode: null });
  });

  it("carries the plaid item id through", () => {
    expect(deriveCursorHealth(input({ plaidItemId: "item-1" })).plaidItemId).toBe(
      "item-1",
    );
  });
});

describe("recordCursor* persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("records the attempt scoped to the owning user and item", async () => {
    const supabase = clientStub({});
    await recordCursorAttempt(supabase as never, {
      userId: "user-1",
      itemDbId: "item-1",
      nowIso: "2026-08-29T11:00:00.000Z",
    });
    expect(supabase.scopedToUser("plaid_items", "user-1")).toBe(true);
    const written = supabase.writtenTo("plaid_items") as {
      last_sync_attempt_at: string;
    };
    expect(written.last_sync_attempt_at).toBe("2026-08-29T11:00:00.000Z");
  });

  it("records a full success and clears incomplete-history flags", async () => {
    const supabase = clientStub({});
    await recordCursorSuccess(supabase as never, {
      userId: "user-1",
      itemDbId: "item-1",
      nowIso: "2026-08-29T11:05:00.000Z",
    });
    expect(supabase.scopedToUser("plaid_items", "user-1")).toBe(true);
    const written = supabase.writtenTo("plaid_items") as Record<string, unknown>;
    expect(written.last_sync_success_at).toBe("2026-08-29T11:05:00.000Z");
    expect(written.last_sync_completed_pages).toBe(true);
    expect(written.initial_history_incomplete).toBe(false);
    expect(written.cursor_reset_detected_at).toBeNull();
  });

  it("records an incomplete initial-history failure", async () => {
    const supabase = clientStub({});
    await recordCursorFailure(supabase as never, {
      userId: "user-1",
      itemDbId: "item-1",
      startedWithoutCursor: true,
      priorSuccess: false,
      nowIso: "2026-08-29T11:00:00.000Z",
    });
    const written = supabase.writtenTo("plaid_items") as Record<string, unknown>;
    expect(written.last_sync_completed_pages).toBe(false);
    expect(written.initial_history_incomplete).toBe(true);
    expect(written.cursor_reset_detected_at).toBeNull();
  });

  it("records a cursor reset when a prior-success item starts with no cursor", async () => {
    const supabase = clientStub({});
    await recordCursorFailure(supabase as never, {
      userId: "user-1",
      itemDbId: "item-1",
      startedWithoutCursor: true,
      priorSuccess: true,
      nowIso: "2026-08-29T11:00:00.000Z",
    });
    const written = supabase.writtenTo("plaid_items") as Record<string, unknown>;
    expect(written.last_sync_completed_pages).toBe(false);
    expect(written.initial_history_incomplete).toBe(true);
    expect(written.cursor_reset_detected_at).toBe("2026-08-29T11:00:00.000Z");
  });

  it("does not clear durable incomplete-history facts on a later failed run", async () => {
    const supabase = clientStub({});
    await recordCursorFailure(supabase as never, {
      userId: "user-1",
      itemDbId: "item-1",
      startedWithoutCursor: false,
      priorSuccess: true,
      nowIso: "2026-08-29T11:00:00.000Z",
    });
    const written = supabase.writtenTo("plaid_items") as Record<string, unknown>;
    expect(written.last_sync_completed_pages).toBe(false);
    expect(written).not.toHaveProperty("initial_history_incomplete");
    expect(written).not.toHaveProperty("cursor_reset_detected_at");
  });

  it("does not clear durable incomplete-history facts on a later partial success", async () => {
    const supabase = clientStub({});
    await recordCursorPartialSuccess(supabase as never, {
      userId: "user-1",
      itemDbId: "item-1",
      startedWithoutCursor: false,
      priorSuccess: true,
      nowIso: "2026-08-29T11:00:00.000Z",
    });
    const written = supabase.writtenTo("plaid_items") as Record<string, unknown>;
    expect(written.last_sync_completed_pages).toBe(false);
    expect(written.last_sync_success_at).toBe("2026-08-29T11:00:00.000Z");
    expect(written).not.toHaveProperty("initial_history_incomplete");
    expect(written).not.toHaveProperty("cursor_reset_detected_at");
  });
});
