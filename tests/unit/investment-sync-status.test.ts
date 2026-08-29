import { describe, expect, it } from "vitest";
import { loadInvestmentSyncStatus } from "@/lib/investments-data";
import { clientStub } from "../fixtures/supabase-query";

describe("loadInvestmentSyncStatus", () => {
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