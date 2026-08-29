import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runItemRepair } from "@/lib/repair";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: () => Promise.resolve(body) };
}

describe("runItemRepair", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts to the repair route with the item id", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, status: "repaired", added: 4, modified: 1, removed: 0 }));
    const state = await runItemRepair("item-1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/plaid/repair",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: "item-1" }),
      }),
    );
    expect(state.kind).toBe("success");
    expect(state.message).toContain("4 added");
  });

  it("maps a bounded backfill to a retry-able state with progress", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        ok: true,
        status: "backfill_incomplete",
        pagesCompleted: 5,
        maxPages: 8,
        completed: false,
        added: 40,
        modified: 0,
        removed: 0,
      }),
    );
    const state = await runItemRepair("item-1");
    expect(state.kind).toBe("backfill_incomplete");
    expect(state.retry).toBe(true);
    expect(state.message).toContain("5 of 8");
  });

  it("surfaces a provider-conditional reconnect message", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { ok: false, status: "institution_login_required", message: "Your bank requires you to log in again." },
        false,
      ),
    );
    const state = await runItemRepair("item-1");
    expect(state.kind).toBe("needs_login");
    expect(state.reconnect).toBe(true);
    expect(state.message).toContain("log in again");
  });

  it("collapses network failures to a retryable error state", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const state = await runItemRepair("item-1");
    expect(state.kind).toBe("error");
    expect(state.retry).toBe(true);
  });
});