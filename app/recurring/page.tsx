import { createClient } from "@/lib/supabase/server";
import AppShell from "@/components/shell/AppShell";
import { expandStreamsForMonth } from "@/lib/recurring-page";
import ReviewBanner from "@/components/recurring/ReviewBanner";
import MonthSummary from "@/components/recurring/MonthSummary";
import RecurringList from "@/components/recurring/RecurringList";
import RecurringCalendar from "@/components/recurring/RecurringCalendar";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isFeatureEnabled } from "@/lib/feature-flags";

export default async function RecurringPage(
  props: Readonly<{
    searchParams: Promise<{ month?: string; scope?: string; view?: string }>;
  }>,
) {
  if (!isFeatureEnabled("recurringPage")) {
    notFound();
  }

  const searchParams = await props.searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return null;

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const currentMonth = today.slice(0, 7);
  const selectedMonth = searchParams.month || currentMonth;
  const activeView = searchParams.view || "list";

  // Fetch recurring streams
  const { data: streamsRows } = await supabase
    .from("recurring_streams")
    .select("id, merchant_name, description, average_amount, user_amount, frequency, category, stream_type, is_active, predicted_next_date, last_date, reviewed_at, dismissed_at")
    .eq("is_active", true);

  const streams = (streamsRows || []).map((s) => ({
    id: s.id as string,
    merchant_name: s.merchant_name as string | null,
    description: s.description as string | null,
    average_amount: Number(s.average_amount),
    user_amount: s.user_amount ? Number(s.user_amount) : null,
    frequency: s.frequency as string,
    category: s.category as string | null,
    stream_type: s.stream_type as string | null,
    is_active: Boolean(s.is_active),
    predicted_next_date: s.predicted_next_date as string | null,
    last_date: s.last_date as string | null,
    reviewed_at: s.reviewed_at as string | null,
    dismissed_at: s.dismissed_at as string | null,
  }));

  // Fetch manual recurring items
  const { data: manualRows } = await supabase
    .from("manual_recurring_items")
    .select("id, merchant_name, amount, frequency, next_date, category");

  const manualItems = (manualRows || []).map((m) => ({
    id: m.id as string,
    merchant_name: m.merchant_name as string,
    amount: Number(m.amount),
    frequency: m.frequency as string,
    next_date: m.next_date as string,
    category: m.category as string | null,
  }));

  const monthData = expandStreamsForMonth({
    streams,
    manualItems,
    month: selectedMonth,
    today,
  });

  return (
    <AppShell active="recurring" email={user.email}>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Recurring</h1>
            <p className="text-sm text-muted">
              Track subscriptions, recurring bills, and expected streams for {selectedMonth}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center rounded-field border border-panel-border bg-panel p-1 text-xs">
              <Link
                href={`/recurring?month=${selectedMonth}&view=list`}
                className={`rounded px-2.5 py-1 font-semibold ${
                  activeView === "list" ? "bg-accent text-white" : "text-muted hover:text-foreground"
                }`}
              >
                List
              </Link>
              <Link
                href={`/recurring?month=${selectedMonth}&view=calendar`}
                className={`rounded px-2.5 py-1 font-semibold ${
                  activeView === "calendar" ? "bg-accent text-white" : "text-muted hover:text-foreground"
                }`}
              >
                Calendar
              </Link>
            </div>
          </div>
        </div>

        <ReviewBanner count={monthData.reviewCount} />

        <MonthSummary data={monthData} />

        {activeView === "calendar" ? (
          <RecurringCalendar month={selectedMonth} occurrences={monthData.occurrences} />
        ) : (
          <RecurringList occurrences={monthData.occurrences} />
        )}
      </div>
    </AppShell>
  );
}
