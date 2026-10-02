import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { clientStub } from "../fixtures/supabase-query";
let db = clientStub();
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => db }));
import { writeDailyAccountSnapshots } from "@/lib/account-history";
beforeEach(() => {
  vi.stubEnv("FUNDFLOW_FEATURE_FLAGS", "");
  db = clientStub({
    accounts: {
      data: [
        {
          id: "bank",
          available_balance: null,
          iso_currency_code: "USD",
          current_balance: 100,
        },
      ],
    },
  });
});
afterEach(() => vi.unstubAllEnvs());
it("writes the legacy snapshot shape and skips all quality RPCs with both flags off", async () => {
  await writeDailyAccountSnapshots("owner", "2026-10-01");
  const rows = db.writtenTo("account_balance_snapshots") as Record<
    string,
    unknown
  >[];
  expect(rows[0]).not.toHaveProperty("provenance");
  expect(db.rpc).not.toHaveBeenCalled();
});
it("processes missing observations for review and records explicit provenance only when enabled", async () => {
  vi.stubEnv(
    "FUNDFLOW_FEATURE_FLAGS",
    "balanceQualityReview,historyProvenance",
  );
  db = clientStub({
    accounts: {
      data: [
        {
          id: "bank",
          available_balance: null,
          iso_currency_code: "USD",
          current_balance: null,
        },
      ],
    },
  });
  await writeDailyAccountSnapshots("owner", "2026-10-01");
  expect(db.writtenTo("account_balance_snapshots")).toEqual([
    expect.objectContaining({
      user_id: "owner",
      account_id: "bank",
      available_balance: null,
      iso_currency_code: "USD",
      current_balance: null,
      provenance: "observed",
    }),
  ]);
  expect(db.callsOnRpc("balance_quality_context")).toEqual([
    [{ p_user_id: "owner", p_date: "2026-10-01" }],
  ]);
});
it("exposes failed quality processing to the cron after preserving the raw snapshot", async () => {
  vi.stubEnv("FUNDFLOW_FEATURE_FLAGS", "balanceQualityReview");
  db = clientStub({
    accounts: {
      data: [
        {
          id: "bank",
          available_balance: null,
          iso_currency_code: "USD",
          current_balance: 100,
        },
      ],
    },
    balance_quality_context: { error: "unavailable" },
  });
  await expect(writeDailyAccountSnapshots("owner", "2026-10-01")).rejects.toBe(
    "unavailable",
  );
  expect(db.writtenTo("account_balance_snapshots")).toEqual([
    expect.objectContaining({ current_balance: 100 }),
  ]);
});
