import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCheckRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

const mockSendCronAlertEmail = vi.fn();
vi.mock("@/lib/reporting", () => ({
  sendCronAlertEmail: (...args: unknown[]) => mockSendCronAlertEmail(...args),
}));

const mockGetUserById = vi.fn();
const profilesChain = {
  select: vi.fn(() => profilesChain),
  eq: vi.fn(() => profilesChain),
  limit: vi.fn(),
};
const mockServiceClient = {
  from: vi.fn(() => profilesChain),
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
    mockCheckRateLimit.mockResolvedValue(true);
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
    expect(mockCheckRateLimit).toHaveBeenCalledWith("cron-alert:daily-sync", 1, 86400);
    expect(mockSendCronAlertEmail).toHaveBeenCalledWith(
      "admin@example.com",
      "daily-sync",
      { failed: 2, total: 5, firstError: "ITEM_LOGIN_REQUIRED" },
    );
  });

  it("skips when the 24h dedupe window is consumed", async () => {
    mockCheckRateLimit.mockResolvedValue(false);
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
  });
});
