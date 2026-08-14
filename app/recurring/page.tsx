import Link from "next/link";
import { notFound } from "next/navigation";
import AppShell from "@/components/shell/AppShell";
import PageHeader from "@/components/shell/PageHeader";
import MonthSummary from "@/components/recurring/MonthSummary";
import ReviewBanner from "@/components/recurring/ReviewBanner";
import RecurringList, { type RecurringTab } from "@/components/recurring/RecurringList";
import Panel from "@/components/ui/Panel";
import SegmentedControl from "@/components/ui/SegmentedControl";
import ButtonLink from "@/components/ui/ButtonLink";
import { ChevronLeft, ChevronRight } from "@/components/ui/icons";
import { formatMonth } from "@/lib/format";
import { localDateKey, localMonthKey } from "@/lib/format-date";
import { loadRecurringData } from "@/lib/recurring-data";
import { serializeFinancialScope } from "@/lib/financial-scope";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { firstSearchParam } from "@/lib/search-params";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    month?: string | string[];
    scope?: string | string[];
    tab?: string | string[];
  }>;
}

const MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;
const RECURRING_TABS = new Set<RecurringTab>(["upcoming", "complete", "manage"]);

function shiftMonth(month: string, delta: number): string {
  const [year, oneBasedMonth] = month.split("-").map(Number);
  const total = year! * 12 + oneBasedMonth! - 1 + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

function parseTab(value: string | undefined): RecurringTab {
  return RECURRING_TABS.has(value as RecurringTab) ? (value as RecurringTab) : "upcoming";
}

function recurringHref(input: { month: string; scope?: string; tab?: RecurringTab }): string {
  const params = new URLSearchParams({ month: input.month });
  if (input.scope) params.set("scope", input.scope);
  if (input.tab && input.tab !== "upcoming") params.set("tab", input.tab);
  return `/recurring?${params.toString()}`;
}

export default async function RecurringPage({ searchParams }: Readonly<PageProps>) {
  if (!isFeatureEnabled("recurringPage")) notFound();

  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const currentMonth = localMonthKey();
  const today = localDateKey();
  const rawMonth = firstSearchParam(params.month);
  const month = rawMonth && MONTH_REGEX.test(rawMonth) ? rawMonth : currentMonth;
  const tab = parseTab(firstSearchParam(params.tab));

  const loaded = await loadRecurringData(supabase, {
    userId: user.id,
    anchorMonth: month,
    rawScope: params.scope,
  });
  const scope = serializeFinancialScope(loaded.scope);
  const baseLink = { month, scope };
  const links: Record<RecurringTab, string> = {
    upcoming: recurringHref({ ...baseLink, tab: "upcoming" }),
    complete: recurringHref({ ...baseLink, tab: "complete" }),
    manage: recurringHref({ ...baseLink, tab: "manage" }),
  };

  return (
    <AppShell active="recurring" email={user.email}>
      <PageHeader
        title="Recurring"
        actions={
          <>
            <SegmentedControl
              ariaLabel="Financial scope"
              items={[
                {
                  label: "Mine",
                  href: recurringHref({ ...baseLink, tab, scope: undefined }),
                  active: loaded.scope.kind === "mine",
                },
                ...(loaded.visibleHouseholdIds[0]
                  ? [
                      {
                        label: "Household",
                        href: recurringHref({ ...baseLink, tab, scope: loaded.visibleHouseholdIds[0] }),
                        active: loaded.scope.kind === "household",
                      },
                    ]
                  : []),
              ]}
            />
            <ButtonLink href={links.manage} variant="primary">
              Manage recurring
            </ButtonLink>
          </>
        }
      />

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Link
          href={recurringHref({ ...baseLink, tab, month: shiftMonth(month, -1) })}
          aria-label="Previous month"
          className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-panel-border bg-panel"
        >
          <ChevronLeft aria-hidden className="h-4 w-4" />
        </Link>
        <span className="min-w-[7rem] text-center text-sm font-bold">{formatMonth(month)}</span>
        <Link
          href={recurringHref({ ...baseLink, tab, month: shiftMonth(month, 1) })}
          aria-label="Next month"
          className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-panel-border bg-panel"
        >
          <ChevronRight aria-hidden className="h-4 w-4" />
        </Link>
        {month !== currentMonth && (
          <Link
            href={recurringHref({ ...baseLink, tab, month: currentMonth })}
            className="inline-flex min-h-11 items-center rounded-field border border-panel-border bg-panel px-4 text-sm font-semibold"
          >
            Today
          </Link>
        )}
      </div>

      <div className="mt-6 space-y-4">
        {loaded.stale && (
          <Panel tone="warning">
            <p className="text-sm font-semibold">Recurring data may be stale.</p>
            <p className="mt-1 text-sm text-muted">Refresh connected accounts before relying on this month.</p>
          </Panel>
        )}

        <ReviewBanner reviewCount={loaded.view.reviewCount} reviewHref={links.manage} />

        <MonthSummary totals={loaded.view.totals} currency={loaded.currency} />

        <Panel title="Occurrences" eyebrow="This month">
          <RecurringList
            occurrences={loaded.view.occurrences}
            streams={loaded.allStreams}
            manualItems={loaded.manualItems}
            currency={loaded.currency}
            today={today}
            tab={tab}
            links={links}
          />
        </Panel>
      </div>
    </AppShell>
  );
}
