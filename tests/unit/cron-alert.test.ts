import { describe, it, expect, vi, beforeEach } from "vitest";

const mockClaim = vi.fn();
const mockFinish = vi.fn();
const delivery = {
  update: mockFinish,
  eq: () => delivery,
  is: () => delivery,
  select: () => Promise.resolve({ data: [{ delivery_key: "cron-alert:daily-sync" }], error: null }),
};
mockFinish.mockReturnValue(delivery);

const mockSendCronAlertEmail = vi.fn();
vi.mock("@/lib/reporting", () => ({
  sendCronAlertEmail: (...args: unknown[]) => mockSendCronAlertEmail(...args),
}));

const mockGetUserById = vi.fn();
const profilesChain = {
  select: vi.fn(() => profilesChain),
  eq: vi.fn(() => profilesChain),
  limit: vi.fn(),
  order: vi.fn(() => profilesChain),
};
const mockServiceClient = {
  from: vi.fn((table) => table === "cron_delivery_windows" ? delivery : profilesChain),
  rpc: mockClaim,
  auth: { admin: { getUserById: (...args: unknown[]) => mockGetUserById(...args) } },
};
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => mockServiceClient,
}));

const mockLogError = vi.fn();
vi.mock("@/lib/log", () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
}));

import { alertCronFailure } from "@/lib/cron-alert";

describe("alertCronFailure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClaim.mockResolvedValue({ data: [{ sent_through: null }], error: null });
    profilesChain.limit.mockResolvedValue({
      data: [{ id: "admin-1" }],
      error: null,
    });
    mockGetUserById.mockResolvedValue({
      data: { user: { email: "admin@example.com" } },
    });
    mockSendCronAlertEmail.mockResolvedValue({ messageId: "m1" });
  });

  it("emails the admin with the cron name and summary", async () => {
    await alertCronFailure("daily-sync", { failed: 2, total: 5, firstError: "ITEM_LOGIN_REQUIRED" });
    expect(mockClaim).toHaveBeenCalledWith("claim_cron_delivery", expect.objectContaining({
      p_key: "cron-alert:daily-sync", p_user_id: null,
    }));
    expect(mockFinish).toHaveBeenCalledWith(expect.objectContaining({ sent_through: expect.any(String) }));
    expect(mockSendCronAlertEmail).toHaveBeenCalledWith(
      "admin@example.com",
      "daily-sync",
      { failed: 2, total: 5, firstError: "ITEM_LOGIN_REQUIRED" },
    );
  });

  it("skips when the 24h dedupe window is consumed", async () => {
    mockClaim.mockResolvedValue({ data: [], error: null });
    await alertCronFailure("weekly-report", { failed: 1, total: 1 });
    expect(mockSendCronAlertEmail).not.toHaveBeenCalled();
  });

  it("logs and skips when no admin profile exists", async () => {
    profilesChain.limit.mockResolvedValue({ data: [], error: null });
    await alertCronFailure("daily-sync", { failed: 1, total: 1 });
    expect(mockSendCronAlertEmail).not.toHaveBeenCalled();
    expect(mockLogError).toHaveBeenCalledWith("cron-alert.no-admin", expect.any(Error));
  });

  it("logs and skips when database query for admin profile fails", async () => {
    profilesChain.limit.mockResolvedValue({
      data: null,
      error: new Error("Supabase query error"),
    });
    await alertCronFailure("daily-sync", { failed: 1, total: 1 });
    expect(mockSendCronAlertEmail).not.toHaveBeenCalled();
    expect(mockLogError).toHaveBeenCalledWith("cron-alert.send", expect.any(Error));
  });

  it("logs and skips when the admin has no email", async () => {
    mockGetUserById.mockResolvedValue({ data: { user: { email: null } } });
    await alertCronFailure("daily-sync", { failed: 1, total: 1 });
    expect(mockSendCronAlertEmail).not.toHaveBeenCalled();
    expect(mockLogError).toHaveBeenCalledWith("cron-alert.no-email", expect.any(Error));
  });

  it("never throws, even when sending fails", async () => {
    mockSendCronAlertEmail.mockRejectedValue(new Error("smtp down"));
    await expect(
      alertCronFailure("daily-sync", { failed: 1, total: 1 }),
    ).resolves.toBeUndefined();
    expect(mockLogError).toHaveBeenCalledWith("cron-alert.send", expect.any(Error));
    expect(mockFinish).toHaveBeenLastCalledWith({ claim_id: null, claim_expires_at: null });
    mockSendCronAlertEmail.mockResolvedValueOnce({ messageId: "retry" });
    await alertCronFailure("daily-sync", { failed: 1, total: 1 });
    expect(mockSendCronAlertEmail).toHaveBeenCalledTimes(2);
    expect(mockFinish).toHaveBeenLastCalledWith(expect.objectContaining({ sent_through: expect.any(String) }));
  });
});
