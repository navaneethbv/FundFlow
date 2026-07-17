import "server-only";
import nodemailer from "nodemailer";
import {
  renderDailyDigestEmail,
  renderWeeklyReportEmail,
  type DigestNotification,
} from "@/lib/report-email";
import type { WeeklyReportData } from "@/lib/weekly-report";

async function createMailTransport() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? "587");
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (host && user && pass) {
    return {
      hostConfigured: true,
      transporter: nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
      }),
    };
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SMTP is not configured (SMTP_HOST/SMTP_USER/SMTP_PASS); refusing to send financial email",
    );
  }

  const testAccount = await nodemailer.createTestAccount();
  return {
    hostConfigured: false,
    transporter: nodemailer.createTransport({
      host: "smtp.ethereal.email",
      port: 587,
      secure: false,
      auth: { user: testAccount.user, pass: testAccount.pass },
    }),
  };
}

function logDevelopmentPreview(info: Awaited<ReturnType<ReturnType<typeof nodemailer.createTransport>["sendMail"]>>) {
  const previewUrl = nodemailer.getTestMessageUrl(info);
  if (previewUrl) console.log(`[nodemailer] Development email preview: ${previewUrl}`);
}

export async function sendWeeklyReportEmail(
  data: WeeklyReportData,
  pdfBuffer: Buffer,
  dashboardUrl: string,
) {
  const { hostConfigured, transporter } = await createMailTransport();
  const content = renderWeeklyReportEmail(data, dashboardUrl);
  const info = await transporter.sendMail({
    from: process.env.SMTP_FROM ?? "FundFlow <onboarding@resend.dev>",
    to: data.userEmail,
    subject: content.subject,
    text: content.text,
    html: content.html,
    attachments: [
      {
        filename: `fundflow-weekly-${data.period.start}-${data.period.end}.pdf`,
        content: pdfBuffer,
        contentType: "application/pdf",
      },
    ],
  });
  if (!hostConfigured) logDevelopmentPreview(info);
  return info;
}

export async function sendDailyDigestEmail(
  toEmail: string,
  notifications: DigestNotification[],
  date: string,
  notificationsUrl: string,
) {
  const { hostConfigured, transporter } = await createMailTransport();
  const content = renderDailyDigestEmail(notifications, date, notificationsUrl);
  const info = await transporter.sendMail({
    from: process.env.SMTP_FROM ?? "FundFlow <onboarding@resend.dev>",
    to: toEmail,
    subject: content.subject,
    text: content.text,
    html: content.html,
  });
  if (!hostConfigured) logDevelopmentPreview(info);
  return info;
}

export interface CronAlertSummary {
  failed: number;
  total: number;
  /**
   * First error message of the run. Error messages only (the same strings
   * logError already emits); never payloads, balances, or PII.
   */
  firstError?: string;
}

export async function sendCronAlertEmail(
  toEmail: string,
  cronName: string,
  summary: CronAlertSummary,
) {
  const { hostConfigured, transporter } = await createMailTransport();
  const lines = [
    `The ${cronName} cron run at ${new Date().toISOString()} reported failures.`,
    `Failed: ${summary.failed} of ${summary.total}.`,
    summary.firstError ? `First error: ${summary.firstError.slice(0, 200)}` : null,
    "Check the Vercel logs and the dashboard sync status for detail.",
  ].filter((line): line is string => Boolean(line));
  const info = await transporter.sendMail({
    from: process.env.SMTP_FROM ?? "FundFlow <onboarding@resend.dev>",
    to: toEmail,
    subject: `FundFlow cron failure: ${cronName}`,
    text: lines.join("\n"),
  });
  if (!hostConfigured) logDevelopmentPreview(info);
  return info;
}
