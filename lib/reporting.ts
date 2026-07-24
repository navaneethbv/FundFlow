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

/** Monthly encrypted-backup delivery (2.1). The attachment is ciphertext. */
export async function sendBackupEmail(
  toEmail: string,
  filename: string,
  archive: Buffer,
  periodLabel: string,
) {
  const { hostConfigured, transporter } = await createMailTransport();
  const info = await transporter.sendMail({
    from: process.env.SMTP_FROM ?? "FundFlow <onboarding@resend.dev>",
    to: toEmail,
    subject: `FundFlow encrypted backup — ${periodLabel}`,
    text: [
      "Attached is your monthly FundFlow data backup.",
      "It is gzip-compressed and AES-256-GCM encrypted with your BACKUP_ENC_KEY.",
      "To restore or inspect it: node scripts/restore-backup.mjs <file> (needs BACKUP_ENC_KEY in the environment).",
      "Keep the key somewhere separate from this email.",
    ].join("\n"),
    attachments: [
      {
        filename,
        content: archive,
        contentType: "application/octet-stream",
      },
    ],
  });
  if (!hostConfigured) logDevelopmentPreview(info);
  return info;
}

/** New-device login alert (7.1): device family only — never IPs or tokens. */
export async function sendLoginAlertEmail(toEmail: string, deviceLabel: string) {
  const { hostConfigured, transporter } = await createMailTransport();
  const info = await transporter.sendMail({
    from: process.env.SMTP_FROM ?? "FundFlow <onboarding@resend.dev>",
    to: toEmail,
    subject: "New sign-in to your FundFlow account",
    text: [
      `A new device just signed in to your FundFlow account: ${deviceLabel}.`,
      "",
      "If this was you, no action is needed.",
      "If not: open Settings → Sessions and revoke everything, then change your password.",
    ].join("\n"),
  });
  if (!hostConfigured) logDevelopmentPreview(info);
  return info;
}

/** Household invite (4.1): a signed accept link, nothing financial. */
export async function sendHouseholdInviteEmail(
  toEmail: string,
  inviterEmail: string,
  householdName: string,
  acceptUrl: string,
) {
  const { hostConfigured, transporter } = await createMailTransport();
  const info = await transporter.sendMail({
    from: process.env.SMTP_FROM ?? "FundFlow <onboarding@resend.dev>",
    to: toEmail,
    subject: `${inviterEmail} invited you to the "${householdName}" household on FundFlow`,
    text: [
      `${inviterEmail} invited you to join the "${householdName}" household on FundFlow.`,
      "",
      `Accept (sign in to FundFlow first, then open): ${acceptUrl}`,
      "",
      "The link expires in 7 days. If you don't recognize the sender, ignore this email.",
    ].join("\n"),
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
