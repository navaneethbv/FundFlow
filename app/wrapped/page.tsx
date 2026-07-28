import Link from "next/link";
import AppShell from "@/components/shell/AppShell";
import EmptyState from "@/components/ui/EmptyState";
import Panel from "@/components/ui/Panel";
import MiniBars from "@/components/charts/MiniBars";
import StatTile from "@/components/charts/StatTile";
import BarList from "@/components/dashboard/BarList";
import { LineChart } from "@/components/ui/icons";
import { computeYearInMoney, type AnnualTxn } from "@/lib/annual";
import { formatCurrency, formatMonth, titleCase } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ year?: string }>;
}

/**
 * Year in Money (8.1): an annual recap over the user's own ledger.
 * RLS-scoped reads, one bounded query, pure aggregation in lib/annual.ts.
 */
export default async function WrappedPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const currentYear = new Date().getFullYear();
  const year =
    params.year && /^\d{4}$/.test(params.year) ? params.year : String(currentYear);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: rows } = await supabase
    .from("transactions")
    .select("date, amount, merchant_name, name, pfc_primary")
    .gte("date", `${year}-01-01`)
    .lt("date", `${Number(year) + 1}-01-01`);

  const txns: AnnualTxn[] = (rows ?? []).map((row) => ({
    date: row.date as string,
    amount: Number(row.amount),
    merchant: (row.merchant_name ?? row.name ?? "Unknown") as string,
    category: row.pfc_primary as string | null,
  }));
  const recap = computeYearInMoney(txns, year);

  const yearChips = Array.from({ length: 4 }, (_, i) => String(currentYear - i));

  return (
    <AppShell active="wrapped" email={user?.email}>
      <header>
        <p className="eyebrow">Year in money</p>
        <h1 className="display mt-2 text-3xl sm:text-4xl">
          {year}, in your own numbers
        </h1>
        <div className="mt-3 flex gap-1 text-xs font-semibold">
          {yearChips.map((chip) => (
            <Link
              key={chip}
              href={`/wrapped?year=${chip}`}
              aria-current={chip === year ? "true" : undefined}
              className={
                chip === year
                  ? "rounded-field bg-accent-soft px-2.5 py-1 text-accent"
                  : "rounded-field px-2.5 py-1 text-muted transition-colors hover:bg-panel-hover hover:text-foreground"
              }
            >
              {chip}
            </Link>
          ))}
        </div>
      </header>

      {!recap ? (
        <EmptyState
          icon={<LineChart aria-hidden className="h-5 w-5" />}
          title={`Nothing tracked in ${year} yet`}
          description="Once transactions land in this year, your recap appears here — totals, top merchants, your biggest month, and where it all went."
        />
      ) : (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="Total spent"
              value={recap.totalSpend}
              chart={<MiniBars values={recap.monthlySpendSeries} />}
            />
            <StatTile label="Total income" value={recap.totalIncome} />
            <section className="rounded-card border border-panel-border bg-panel p-5 text-foreground shadow-card">
              <h3 className="eyebrow">Savings rate</h3>
              <p className="metric-value mt-3 text-3xl">{recap.savingsRate}%</p>
              <p className="mt-2 text-xs font-medium text-muted">
                Across the whole year
              </p>
            </section>
            <section className="rounded-card border border-panel-border bg-panel p-5 text-foreground shadow-card">
              <h3 className="eyebrow">Transactions tracked</h3>
              <p className="metric-value mt-3 text-3xl">
                {recap.transactionCount.toLocaleString("en-US")}
              </p>
              <p className="mt-2 text-xs font-medium text-muted">
                Transfers and loan payments excluded
              </p>
            </section>
          </div>

          <div className="grid gap-5 xl:grid-cols-12">
            <Panel
              title="Where it all went"
              eyebrow="Top categories"
              className="xl:col-span-6"
            >
              <BarList
                items={recap.topCategories.map((row) => ({
                  label: titleCase(row.category),
                  amount: row.amount,
                  href: `/transactions?category=${encodeURIComponent(row.category)}`,
                }))}
                max={Math.max(1, ...recap.topCategories.map((row) => row.amount))}
              />
            </Panel>
            <Panel
              title="Your favorite places"
              eyebrow="Top merchants"
              className="xl:col-span-6"
            >
              <BarList
                items={recap.topMerchants.map((row) => ({
                  label: row.merchant,
                  amount: row.amount,
                  href: `/transactions?merchant=${encodeURIComponent(row.merchant)}`,
                }))}
                max={Math.max(1, ...recap.topMerchants.map((row) => row.amount))}
              />
            </Panel>
          </div>

          <Panel title="The shape of your year" eyebrow="Highlights">
            <div className="grid gap-3 text-sm sm:grid-cols-3">
              {recap.biggestMonth && (
                <div className="rounded-field bg-panel-2 p-3">
                  <span className="block text-xs text-muted">Your biggest month</span>
                  <span className="mt-1 block font-semibold">
                    {formatMonth(recap.biggestMonth.month)}
                  </span>
                  <span className="metric-value text-sm">
                    {formatCurrency(recap.biggestMonth.spend)}
                  </span>
                </div>
              )}
              {recap.quietestMonth && (
                <div className="rounded-field bg-panel-2 p-3">
                  <span className="block text-xs text-muted">Your quietest month</span>
                  <span className="mt-1 block font-semibold">
                    {formatMonth(recap.quietestMonth.month)}
                  </span>
                  <span className="metric-value text-sm">
                    {formatCurrency(recap.quietestMonth.spend)}
                  </span>
                </div>
              )}
              {recap.largestPurchase && (
                <div className="rounded-field bg-panel-2 p-3">
                  <span className="block text-xs text-muted">Largest purchase</span>
                  <span className="mt-1 block truncate font-semibold">
                    {recap.largestPurchase.merchant}
                  </span>
                  <span className="metric-value text-sm">
                    {formatCurrency(recap.largestPurchase.amount)}
                  </span>
                  <span className="block text-xs text-muted">
                    {recap.largestPurchase.date}
                  </span>
                </div>
              )}
            </div>
          </Panel>
        </div>
      )}
    </AppShell>
  );
}
