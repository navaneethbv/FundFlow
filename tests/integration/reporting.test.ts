import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { getWeeklyReportData } from "@/lib/weekly-report-data";
import { generateWeeklyReportPdf } from "@/lib/report-pdf";
import { runWeeklyReports } from "@/app/api/cron/weekly-report/route";
import { storeItem } from "@/lib/plaid-service";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SECRET_KEY;
const run = Boolean(url && publishable && secret);
const suite = run ? describe : describe.skip;

const period = {
  start: "2026-07-06",
  end: "2026-07-12",
  previousStart: "2026-06-29",
  previousEnd: "2026-07-05",
};

const mockSendMail = vi.hoisted(() =>
  vi.fn().mockImplementation(({ to }: { to: string }) => {
    if (to.startsWith("rep-fail-")) throw new Error("simulated email failure");
    return Promise.resolve({ messageId: "mock-message-id" });
  }),
);

vi.mock("nodemailer", () => {
  return {
    default: {
      createTransport: vi.fn().mockReturnValue({
        sendMail: mockSendMail,
      }),
      createTestAccount: vi.fn().mockResolvedValue({ user: "test", pass: "test" }),
      getTestMessageUrl: vi.fn().mockReturnValue("https://smtp.ethereal.email/message/1"),
    },
  };
});

suite("weekly financial reporting integration", () => {
  if (!run) return;

  const admin = createClient(url!, secret!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const stamp = Date.now();
  let userId = "";
  let optedOutUserId = "";
  let failingUserId = "";
  let itemDbId = "";
  let checkingId = "";
  let creditId = "";

  beforeAll(async () => {
    // 1. Create temporary user
    const { data: userData, error: userError } = await admin.auth.admin.createUser({
      email: `rep-${stamp}@example.com`,
      password: "Password123!",
      email_confirm: true,
    });
    if (userError) throw userError;
    userId = userData.user.id;

    const [optedOutResult, failingResult] = await Promise.all([
      admin.auth.admin.createUser({
        email: `rep-off-${stamp}@example.com`,
        password: "Password123!",
        email_confirm: true,
      }),
      admin.auth.admin.createUser({
        email: `rep-fail-${stamp}@example.com`,
        password: "Password123!",
        email_confirm: true,
      }),
    ]);
    if (optedOutResult.error) throw optedOutResult.error;
    if (failingResult.error) throw failingResult.error;
    optedOutUserId = optedOutResult.data.user.id;
    failingUserId = failingResult.data.user.id;
    const { error: profileError } = await admin
      .from("profiles")
      .upsert([
        { id: userId, weekly_report_enabled: true, timezone: "America/Los_Angeles" },
        { id: optedOutUserId, weekly_report_enabled: false, timezone: "America/Los_Angeles" },
        { id: failingUserId, weekly_report_enabled: true, timezone: "America/Los_Angeles" },
      ]);
    if (profileError) throw profileError;

    // 2. Store item
    itemDbId = await storeItem({
      userId,
      plaidItemId: `item-rep-${stamp}`,
      accessToken: "mock-token",
      institutionName: "Test Bank",
    });

    // 3. Create checking and credit accounts
    const { data: accountsData, error: accountsError } = await admin
      .from("accounts")
      .insert([
        {
          user_id: userId,
          plaid_item_id: itemDbId,
          plaid_account_id: `checking-${stamp}`,
          name: "Checking",
          type: "depository",
          subtype: "checking",
          current_balance: 1000.0,
        },
        {
          user_id: userId,
          plaid_item_id: itemDbId,
          plaid_account_id: `credit-${stamp}`,
          name: "Visa",
          type: "credit",
          subtype: "credit card",
          current_balance: 250.0,
        },
      ])
      .select();
    if (accountsError) throw accountsError;

    checkingId = accountsData.find((a) => a.type === "depository")!.id;
    creditId = accountsData.find((a) => a.type === "credit")!.id;

    // 4. Seed transactions
    const activeTxn1Date = "2026-07-10";
    const activeTxn2Date = "2026-07-09";
    const prevTxnDate = "2026-07-02";

    const { error: txnsError } = await admin.from("transactions").insert([
      {
        user_id: userId,
        account_id: checkingId,
        plaid_transaction_id: `txn-rep-1-${stamp}`,
        amount: 50.0, // active week expense
        date: activeTxn1Date,
        name: "Whole Foods",
        pfc_primary: "FOOD_AND_DRINK",
      },
      {
        user_id: userId,
        account_id: checkingId,
        plaid_transaction_id: `txn-rep-2-${stamp}`,
        amount: -200.0, // active week deposit
        date: activeTxn2Date,
        name: "Direct Deposit",
        pfc_primary: "INCOME",
      },
      {
        user_id: userId,
        account_id: creditId,
        plaid_transaction_id: `txn-rep-3-${stamp}`,
        amount: 30.0, // active week credit expense
        date: activeTxn1Date,
        name: "Uber",
        pfc_primary: "TRAVEL",
      },
      {
        user_id: userId,
        account_id: checkingId,
        plaid_transaction_id: `txn-rep-4-${stamp}`,
        amount: 40.0, // prev week checking expense
        date: prevTxnDate,
        name: "Gas Station",
        pfc_primary: "TRAVEL",
      },
    ]);
    if (txnsError) throw txnsError;
  });

  afterAll(async () => {
    if (userId) {
      await admin.auth.admin.deleteUser(userId);
    }
    if (optedOutUserId) await admin.auth.admin.deleteUser(optedOutUserId);
    if (failingUserId) await admin.auth.admin.deleteUser(failingUserId);
  });

  it("calculates weekly report data correctly", async () => {
    const report = await getWeeklyReportData(admin, userId, period);
    expect(report).not.toBeNull();
    if (!report) return;

    expect(report.totalSpend).toBe(80.0); // 50 (checking) + 30 (credit)
    expect(report.previousTotalSpend).toBe(40.0); // 40 (prev week checking)
    expect(report.cashFlow.inflows).toBe(200.0); // Direct deposit
    expect(report.cashFlow.outflows).toBe(50.0); // Whole foods
    expect(report.cashFlow.net).toBe(150.0);

    expect(report.categories).toContainEqual({
      category: "FOOD_AND_DRINK",
      amount: 50.0,
      share: 0.625,
    });
    expect(report.categories).toContainEqual({
      category: "TRAVEL",
      amount: 30.0,
      share: 0.375,
    });
    expect(report.banks).toEqual([{ name: "Test Bank", amount: 80 }]);
    expect(report.cards).toEqual([{ name: "Visa", amount: 30 }]);
    expect(report).not.toHaveProperty("accounts");
  });

  it("generates a PDF report buffer", async () => {
    const report = await getWeeklyReportData(admin, userId, period);
    expect(report).not.toBeNull();
    if (!report) return;

    const buffer = await generateWeeklyReportPdf(report);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
  });

  it("sends once per period, respects opt-out, and isolates send failures", async () => {
    const reference = new Date("2026-07-13T15:15:00.000Z");
    const first = await runWeeklyReports(reference);
    const second = await runWeeklyReports(reference);

    expect(first.reports_sent).toBeGreaterThanOrEqual(1);
    expect(first.reports_failed).toBeGreaterThanOrEqual(1);
    expect(second.reports_sent).toBe(0);
    expect(second.reports_skipped).toBeGreaterThanOrEqual(1);

    const { data: successfulDeliveries } = await admin
      .from("weekly_report_deliveries")
      .select("status")
      .eq("user_id", userId)
      .eq("period_start", period.start);
    const { data: optedOutDeliveries } = await admin
      .from("weekly_report_deliveries")
      .select("status")
      .eq("user_id", optedOutUserId)
      .eq("period_start", period.start);

    expect(successfulDeliveries).toEqual([{ status: "sent" }]);
    expect(optedOutDeliveries).toEqual([]);
  });
});
