import Link from "next/link";
import { notFound } from "next/navigation";
import AppShell from "@/components/shell/AppShell";
import PageHeader from "@/components/shell/PageHeader";
import MonthSummary from "@/components/recurring/MonthSummary";
import MonthPulse from "@/components/recurring/MonthPulse";
import ReviewBanner from "@/components/recurring/ReviewBanner";
import PriceSpikeBanner from "@/components/recurring/PriceSpikeBanner";
import PriceChangeHistory, { type PriceChangeHistoryRow } from "@/components/recurring/PriceChangeHistory";
import RecurringList, { type RecurringTab } from "@/components/recurring/RecurringList";
import RecurringCalendar from "@/components/recurring/RecurringCalendar";
import { detectPriceSpikes } from "@/lib/recurring-alerts";
import Panel from "@/components/ui/Panel";
import SegmentedControl from "@/components/ui/SegmentedControl";
import ButtonLink from "@/components/ui/ButtonLink";
import { ChevronLeft, ChevronRight } from "@/components/ui/icons";
import { formatMonth } from "@/lib/format";
import { loadRecurringData } from "@/lib/recurring-data";
import { loadPaycheckPlan } from "@/lib/paycheck-planner-data";
import PaycheckPlan from "@/components/recurring/PaycheckPlan";
import { dateKeyInTimezone } from "@/lib/report-period";
import { serializeFinancialScope } from "@/lib/financial-scope";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { firstSearchParam } from "@/lib/search-params";
import { logError } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    month?: string | string[];
    scope?: string | string[];
    tab?: string | string[];
    view?: string | string[];
  }>;
}

const MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;
const RECURRING_TABS = new Set<RecurringTab>([
  "overdue",
  "upcoming",
  "complete",
  "manage",
]);

function shiftMonth(month: string, delta: number): string {
  const [year, oneBasedMonth] = month.split("-").map(Number);
  const total = year! * 12 + oneBasedMonth! - 1 + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

function parseTab(value: string | undefined): RecurringTab {
  return RECURRING_TABS.has(value as RecurringTab)
    ? (value as RecurringTab)
    : "upcoming";
}

function recurringHref(input: {
  month: string;
  scope?: string;
  tab?: RecurringTab;
  view?: "calendar" | "list" | "paycheck";
}): string {
  const params = new URLSearchParams({ month: input.month });
  if (input.scope) params.set("scope", input.scope);
  if (input.tab && input.tab !== "upcoming") params.set("tab", input.tab);
  if (input.view === "calendar") params.set("view", "calendar");
  if (input.view === "paycheck") params.set("view", "paycheck");
  return `/recurring?${params.toString()}`;
}

export const metadata = {
  title: "Recurring",
};

type RecurringView = "calendar" | "list" | "paycheck";
type RecurringLoadedData = Awaited<ReturnType<typeof loadRecurringData>>;
type RecurringViewer = { user: { id: string; email?: string }; today: string };
type RecurringFeatureState = { billsViewsEnabled: boolean; paycheckViewEnabled: boolean; priceHistoryEnabled: boolean };

function resolveView(rawView: string | undefined, paycheckViewEnabled: boolean): RecurringView {
  if (paycheckViewEnabled && rawView === "paycheck") return "paycheck";
  if (rawView === "calendar") return "calendar";
  return "list";
}

function panelTitle(view: RecurringView): string {
  if (view === "calendar") return "Recurring calendar";
  if (view === "paycheck") return "Paycheck view";
  return "Occurrences";
}

function resolveMonth(rawMonth: string | undefined, currentMonth: string): string {
  if (rawMonth && MONTH_REGEX.test(rawMonth)) return rawMonth;
  return currentMonth;
}

function resolveFeatures(): RecurringFeatureState {
  const billsViewsEnabled = isFeatureEnabled("billsViews");
  const paycheckViewEnabled = billsViewsEnabled
    && isFeatureEnabled("paycheckPlanner")
    && isFeatureEnabled("paydaySettings");
  return {
    billsViewsEnabled,
    paycheckViewEnabled,
    priceHistoryEnabled: isFeatureEnabled("recurringPriceHistory"),
  };
}

async function loadViewer(supabase: Awaited<ReturnType<typeof createClient>>): Promise<RecurringViewer> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) logError("recurring.profile-timezone", profileError);
  const timezone = profileError ? null : profile?.timezone;
  return { user: { id: user.id, email: user.email }, today: dateKeyInTimezone(new Date(), timezone) };
}

async function loadPriceChanges(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  enabled: boolean,
): Promise<PriceChangeHistoryRow[]> {
  if (!enabled) return [];
  const result = await supabase
    .from("recurring_price_changes")
    .select("id,recurring_stream_id,effective_date,previous_amount,new_amount")
    .eq("user_id", userId)
    .order("effective_date", { ascending: false })
    .limit(100);
  if (result.error) {
    logError("recurring.price-change-history", result.error);
    return [];
  }
  return (result.data ?? []) as PriceChangeHistoryRow[];
}

function RecurringPanelContent({
  view,
  paycheckPlan,
  month,
  today,
  currency,
  occurrences,
  streams,
  manualItems,
  tab,
  links,
  subscriptionCatalogEnabled,
}: Readonly<{
  view: RecurringView;
  paycheckPlan: Awaited<ReturnType<typeof loadPaycheckPlan>> | null;
  month: string;
  today: string;
  currency: string;
  occurrences: RecurringLoadedData["view"]["occurrences"];
  streams: RecurringLoadedData["allStreams"];
  manualItems: RecurringLoadedData["manualItems"];
  tab: RecurringTab;
  links: Record<RecurringTab, string>;
  subscriptionCatalogEnabled: boolean;
}>) {
  if (view === "paycheck") {
    if (!paycheckPlan?.configured) return <p>Confirm a payday and take-home amount before planning pay periods.</p>;
    if (paycheckPlan.currencyUnsupported) return <p>This paycheck view supports USD accounts only.</p>;
    return <PaycheckPlan periods={paycheckPlan.periods} cash={paycheckPlan.cash} />;
  }
  if (view === "calendar") {
    return <RecurringCalendar month={month} today={today} currency={currency} occurrences={occurrences} />;
  }
  return (
    <RecurringList
      occurrences={occurrences}
      streams={streams}
      manualItems={manualItems}
      currency={currency}
      today={today}
      tab={tab}
      links={links}
      subscriptionCatalogEnabled={subscriptionCatalogEnabled}
    />
  );
}

function RecurringSurface({
  userEmail,
  loaded,
  month,
  currentMonth,
  today,
  tab,
  view,
  links,
  baseLink,
  paycheckViewEnabled,
  paycheckPlan,
  billsViewsEnabled,
  priceHistoryEnabled,
  priceChanges,
}: Readonly<{
  userEmail: string | undefined;
  loaded: RecurringLoadedData;
  month: string;
  currentMonth: string;
  today: string;
  tab: RecurringTab;
  view: RecurringView;
  links: Record<RecurringTab, string>;
  baseLink: { month: string; scope?: string };
  paycheckViewEnabled: boolean;
  paycheckPlan: Awaited<ReturnType<typeof loadPaycheckPlan>> | null;
  billsViewsEnabled: boolean;
  priceHistoryEnabled: boolean;
  priceChanges: PriceChangeHistoryRow[];
}>) {
  return (
    <AppShell active="recurring" email={userEmail}>
      <PageHeader
        title="Recurring"
        actions={
          <>
            {loaded.visibleHouseholdIds[0] && (
              <SegmentedControl
                ariaLabel="Financial scope"
                items={[
                  { label: "Mine", href: recurringHref({ ...baseLink, tab, scope: undefined }), active: loaded.scope.kind === "mine" },
                  { label: "Household", href: recurringHref({ ...baseLink, tab, scope: loaded.visibleHouseholdIds[0] }), active: loaded.scope.kind === "household" },
                ]}
              />
            )}
            {isFeatureEnabled("paycheckPlanner") && <ButtonLink href="/recurring/paychecks">Paycheck plan</ButtonLink>}
            {isFeatureEnabled("paydaySettings") && <ButtonLink href="/settings/payday">Confirm payday</ButtonLink>}
            <ButtonLink href={links.manage} variant="primary">Manage recurring</ButtonLink>
          </>
        }
      />
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Link href={recurringHref({ ...baseLink, tab, view, month: shiftMonth(month, -1) })} aria-label="Previous month" className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-panel-border bg-panel"><ChevronLeft aria-hidden className="h-4 w-4" /></Link>
        <span className="min-w-[7rem] text-center text-sm font-bold">{formatMonth(month)}</span>
        <Link href={recurringHref({ ...baseLink, tab, view, month: shiftMonth(month, 1) })} aria-label="Next month" className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-panel-border bg-panel"><ChevronRight aria-hidden className="h-4 w-4" /></Link>
        {month !== currentMonth && <Link href={recurringHref({ ...baseLink, tab, view, month: currentMonth })} className="inline-flex min-h-11 items-center rounded-field border border-panel-border bg-panel px-4 text-sm font-semibold">Today</Link>}
      </div>
      <div className="mt-6 space-y-4">
        {loaded.stale && <Panel tone="warning"><p className="text-sm font-semibold">Recurring data may be stale.</p><p className="mt-1 text-sm text-muted">Refresh connected accounts before relying on this month.</p></Panel>}
        <ReviewBanner reviewCount={loaded.view.reviewCount} reviewHref={links.manage} />
        <PriceSpikeBanner
          initialAlerts={detectPriceSpikes(loaded.allStreams.map((stream) => ({
            id: stream.id,
            merchantName: stream.merchantName,
            description: stream.description,
            lastAmount: stream.lastAmount ?? stream.averageAmount,
            averageAmount: stream.averageAmount,
            frequency: stream.frequency,
            streamType: stream.streamType,
            status: stream.status,
            isActive: stream.isActive,
            dismissedAt: stream.dismissedAt,
          })))}
          historyEnabled={priceHistoryEnabled}
        />
        {priceHistoryEnabled && <PriceChangeHistory rows={priceChanges} streamNames={new Map(loaded.allStreams.map((stream) => [stream.id, stream.merchantName ?? stream.description ?? "Recurring charge"]))} currency={loaded.currency} />}
        <MonthSummary totals={loaded.view.totals} currency={loaded.currency} />
        {billsViewsEnabled && <MonthPulse occurrences={loaded.view.occurrences} currency={loaded.currency} />}
        <Panel
          title={panelTitle(view)}
          eyebrow="This month"
          action={<SegmentedControl ariaLabel="Occurrences view" items={[
            { label: "List", href: recurringHref({ ...baseLink, tab, view: "list" }), active: view === "list" },
            { label: "Calendar", href: recurringHref({ ...baseLink, tab, view: "calendar" }), active: view === "calendar" },
            ...(paycheckViewEnabled ? [{ label: "Paycheck", href: recurringHref({ ...baseLink, tab, view: "paycheck" }), active: view === "paycheck" }] : []),
          ]} />}
        >
          <RecurringPanelContent
            view={view}
            paycheckPlan={paycheckPlan}
            month={month}
            today={today}
            currency={loaded.currency}
            occurrences={loaded.view.occurrences}
            streams={loaded.allStreams}
            manualItems={loaded.manualItems}
            tab={tab}
            links={links}
            subscriptionCatalogEnabled={isFeatureEnabled("subscriptionCatalog")}
          />
        </Panel>
      </div>
    </AppShell>
  );
}

export default async function RecurringPage({ searchParams }: Readonly<PageProps>) {
  if (!isFeatureEnabled("recurringPage")) notFound();

  const params = await searchParams;
  const supabase = await createClient();
  const { user, today } = await loadViewer(supabase);
  const currentMonth = today.slice(0, 7);
  const month = resolveMonth(firstSearchParam(params.month), currentMonth);
  const tab = parseTab(firstSearchParam(params.tab));
  const { billsViewsEnabled, paycheckViewEnabled, priceHistoryEnabled } = resolveFeatures();
  const rawView = firstSearchParam(params.view);
  const view = resolveView(rawView, paycheckViewEnabled);

  const loaded = await loadRecurringData(supabase, {
    userId: user.id,
    anchorMonth: month,
    rawScope: params.scope,
    today,
  });
  const scope = serializeFinancialScope(loaded.scope);
  const baseLink = { month, scope };
  const links: Record<RecurringTab, string> = {
    overdue: recurringHref({ ...baseLink, tab: "overdue" }),
    upcoming: recurringHref({ ...baseLink, tab: "upcoming" }),
    complete: recurringHref({ ...baseLink, tab: "complete" }),
    manage: recurringHref({ ...baseLink, tab: "manage" }),
  };
  const paycheckPlan = view === "paycheck" ? await loadPaycheckPlan(supabase, user.id, today) : null;
  const priceChanges = await loadPriceChanges(supabase, user.id, priceHistoryEnabled);

  return <RecurringSurface userEmail={user.email} loaded={loaded} month={month} currentMonth={currentMonth} today={today} tab={tab} view={view} links={links} baseLink={baseLink} paycheckViewEnabled={paycheckViewEnabled} paycheckPlan={paycheckPlan} billsViewsEnabled={billsViewsEnabled} priceHistoryEnabled={priceHistoryEnabled} priceChanges={priceChanges} />;
}
