import { formatCurrency, titleCase } from "@/lib/format";
import type { WeeklyReportData } from "@/lib/weekly-report";

const COLORS = {
  ink: "#0f1523",
  muted: "#5c6778",
  canvas: "#f3f5f9",
  panel: "#ffffff",
  line: "#dfe5ee",
  accent: "#2563eb",
  teal: "#0ea5a5",
  success: "#0f9f6e",
  warning: "#b45309",
  danger: "#d03b3b",
};

const HTML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#039;",
};

export function escapeEmailHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ENTITIES[character]!);
}

function formatPeriodDate(value: string, includeYear = false): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    ...(includeYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year!, month! - 1, day!)));
}

function periodLabel(data: WeeklyReportData): string {
  const start = formatPeriodDate(data.period.start);
  const end = formatPeriodDate(data.period.end, true);
  const startMonth = start.split(" ")[0];
  const endMonth = end.split(" ")[0];
  if (startMonth === endMonth) {
    return `${start}-${end.replace(`${endMonth} `, "")}`;
  }
  return `${start}-${end}`;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value * 100)));
}

function accountLabel(value: string): string {
  return value
    .replace(/\s+(?:(?:•{2}|\*{2,}|x{2,})\s*)?\d{4}\b/gi, "")
    .trim();
}

function sectionHeading(title: string, eyebrow: string): string {
  return `
    <tr>
      <td style="padding:28px 32px 10px;border-left:3px solid ${COLORS.accent};">
        <div style="font-size:11px;line-height:16px;letter-spacing:1.2px;text-transform:uppercase;color:${COLORS.accent};font-weight:700;">${escapeEmailHtml(eyebrow)}</div>
        <div style="font-size:20px;line-height:28px;color:${COLORS.ink};font-weight:700;">${escapeEmailHtml(title)}</div>
      </td>
    </tr>`;
}

function emptyRow(message: string): string {
  return `<tr><td style="padding:10px 32px 4px;color:${COLORS.muted};font-size:14px;line-height:21px;">${escapeEmailHtml(message)}</td></tr>`;
}

function barRows(
  rows: Array<{ label: string; amount: number; ratio: number }>,
  color: string,
): string {
  if (rows.length === 0) return emptyRow("No spending recorded for this section.");
  return rows
    .map(
      (row) => `
      <tr>
        <td style="padding:8px 32px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td style="color:${COLORS.ink};font-size:14px;line-height:20px;font-weight:600;">${escapeEmailHtml(row.label)}</td>
              <td align="right" style="color:${COLORS.ink};font-size:14px;line-height:20px;font-weight:700;">${formatCurrency(row.amount)}</td>
            </tr>
            <tr>
              <td colspan="2" style="padding-top:6px;">
                <div style="height:8px;border-radius:4px;background:${COLORS.line};overflow:hidden;">
                  <div style="width:${clampPercent(row.ratio)}%;height:8px;border-radius:4px;background:${color};font-size:0;line-height:0;">&nbsp;</div>
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>`,
    )
    .join("");
}

function metricCell(label: string, value: string, color = COLORS.ink): string {
  return `<td width="33.33%" valign="top" style="padding:18px 14px;background:${COLORS.panel};border:1px solid ${COLORS.line};">
    <div style="font-size:11px;line-height:16px;text-transform:uppercase;letter-spacing:.8px;color:${COLORS.muted};font-weight:700;">${escapeEmailHtml(label)}</div>
    <div style="padding-top:4px;font-size:22px;line-height:28px;color:${color};font-weight:700;">${escapeEmailHtml(value)}</div>
  </td>`;
}

export function renderWeeklyReportEmail(
  data: WeeklyReportData,
  dashboardUrl: string,
): { subject: string; html: string; text: string } {
  const range = periodLabel(data);
  const change =
    data.changePercent === null
      ? "No prior data"
      : `${data.changePercent > 0 ? "+" : ""}${Math.round(data.changePercent * 100)}%`;
  const changeColor =
    data.changeAmount <= 0 ? COLORS.success : COLORS.danger;
  const maxBank = Math.max(1, ...data.banks.map((row) => row.amount));
  const maxCard = Math.max(1, ...data.cards.map((row) => row.amount));
  const safeDashboardUrl = escapeEmailHtml(dashboardUrl);

  const categoryHtml = barRows(
    data.categories.map((category) => ({
      label: titleCase(category.category),
      amount: category.amount,
      ratio: category.share,
    })),
    COLORS.accent,
  );
  const bankHtml = barRows(
    data.banks.map((bank) => ({
      label: bank.name,
      amount: bank.amount,
      ratio: bank.amount / maxBank,
    })),
    COLORS.teal,
  );
  const cardHtml = barRows(
    data.cards.map((card) => ({
      label: accountLabel(card.name),
      amount: card.amount,
      ratio: card.amount / maxCard,
    })),
    "#4a3aa7",
  );
  const budgetHtml = data.budgets.length
    ? data.budgets
        .map((budget) => {
          const tone =
            budget.status === "over"
              ? COLORS.danger
              : budget.status === "at-risk"
                ? COLORS.warning
                : COLORS.success;
          return `
          <tr>
            <td style="padding:9px 32px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="font-size:14px;line-height:20px;color:${COLORS.ink};font-weight:600;">${escapeEmailHtml(titleCase(budget.category))}</td>
                  <td align="right" style="font-size:13px;line-height:20px;color:${tone};font-weight:700;">${escapeEmailHtml(budget.status.replace("-", " "))}</td>
                </tr>
                <tr>
                  <td colspan="2" style="padding-top:3px;color:${COLORS.muted};font-size:12px;line-height:18px;">${formatCurrency(budget.spent)} of ${formatCurrency(budget.weeklyAllowance)} weekly allowance</td>
                </tr>
                <tr><td colspan="2" style="padding-top:6px;"><div style="height:8px;border-radius:4px;background:${COLORS.line};overflow:hidden;"><div style="width:${clampPercent(budget.percentage)}%;height:8px;background:${tone};font-size:0;line-height:0;">&nbsp;</div></div></td></tr>
              </table>
            </td>
          </tr>`;
        })
        .join("")
    : emptyRow("No category budgets are configured.");
  const merchantHtml = data.merchants.length
    ? data.merchants
        .map(
          (merchant) => `<tr><td style="padding:7px 32px;color:${COLORS.ink};font-size:14px;line-height:20px;">${escapeEmailHtml(merchant.merchant)}</td><td align="right" style="padding:7px 32px 7px 12px;color:${COLORS.ink};font-size:14px;line-height:20px;font-weight:700;">${formatCurrency(merchant.amount)}</td></tr>`,
        )
        .join("")
    : emptyRow("No merchants recorded this week.");

  const html = `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>FundFlow weekly insights</title></head>
<body style="margin:0;padding:0;background:${COLORS.canvas};font-family:Arial,Helvetica,sans-serif;color:${COLORS.ink};">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${COLORS.canvas};">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background:${COLORS.panel};border:1px solid ${COLORS.line};border-radius:16px;overflow:hidden;">
        <tr><td style="padding:34px 32px 28px;background:${COLORS.ink};">
          <div style="font-size:12px;line-height:18px;letter-spacing:1.5px;text-transform:uppercase;color:#93c5fd;font-weight:700;">FundFlow weekly flow</div>
          <div style="padding-top:8px;font-size:30px;line-height:36px;color:#ffffff;font-weight:700;">Your money, in motion.</div>
          <div style="padding-top:8px;font-size:14px;line-height:21px;color:#cbd5e1;">Previous Monday through Sunday | ${escapeEmailHtml(range)}</div>
        </td></tr>
        <tr><td style="padding:20px 24px 6px;">
          <table role="presentation" width="100%" cellspacing="8" cellpadding="0" border="0"><tr>
            ${metricCell("Spent", formatCurrency(data.totalSpend))}
            ${metricCell("Prior week", formatCurrency(data.previousTotalSpend))}
            ${metricCell("Change", change, changeColor)}
          </tr></table>
        </td></tr>
        ${sectionHeading("Category breakdown", "Where it went")}
        ${categoryHtml}
        ${sectionHeading("Banks and credit cards", "How it moved")}
        <tr><td style="padding:6px 32px 0;color:${COLORS.muted};font-size:12px;line-height:18px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;">By bank</td></tr>
        ${bankHtml}
        <tr><td style="padding:18px 32px 0;color:${COLORS.muted};font-size:12px;line-height:18px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;">By credit card</td></tr>
        ${cardHtml}
        ${sectionHeading("Budget pacing", "Weekly allowance")}
        ${budgetHtml}
        ${sectionHeading("Top merchants", "Largest stops")}
        ${merchantHtml}
        ${sectionHeading("Cash flow", "Checking and savings")}
        <tr><td style="padding:8px 24px 12px;"><table role="presentation" width="100%" cellspacing="8" cellpadding="0" border="0"><tr>
          ${metricCell("Deposits", `+${formatCurrency(data.cashFlow.inflows)}`, COLORS.success)}
          ${metricCell("Withdrawals", `-${formatCurrency(data.cashFlow.outflows)}`, COLORS.danger)}
          ${metricCell("Net flow", `${data.cashFlow.net >= 0 ? "+" : ""}${formatCurrency(data.cashFlow.net)}`, data.cashFlow.net >= 0 ? COLORS.success : COLORS.danger)}
        </tr></table></td></tr>
        <tr><td align="center" style="padding:22px 32px 14px;"><a href="${safeDashboardUrl}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:${COLORS.accent};color:#ffffff;text-decoration:none;font-size:14px;line-height:20px;font-weight:700;">Open FundFlow</a></td></tr>
        <tr><td align="center" style="padding:0 32px 30px;color:${COLORS.muted};font-size:12px;line-height:18px;">Your expanded PDF report is attached. No account balances or transaction details are included.</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    `FundFlow weekly insights | ${range}`,
    "Previous Monday through Sunday",
    "",
    `Spent: ${formatCurrency(data.totalSpend)}`,
    `Prior week: ${formatCurrency(data.previousTotalSpend)}`,
    `Change: ${change}`,
    "",
    "Categories",
    ...data.categories.map(
      (category) =>
        `${titleCase(category.category)}: ${formatCurrency(category.amount)}`,
    ),
    "",
    "Banks",
    ...data.banks.map((bank) => `${bank.name}: ${formatCurrency(bank.amount)}`),
    "",
    "Credit cards",
    ...data.cards.map(
      (card) => `${accountLabel(card.name)}: ${formatCurrency(card.amount)}`,
    ),
    "",
    `Cash flow: ${formatCurrency(data.cashFlow.net)}`,
    `Dashboard: ${dashboardUrl}`,
  ].join("\n");

  return {
    subject: `FundFlow weekly insights | ${range}`,
    html,
    text,
  };
}

export interface DigestNotification {
  type: string;
  title: string;
  body: string;
}

export function renderDailyDigestEmail(
  notifications: DigestNotification[],
  date: string,
  notificationsUrl: string,
): { subject: string; html: string; text: string } {
  const rows = notifications
    .map(
      (notification) => `<tr><td style="padding:12px 16px;border:1px solid ${COLORS.line};background:#f7f9fc;"><div style="color:${COLORS.ink};font-size:14px;line-height:20px;font-weight:700;">${escapeEmailHtml(titleCase(notification.type.replace(/_/g, " ")))} | ${escapeEmailHtml(notification.title)}</div><div style="padding-top:4px;color:${COLORS.muted};font-size:13px;line-height:19px;">${escapeEmailHtml(notification.body)}</div></td></tr><tr><td height="8"></td></tr>`,
    )
    .join("");
  const html = `<html><body style="margin:0;background:${COLORS.canvas};font-family:Arial,Helvetica,sans-serif;"><table role="presentation" width="100%"><tr><td align="center" style="padding:24px 12px;"><table role="presentation" width="100%" style="max-width:600px;background:${COLORS.panel};border:1px solid ${COLORS.line};"><tr><td style="padding:28px 24px;"><h1 style="margin:0;color:${COLORS.ink};font-size:24px;line-height:31px;">Daily financial alerts</h1><p style="color:${COLORS.muted};font-size:14px;line-height:21px;">${escapeEmailHtml(date)} | ${notifications.length} alert${notifications.length === 1 ? "" : "s"}</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows}</table><p><a href="${escapeEmailHtml(notificationsUrl)}" style="color:${COLORS.accent};font-weight:700;">Review notifications</a></p></td></tr></table></td></tr></table></body></html>`;
  const text = [
    `FundFlow daily alerts | ${date}`,
    ...notifications.flatMap((notification) => [
      "",
      `${titleCase(notification.type.replace(/_/g, " "))}: ${notification.title}`,
      notification.body,
    ]),
    "",
    `Review notifications: ${notificationsUrl}`,
  ].join("\n");
  return { subject: `FundFlow daily alerts | ${date}`, html, text };
}
