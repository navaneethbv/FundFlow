import { beforeEach, describe, expect, it, vi } from "vitest";
import { clientStub } from "../fixtures/supabase-query";

let serviceClient = clientStub();
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => serviceClient,
}));

import {
  shapeDailyAccountSnapshots,
  writeDailyAccountSnapshots,
} from "@/lib/account-history";

beforeEach(() => {
  serviceClient = clientStub();
});

describe("shapeDailyAccountSnapshots", () => {
  it("shapes Plaid and included manual balances with explicit ownership", () => {
    expect(
      shapeDailyAccountSnapshots({
        userId: "user-1",
        snapshotDate: "2026-07-29",
        capturedAt: "2026-07-29T12:00:00.000Z",
        plaidAccounts: [
          {
            id: "plaid-1",
            current_balance: "1250.50",
            available_balance: 1200,
            iso_currency_code: "usd",
          },
        ],
        manualAccounts: [
          {
            id: "manual-1",
            balance: "8000.25",
            include_in_net_worth: true,
          },
        ],
      }),
    ).toEqual([
      {
        user_id: "user-1",
        account_id: "plaid-1",
        manual_account_id: null,
        snapshot_date: "2026-07-29",
        current_balance: 1250.5,
        available_balance: 1200,
        iso_currency_code: "USD",
        captured_at: "2026-07-29T12:00:00.000Z",
      },
      {
        user_id: "user-1",
        account_id: null,
        manual_account_id: "manual-1",
        snapshot_date: "2026-07-29",
        current_balance: 8000.25,
        available_balance: null,
        iso_currency_code: "USD",
        captured_at: "2026-07-29T12:00:00.000Z",
      },
    ]);
  });

  it("omits null Plaid balances and excluded manual accounts", () => {
    expect(
      shapeDailyAccountSnapshots({
        userId: "user-1",
        snapshotDate: "2026-07-29",
        plaidAccounts: [
          {
            id: "plaid-null",
            current_balance: null,
            available_balance: 50,
            iso_currency_code: "CAD",
          },
        ],
        manualAccounts: [
          {
            id: "manual-excluded",
            balance: 20,
            include_in_net_worth: false,
          },
          {
            id: "manual-null",
            balance: null,
            include_in_net_worth: true,
          },
        ],
      }),
    ).toEqual([]);
  });

  it("falls back to USD when Plaid omits a currency", () => {
    const [row] = shapeDailyAccountSnapshots({
      userId: "user-1",
      snapshotDate: "2026-07-29",
      plaidAccounts: [
        {
          id: "plaid-1",
          current_balance: 10,
          available_balance: null,
          iso_currency_code: null,
        },
      ],
      manualAccounts: [],
    });

    expect(row?.iso_currency_code).toBe("USD");
  });

  it.each(["2026-7-29", "2026-02-30", "not-a-date"])(
    "rejects malformed snapshot date %s",
    (snapshotDate) => {
      expect(() =>
        shapeDailyAccountSnapshots({
          userId: "user-1",
          snapshotDate,
          plaidAccounts: [],
          manualAccounts: [],
        }),
      ).toThrow(RangeError);
    },
  );

  it("rejects a malformed currency instead of silently relabeling money", () => {
    expect(() =>
      shapeDailyAccountSnapshots({
        userId: "user-1",
        snapshotDate: "2026-07-29",
        plaidAccounts: [
          {
            id: "plaid-1",
            current_balance: 10,
            available_balance: null,
            iso_currency_code: "US",
          },
        ],
        manualAccounts: [],
      }),
    ).toThrow(RangeError);
  });

  it("rejects an invalid capture timestamp", () => {
    expect(() =>
      shapeDailyAccountSnapshots({
        userId: "user-1",
        snapshotDate: "2026-07-29",
        capturedAt: "not-a-timestamp",
        plaidAccounts: [],
        manualAccounts: [],
      }),
    ).toThrow(RangeError);
  });
});

describe("writeDailyAccountSnapshots", () => {
  it("reads both account sources with user scoping and upserts one batch", async () => {
    serviceClient = clientStub({
      accounts: {
        data: [
          {
            id: "plaid-1",
            current_balance: 100,
            available_balance: 90,
            iso_currency_code: "USD",
          },
        ],
      },
      manual_accounts: {
        data: [
          {
            id: "manual-1",
            balance: 50,
            include_in_net_worth: true,
          },
        ],
      },
      account_balance_snapshots: { error: null },
    });

    await expect(
      writeDailyAccountSnapshots("user-1", "2026-07-29"),
    ).resolves.toEqual({ written: 2, snapshotDate: "2026-07-29" });

    expect(serviceClient.scopedToUser("accounts", "user-1")).toBe(true);
    expect(serviceClient.scopedToUser("manual_accounts", "user-1")).toBe(true);
    expect(serviceClient.writtenTo("account_balance_snapshots")).toHaveLength(2);
    expect(serviceClient.callsOn("account_balance_snapshots")).toContainEqual({
      method: "upsert",
      args: [
        expect.any(Array),
        { onConflict: "account_id,manual_account_id,snapshot_date" },
      ],
    });
  });

  it("does not issue an empty upsert", async () => {
    serviceClient = clientStub({
      accounts: { data: [] },
      manual_accounts: { data: [] },
    });

    await expect(
      writeDailyAccountSnapshots("user-1", "2026-07-29"),
    ).resolves.toEqual({ written: 0, snapshotDate: "2026-07-29" });
    expect(serviceClient.callsOn("account_balance_snapshots")).toEqual([]);
  });

  it("throws a source read error", async () => {
    serviceClient = clientStub({
      accounts: { error: new Error("accounts unavailable") },
      manual_accounts: { data: [] },
    });

    await expect(
      writeDailyAccountSnapshots("user-1", "2026-07-29"),
    ).rejects.toThrow("accounts unavailable");
  });

  it("throws a snapshot write error", async () => {
    serviceClient = clientStub({
      accounts: {
        data: [
          {
            id: "plaid-1",
            current_balance: 100,
            available_balance: null,
            iso_currency_code: "USD",
          },
        ],
      },
      manual_accounts: { data: [] },
      account_balance_snapshots: { error: new Error("write unavailable") },
    });

    await expect(
      writeDailyAccountSnapshots("user-1", "2026-07-29"),
    ).rejects.toThrow("write unavailable");
  });
});

describe("tryWriteDailyAccountSnapshots", () => {
  it("swallows errors and logs context without throwing", async () => {
    const { tryWriteDailyAccountSnapshots } = await import("@/lib/account-history");
    serviceClient = clientStub({
      accounts: { error: new Error("DB offline") },
    });
    await expect(tryWriteDailyAccountSnapshots("user-1", "test.context")).resolves.toBeUndefined();
  });
});
