import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import {
  POST as allocationPost,
  DELETE as allocationDelete,
} from "@/app/api/goals/accounts/route";
import {
  POST as eventPost,
  DELETE as eventDelete,
} from "@/app/api/goals/events/route";
import { writeAudit } from "@/lib/audit";
import { requireUser } from "@/lib/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { clientStub, type QueryResult } from "../fixtures/supabase-query";

vi.mock("@/lib/http", async () => {
  const actual = await vi.importActual<typeof import("@/lib/http")>("@/lib/http");
  return { ...actual, requireUser: vi.fn() };
});
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(), getClientIp: vi.fn(() => null) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn() }));

const GOAL_ID = "11111111-1111-1111-1111-111111111111";
const ACCOUNT_ID = "22222222-2222-2222-2222-222222222222";
const EVENT_ID = "33333333-3333-3333-3333-333333333333";

/** clientStub has no `rpc`; allocations go through one, so add it here. */
function goalClient(
  seeds: Record<string, QueryResult>,
  rpcResult: { data?: unknown; error?: { message: string } | null } = {
    data: "alloc-1",
    error: null,
  },
) {
  const base = clientStub(seeds);
  return Object.assign(base, { rpc: vi.fn(async () => rpcResult) });
}

function jsonReq(url: string, method: string, body: unknown) {
  return new NextRequest(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function authWith(supabase: unknown) {
  vi.mocked(requireUser).mockResolvedValue({
    user: { id: "user-1", email: "test@example.com" },
    supabase: supabase as never,
  } as never);
}

const ALLOCATION_URL = "http://localhost/api/goals/accounts";
const EVENTS_URL = "http://localhost/api/goals/events";

describe("goal allocation route", () => {
  let client: ReturnType<typeof goalClient>;

  function seedOwned(extra: Record<string, QueryResult> = {}) {
    return goalClient({
      goals: { data: { id: GOAL_ID, goal_type: "save_up", starting_balance: null } },
      accounts: { data: { id: ACCOUNT_ID, type: "depository", current_balance: 5000 } },
      ...extra,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimit).mockResolvedValue(true);
    client = seedOwned();
    authWith(client);
  });

  it("requires both ids", async () => {
    expect(
      (await allocationPost(jsonReq(ALLOCATION_URL, "POST", { accountId: ACCOUNT_ID })))
        .status,
    ).toBe(400);
    expect(
      (await allocationPost(jsonReq(ALLOCATION_URL, "POST", { goalId: GOAL_ID })))
        .status,
    ).toBe(400);
  });

  it("rejects a fixed allocation with no positive amount", async () => {
    for (const allocatedAmount of [undefined, 0, -5, "100"]) {
      const response = await allocationPost(
        jsonReq(ALLOCATION_URL, "POST", {
          goalId: GOAL_ID,
          accountId: ACCOUNT_ID,
          allocatedAmount,
        }),
      );
      expect(response.status).toBe(400);
    }
  });

  it("rejects an amount alongside an entire-balance claim", async () => {
    const response = await allocationPost(
      jsonReq(ALLOCATION_URL, "POST", {
        goalId: GOAL_ID,
        accountId: ACCOUNT_ID,
        useEntireBalance: true,
        allocatedAmount: 100,
      }),
    );
    expect(response.status).toBe(400);
  });

  it("404s a goal the caller does not own", async () => {
    client = goalClient({
      goals: { data: null },
      accounts: { data: { id: ACCOUNT_ID, type: "depository", current_balance: 10 } },
    });
    authWith(client);
    const response = await allocationPost(
      jsonReq(ALLOCATION_URL, "POST", {
        goalId: GOAL_ID,
        accountId: ACCOUNT_ID,
        allocatedAmount: 5,
      }),
    );
    expect(response.status).toBe(404);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("404s an account the caller does not own", async () => {
    client = goalClient({
      goals: { data: { id: GOAL_ID, goal_type: "save_up", starting_balance: null } },
      accounts: { data: null },
    });
    authWith(client);
    const response = await allocationPost(
      jsonReq(ALLOCATION_URL, "POST", {
        goalId: GOAL_ID,
        accountId: ACCOUNT_ID,
        allocatedAmount: 5,
      }),
    );
    expect(response.status).toBe(404);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("scopes both ownership checks to the caller", async () => {
    await allocationPost(
      jsonReq(ALLOCATION_URL, "POST", {
        goalId: GOAL_ID,
        accountId: ACCOUNT_ID,
        allocatedAmount: 500,
      }),
    );
    expect(client.scopedToUser("goals", "user-1")).toBe(true);
    expect(client.scopedToUser("accounts", "user-1")).toBe(true);
  });

  it("delegates the cross-row rules to the locking database function", async () => {
    const response = await allocationPost(
      jsonReq(ALLOCATION_URL, "POST", {
        goalId: GOAL_ID,
        accountId: ACCOUNT_ID,
        allocatedAmount: 500.005,
      }),
    );
    expect(response.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledWith("set_goal_allocation", {
      p_goal_id: GOAL_ID,
      p_account_id: ACCOUNT_ID,
      // Rounded to the cent, so the stored value matches what was checked.
      p_allocated_amount: 500.01,
      p_use_entire_balance: false,
    });
  });

  it("turns a function rule violation into a 409 with its own message", async () => {
    client = goalClient(
      {
        goals: { data: { id: GOAL_ID, goal_type: "save_up", starting_balance: null } },
        accounts: { data: { id: ACCOUNT_ID, type: "depository", current_balance: 100 } },
      },
      { data: null, error: { message: 'unexpected: allocation_exceeds_balance' } },
    );
    authWith(client);
    const response = await allocationPost(
      jsonReq(ALLOCATION_URL, "POST", {
        goalId: GOAL_ID,
        accountId: ACCOUNT_ID,
        allocatedAmount: 500,
      }),
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "allocation_exceeds_balance",
      error: expect.stringContaining("more than this account"),
    });
  });

  it("surfaces an unrecognised database failure as a 500, not a 409", async () => {
    client = goalClient(
      {
        goals: { data: { id: GOAL_ID, goal_type: "save_up", starting_balance: null } },
        accounts: { data: { id: ACCOUNT_ID, type: "depository", current_balance: 100 } },
      },
      { data: null, error: { message: "connection reset" } },
    );
    authWith(client);
    const response = await allocationPost(
      jsonReq(ALLOCATION_URL, "POST", {
        goalId: GOAL_ID,
        accountId: ACCOUNT_ID,
        allocatedAmount: 50,
      }),
    );
    expect(response.status).toBe(500);
  });

  it("captures the pay-down baseline on the first liability link", async () => {
    client = goalClient({
      goals: { data: { id: GOAL_ID, goal_type: "pay_down", starting_balance: null, target_amount: 0 } },
      accounts: { data: { id: ACCOUNT_ID, type: "credit", current_balance: 4200 } },
    });
    authWith(client);
    const response = await allocationPost(
      jsonReq(ALLOCATION_URL, "POST", {
        goalId: GOAL_ID,
        accountId: ACCOUNT_ID,
        useEntireBalance: true,
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ baselineCaptured: true });
    expect(client.writtenTo("goals")).toEqual({
      starting_balance: 4200,
      target_balance: 0,
    });
  });

  it("mirrors an entered payoff amount into target_balance on baseline capture", async () => {
    client = goalClient({
      goals: { data: { id: GOAL_ID, goal_type: "pay_down", starting_balance: null, target_amount: 5000 } },
      accounts: { data: { id: ACCOUNT_ID, type: "credit", current_balance: 12000 } },
    });
    authWith(client);
    const response = await allocationPost(
      jsonReq(ALLOCATION_URL, "POST", {
        goalId: GOAL_ID,
        accountId: ACCOUNT_ID,
        useEntireBalance: true,
      }),
    );

    await expect(response.json()).resolves.toMatchObject({ baselineCaptured: true });
    // Paying off 5,000 of a 12,000 balance leaves 7,000 as the target balance,
    // so the row's target_balance mirrors the amount the user entered.
    expect(client.writtenTo("goals")).toEqual({
      starting_balance: 12000,
      target_balance: 7000,
    });
  });

  it("never recomputes a baseline that is already set", async () => {
    client = goalClient({
      goals: { data: { id: GOAL_ID, goal_type: "pay_down", starting_balance: 9000 } },
      accounts: { data: { id: ACCOUNT_ID, type: "credit", current_balance: 1000 } },
    });
    authWith(client);
    const response = await allocationPost(
      jsonReq(ALLOCATION_URL, "POST", {
        goalId: GOAL_ID,
        accountId: ACCOUNT_ID,
        useEntireBalance: true,
      }),
    );
    await expect(response.json()).resolves.toMatchObject({ baselineCaptured: false });
    expect(client.writtenTo("goals")).toBeUndefined();
  });

  it("does not capture a baseline from a non-liability account", async () => {
    client = goalClient({
      goals: { data: { id: GOAL_ID, goal_type: "pay_down", starting_balance: null } },
      accounts: { data: { id: ACCOUNT_ID, type: "depository", current_balance: 1000 } },
    });
    authWith(client);
    const response = await allocationPost(
      jsonReq(ALLOCATION_URL, "POST", {
        goalId: GOAL_ID,
        accountId: ACCOUNT_ID,
        useEntireBalance: true,
      }),
    );
    await expect(response.json()).resolves.toMatchObject({ baselineCaptured: false });
  });

  it("audits ids only, never an amount", async () => {
    await allocationPost(
      jsonReq(ALLOCATION_URL, "POST", {
        goalId: GOAL_ID,
        accountId: ACCOUNT_ID,
        allocatedAmount: 1234.56,
      }),
    );
    const call = vi.mocked(writeAudit).mock.calls[0]![0];
    expect(call.action).toBe("goal_allocation_set");
    expect(JSON.stringify(call.metadata)).not.toContain("1234");
  });

  it("429s when the rate limit is spent", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue(false);
    const response = await allocationPost(
      jsonReq(ALLOCATION_URL, "POST", {
        goalId: GOAL_ID,
        accountId: ACCOUNT_ID,
        allocatedAmount: 10,
      }),
    );
    expect(response.status).toBe(429);
  });

  it("passes a 401 straight through", async () => {
    vi.mocked(requireUser).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const response = await allocationPost(
      jsonReq(ALLOCATION_URL, "POST", { goalId: GOAL_ID, accountId: ACCOUNT_ID }),
    );
    expect(response.status).toBe(401);
  });

  describe("DELETE", () => {
    it("requires both ids", async () => {
      const response = await allocationDelete(
        new NextRequest(`${ALLOCATION_URL}?goalId=${GOAL_ID}`, { method: "DELETE" }),
      );
      expect(response.status).toBe(400);
    });

    it("unlinks scoped to the owner", async () => {
      client = goalClient({ goal_accounts: { data: { id: "alloc-1" } } });
      authWith(client);
      const response = await allocationDelete(
        new NextRequest(
          `${ALLOCATION_URL}?goalId=${GOAL_ID}&accountId=${ACCOUNT_ID}`,
          { method: "DELETE" },
        ),
      );
      expect(response.status).toBe(200);
      expect(client.scopedToUser("goal_accounts", "user-1")).toBe(true);
    });

    it("404s an allocation that is not the caller's", async () => {
      client = goalClient({ goal_accounts: { data: null } });
      authWith(client);
      const response = await allocationDelete(
        new NextRequest(
          `${ALLOCATION_URL}?goalId=${GOAL_ID}&accountId=${ACCOUNT_ID}`,
          { method: "DELETE" },
        ),
      );
      expect(response.status).toBe(404);
    });
  });
});

describe("goal contribution events route", () => {
  let client: ReturnType<typeof clientStub>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimit).mockResolvedValue(true);
    client = clientStub({
      goals: { data: { id: GOAL_ID } },
      goal_progress_events: { data: { id: EVENT_ID } },
    });
    authWith(client);
  });

  it("requires a goal id and a non-zero amount", async () => {
    expect(
      (await eventPost(jsonReq(EVENTS_URL, "POST", { amount: 10 }))).status,
    ).toBe(400);
    for (const amount of [0, "10", Number.NaN, undefined]) {
      expect(
        (await eventPost(jsonReq(EVENTS_URL, "POST", { goalId: GOAL_ID, amount })))
          .status,
      ).toBe(400);
    }
  });

  it("rejects an absurd amount rather than overflowing the column", async () => {
    const response = await eventPost(
      jsonReq(EVENTS_URL, "POST", { goalId: GOAL_ID, amount: 1e12 }),
    );
    expect(response.status).toBe(400);
  });

  it("404s a goal the caller does not own", async () => {
    client = clientStub({ goals: { data: null } });
    authWith(client);
    const response = await eventPost(
      jsonReq(EVENTS_URL, "POST", { goalId: GOAL_ID, amount: 100 }),
    );
    expect(response.status).toBe(404);
  });

  it("records a contribution scoped to the caller", async () => {
    const response = await eventPost(
      jsonReq(EVENTS_URL, "POST", {
        goalId: GOAL_ID,
        amount: 250.567,
        eventDate: "2026-07-04",
      }),
    );
    expect(response.status).toBe(200);
    expect(client.writtenTo("goal_progress_events")).toMatchObject({
      user_id: "user-1",
      goal_id: GOAL_ID,
      amount: 250.57,
      event_date: "2026-07-04",
      event_type: "manual_contribution",
    });
  });

  it("accepts a negative amount as a withdrawal", async () => {
    await eventPost(
      jsonReq(EVENTS_URL, "POST", {
        goalId: GOAL_ID,
        amount: -80,
        eventType: "manual_adjustment",
      }),
    );
    expect(client.writtenTo("goal_progress_events")).toMatchObject({
      amount: -80,
      event_type: "manual_adjustment",
    });
  });

  it("refuses to accept a transaction-typed event from this endpoint", async () => {
    // Those carry a transaction_id whose ownership this route cannot vouch for,
    // so an unknown type falls back to a plain manual contribution.
    await eventPost(
      jsonReq(EVENTS_URL, "POST", {
        goalId: GOAL_ID,
        amount: 10,
        eventType: "transaction",
      }),
    );
    expect(client.writtenTo("goal_progress_events")).toMatchObject({
      event_type: "manual_contribution",
    });
  });

  it("falls back to today for a malformed date", async () => {
    await eventPost(
      jsonReq(EVENTS_URL, "POST", {
        goalId: GOAL_ID,
        amount: 10,
        eventDate: "07/04/2026",
      }),
    );
    const written = client.writtenTo("goal_progress_events") as {
      event_date: string;
    };
    expect(written.event_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("audits without the amount", async () => {
    await eventPost(
      jsonReq(EVENTS_URL, "POST", { goalId: GOAL_ID, amount: 9876.54 }),
    );
    const call = vi.mocked(writeAudit).mock.calls[0]![0];
    expect(call.action).toBe("goal_contribution_recorded");
    expect(JSON.stringify(call.metadata)).not.toContain("9876");
  });

  it("deletes an event scoped to the owner and 404s otherwise", async () => {
    const ok = await eventDelete(
      new NextRequest(`${EVENTS_URL}?id=${EVENT_ID}`, { method: "DELETE" }),
    );
    expect(ok.status).toBe(200);
    expect(client.scopedToUser("goal_progress_events", "user-1")).toBe(true);

    client = clientStub({ goal_progress_events: { data: null } });
    authWith(client);
    const missing = await eventDelete(
      new NextRequest(`${EVENTS_URL}?id=${EVENT_ID}`, { method: "DELETE" }),
    );
    expect(missing.status).toBe(404);
  });

  it("requires an id to delete", async () => {
    const response = await eventDelete(
      new NextRequest(EVENTS_URL, { method: "DELETE" }),
    );
    expect(response.status).toBe(400);
  });
});
