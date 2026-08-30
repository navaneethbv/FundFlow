import { describe, expect, it } from "vitest";
import { loadInvestmentSyncStatus } from "@/lib/investments-data";
import { clientStub } from "../fixtures/supabase-query";

describe("loadInvestmentSyncStatus", () => {
  it("reports the newest attempt and the newest actual success separately", async () => {
    const supabase = clientStub({
      plaid_items: { data: [{ id: "item-1", institution_name: "Fidelity" }] },
      sync_jobs: {
        data: [
          {
            id: "job-newest",
            plaid_item_id: "item-1",
            updated_at: "2026-08-29T10:00:00.000Z",
            status: "failed",
            last_error: "rate_limited",
          },
          {
            id: "job-success",
            plaid_item_id: "item-1",
            updated_at: "2026-08-28T10:00:00.000Z",
            status: "done",
            last_error: null,
          },
        ],
      },
    });

    const result = await loadInvestmentSyncStatus(supabase as never, "user-1");

    expect(result[0]).toMatchObject({
      lastAttemptAt: "2026-08-29T10:00:00.000Z",
      lastSuccessAt: "2026-08-28T10:00:00.000Z",
      outcome: "rate_limited",
    });
  });

  it("pages sync history without a silent 2000-row cap", async () => {
    const jobs = Array.from({ length: 2_001 }, (_, index) => ({
      id: `job-${String(index).padStart(4, "0")}`,
      plaid_item_id: index === 2_000 ? "item-1" : `other-${index}`,
      updated_at: new Date(Date.UTC(2026, 7, 29, 10, 0, 0) - index * 1_000).toISOString(),
      status: "done",
      last_error: null,
    }));
    const supabase = clientStub({
      plaid_items: { data: [{ id: "item-1", institution_name: "Fidelity" }] },
      sync_jobs: { data: jobs },
    });

    const result = await loadInvestmentSyncStatus(supabase as never, "user-1");

    expect(result[0].lastSuccessAt).toBe(jobs[2_000]!.updated_at);
    expect(
      supabase.callsOn("sync_jobs").filter((call) => call.method === "range"),
    ).toHaveLength(3);
    expect(
      supabase.callsOn("sync_jobs").some(
        (call) => call.method === "limit" && call.args[0] === 2000,
      ),
    ).toBe(false);
  });

  it("pages every visible institution instead of relying on the API row cap", async () => {
    const items = Array.from({ length: 1_001 }, (_, index) => ({
      id: `item-${index}`,
      institution_name: `Institution ${index}`,
    }));
    const supabase = clientStub({
      plaid_items: { data: items },
      sync_jobs: { data: [] },
    });

    const result = await loadInvestmentSyncStatus(supabase as never, "user-1");

    expect(result).toHaveLength(1_001);
    expect(
      supabase.callsOn("plaid_items").filter((call) => call.method === "range"),
    ).toEqual([
      { method: "range", args: [0, 999] },
      { method: "range", args: [1000, 1999] },
    ]);
  });

  it.each(["plaid_items", "sync_jobs"])(
    "throws when the %s query fails",
    async (failedTable) => {
      const supabase = clientStub({
        plaid_items: { data: [], error: failedTable === "plaid_items" ? new Error("items failed") : null },
        sync_jobs: { data: [], error: failedTable === "sync_jobs" ? new Error("jobs failed") : null },
      });

      await expect(
        loadInvestmentSyncStatus(supabase as never, "user-1"),
      ).rejects.toThrow(failedTable === "plaid_items" ? "items failed" : "jobs failed");
    },
  );

  it("scopes to the caller and reports per-item outcomes and staleness", async () => {
    const supabase = clientStub({
      plaid_items: {
        data: [{ id: "item-1", institution_name: "Fidelity" }],
      },
      sync_jobs: {
        data: [
          {
            plaid_item_id: "item-1",
            updated_at: "2026-08-29T10:00:00.000Z",
            status: "done",
            last_error: "product_not_ready",
          },
        ],
      },
    });
    const result = await loadInvestmentSyncStatus(supabase as never, "user-1");
    expect(supabase.scopedToUser("plaid_items", "user-1")).toBe(true);
    expect(supabase.scopedToUser("sync_jobs", "user-1")).toBe(true);
    expect(result[0]).toMatchObject({
      plaidItemId: "item-1",
      institutionName: "Fidelity",
      outcome: "product_not_ready",
      lastSuccessAt: null,
      lastAttemptAt: "2026-08-29T10:00:00.000Z",
    });
  });

  it("marks a recent full success as fresh and not stale", async () => {
    const now = new Date().toISOString();
    const supabase = clientStub({
      plaid_items: { data: [{ id: "item-1", institution_name: "Fidelity" }] },
      sync_jobs: {
        data: [
          {
            plaid_item_id: "item-1",
            updated_at: now,
            status: "done",
            last_error: null,
          },
        ],
      },
    });
    const result = await loadInvestmentSyncStatus(supabase as never, "user-1");
    expect(result[0].lastSuccessAt).toBeTruthy();
    expect(result[0].stale).toBe(false);
  });
});
