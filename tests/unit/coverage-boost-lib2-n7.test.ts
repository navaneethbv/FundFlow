import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockSendMail: vi.fn().mockResolvedValue({ messageId: "mock-message-id" }),
  mockCreateTransport: vi.fn(),
  mockCreateTestAccount: vi.fn().mockResolvedValue({ user: "test-user", pass: "test-pass" }),
  mockGetTestMessageUrl: vi.fn().mockReturnValue("https://smtp.ethereal.email/message/1"),
}));

mocks.mockCreateTransport.mockReturnValue({ sendMail: mocks.mockSendMail });

vi.mock("nodemailer", () => ({
  default: {
    createTransport: mocks.mockCreateTransport,
    createTestAccount: mocks.mockCreateTestAccount,
    getTestMessageUrl: mocks.mockGetTestMessageUrl,
  },
}));

import {
  sendWeeklyReportEmail,
  sendDailyDigestEmail,
  sendBackupEmail,
  sendLoginAlertEmail,
  sendHouseholdInviteEmail,
  sendCronAlertEmail,
} from "@/lib/reporting";

describe("reporting hostConfigured branches", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    mocks.mockSendMail.mockResolvedValue({ messageId: "mock-message-id" });
    mocks.mockCreateTestAccount.mockResolvedValue({ user: "test-user", pass: "test-pass" });
    mocks.mockGetTestMessageUrl.mockReturnValue("https://smtp.ethereal.email/message/1");
    mocks.mockCreateTransport.mockReturnValue({ sendMail: mocks.mockSendMail });
  });

  it("weekly report with configured SMTP does not log a dev preview", async () => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_PORT = "465";
    process.env.SMTP_USER = "user";
    process.env.SMTP_PASS = "pass";
    const data = {
      userId: "u1",
      userEmail: "u@fundflow.dev",
      period: { start: "2026-07-06", end: "2026-07-12", previousStart: "2026-06-29", previousEnd: "2026-07-05" },
      totalSpend: 10,
      previousTotalSpend: 5,
      changeAmount: 5,
      changePercent: 1,
      categories: [],
      merchants: [],
      banks: [],
      cards: [],
      budgets: [],
      cashFlow: { inflows: 1, outflows: 2, net: -1 },
    };
    const info = await sendWeeklyReportEmail(data, Buffer.from("pdf"), "https://fundflow.dev");
    expect(info.messageId).toBe("mock-message-id");
    expect(mocks.mockGetTestMessageUrl).not.toHaveBeenCalled();
  });

  it("weekly report in development without SMTP config logs a preview", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    const data = {
      userId: "u1",
      userEmail: "u@fundflow.dev",
      period: { start: "2026-07-06", end: "2026-07-12", previousStart: "2026-06-29", previousEnd: "2026-07-05" },
      totalSpend: 10,
      previousTotalSpend: 5,
      changeAmount: 5,
      changePercent: 1,
      categories: [],
      merchants: [],
      banks: [],
      cards: [],
      budgets: [],
      cashFlow: { inflows: 1, outflows: 2, net: -1 },
    };
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await sendWeeklyReportEmail(data, Buffer.from("pdf"), "https://fundflow.dev");
    expect(mocks.mockGetTestMessageUrl).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("backup, login-alert, and household-invite emails with configured SMTP do not preview", async () => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_PORT = "587";
    process.env.SMTP_USER = "user";
    process.env.SMTP_PASS = "pass";
    process.env.SMTP_FROM = "FundFlow <no-reply@fundflow.dev>";

    await sendBackupEmail("u@fundflow.dev", "backup.gz", Buffer.from("x"), "2026-07");
    await sendLoginAlertEmail("u@fundflow.dev", "Chrome on macOS");
    await sendHouseholdInviteEmail("invitee@fundflow.dev", "inviter@fundflow.dev", "The Home", "https://fundflow.dev/accept?x=1");
    expect(mocks.mockGetTestMessageUrl).not.toHaveBeenCalled();
    expect(mocks.mockSendMail).toHaveBeenCalledTimes(3);
  });

  it("backup, login-alert, and household-invite emails in development log a preview", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await sendBackupEmail("u@fundflow.dev", "backup.gz", Buffer.from("x"), "2026-07");
    await sendLoginAlertEmail("u@fundflow.dev", "Chrome on macOS");
    await sendHouseholdInviteEmail("invitee@fundflow.dev", "inviter@fundflow.dev", "The Home", "https://fundflow.dev/accept?x=1");
    expect(mocks.mockGetTestMessageUrl).toHaveBeenCalledTimes(3);
    logSpy.mockRestore();
  });

  it("daily digest and cron alert also skip preview when configured", async () => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_PORT = "587";
    process.env.SMTP_USER = "user";
    process.env.SMTP_PASS = "pass";
    await sendDailyDigestEmail("u@fundflow.dev", [{ type: "budget", title: "Over", body: "b" }], "2026-07-08", "https://fundflow.dev/n");
    await sendCronAlertEmail("u@fundflow.dev", "weekly", { failed: 1, total: 3, firstError: "boom" });
    await sendCronAlertEmail("u@fundflow.dev", "weekly", { failed: 0, total: 2 });
    expect(mocks.mockGetTestMessageUrl).not.toHaveBeenCalled();
  });
});