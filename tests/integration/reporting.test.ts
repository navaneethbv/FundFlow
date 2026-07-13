import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { getWeeklyReportData } from "@/lib/weekly-report-data";
import { generateWeeklyReportPdf } from "@/lib/report-pdf";
import { GET as weeklyReportGet } from "@/app/api/cron/weekly-report/route";
import { NextRequest } from "next/server";
import { serverEnv } from "@/lib/env.server";
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

vi.mock("nodemailer", () => {
  return {
    default: {
      createTransport: vi.fn().mockReturnValue({
        sendMail: vi.fn().mockResolvedValue({ messageId: "mock-message-id" }),
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

  it("runs the weekly cron report route successfully with auth", async () => {
    const req = new NextRequest("http://localhost/api/cron/weekly-report", {
      method: "GET",
      headers: {
        authorization: `Bearer ${serverEnv.cronSecret}`,
      },
    });

    const resp = await weeklyReportGet(req);
    expect(resp.status).toBe(200);

    const body = await resp.json();
    expect(body.ok).toBe(true);
    expect(body.reports_sent).toBeGreaterThanOrEqual(1);
  });
});
