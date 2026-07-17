import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockSendMail: vi.fn().mockResolvedValue({ messageId: "mock-message-id" }),
  mockCreateTransport: vi.fn(),
  mockCreateTestAccount: vi
    .fn()
    .mockResolvedValue({ user: "test-user", pass: "test-pass" }),
  mockGetTestMessageUrl: vi
    .fn()
    .mockReturnValue("https://smtp.ethereal.email/message/1"),
}));

mocks.mockCreateTransport.mockReturnValue({
  sendMail: mocks.mockSendMail,
});

vi.mock("nodemailer", () => {
  return {
    default: {
      createTransport: mocks.mockCreateTransport,
      createTestAccount: mocks.mockCreateTestAccount,
      getTestMessageUrl: mocks.mockGetTestMessageUrl,
    },
  };
});

import {
  sendWeeklyReportEmail,
  sendDailyDigestEmail,
  sendCronAlertEmail,
} from "@/lib/reporting";
import type { WeeklyReportData } from "@/lib/weekly-report";

describe("lib/reporting", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("sends weekly report using ethereal test account in development", async () => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    process.env.NODE_ENV = "development";

    const data = {
      userEmail: "test@example.com",
      period: { start: "2026-07-01", end: "2026-07-07" },
      cashIn: 100,
      cashOut: 50,
      netSavings: 50,
      topCategories: [],
      goalsProgress: [],
      forecastLowest: 500,
      banks: [],
      cards: [],
      categories: [],
      budgets: [],
      changePercent: 0.1,
      changeAmount: 10,
      totalSpend: 150,
      previousTotalSpend: 100,
      cashFlow: { inflows: 200, outflows: 150, net: 50 },
      merchants: [],
    } as unknown as WeeklyReportData;

    const res = await sendWeeklyReportEmail(
      data,
      Buffer.from("pdf"),
      "http://localhost",
    );
    expect(mocks.mockCreateTestAccount).toHaveBeenCalled();
    expect(mocks.mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "smtp.ethereal.email",
      }),
    );
    expect(mocks.mockSendMail).toHaveBeenCalled();
    expect(res).toEqual({ messageId: "mock-message-id" });
  });

  it("throws an error in production if SMTP is not configured", async () => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    process.env.NODE_ENV = "production";

    const data = {
      userEmail: "test@example.com",
      period: { start: "2026-07-01", end: "2026-07-07" },
      banks: [],
      cards: [],
      categories: [],
      budgets: [],
      changePercent: 0.1,
      changeAmount: 10,
      totalSpend: 150,
      previousTotalSpend: 100,
      cashFlow: { inflows: 200, outflows: 150, net: 50 },
      merchants: [],
    } as unknown as WeeklyReportData;

    await expect(
      sendWeeklyReportEmail(data, Buffer.from("pdf"), "http://localhost"),
    ).rejects.toThrow("SMTP is not configured");
  });

  it("sends daily digest using configured SMTP settings", async () => {
    process.env.SMTP_HOST = "smtp.custom.com";
    process.env.SMTP_PORT = "465";
    process.env.SMTP_USER = "user";
    process.env.SMTP_PASS = "pass";
    process.env.SMTP_FROM = "custom@example.com";

    const res = await sendDailyDigestEmail(
      "user@example.com",
      [
        {
          id: "1",
          type: "low_cash_forecast",
          title: "Low Cash",
          body: "Check balance",
          created_at: "2026",
        },
      ],
      "2026-07-13",
      "http://localhost",
    );

    expect(mocks.mockCreateTransport).toHaveBeenCalledWith({
      host: "smtp.custom.com",
      port: 465,
      secure: true,
      auth: { user: "user", pass: "pass" },
    });
    expect(mocks.mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "custom@example.com",
        to: "user@example.com",
      }),
    );
    expect(res).toEqual({ messageId: "mock-message-id" });
  });

  it("sends a cron alert with the failure summary and truncated first error", async () => {
    process.env.SMTP_HOST = "smtp.custom.com";
    process.env.SMTP_PORT = "587";
    process.env.SMTP_USER = "user";
    process.env.SMTP_PASS = "pass";

    const res = await sendCronAlertEmail("admin@example.com", "daily-sync", {
      failed: 2,
      total: 5,
      firstError: "X".repeat(300),
    });

    expect(mocks.mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "admin@example.com",
        subject: "FundFlow cron failure: daily-sync",
      }),
    );
    const text = mocks.mockSendMail.mock.calls[0][0].text as string;
    expect(text).toContain("Failed: 2 of 5.");
    expect(text).toContain("First error: " + "X".repeat(200));
    expect(text).not.toContain("X".repeat(201));
    expect(res).toEqual({ messageId: "mock-message-id" });
  });

  it("omits the first-error line when none is given and previews via ethereal in dev", async () => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    process.env.NODE_ENV = "development";

    await sendCronAlertEmail("admin@example.com", "weekly-report", {
      failed: 1,
      total: 1,
    });

    const text = mocks.mockSendMail.mock.calls[0][0].text as string;
    expect(text).not.toContain("First error:");
    expect(mocks.mockGetTestMessageUrl).toHaveBeenCalled();
  });
});
