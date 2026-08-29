import {
  getWeeklyReportPeriod,
  normalizeReportTimezone,
} from "@/lib/report-period";

export interface StoredDeliveryRow {
  period_start: string;
  period_end: string;
  status: string;
  error_code?: string | null;
  attempted_at?: string | null;
  sent_at?: string | null;
}

export interface WeeklyDeliveryHistoryItem {
  periodStart: string;
  periodEnd: string;
  status: "processing" | "sent" | "failed" | "skipped" | "missing";
  reason: string | null;
  attemptedAt: string | null;
  sentAt: string | null;
}

function humanizeReason(
  status: string,
  errorCode?: string | null,
): string | null {
  if (status === "sent") return null;
  if (!errorCode) {
    if (status === "missing") return "No run recorded";
    if (status === "skipped") return "Skipped";
    if (status === "failed") return "Delivery failed";
    return null;
  }
  switch (errorCode) {
    case "disabled":
      return "Weekly reports disabled";
    case "no_data":
      return "No transaction activity";
    case "smtp_error":
    case "email_delivery_failed":
      return "Email delivery service issue";
    case "pdf_generation_failed":
      return "Report summary generation issue";
    default:
      return errorCode.replace(/_/g, " ");
  }
}

export function buildWeeklyDeliveryHistory(
  storedDeliveries: StoredDeliveryRow[],
  anchorDate = new Date(),
  timezone = "America/Los_Angeles",
  windowWeeks = 6,
): WeeklyDeliveryHistoryItem[] {
  const normTz = normalizeReportTimezone(timezone);
  const byPeriod = new Map<string, StoredDeliveryRow>();
  for (const row of storedDeliveries) {
    byPeriod.set(row.period_start, row);
  }

  const items: WeeklyDeliveryHistoryItem[] = [];
  const latestPeriod = getWeeklyReportPeriod(anchorDate, normTz);

  const addDays = (dateStr: string, days: number): string => {
    const [y, m, d] = dateStr.split("-").map(Number);
    const date = new Date(Date.UTC(y!, m! - 1, d! + days));
    return date.toISOString().slice(0, 10);
  };

  for (let i = 0; i < windowWeeks; i++) {
    const start = addDays(latestPeriod.start, -i * 7);
    const end = addDays(latestPeriod.end, -i * 7);
    const stored = byPeriod.get(start);

    if (stored) {
      const status =
        (stored.status as WeeklyDeliveryHistoryItem["status"]) || "processing";
      items.push({
        periodStart: stored.period_start,
        periodEnd: stored.period_end,
        status,
        reason: humanizeReason(status, stored.error_code),
        attemptedAt: stored.attempted_at ?? null,
        sentAt: stored.sent_at ?? null,
      });
    } else {
      items.push({
        periodStart: start,
        periodEnd: end,
        status: "missing",
        reason: "No run recorded",
        attemptedAt: null,
        sentAt: null,
      });
    }
  }

  return items;
}
