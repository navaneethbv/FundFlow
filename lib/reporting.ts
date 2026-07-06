import "server-only";
import PDFDocument from "pdfkit";
import nodemailer from "nodemailer";
import { SupabaseClient } from "@supabase/supabase-js";
import { formatCurrency, titleCase } from "./format";

export interface WeeklyReportData {
  userId: string;
  userEmail: string;
  totalSpend: number;
  prevTotalSpend: number;
  categories: { category: string; amount: number }[];
  merchants: { merchant: string; amount: number }[];
  cashFlow: {
    inflows: number;
    outflows: number;
    net: number;
  };
  accounts: { name: string; balance: number; subtype: string }[];
}

export async function getWeeklyReportData(
  supabase: SupabaseClient,
  userId: string,
): Promise<WeeklyReportData | null> {
  // Get user details
  const { data: userData } = await supabase.auth.admin.getUserById(userId);
  if (!userData?.user?.email) return null;
  const email = userData.user.email;

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);

  // Active week: last 7 days
  const sevenDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
  const sevenDaysAgoStr = sevenDaysAgo.toISOString().slice(0, 10);

  // Previous week: 7 to 14 days ago
  const fourteenDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 14);
  const fourteenDaysAgoStr = fourteenDaysAgo.toISOString().slice(0, 10);

  const [
    { data: accounts },
    { data: txns },
  ] = await Promise.all([
    supabase
      .from("accounts")
      .select("id, name, type, subtype, current_balance"),
    supabase
      .from("transactions")
      .select("date, amount, merchant_name, name, pfc_primary, account_id")
      .eq("user_id", userId)
      .gte("date", fourteenDaysAgoStr)
      .lte("date", todayStr),
  ]);

  const allAccounts = accounts ?? [];
  const allTxns = txns ?? [];

  let totalSpend = 0;
  let prevTotalSpend = 0;

  let inflows = 0;
  let outflows = 0;

  const activeCategories: Record<string, number> = {};
  const activeMerchants: Record<string, number> = {};

  for (const t of allTxns) {
    const acct = allAccounts.find((a) => a.id === t.account_id);
    if (!acct) continue;

    const isActiveWeek = t.date >= sevenDaysAgoStr && t.date <= todayStr;
    const isPrevWeek = t.date >= fourteenDaysAgoStr && t.date < sevenDaysAgoStr;

    if (acct.type === "credit") {
      if (t.amount > 0) {
        if (isActiveWeek) {
          totalSpend += t.amount;
          const cat = t.pfc_primary ?? "Uncategorized";
          activeCategories[cat] = (activeCategories[cat] ?? 0) + t.amount;
          const merch = t.merchant_name ?? t.name ?? "Unknown Merchant";
          activeMerchants[merch] = (activeMerchants[merch] ?? 0) + t.amount;
        } else if (isPrevWeek) {
          prevTotalSpend += t.amount;
        }
      }
    } else if (acct.type === "depository") {
      if (t.amount > 0) {
        // Outflow
        if (isActiveWeek) {
          totalSpend += t.amount;
          outflows += t.amount;
          const cat = t.pfc_primary ?? "Uncategorized";
          activeCategories[cat] = (activeCategories[cat] ?? 0) + t.amount;
          const merch = t.merchant_name ?? t.name ?? "Unknown Merchant";
          activeMerchants[merch] = (activeMerchants[merch] ?? 0) + t.amount;
        } else if (isPrevWeek) {
          prevTotalSpend += t.amount;
        }
      } else if (t.amount < 0) {
        // Inflow
        if (isActiveWeek) {
          inflows += Math.abs(t.amount);
        }
      }
    }
  }

  // Sort and compile categories
  const categoriesList = Object.entries(activeCategories)
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  // Sort and compile merchants
  const merchantsList = Object.entries(activeMerchants)
    .map(([merchant, amount]) => ({ merchant, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  const depositoryAccounts = allAccounts
    .filter((a) => a.type === "depository")
    .map((a) => ({
      name: a.name,
      balance: a.current_balance,
      subtype: a.subtype ?? "checking",
    }));

  return {
    userId,
    userEmail: email,
    totalSpend,
    prevTotalSpend,
    categories: categoriesList,
    merchants: merchantsList,
    cashFlow: {
      inflows,
      outflows,
      net: inflows - outflows,
    },
    accounts: depositoryAccounts,
  };
}

export function generateWeeklyReportPdf(data: WeeklyReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", (err) => reject(err));

    // Colors
    const primaryColor = "#0F172A"; // slate-900
    const secondaryColor = "#1E293B"; // slate-800
    const accentGreen = "#15803D"; // green-700
    const accentRed = "#B91C1C"; // red-700
    const textGray = "#475569"; // slate-600
    const lightGray = "#F1F5F9"; // slate-100

    // Header Background Accent
    doc.rect(0, 0, 612, 110).fill("#F8FAFC");

    // Title
    doc.fillColor(primaryColor).font("Helvetica-Bold").fontSize(24).text("FundFlow Weekly Report", 50, 40);
    doc.fillColor(textGray).font("Helvetica").fontSize(10).text(`Weekly insight summary for ${data.userEmail}`, 50, 70);
    doc.fontSize(9).text(`Generated: ${new Date().toLocaleDateString()}`, 50, 85);

    doc.y = 130;

    // Weekly Spend Highlight
    doc.fillColor(primaryColor).font("Helvetica-Bold").fontSize(16).text("Weekly Spend Summary");
    doc.moveDown(0.5);

    // Spend Box
    doc.rect(50, doc.y, 512, 60).fill(lightGray);
    const startY = doc.y + 12;

    doc.fillColor(secondaryColor).font("Helvetica-Bold").fontSize(11).text("Spent This Week", 70, startY);
    doc.fillColor(primaryColor).font("Helvetica-Bold").fontSize(16).text(formatCurrency(data.totalSpend), 70, startY + 18);

    doc.fillColor(secondaryColor).font("Helvetica-Bold").fontSize(11).text("Previous Week", 250, startY);
    doc.fillColor(textGray).font("Helvetica-Bold").fontSize(16).text(formatCurrency(data.prevTotalSpend), 250, startY + 18);

    const diff = data.totalSpend - data.prevTotalSpend;
    const diffPercent = data.prevTotalSpend > 0 ? (Math.abs(diff) / data.prevTotalSpend) * 100 : 0;
    doc.fillColor(secondaryColor).font("Helvetica-Bold").fontSize(11).text("Weekly Trend", 410, startY);

    if (diff > 0) {
      doc.fillColor(accentRed).font("Helvetica-Bold").fontSize(14).text(`+${diffPercent.toFixed(0)}% Up`, 410, startY + 18);
    } else if (diff < 0) {
      doc.fillColor(accentGreen).font("Helvetica-Bold").fontSize(14).text(`-${diffPercent.toFixed(0)}% Down`, 410, startY + 18);
    } else {
      doc.fillColor(textGray).font("Helvetica-Bold").fontSize(14).text("Flat", 410, startY + 18);
    }

    doc.y = startY + 60;
    doc.moveDown(2);

    // Top Categories & Merchants (Side-by-side)
    const columnsY = doc.y;

    // Left Column: Categories
    doc.fillColor(primaryColor).font("Helvetica-Bold").fontSize(14).text("Top Categories", 50, columnsY);
    doc.moveDown(0.5);
    if (data.categories.length === 0) {
      doc.fillColor(textGray).font("Helvetica").fontSize(10).text("No categories recorded.");
    } else {
      let catY = columnsY + 25;
      for (const cat of data.categories) {
        doc.fillColor(secondaryColor).font("Helvetica-Bold").fontSize(10).text(titleCase(cat.category), 50, catY);
        doc.fillColor(textGray).font("Helvetica").fontSize(10).text(formatCurrency(cat.amount), 220, catY, { align: "right", width: 50 });
        catY += 18;
      }
    }

    // Right Column: Merchants
    doc.fillColor(primaryColor).font("Helvetica-Bold").fontSize(14).text("Top Merchants", 320, columnsY);
    doc.moveDown(0.5);
    if (data.merchants.length === 0) {
      doc.fillColor(textGray).font("Helvetica").fontSize(10).text("No merchants recorded.", 320);
    } else {
      let merchY = columnsY + 25;
      for (const merch of data.merchants) {
        doc.fillColor(secondaryColor).font("Helvetica-Bold").fontSize(10).text(merch.merchant, 320, merchY, { width: 140, height: 12, ellipsis: true });
        doc.fillColor(textGray).font("Helvetica").fontSize(10).text(formatCurrency(merch.amount), 512, merchY, { align: "right", width: 50 });
        merchY += 18;
      }
    }

    doc.y = Math.max(columnsY + 130, doc.y);
    doc.moveDown(2.5);

    // Checking Cash Flow
    doc.fillColor(primaryColor).font("Helvetica-Bold").fontSize(14).text("Weekly Cash Flow (Checking/Savings)", 50);
    doc.moveDown(0.5);

    doc.rect(50, doc.y, 512, 50).fill(lightGray);
    const flowY = doc.y + 12;

    doc.fillColor(secondaryColor).font("Helvetica-Bold").fontSize(10).text("Deposits (In)", 70, flowY);
    doc.fillColor(accentGreen).font("Helvetica-Bold").fontSize(12).text(`+${formatCurrency(data.cashFlow.inflows)}`, 70, flowY + 16);

    doc.fillColor(secondaryColor).font("Helvetica-Bold").fontSize(10).text("Withdrawals (Out)", 250, flowY);
    doc.fillColor(accentRed).font("Helvetica-Bold").fontSize(12).text(`-${formatCurrency(data.cashFlow.outflows)}`, 250, flowY + 16);

    doc.fillColor(secondaryColor).font("Helvetica-Bold").fontSize(10).text("Net Saving Flow", 410, flowY);
    const isPositive = data.cashFlow.net >= 0;
    doc.fillColor(isPositive ? accentGreen : accentRed)
      .font("Helvetica-Bold")
      .fontSize(12)
      .text(`${isPositive ? "+" : ""}${formatCurrency(data.cashFlow.net)}`, 410, flowY + 16);

    doc.y = flowY + 50;
    doc.moveDown(2.5);

    // Depository Balances
    doc.fillColor(primaryColor).font("Helvetica-Bold").fontSize(14).text("Account Balances", 50);
    doc.moveDown(0.5);
    if (data.accounts.length === 0) {
      doc.fillColor(textGray).font("Helvetica").fontSize(10).text("No active checking or savings accounts connected.");
    } else {
      let acctY = doc.y;
      for (const a of data.accounts) {
        doc.fillColor(secondaryColor).font("Helvetica-Bold").fontSize(10).text(`${a.name} (${titleCase(a.subtype)})`, 50, acctY);
        doc.fillColor(secondaryColor).font("Helvetica-Bold").fontSize(10).text(formatCurrency(a.balance), 512, acctY, { align: "right", width: 50 });
        acctY += 18;
      }
      doc.y = acctY;
    }

    // Divider Line above footer
    doc.strokeColor("#E2E8F0").lineWidth(1).moveTo(50, 710).lineTo(562, 710).stroke();

    // Footer
    doc.fillColor("#94A3B8").font("Helvetica").fontSize(8).text(
      "This weekly insight report is strictly confidential and generated for your personal use. All financial data is aggregated privately.",
      50,
      722,
      { align: "center", width: 512 }
    );

    doc.end();
  });
}

export async function sendWeeklyReportEmail(
  toEmail: string,
  pdfBuffer: Buffer,
  dateStr: string,
) {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? "587");
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM ?? "FundFlow <onboarding@resend.dev>";

  let transporter;

  if (host && user && pass) {
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
  } else {
    // Fallback: provision a test Ethereal account
    const testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: "smtp.ethereal.email",
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
    });
  }

  const info = await transporter.sendMail({
    from,
    to: toEmail,
    subject: `FundFlow Weekly Financial Report · ${dateStr}`,
    text: "Please find attached your weekly FundFlow financial summary and spend insights report in PDF format.",
    html: `
      <div style="font-family: sans-serif; max-width: 580px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; rounded-lg">
        <h2 style="color: #0f172a">Your Weekly Financial Summary</h2>
        <p style="color: #334155; line-height: 1.5">
          Here is your weekly summary of balances, spending pacing, top categories, and cash flows. We have compiled these insights into a nicely crafted PDF report attached to this email.
        </p>
        <p style="color: #64748b; font-size: 13px">
          Thank you for using FundFlow to keep your budget balanced.
        </p>
      </div>
    `,
    attachments: [
      {
        filename: `weekly-insights-${dateStr}.pdf`,
        content: pdfBuffer,
      },
    ],
  });

  if (!host) {
    // Log the Ethereal email preview link for developers
    const previewUrl = nodemailer.getTestMessageUrl(info);
    console.log(`[nodemailer] Test report email sent! Preview URL: ${previewUrl}`);
  }

  return info;
}
