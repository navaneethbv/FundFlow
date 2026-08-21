import { describe, expect, it, vi, beforeEach } from "vitest";
import { clientStub } from "../fixtures/supabase-query";

vi.mock("@/lib/finance-query", () => ({
  loadCanonicalProjection: () =>
    Promise.resolve({
      transactions: [],
      currencyByAccountId: new Map(),
      truncated: false,
    }),
}));

import { loadForecastPageData } from "@/lib/forecasting-data";
import {
  goalMonthlyPace,
  goalSummary,
  getGoals,
  type Goal,
} from "@/lib/goals";

const mockNotify = vi.fn();
vi.mock("@/lib/login-alert", () => ({
  notifyNewDeviceLogin: (...args: unknown[]) => mockNotify(...args),
}));
vi.mock("@/lib/log", () => ({ logError: vi.fn() }));

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => holder.client,
}));

describe("loadForecastPageData branch coverage", () => {
  it("throws when the accounts query fails", async () => {
    const supabase = clientStub({
      accounts: { error: new Error("accounts down") },
      manual_accounts: { data: [] },
    });
    await expect(
      loadForecastPageData(supabase as never, "user-1", "2026-07-15"),
    ).rejects.toThrow("accounts down");
  });

  it("falls back to empty arrays for null account data", async () => {
    const supabase = clientStub({
      accounts: { data: null },
      manual_accounts: { data: null },
    });
    const data = await loadForecastPageData(supabase as never, "user-1", "2026-07-15");
    expect(data.startingState).toBeDefined();
  });
});

function goal(overrides: Partial<Goal>): Goal {
  return {
    id: "goal-1",
    name: "Emergency fund",
    target_amount: 10000,
    saved_amount: 2500,
    target_date: "2026-11-07",
    ...overrides,
  };
}

describe("goals parseGoalDate and sort branches", () => {
  const today = new Date("2026-07-07T12:00:00Z");

  it("fills a bare-year target date month and day", () => {
    expect(goalMonthlyPace(goal({ target_date: "2026" }), today)).toBeNull();
  });

  it("sorts two undated goals by name", () => {
    const summary = goalSummary(
      [goal({ id: "b", name: "Beta", target_date: null }), goal({ id: "a", name: "Alpha", target_date: null })],
      today,
    );
    expect(summary.map((s) => s.goal.id)).toEqual(["a", "b"]);
  });

  it("sorts an undated goal after a dated goal", () => {
    const summary = goalSummary(
      [goal({ id: "undated", target_date: null }), goal({ id: "dated", target_date: "2026-08-01" })],
      today,
    );
    expect(summary.map((s) => s.goal.id)).toEqual(["dated", "undated"]);
  });
});

describe("getGoals data fallback branches", () => {
  it("returns goals when data is present", async () => {
    const supabase = clientStub({ goals: { data: [{ id: "g1", name: "Fund" }] } });
    const goals = await getGoals(supabase as never, "user-1");
    expect(goals).toEqual([{ id: "g1", name: "Fund" }]);
  });

  it("returns an empty list when data is null", async () => {
    const supabase = clientStub({ goals: { data: null } });
    const goals = await getGoals(supabase as never, "user-1");
    expect(goals).toEqual([]);
  });
});

describe("http requireUser session recording", () => {
  const mockGetUser = vi.fn();
  const mockGetAal = vi.fn();
  const mockGetSession = vi.fn();

  function buildToken(sessionId: string) {
    const payload = Buffer.from(JSON.stringify({ session_id: sessionId })).toString("base64url");
    return `header.${payload}.sig`;
  }

  function makeClient(snapshot: { revoked_at: string | null; created_at: string | null }) {
    return Object.assign(clientStub({ user_session_records: { data: snapshot } }), {
      auth: {
        getUser: mockGetUser,
        mfa: { getAuthenticatorAssuranceLevel: mockGetAal },
        getSession: mockGetSession,
      },
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-123", email: "a@fundflow.dev" } } });
    mockGetAal.mockResolvedValue({ data: { currentLevel: "aal1", nextLevel: "aal1" } });
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: buildToken("sess-1") } },
    });
  });

  async function loadHttp() {
    return await import("@/lib/http");
  }

  it("records the session and alerts for a freshly-created record", async () => {
    holder.client = makeClient({ revoked_at: null, created_at: new Date().toISOString() });
    const { requireUser } = await loadHttp();
    const result = await requireUser();
    expect(result).not.toBeInstanceOf(Response);
    expect(mockNotify).toHaveBeenCalled();
  });

  it("skips the new-device alert for a record that is not freshly created", async () => {
    const old = new Date(Date.now() - 3600 * 1000).toISOString();
    holder.client = makeClient({ revoked_at: null, created_at: old });
    const { requireUser } = await loadHttp();
    await requireUser();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("skips the new-device alert when the record has no created_at", async () => {
    holder.client = makeClient({ revoked_at: null, created_at: null });
    const { requireUser } = await loadHttp();
    await requireUser();
    expect(mockNotify).not.toHaveBeenCalled();
  });
});
