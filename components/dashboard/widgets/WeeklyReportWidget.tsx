import Link from "next/link";
import Badge, { type BadgeTone } from "@/components/ui/Badge";
import Panel from "@/components/ui/Panel";
import type { LatestWeeklyDelivery } from "@/lib/weekly-delivery-history";

function deliveryDisplay(
  delivery: LatestWeeklyDelivery,
): { label: string; tone: BadgeTone; detail: string } {
  switch (delivery.status) {
    case "sent":
      return { label: "Delivered", tone: "success", detail: "Open Reports to explore this period." };
    case "processing":
      return { label: "Preparing", tone: "neutral", detail: "Your weekly report is being generated." };
    case "failed":
      return { label: "Delivery failed", tone: "danger", detail: "Check your Notifications for the full history." };
    default:
      return { label: "Skipped", tone: "neutral", detail: "This week's report was skipped." };
  }
}

/**
 * Dashboard entry point for the latest weekly report. Shows delivery status
 * and links to the reports workspace; Notifications remains the canonical
 * delivery history.
 */
export default function WeeklyReportWidget({
  delivery,
}: Readonly<{ delivery: LatestWeeklyDelivery | null }>) {
  if (!delivery) {
    return (
      <Panel title="Weekly report" eyebrow="Recap">
        <p className="text-sm text-muted">
          No weekly report has been generated yet. Reports are delivered weekly to your
          Notifications.
        </p>
      </Panel>
    );
  }
  const display = deliveryDisplay(delivery);
  return (
    <Panel title="Weekly report" eyebrow="Recap">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">
            {delivery.periodStart} to {delivery.periodEnd}
          </p>
          <p className="mt-1 text-sm text-muted">{display.detail}</p>
        </div>
        <Badge tone={display.tone}>{display.label}</Badge>
      </div>
      <Link
        href="/reports"
        className="mt-4 inline-block text-xs font-semibold text-accent hover:underline"
      >
        Open reports
      </Link>
    </Panel>
  );
}
