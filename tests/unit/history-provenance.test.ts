import { describe, it, expect, vi, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { historyProvenance } from "@/lib/history-provenance";
import { recordEstimatedAccountHistory } from "@/lib/history-provenance-writer";
import { shapeDailyAccountSnapshots } from "@/lib/account-history";
import { clientStub } from "../fixtures/supabase-query";
afterEach(() => vi.unstubAllEnvs());
const input = {
  userId: "owner",
  accountId: "account",
  manualAccountId: null,
  date: "2026-01-01",
  balance: 12,
  currency: "USD",
};
describe("history source", () => {
  it("derives legacy source without calling an estimate observed", () => {
    expect(historyProvenance(null, null)).toBe("observed");
    expect(historyProvenance(null, "manual")).toBe("manual");
    expect(historyProvenance("estimated", "manual")).toBe("estimated");
  });
  it("records provider and manual sources only when requested", () => {
    const source = {
      userId: "owner",
      snapshotDate: "2026-10-01",
      plaidAccounts: [
        {
          id: "bank",
          current_balance: 100,
          available_balance: null,
          iso_currency_code: "USD",
        },
      ],
      manualAccounts: [
        { id: "manual", balance: 10, include_in_net_worth: true },
      ],
    };
    expect(
      shapeDailyAccountSnapshots(source).every(
        (row) => row.provenance === undefined,
      ),
    ).toBe(true);
    expect(
      shapeDailyAccountSnapshots({ ...source, recordProvenance: true }).map(
        (row) => row.provenance,
      ),
    ).toEqual(["observed", "manual"]);
    expect(
      shapeDailyAccountSnapshots({
        ...source,
        includeMissingBalances: true,
        plaidAccounts: [{ ...source.plaidAccounts[0]!, current_balance: null }],
      })[0]!.current_balance,
    ).toBeNull();
  });
  it("skips the new writer when disabled", async () => {
    vi.stubEnv("FUNDFLOW_FEATURE_FLAGS", "");
    const db = clientStub();
    expect(
      await recordEstimatedAccountHistory(
        db as unknown as SupabaseClient,
        input,
      ),
    ).toBe(false);
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it.each([true, false])(
    "reports whether the estimate was stored (%s)",
    async (accepted) => {
      vi.stubEnv("FUNDFLOW_FEATURE_FLAGS", "historyProvenance");
      const db = clientStub({
        record_estimated_account_history: { data: accepted },
      });
      expect(
        await recordEstimatedAccountHistory(
          db as unknown as SupabaseClient,
          input,
        ),
      ).toBe(accepted);
      expect(db.callsOnRpc("record_estimated_account_history")).toEqual([
        [
          {
            p_user_id: "owner",
            p_account_id: "account",
            p_manual_account_id: null,
            p_date: input.date,
            p_balance: 12,
            p_currency: "USD",
          },
        ],
      ]);
    },
  );
  it("propagates persistence failure", async () => {
    vi.stubEnv("FUNDFLOW_FEATURE_FLAGS", "historyProvenance");
    const db = clientStub({
      record_estimated_account_history: { error: new Error("denied") },
    });
    await expect(
      recordEstimatedAccountHistory(db as unknown as SupabaseClient, input),
    ).rejects.toThrow("denied");
  });
});
