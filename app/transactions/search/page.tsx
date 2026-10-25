import { notFound } from "next/navigation";
import AppShell from "@/components/shell/AppShell";
import PageHeader from "@/components/shell/PageHeader";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import ButtonLink from "@/components/ui/ButtonLink";
import EmptyState from "@/components/ui/EmptyState";
import Input from "@/components/ui/Input";
import Label from "@/components/ui/Label";
import Money from "@/components/ui/Money";
import Panel from "@/components/ui/Panel";
import {
  BILL_SEARCH_LIMIT,
  formatBillDate,
  formatBillTime,
  parseBillQuery,
  searchBills,
  type BillMatch,
  type BillQuery,
} from "@/lib/bill-search";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { formatCurrency, titleCase } from "@/lib/format";
import { firstSearchParamOrEmpty } from "@/lib/search-params";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Find a bill",
};

interface PageProps {
  searchParams: Promise<{ q?: string | string[] }>;
}

function describeQuery(query: BillQuery): string {
  if (query.kind === "amount") return `an amount of ${formatCurrency(Number(query.amount))}`;
  if (query.kind === "text") return `“${query.term}”`;
  return "";
}

function resultSummary(query: BillQuery, count: number, truncated: boolean): string {
  const target = describeQuery(query);
  if (count === 0) return `No transactions match ${target}.`;
  if (truncated) {
    return `More than ${BILL_SEARCH_LIMIT} transactions match ${target}. Showing the latest ${BILL_SEARCH_LIMIT}; narrow the search to see older ones.`;
  }
  const noun = count === 1 ? "transaction matches" : "transactions match";
  return `${count} ${noun} ${target}, newest first.`;
}

function BillDetail({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold text-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-sm">{children}</dd>
    </div>
  );
}

function BillCard({ bill, timeZone, timesEnabled }: Readonly<{ bill: BillMatch; timeZone: string; timesEnabled: boolean }>) {
  const time = formatBillTime(bill.time, timeZone);
  const timeFallback = timesEnabled ? "Not reported by the bank" : "Not recorded yet";
  return (
    <li>
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="break-words text-base font-semibold">{bill.provider}</h2>
            {bill.description && <p className="break-words text-xs text-muted">{bill.description}</p>}
          </div>
          <div className="text-right">
            <Money amount={bill.total} currency={bill.currency} className="block text-lg font-semibold tabular-nums" />
            <div className="mt-1 flex justify-end gap-1.5">
              {bill.direction === "refund" && <Badge tone="success">Refund</Badge>}
              {bill.pending && <Badge tone="warning">Pending</Badge>}
            </div>
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <BillDetail label="Date">{formatBillDate(bill.date)}</BillDetail>
          <BillDetail label="Time">{time ?? <span className="text-muted">{timeFallback}</span>}</BillDetail>
          <BillDetail label="Provider">{bill.provider}</BillDetail>
          <BillDetail label="Total">
            <Money amount={bill.total} currency={bill.currency} /> {bill.direction === "refund" ? "refunded" : "charged"}
          </BillDetail>
          <BillDetail label="Paid with">
            {bill.paidWith}
            {bill.paidWithType && <span className="block text-xs text-muted">{bill.paidWithType}</span>}
          </BillDetail>
          <BillDetail label="Category">
            {bill.category ?? <span className="text-muted">Uncategorized</span>}
            {bill.paymentChannel && <span className="block text-xs text-muted">{titleCase(bill.paymentChannel)}</span>}
          </BillDetail>
        </dl>
      </Panel>
    </li>
  );
}

export default async function BillSearchPage({ searchParams }: Readonly<PageProps>) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const raw = firstSearchParamOrEmpty((await searchParams).q);
  const query = parseBillQuery(raw);
  const timesEnabled = isFeatureEnabled("transactionTimes");

  let matches: BillMatch[] = [];
  let truncated = false;
  let searchError = "";
  let timeZone = "UTC";
  if (query.kind !== "empty") {
    try {
      const [result, profile] = await Promise.all([
        searchBills(supabase, user.id, query, {
          includeTime: timesEnabled,
          includeManualAccounts: isFeatureEnabled("transactionsParity"),
        }),
        supabase.from("profiles").select("timezone").eq("id", user.id).maybeSingle(),
      ]);
      matches = result.matches;
      truncated = result.truncated;
      timeZone = (profile.data as { timezone?: string | null } | null)?.timezone || "UTC";
    } catch (error) {
      console.error("Bill search failed", (error as { code?: string } | null)?.code ?? "unknown");
      searchError = "We couldn't search your transactions. Try again.";
    }
  }

  return (
    <AppShell active="transactions" email={user.email}>
      <PageHeader
        title="Find a bill"
        actions={<ButtonLink href="/transactions">Back to transactions</ButtonLink>}
      />
      <div className="space-y-4">
        <Panel>
          <form method="get" role="search" className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <Label htmlFor="bill-search">Provider name or amount</Label>
              <Input
                id="bill-search"
                name="q"
                type="search"
                defaultValue={raw}
                maxLength={80}
                placeholder="e.g. Comcast or 89.99"
                autoComplete="off"
                className="mt-1"
              />
            </div>
            <Button type="submit">Search</Button>
          </form>
          <p className="mt-2 text-xs text-muted">
            An amount finds charges and refunds of exactly that total. Anything else matches the provider name.
          </p>
        </Panel>

        {searchError && (
          <Panel tone="danger" role="alert" title="Search unavailable">
            <p className="text-sm text-muted">{searchError}</p>
          </Panel>
        )}

        {!searchError && query.kind !== "empty" && (
          <p className="text-xs text-muted" aria-live="polite" data-money>
            {resultSummary(query, matches.length, truncated)}
          </p>
        )}

        {query.kind === "empty" && raw.trim() !== "" && (
          <p className="text-xs text-muted">Enter at least two letters of a provider name, or an amount like 42.10.</p>
        )}

        {query.kind === "empty" && raw.trim() === "" && (
          <EmptyState
            title="Search for a bill"
            description="Enter who you paid or how much, and see when it happened, the total, and which card paid it."
          />
        )}

        {matches.length > 0 && (
          <ul className="space-y-3">
            {matches.map((bill) => (
              <BillCard key={bill.id} bill={bill} timeZone={timeZone} timesEnabled={timesEnabled} />
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
