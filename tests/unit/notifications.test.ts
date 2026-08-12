import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Supabase Service Client
const mockSingle = vi.fn();
const mockMaybeSingle = vi.fn();
const mockGte = vi.fn();
const mockEq = vi.fn();
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockInsert = vi.fn();
const mockUpsert = vi.fn();

const mockQueryChain: {
  select: typeof mockSelect;
  insert: typeof mockInsert;
  upsert: typeof mockUpsert;
  eq: typeof mockEq;
  gte: typeof mockGte;
  single: typeof mockSingle;
  maybeSingle: typeof mockMaybeSingle;
  then?: (onfulfilled: (value: { data: unknown[]; error: null }) => unknown) => Promise<unknown>;
} = {
  select: mockSelect,
  insert: mockInsert,
  upsert: mockUpsert,
  eq: mockEq,
  gte: mockGte,
  single: mockSingle,
  maybeSingle: mockMaybeSingle,
};

// Enable chaining by returning the same query chain
mockFrom.mockReturnValue(mockQueryChain);
mockSelect.mockReturnValue(mockQueryChain);
mockInsert.mockReturnValue(mockQueryChain);
mockUpsert.mockReturnValue(mockQueryChain);
mockEq.mockReturnValue(mockQueryChain);
mockGte.mockReturnValue(mockQueryChain);
mockMaybeSingle.mockReturnValue(mockQueryChain);

const mockSupabaseClient = {
  from: mockFrom,
};

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => mockSupabaseClient,
}));

// Mock Dashboard and Goals data
const mockGetDashboardData = vi.fn();
vi.mock("@/lib/dashboard", () => ({
  getDashboardData: () => mockGetDashboardData(),
}));

const mockGetGoals = vi.fn();
vi.mock("@/lib/goals", () => ({
  getGoals: () => mockGetGoals(),
}));

import { createNotification, processNotificationsForUser } from "@/lib/notifications";

describe("notifications manager", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default implementations for query chain functions
    mockGte.mockImplementation(() => Promise.resolve({ data: [], error: null }));
    mockEq.mockReturnValue(mockQueryChain);
    mockSelect.mockReturnValue(mockQueryChain);
    mockInsert.mockReturnValue(mockQueryChain);
    mockUpsert.mockReturnValue(mockQueryChain);
    mockMaybeSingle.mockResolvedValue({ data: null, error: null }); // Default no row
    mockSingle.mockResolvedValue({ data: null, error: null }); // Default no preferences row
    
    // Support promise-like behavior on the query chain by default
    mockQueryChain.then = (onfulfilled: (value: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(onfulfilled);
  });

  it("respects alert opt-out preference and returns null", async () => {
    // Mock user has opted out of low cash forecast alerts
    mockSingle.mockResolvedValueOnce({
      data: {
        low_cash_forecast: false,
      },
      error: null,
    });

    const result = await createNotification("user-1", "low_cash_forecast", {
      title: "Low Cash Alert",
      body: "Your cash is low",
    });

    expect(result).toBeNull();
  });

  it("keeps broken bank alerts enabled despite a legacy opt-out", async () => {
    mockSingle.mockResolvedValueOnce({
      data: { broken_bank: false },
      error: null,
    });
    mockSingle.mockResolvedValueOnce({
      data: { id: "critical-alert" },
      error: null,
    });

    const result = await createNotification("user-1", "broken_bank", {
      title: "Reconnect your bank",
      body: "A connection needs attention.",
    });

    expect(result).toEqual({ id: "critical-alert" });
    expect(mockInsert).toHaveBeenCalled();
  });

  it("processes net worth milestones and handles claim errors", async () => {
    mockGetDashboardData.mockResolvedValue({
      cashFlowForecast: { lowBalanceRisk: false },
      budgetEnvelopes: [],
      netWorthSnapshot: { assets: 15000, liabilities: 0, netWorth: 15000 },
      netWorthHistory: [
        { month: "2026-06", netWorth: 5000 },
        { month: "2026-07", netWorth: 15000 }, // Crosses $10k milestone
      ],
    });
    mockGetGoals.mockResolvedValue([]);
    mockSingle.mockResolvedValue({ data: { broken_bank: true }, error: null });

    const insertedMilestones: string[] = [];
    mockFrom.mockImplementation((table) => {
      if (table === "milestones") {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: [], error: null }),
          }),
          insert: (data: { key: string }) => {
            if (data.key === "dupe-key") return Promise.resolve({ error: new Error("Claimed") });
            insertedMilestones.push(data.key);
            return Promise.resolve({ error: null });
          },
        };
      }
      return mockQueryChain;
    });

    await processNotificationsForUser("user-1");
    expect(insertedMilestones.length).toBeGreaterThan(0);
  });

  it("inserts notification when preference is enabled", async () => {
    const mockCreatedNotification = {
      id: "notif-123",
      user_id: "user-1",
      type: "low_cash_forecast",
      title: "Low Cash Alert",
      body: "Your cash is low",
    };

    // First call to mockSingle gets preferences
    mockSingle.mockResolvedValueOnce({
      data: {
        low_cash_forecast: true,
      },
      error: null,
    });
    // Second call gets the inserted notification
    mockSingle.mockResolvedValueOnce({
      data: mockCreatedNotification,
      error: null,
    });

    const result = await createNotification("user-1", "low_cash_forecast", {
      title: "Low Cash Alert",
      body: "Your cash is low",
    });

    expect(result).toEqual(mockCreatedNotification);
    expect(mockInsert).toHaveBeenCalled();
  });

  it("deduplicates notifications of same type on the same day", async () => {
    mockSingle.mockResolvedValueOnce({
      data: {
        low_cash_forecast: true,
      },
      error: null,
    });

    // Mock that a low_cash_forecast notification already exists today
    mockGte.mockResolvedValueOnce({
      data: [{ id: "existing-notif" }],
      error: null,
    });

    const result = await createNotification("user-1", "low_cash_forecast", {
      title: "Low Cash Alert",
      body: "Your cash is low",
    });

    expect(result).toBeNull();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("processes notifications for low balance risk and budget exceed", async () => {
    // 1. Mock Dashboard Data
    mockGetDashboardData.mockResolvedValue({
      cashFlowForecast: {
        lowBalanceRisk: true,
        lowestBalance: 250,
        assumptions: [],
      },
      budgetEnvelopes: [
        {
          category: "FOOD",
          spent: 600,
          monthlyLimit: 500,
          status: "over",
        },
        {
          category: "RENT",
          spent: 1000,
          monthlyLimit: 1000,
          status: "on-track",
        },
      ],
      netWorthSnapshot: { assets: 1000, liabilities: 0, netWorth: 1000 },
      netWorthHistory: [],
    });

    // 2. Mock Goals
    mockGetGoals.mockResolvedValue([
      {
        id: "goal-1",
        name: "New Car",
        target_amount: 5000,
        saved_amount: 5000, // Reached
      },
    ]);

    // 3. Mock preferences (always return true/enabled)
    mockSingle.mockResolvedValue({
      data: {
        low_cash_forecast: true,
        budget_exceeded: true,
        goal_reached: true,
        broken_bank: true,
      },
      error: null,
    });
    // We spy on createNotification calls
    const processedNotifications: string[] = [];
    mockInsert.mockImplementation((val) => {
      processedNotifications.push(val.type);
      return {
        select: vi.fn().mockReturnValue({
          single: () => Promise.resolve({ data: val, error: null }),
        }),
      };
    });

    await processNotificationsForUser("user-1");

    expect(processedNotifications).toContain("low_cash_forecast");
    expect(processedNotifications).toContain("budget_exceeded");
    expect(processedNotifications).toContain("goal_reached");
  });

  it("handles duplication checking with subjectKey", async () => {
    // Enable low cash forecast alerts
    mockSingle.mockResolvedValueOnce({
      data: { low_cash_forecast: true },
      error: null,
    });

    // Mock an existing notification claiming the same subject key
    mockMaybeSingle.mockResolvedValueOnce({
      data: { id: "existing-notif", subject_key: "chase-credit" },
      error: null,
    });

    const result = await createNotification(
      "user-1",
      "low_cash_forecast",
      { title: "New alert", body: "chase credit balance low" },
      "chase-credit", // subjectKey
      "exact",
    );

    // Should be detected as a duplicate by the stored subject_key column,
    // not by substring-matching rendered text.
    expect(result).toBeNull();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("triggers broken bank notification during processing when item status is error", async () => {
    // Mock Dashboard and Goals data
    mockGetDashboardData.mockResolvedValue({
      cashFlowForecast: { lowBalanceRisk: false },
      budgetEnvelopes: [],
      netWorthSnapshot: { assets: 100, liabilities: 0, netWorth: 100 },
      netWorthHistory: [],
    });
    mockGetGoals.mockResolvedValue([]);

    // Mock preferences
    mockSingle.mockResolvedValue({
      data: { broken_bank: true },
      error: null,
    });

    // Mock broken bank item
    mockFrom.mockImplementation((table) => {
      if (table === "plaid_items") {
        return {
          select: () => ({
            eq: () => Promise.resolve({
              data: [{ id: "item-123", institution_name: "Chase", status: "error", error_code: "ITEM_LOGIN_REQUIRED" }],
              error: null,
            }),
          }),
        };
      }
      return mockQueryChain;
    });

    const processedNotifications: string[] = [];
    const insertedRows: Array<{ type: string; subject_key: string | null }> = [];
    mockInsert.mockImplementation((val) => {
      processedNotifications.push(val.type);
      insertedRows.push(val);
      return {
        select: vi.fn().mockReturnValue({
          single: () => Promise.resolve({ data: val, error: null }),
        }),
      };
    });

    await processNotificationsForUser("user-1");

    expect(processedNotifications).toContain("broken_bank");

    // The subject key must carry the day. Under `exact` dedupe an id-only key
    // would alert once ever, so a connection that stays broken goes silent and
    // takes the daily digest with it.
    const brokenBank = insertedRows.find((row) => row.type === "broken_bank")!;
    const today = new Date().toISOString().slice(0, 10);
    expect(brokenBank.subject_key).toBe(`broken_bank:item-123:${today}`);
  });

  it("getUnreadNotificationCount returns unread count or 0 on error", async () => {
    const { getUnreadNotificationCount } = await import("@/lib/notifications");

    const mockSupabaseSuccess = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            is: vi.fn().mockResolvedValue({ count: 5, error: null }),
          }),
        }),
      }),
    };
    const count = await getUnreadNotificationCount(mockSupabaseSuccess as never, "user-1");
    expect(count).toBe(5);

    const mockSupabaseError = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            is: vi.fn().mockResolvedValue({ count: null, error: new Error("DB Error") }),
          }),
        }),
      }),
    };
    const countErr = await getUnreadNotificationCount(mockSupabaseError as never, "user-1");
    expect(countErr).toBe(0);
  });

  it("handles non-matching subjectKey and DB errors in createNotification", async () => {
    mockSingle.mockResolvedValueOnce({
      data: { low_cash_forecast: true },
      error: null,
    });
    mockMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });
    mockSingle.mockResolvedValueOnce({
      data: { id: "notif-new" },
      error: null,
    });

    const res = await createNotification(
      "user-1",
      "low_cash_forecast",
      { title: "Chase alert", body: "Low cash" },
      "chase",
      "exact",
    );
    expect(res).toEqual({ id: "notif-new" });

    // DB query error handling on the subject-key dedupe
    mockSingle.mockResolvedValueOnce({ data: { low_cash_forecast: true }, error: null });
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: new Error("Dedupe Error") });
    await expect(
      createNotification(
        "user-1",
        "low_cash_forecast",
        { title: "t", body: "b" },
        "chase",
        "exact",
      ),
    ).rejects.toThrow("Dedupe Error");
  });

  it("keeps subject-key alerts on the legacy time window unless exact dedupe is requested", async () => {
    mockSingle.mockResolvedValueOnce({
      data: { cancellation_watch: true },
      error: null,
    });
    mockGte.mockResolvedValueOnce({
      data: [
        {
          id: "existing-notification",
          title: "Charged after cancellation: Netflix",
          body: "Netflix charged 20 on 2026-08-12 after you marked it cancelled.",
        },
      ],
      error: null,
    });

    const result = await createNotification(
      "user-1",
      "cancellation_watch",
      { title: "Charged after cancellation: Netflix", body: "Netflix charged 20" },
      "Netflix",
    );

    expect(result).toBeNull();
    expect(mockMaybeSingle).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("handles milestone processing errors gracefully", async () => {
    mockGetDashboardData.mockResolvedValue({
      cashFlowForecast: { lowBalanceRisk: false },
      budgetEnvelopes: [],
      netWorthSnapshot: { assets: 15000, liabilities: 0, netWorth: 15000 },
      netWorthHistory: [
        { month: "2026-06", netWorth: 5000 },
        { month: "2026-07", netWorth: 15000 },
      ],
    });
    mockGetGoals.mockResolvedValue([]);
    mockSingle.mockResolvedValue({ data: { broken_bank: true }, error: null });

    mockFrom.mockImplementation((table) => {
      if (table === "milestones") {
        return {
          select: () => {
            throw new Error("Milestones table error");
          },
        };
      }
      return mockQueryChain;
    });

    await expect(processNotificationsForUser("user-1")).resolves.not.toThrow();
  });

  it("uses default alert preferences when no preferences row exists", async () => {
    await createNotification("user-1", "goal_reached", { title: "Goal", body: "You did it" });
    expect(mockInsert).toHaveBeenCalled();
  });

  it("throws when inserting the notification fails", async () => {
    mockSingle.mockResolvedValueOnce({ data: { goal_reached: true }, error: null });
    mockGte.mockResolvedValueOnce({ data: [], error: null });
    mockSingle.mockResolvedValueOnce({ data: null, error: new Error("Insert failed") });

    await expect(
      createNotification("user-1", "goal_reached", { title: "t", body: "b" }),
    ).rejects.toThrow("Insert failed");
  });

  it("skips notifications when nothing is due and result lists are null", async () => {
    mockGetDashboardData.mockResolvedValue({
      cashFlowForecast: { lowBalanceRisk: false },
      netWorthSnapshot: { assets: 100, liabilities: 0, netWorth: 100 },
      netWorthHistory: [],
    });
    mockGetGoals.mockResolvedValue([
      { id: "g1", name: "Trip", target_amount: 5000, saved_amount: 1000 },
    ]);
    mockSingle.mockResolvedValue({ data: { broken_bank: true }, error: null });
    mockFrom.mockImplementation((table) => {
      if (table === "milestones") {
        return { select: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) };
      }
      if (table === "plaid_items") {
        return { select: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) };
      }
      return mockQueryChain;
    });

    const inserted: string[] = [];
    mockInsert.mockImplementation((val) => {
      inserted.push(val.type);
      return {
        select: vi.fn().mockReturnValue({
          single: () => Promise.resolve({ data: val, error: null }),
        }),
      };
    });

    await processNotificationsForUser("user-1");
    expect(inserted).toEqual([]);
  });

  it("silently skips milestone keys that fail to claim", async () => {
    mockGetDashboardData.mockResolvedValue({
      cashFlowForecast: { lowBalanceRisk: false },
      budgetEnvelopes: [],
      netWorthSnapshot: { assets: 15000, liabilities: 0, netWorth: 15000 },
      netWorthHistory: [
        { month: "2026-06", netWorth: 5000 },
        { month: "2026-07", netWorth: 15000 },
      ],
    });
    mockGetGoals.mockResolvedValue([]);
    mockSingle.mockResolvedValue({ data: { broken_bank: true }, error: null });
    mockFrom.mockImplementation((table) => {
      if (table === "milestones") {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: [{ key: "networth:positive" }], error: null }),
          }),
          insert: () => Promise.resolve({ error: new Error("Claimed") }),
        };
      }
      if (table === "plaid_items") {
        return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) };
      }
      return mockQueryChain;
    });

    await expect(processNotificationsForUser("user-1")).resolves.not.toThrow();
  });

  it("handles broken bank items missing institution and error metadata", async () => {
    mockGetDashboardData.mockResolvedValue({
      cashFlowForecast: { lowBalanceRisk: false },
      budgetEnvelopes: [],
      netWorthSnapshot: { assets: 100, liabilities: 0, netWorth: 100 },
      netWorthHistory: [],
    });
    mockGetGoals.mockResolvedValue([]);
    mockSingle.mockResolvedValue({ data: { broken_bank: true }, error: null });
    mockFrom.mockImplementation((table) => {
      if (table === "milestones") {
        return { select: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) };
      }
      if (table === "plaid_items") {
        return {
          select: () => ({
            eq: () =>
              Promise.resolve({
                data: [
                  { id: "ok", institution_name: "Chase", status: "ok", error_code: null },
                  { id: "bare", institution_name: null, status: "error", error_code: null },
                ],
                error: null,
              }),
          }),
        };
      }
      return mockQueryChain;
    });

    const bodies: string[] = [];
    mockInsert.mockImplementation((val) => {
      bodies.push(val.body);
      return {
        select: vi.fn().mockReturnValue({
          single: () => Promise.resolve({ data: val, error: null }),
        }),
      };
    });

    await processNotificationsForUser("user-1");
    expect(bodies.some((b) => b.includes("your bank") && b.includes("unknown"))).toBe(true);
  });
});
