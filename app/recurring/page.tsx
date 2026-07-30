import { notFound } from "next/navigation";
import AppShell from "@/components/shell/AppShell";
import MonthSummary from "@/components/recurring/MonthSummary";
import ReviewBanner from "@/components/recurring/ReviewBanner";
import RecurringList from "@/components/recurring/RecurringList";
import Panel from "@/components/ui/Panel";
import Link from "next/link";
import { loadRecurringData } from "@/lib/recurring-data";
import { serializeFinancialScope } from "@/lib/financial-scope";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { formatMonth } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    month?: string | string[];
    scope?: string | string[];
  }>;
}

const MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function shiftMonth(month: string, delta: number): string {
  const [year, oneBasedMonth] = month.split("-").map(Number);
  const total = year! * 12 + oneBasedMonth! - 1 + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

function recurringHref(input: { month: string; scope?: string }): string {
  const params = new URLSearchParams({ month: input.month });
  if (input.scope) params.set("scope", input.scope);
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

  const currentMonth = new Date().toISOString().slice(0, 7);
  const rawMonth = first(params.month);
  const month = rawMonth && MONTH_REGEX.test(rawMonth) ? rawMonth : currentMonth;

  const loaded = await loadRecurringData(supabase, {
    userId: user.id,
    anchorMonth: month,
    rawScope: params.scope,
  });
  const scope = serializeFinancialScope(loaded.scope);
  const baseLink = { month, scope };

  return (
    <AppShell active="recurring" email={user.email}>
      <header className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="eyebrow">{formatMonth(month)}</p>
          <h1 className="display mt-2 text-3xl sm:text-4xl">Recurring</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            Bills, subscriptions, and income Plaid detects automatically, plus anything you track manually.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={recurringHref({ ...baseLink, month: shiftMonth(month, -1) })}
            className="inline-flex min-h-11 items-center rounded-field border border-panel-border bg-panel px-4 text-sm font-semibold"
          >
            Previous
          </Link>
          <Link
            href={recurringHref({ ...baseLink, month: shiftMonth(month, 1) })}
            className="inline-flex min-h-11 items-center rounded-field border border-panel-border bg-panel px-4 text-sm font-semibold"
          >
            Next
          </Link>
          <Link
            href={recurringHref({ ...baseLink, scope: undefined })}
            aria-current={loaded.scope.kind === "mine" ? "page" : undefined}
            className="inline-flex min-h-11 items-center rounded-field border border-panel-border bg-panel px-4 text-sm font-semibold"
          >
            Mine
          </Link>
          {loaded.visibleHouseholdIds[0] && (
            <Link
              href={recurringHref({ ...baseLink, scope: loaded.visibleHouseholdIds[0] })}
              aria-current={loaded.scope.kind === "household" ? "page" : undefined}
              className="inline-flex min-h-11 items-center rounded-field border border-panel-border bg-panel px-4 text-sm font-semibold"
            >
              Household
            </Link>
          )}
        </div>
      </header>

      <div className="mt-6 space-y-4">
        {loaded.stale && (
          <Panel tone="warning">
            <p className="text-sm font-semibold">Recurring data may be stale.</p>
            <p className="mt-1 text-sm text-muted">Refresh connected accounts before relying on this month.</p>
          </Panel>
        )}

        <ReviewBanner reviewCount={loaded.view.reviewCount}>
          <p className="text-sm text-muted">Open the &quot;All&quot; tab below to confirm or dismiss each one.</p>
        </ReviewBanner>

        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <Panel title="Occurrences" eyebrow="This month">
            <RecurringList
              occurrences={loaded.view.occurrences}
              streams={loaded.allStreams}
              currency={loaded.currency}
            />
          </Panel>
          <MonthSummary totals={loaded.view.totals} currency={loaded.currency} />
        </div>
      </div>
    </AppShell>
  );
}
