import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Supabase Service Client
const mockSingle = vi.fn();
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
  then?: (onfulfilled: (value: { data: unknown[]; error: null }) => unknown) => Promise<unknown>;
} = {
  select: mockSelect,
  insert: mockInsert,
  upsert: mockUpsert,
  eq: mockEq,
  gte: mockGte,
  single: mockSingle,
};

// Enable chaining by returning the same query chain
mockFrom.mockReturnValue(mockQueryChain);
mockSelect.mockReturnValue(mockQueryChain);
mockInsert.mockReturnValue(mockQueryChain);
mockUpsert.mockReturnValue(mockQueryChain);
mockEq.mockReturnValue(mockQueryChain);
mockGte.mockReturnValue(mockQueryChain);

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

    // Mock existing notifications in window containing a subjectKey match
    mockGte.mockResolvedValueOnce({
      data: [
        { title: "Target alert Chase credit", body: "Something happened" }
      ],
      error: null,
    });

    const result = await createNotification(
      "user-1",
      "low_cash_forecast",
      { title: "New alert", body: "chase credit balance low" },
      "Chase credit" // subjectKey
    );

    // Should be detected as a duplicate (case-insensitive substring match of "Chase credit" in title/body)
    expect(result).toBeNull();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("triggers broken bank notification during processing when item status is error", async () => {
    // Mock Dashboard and Goals data
    mockGetDashboardData.mockResolvedValue({
      cashFlowForecast: { lowBalanceRisk: false },
      budgetEnvelopes: [],
      netWorthSnapshot: { assets: 100, liabilities: 0, netWorth: 100 },
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
    mockInsert.mockImplementation((val) => {
      processedNotifications.push(val.type);
      return {
        select: vi.fn().mockReturnValue({
          single: () => Promise.resolve({ data: val, error: null }),
        }),
      };
    });

    await processNotificationsForUser("user-1");

    expect(processedNotifications).toContain("broken_bank");
  });
});
