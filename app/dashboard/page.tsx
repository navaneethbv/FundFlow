import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getDashboardData } from "@/lib/dashboard";
import { formatCurrency, titleCase, formatMonth, formatMinutesAgo } from "@/lib/format";
import ConnectBankButton from "@/components/ConnectBankButton";
import RefreshButton from "@/components/RefreshButton";
import AutoRefresh from "@/components/AutoRefresh";
import LogoutButton from "@/components/LogoutButton";
import { detectCardDesign } from "@/lib/card-design";
import TrendChart from "@/components/charts/TrendChart";
import DonutChart from "@/components/charts/DonutChart";
import DivergingColumns from "@/components/charts/DivergingColumns";
import StatTile from "@/components/charts/StatTile";
import { foldTail } from "@/lib/chart-utils";

export const dynamic = "force-dynamic";

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-black/10 dark:border-white/15 p-5 bg-white/40 dark:bg-black/20 backdrop-blur-sm shadow-sm transition-all duration-200">
      <h2 className="text-xs font-semibold uppercase tracking-wider opacity-60 mb-4">
        {title}
      </h2>
      {children}
    </section>
  );
}

function BarList({
  items,
  max,
}: {
  items: { label: string; amount: number }[];
  max: number;
}) {
  if (items.length === 0) {
    return <p className="text-sm opacity-60 py-4">No data yet.</p>;
  }
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item.label} className="text-sm">
          <div className="flex justify-between mb-1.5 font-medium">
            <span>{item.label}</span>
            <span className="tabular-nums font-semibold">{formatCurrency(item.amount)}</span>
          </div>
          {/* Ranking bars: one series → one hue (slot 1), 4px rounded data-end,
              square at the baseline. Never a darker-where-bigger ramp. */}
          <div className="h-2.5 bg-black/[0.06] dark:bg-white/[0.08] overflow-hidden rounded-r-[4px]">
            <div
              className="h-full rounded-r-[4px] transition-all duration-500 ease-out"
              style={{
                width: `${max > 0 ? (item.amount / max) * 100 : 0}%`,
                background: "var(--viz-1)",
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

// Inline SVGs for Card Networks
function CardNetworkLogo({ network }: { network: string }) {
  if (network === "apple") {
    return (
      <svg className="w-5 h-5 fill-current" viewBox="0 0 170 170">
        <path d="M150.37 130.25c-2.45 5.66-5.35 10.87-8.71 15.66-4.58 6.53-8.33 11.05-11.22 13.56-4.48 4.12-9.28 6.23-14.42 6.35-3.69 0-8.14-1.05-13.32-3.18-5.19-2.12-9.97-3.17-14.34-3.17-4.58 0-9.49 1.05-14.75 3.17-5.26 2.13-9.5 3.24-12.74 3.35-4.39.13-9.13-1.85-14.23-5.94-3.64-3.03-7.5-7.77-11.59-14.23-8.24-13.06-14.19-28.7-17.85-46.91-3.66-18.21-1.92-33.85 5.2-46.91 5.37-9.87 12-14.93 19.92-15.19 4.39 0 9.28 1.45 14.65 4.35 5.37 2.9 9.38 4.35 12.02 4.35 2.11 0 6.06-1.42 11.87-4.24 5.81-2.83 10.74-4.14 14.81-3.95 10.55.79 18.68 4.79 24.39 12 4.41 5.54 7.42 11.75 9.04 18.66-15.02 6.13-22.34 16.14-22 30.01.37 10.3 4.29 18.64 11.75 25.04 7.46 6.4 15.93 9.68 25.4 9.83.69-2.31 1.48-4.7 2.37-7.18zM119.22 19.25c0 7.82-2.82 14.93-8.47 21.32-5.66 6.4-12.56 10.23-20.73 11.5-1.05-8.91 2.06-16.89 9.33-23.94 7.28-7.05 14.73-10.74 22.34-11.08-.26 1.05-.26 2.11-.26 3.17c.01 3.03-.68 6.04-2.21 9.03z" />
      </svg>
    );
  }
  if (network === "visa") {
    return (
      <span className="text-lg font-black italic tracking-wider text-blue-500 select-none">
        VISA
      </span>
    );
  }
  if (network === "mastercard") {
    return (
      <div className="flex -space-x-2 select-none">
        <div className="w-5 h-5 rounded-full bg-[#eb001b] opacity-90" />
        <div className="w-5 h-5 rounded-full bg-[#ff5f00] opacity-90" />
      </div>
    );
  }
  if (network === "amex") {
    return (
      <div className="border border-blue-400 bg-blue-500 px-1 py-0.5 rounded text-[8px] font-black text-white leading-none tracking-tighter uppercase select-none">
        AMEX
      </div>
    );
  }
  if (network === "discover") {
    return (
      <span className="text-xs font-bold italic tracking-wide text-orange-500 select-none">
        DISCOVER
      </span>
    );
  }
  return (
    <svg className="w-5 h-5 fill-current opacity-70" viewBox="0 0 24 24">
      <path d="M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z" />
    </svg>
  );
}

interface PageProps {
  searchParams: Promise<{
    accountId?: string;
    month?: string;
    tab?: string;
  }>;
}

export default async function DashboardPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const selectedAccountId = params.accountId;
  const selectedMonth = params.month;
  const activeTab = params.tab || "overview";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [data, { data: items }] = await Promise.all([
    getDashboardData(supabase, selectedAccountId, selectedMonth),
    supabase
      .from("plaid_items")
      .select("id, institution_name, status")
      .order("created_at"),
  ]);

  // Freshness: warn when a bank connection is broken, or when no sync has
  // succeeded in 48h (covers silently failing crons; sync_jobs is written by
  // every sync run). Staleness is computed in getDashboardData.
  const brokenBanks = (items ?? []).filter((i) => i.status === "error");
  const isStale = data.syncIsStale;

  const net = data.currentMonthIncome - data.currentMonthExpenses;
  const maxMerchant = Math.max(1, ...data.merchantBreakdown.map((m) => m.amount));
  const hasBanks = (items ?? []).length > 0;

  // Series + deltas for the charts and stat tiles (6-month window, last =
  // active month, index 4 = the month before).
  const monthLabels = data.monthlySpending.map((m) => formatMonth(m.month));
  const spendSeries = data.monthlySpending.map((m) => m.amount);
  const incomeSeries = data.monthlyIncome.map((m) => m.amount);
  const netSeries = spendSeries.map((s, i) => (incomeSeries[i] ?? 0) - s);
  const prevMonthLabel = monthLabels[monthLabels.length - 2] ?? "last month";
  const spendDelta = spendSeries[5]! - (spendSeries[4] ?? 0);
  const incomeDelta = incomeSeries[5]! - (incomeSeries[4] ?? 0);
  const netDelta = netSeries[5]! - (netSeries[4] ?? 0);

  const donutItems = foldTail(
    data.categoryBreakdown.map((c) => ({ label: titleCase(c.category), amount: c.amount })),
    6,
    (amount) => ({ label: "Other", amount }),
  );

  // Budget calculations
  const hasBudget = data.totalBudget > 0;
  const budgetProgress = hasBudget ? (data.currentMonthExpenses / data.totalBudget) * 100 : 0;
  const budgetAlert = budgetProgress >= 100;
  const budgetWarning = budgetProgress >= 85 && budgetProgress < 100;

  // Pacing calculations vs pro-rated last month
  const pacingDiff = data.currentMonthExpenses - data.lastMonthProratedSpent;
  const pacingPercent = data.lastMonthProratedSpent > 0
    ? (Math.abs(pacingDiff) / data.lastMonthProratedSpent) * 100
    : 0;

  const activeYear = Number(data.selectedMonth.split("-")[0]);
  const activeMonthIndex = Number(data.selectedMonth.split("-")[1]) - 1;
  const lastMonthDate = new Date(activeYear, activeMonthIndex - 1, 15);
  const lastMonthKey = lastMonthDate.toISOString().slice(0, 7);

  // Common query param builder to preserve selection state across tabs
  const getTabUrl = (tabName: string) => {
    const parts = [`tab=${tabName}`];
    if (selectedAccountId) parts.push(`accountId=${selectedAccountId}`);
    if (selectedMonth) parts.push(`month=${selectedMonth}`);
    return `/dashboard?${parts.join("&")}`;
  };

  return (
    <main className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
      {/* Live updates: re-render every 2 min (no Plaid calls — shows what the
          webhook/cron wrote), plus one Plaid auto-pull per 30-min window. */}
      {hasBanks && <AutoRefresh />}

      {/* Header section with mobile optimization */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-black/5 dark:border-white/5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">FundFlow</h1>
          <p className="text-xs opacity-60 mt-0.5 sm:hidden">{user?.email}</p>
        </div>
        <nav className="flex items-center justify-between sm:justify-end gap-5 text-sm font-medium">
          <span className="opacity-60 hidden sm:inline text-xs">{user?.email}</span>
          <div className="flex gap-4">
            <Link href="/transactions" className="underline hover:opacity-80 transition-opacity">
              Transactions
            </Link>
            <Link href="/settings" className="underline hover:opacity-80 transition-opacity">
              Settings
            </Link>
            <LogoutButton />
          </div>
        </nav>
      </header>

      {(brokenBanks.length > 0 || isStale) && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          {brokenBanks.length > 0 ? (
            <>
              <span className="font-medium">
                {brokenBanks
                  .map((b) => b.institution_name ?? "A bank")
                  .join(", ")}{" "}
                lost its connection
              </span>{" "}
              — data may be stale.{" "}
              <Link href="/settings" className="underline">
                Reconnect in Settings
              </Link>
            </>
          ) : (
            <>
              <span className="font-medium">Data may be stale</span> — no
              successful sync in the last 48 hours. Try Refresh, and check your
              banks in{" "}
              <Link href="/settings" className="underline">
                Settings
              </Link>
              .
            </>
          )}
        </div>
      )}

      {/* Action buttons bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-black/5 dark:bg-white/5 p-3 rounded-2xl">
        <div className="flex flex-wrap items-center gap-2.5">
          <ConnectBankButton />
          {hasBanks && <RefreshButton />}
          {hasBanks && (
            <span className="text-xs opacity-60" title="Newest successful sync; auto-updates every 30 min while open">
              Updated {formatMinutesAgo(data.lastSyncAgoMinutes)}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold">
          {(items ?? []).map((i) => (
            <span
              key={i.id}
              className={`inline-block rounded-full border px-2.5 py-1 ${
                i.status === "active"
                  ? "border-green-500/20 bg-green-500/10 text-green-700 dark:text-green-400"
                  : "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-400"
              }`}
            >
              {i.institution_name ?? "Bank"}
              {i.status !== "active" ? ` (${i.status})` : ""}
            </span>
          ))}
        </div>
      </div>

      {!hasBanks ? (
        <div className="text-center py-12 px-4 rounded-2xl border border-dashed border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5">
          <svg className="w-12 h-12 mx-auto mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
          </svg>
          <h3 className="font-semibold text-lg">No banks connected</h3>
          <p className="opacity-60 text-sm max-w-sm mx-auto mt-1 mb-4">
            Connect your bank accounts securely with Plaid to analyze your spending, subscriptions, and income streams.
          </p>
          <ConnectBankButton />
        </div>
      ) : (
        <>
          {/* Card Deck Carousel with snap scrolling */}
          <div>
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider opacity-60">
                Your Cards & Accounts
              </h2>
              {selectedAccountId && (
                <Link
                  href={`/dashboard?tab=${activeTab}${selectedMonth ? `&month=${selectedMonth}` : ""}`}
                  className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Clear Card Filter
                </Link>
              )}
            </div>

            {/* Horizontal deck container */}
            <div className="flex overflow-x-auto gap-4 pb-4 snap-x scrollbar-none touch-pan-x -mx-4 px-4 sm:mx-0 sm:px-0">
              {data.accounts.map((a) => {
                const design = detectCardDesign(a.name, a.official_name, a.type, a.subtype);
                const isSelected = selectedAccountId === a.id;

                // Build filter link URL toggling this card selection
                const cardLink = isSelected
                  ? `/dashboard?tab=${activeTab}${selectedMonth ? `&month=${selectedMonth}` : ""}`
                  : `/dashboard?tab=${activeTab}&accountId=${a.id}${selectedMonth ? `&month=${selectedMonth}` : ""}`;

                return (
                  <Link
                    href={cardLink}
                    key={a.id}
                    className="flex-shrink-0 snap-start"
                  >
                    <div
                      className={`relative w-[280px] sm:w-[300px] h-[170px] rounded-2xl p-5 bg-gradient-to-br ${
                        design.bgGradient
                      } ${design.textColor} flex flex-col justify-between shadow-md transition-all duration-200 cursor-pointer ${
                        isSelected
                          ? `ring-4 ${design.borderColor} scale-[0.98]`
                          : "hover:scale-[1.01] hover:shadow-lg border border-black/5 dark:border-white/5"
                      }`}
                    >
                      {/* Top row: Name & Logo */}
                      <div className="flex items-start justify-between">
                        <div className="max-w-[70%]">
                          <p className="text-[10px] uppercase opacity-70 tracking-widest leading-none font-bold">
                            {a.type === "credit" ? "Credit Card" : titleCase(a.subtype ?? a.type)}
                          </p>
                          <p className="font-bold text-sm tracking-tight truncate mt-1">
                            {design.displayName}
                          </p>
                        </div>
                        <div className="opacity-95">
                          <CardNetworkLogo network={design.network} />
                        </div>
                      </div>

                      {/* Middle row: Masked digits */}
                      <div>
                        <p className="font-mono text-base tracking-widest opacity-85 select-all">
                          •••• •••• •••• {a.mask ?? "••••"}
                        </p>
                      </div>

                      {/* Bottom row: Balance & EXP / Info */}
                      <div className="flex items-end justify-between">
                        <div>
                          <p className="text-[9px] uppercase opacity-70 tracking-widest leading-none font-bold mb-0.5">
                            Balance
                          </p>
                          <p className="font-semibold text-lg tabular-nums leading-none tracking-tight">
                            {formatCurrency(a.current_balance, a.iso_currency_code ?? "USD")}
                          </p>
                        </div>
                        {a.credit_limit ? (
                          <div className="text-right">
                            <p className="text-[8px] uppercase opacity-70 tracking-widest leading-none font-bold mb-0.5">
                              Limit
                            </p>
                            <p className="text-xs opacity-90 tabular-nums">
                              {formatCurrency(a.credit_limit, a.iso_currency_code ?? "USD")}
                            </p>
                          </div>
                        ) : (
                          <div className="text-[9px] opacity-60 font-semibold tracking-wider">
                            EXP 09/31
                          </div>
                        )}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Month selector Browser */}
          <div className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wider opacity-60">
              Browse Spending History
            </h2>
            <div className="flex overflow-x-auto gap-2 pb-2 snap-x scrollbar-none -mx-4 px-4 sm:mx-0 sm:px-0">
              {data.availableMonths.map((m) => {
                const isActive = data.selectedMonth === m;
                const monthLink = isActive
                  ? `/dashboard?tab=${activeTab}${selectedAccountId ? `&accountId=${selectedAccountId}` : ""}`
                  : `/dashboard?tab=${activeTab}&month=${m}${selectedAccountId ? `&accountId=${selectedAccountId}` : ""}`;

                return (
                  <Link
                    href={monthLink}
                    key={m}
                    className="flex-shrink-0 snap-start"
                  >
                    <span
                      className={`inline-block px-4 py-2 text-xs font-semibold rounded-full border transition-all duration-150 cursor-pointer ${
                        isActive
                          ? "bg-foreground text-background border-foreground font-bold shadow-sm"
                          : "border-black/10 dark:border-white/15 bg-white/50 dark:bg-black/30 hover:border-black/30 dark:hover:border-white/30"
                      }`}
                    >
                      {formatMonth(m)}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>

          {/* Tab selectors */}
          <div className="flex border-b border-black/10 dark:border-white/10 gap-1.5 scrollbar-none overflow-x-auto">
            <Link
              href={getTabUrl("overview")}
              className={`py-2.5 px-4 text-sm font-bold border-b-2 transition-all duration-150 ${
                activeTab === "overview"
                  ? "border-foreground text-foreground"
                  : "border-transparent text-black/50 dark:text-white/50 hover:text-foreground"
              }`}
            >
              Overview
            </Link>
            <Link
              href={getTabUrl("breakdowns")}
              className={`py-2.5 px-4 text-sm font-bold border-b-2 transition-all duration-150 ${
                activeTab === "breakdowns"
                  ? "border-foreground text-foreground"
                  : "border-transparent text-black/50 dark:text-white/50 hover:text-foreground"
              }`}
            >
              Cards & Banks
            </Link>
            <Link
              href={getTabUrl("cashflow")}
              className={`py-2.5 px-4 text-sm font-bold border-b-2 transition-all duration-150 ${
                activeTab === "cashflow"
                  ? "border-foreground text-foreground"
                  : "border-transparent text-black/50 dark:text-white/50 hover:text-foreground"
              }`}
            >
              Cash Flow Insights
            </Link>
          </div>

          {/* TAB CONTENT: Overview */}
          {activeTab === "overview" && (
            <div className="space-y-6">
              {/* Pacing Widget (spent so far vs budget & vs last month pro-rated) */}
              <section className="rounded-2xl border border-black/10 dark:border-white/15 p-5 bg-gradient-to-br from-black/[0.02] to-black/[0.05] dark:from-white/[0.02] dark:to-white/[0.05] shadow-inner space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold uppercase tracking-wider opacity-60">
                      Spend Pacing & Budget
                    </h3>
                    <p className="text-xs opacity-50 mt-0.5">
                      Priced and compared to this exact calendar day last month
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold tabular-nums">
                      {formatCurrency(data.currentMonthExpenses)}
                    </p>
                    <p className="text-xs font-semibold opacity-70">
                      {hasBudget ? (
                        <>of {formatCurrency(data.totalBudget)} monthly budget</>
                      ) : (
                        <Link href="/settings" className="text-blue-600 dark:text-blue-400 underline">
                          Set budgets in settings
                        </Link>
                      )}
                    </p>
                  </div>
                </div>

                {/* Progress bar vs total budget */}
                {hasBudget && (
                  <div className="space-y-1.5">
                    <div className="h-3 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden relative">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ease-out ${
                          budgetAlert
                            ? "bg-red-500"
                            : budgetWarning
                            ? "bg-amber-500"
                            : "bg-green-500"
                        }`}
                        style={{ width: `${Math.min(100, budgetProgress)}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-xs font-semibold">
                      <span
                        className={
                          budgetAlert
                            ? "text-red-500"
                            : budgetWarning
                            ? "text-amber-500"
                            : "text-green-500"
                        }
                      >
                        {budgetProgress.toFixed(0)}% consumed
                      </span>
                      <span className="opacity-60">
                        {formatCurrency(Math.max(0, data.totalBudget - data.currentMonthExpenses))} remaining
                      </span>
                    </div>
                  </div>
                )}

                {/* Comparison Pacing indicator vs last month pro-rated */}
                <div className="flex items-center gap-3 bg-white/40 dark:bg-black/20 p-3 rounded-xl text-sm border border-black/5 dark:border-white/5 backdrop-blur-sm">
                  {pacingDiff > 0 ? (
                    <>
                      <div className="w-8 h-8 rounded-full bg-red-500/10 text-red-500 flex items-center justify-center font-bold text-lg select-none">
                        ↑
                      </div>
                      <div>
                        <span className="font-bold text-red-600 dark:text-red-400">
                          +{pacingPercent.toFixed(0)}% pacing higher
                        </span>{" "}
                        than this day in {formatMonth(lastMonthKey)} ({formatCurrency(data.lastMonthProratedSpent)} prorated).
                      </div>
                    </>
                  ) : pacingDiff < 0 ? (
                    <>
                      <div className="w-8 h-8 rounded-full bg-green-500/10 text-green-500 flex items-center justify-center font-bold text-lg select-none">
                        ↓
                      </div>
                      <div>
                        <span className="font-bold text-green-600 dark:text-green-400">
                          -{pacingPercent.toFixed(0)}% pacing lower
                        </span>{" "}
                        than this day in {formatMonth(lastMonthKey)} ({formatCurrency(data.lastMonthProratedSpent)} prorated).
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="w-8 h-8 rounded-full bg-blue-500/10 text-blue-500 flex items-center justify-center font-bold text-lg select-none">
                        →
                      </div>
                      <div>
                        <span className="font-bold text-blue-600 dark:text-blue-400">On pace</span> with
                        same time in {formatMonth(lastMonthKey)} ({formatCurrency(data.lastMonthProratedSpent)} prorated).
                      </div>
                    </>
                  )}
                </div>
              </section>

              {/* Stat tiles: value + delta vs last month + 6-month sparkline */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <StatTile
                  label={`${formatMonth(data.selectedMonth)} · Income`}
                  value={data.currentMonthIncome}
                  delta={incomeDelta}
                  deltaVs={prevMonthLabel}
                  upIsGood
                  trend={incomeSeries}
                />
                <StatTile
                  label={`${formatMonth(data.selectedMonth)} · Expenses`}
                  value={data.currentMonthExpenses}
                  delta={spendDelta}
                  deltaVs={prevMonthLabel}
                  upIsGood={false}
                  trend={spendSeries}
                />
                <StatTile
                  label={`${formatMonth(data.selectedMonth)} · Net`}
                  value={net}
                  delta={netDelta}
                  deltaVs={prevMonthLabel}
                  upIsGood
                  trend={netSeries}
                />
              </div>

              {/* Trend + category breakdown */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <Card title="Spending vs income · 6 months">
                  <TrendChart
                    labels={monthLabels}
                    series={[
                      { name: "Spending", slot: 6, values: spendSeries },
                      { name: "Income", slot: 1, values: incomeSeries },
                    ]}
                  />
                </Card>
                <Card title={`Where it went (${formatMonth(data.selectedMonth)})`}>
                  <DonutChart items={donutItems} centerLabel="total spend" />
                </Card>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <Card title={`Top merchants (${formatMonth(data.selectedMonth)})`}>
                  <BarList
                    items={data.merchantBreakdown.map((m) => ({
                      label: m.merchant,
                      amount: m.amount,
                    }))}
                    max={maxMerchant}
                  />
                </Card>
                <Card title="Recurring streams">
                  {data.subscriptions.length === 0 ? (
                    <p className="text-sm opacity-60 py-4">No recurring streams detected.</p>
                  ) : (
                    <ul className="space-y-3.5 text-sm font-medium">
                      {data.subscriptions.map((s, i) => (
                        <li key={i} className="flex justify-between items-center py-0.5 border-b border-black/5 dark:border-white/5 last:border-0">
                          <span>
                            {s.merchant}
                            <span className="text-[10px] ml-1.5 uppercase opacity-55 font-bold tracking-wider px-1.5 py-0.5 bg-black/5 dark:bg-white/5 rounded">
                              {s.frequency ?? "recurring"}
                            </span>
                          </span>
                          <span className="tabular-nums font-semibold">
                            {formatCurrency(s.amount)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>
            </div>
          )}

          {/* TAB CONTENT: Breakdowns (Card & Bank lists) */}
          {activeTab === "breakdowns" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <Card title={`Spend by Card (${formatMonth(data.selectedMonth)})`}>
                <BarList
                  items={data.spendPerCard.map((c) => ({
                    label: c.name,
                    amount: c.amount,
                  }))}
                  max={Math.max(1, ...data.spendPerCard.map((c) => c.amount))}
                />
              </Card>

              <Card title={`Spend by Bank (${formatMonth(data.selectedMonth)})`}>
                <BarList
                  items={data.spendPerBank.map((b) => ({
                    label: b.name,
                    amount: b.amount,
                  }))}
                  max={Math.max(1, ...data.spendPerBank.map((b) => b.amount))}
                />
              </Card>
            </div>
          )}

          {/* TAB CONTENT: Cash Flow Insights */}
          {activeTab === "cashflow" && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Card title="Depository Inflows (Deposits)">
                  <p className="text-2xl font-bold tabular-nums text-green-600 dark:text-green-400">
                    +{formatCurrency(data.cashFlow.deposits)}
                  </p>
                </Card>
                <Card title="Depository Outflows (Withdrawals)">
                  <p className="text-2xl font-bold tabular-nums text-red-600 dark:text-red-400">
                    -{formatCurrency(data.cashFlow.withdrawals)}
                  </p>
                </Card>
                <Card title="Net Cash Flow">
                  <p
                    className={`text-2xl font-bold tabular-nums ${
                      data.cashFlow.net >= 0
                        ? "text-green-600 dark:text-green-400"
                        : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {data.cashFlow.net >= 0 ? "+" : ""}
                    {formatCurrency(data.cashFlow.net)}
                  </p>
                </Card>
              </div>

              <Card title="Checking cash flow · 6 months">
                <DivergingColumns
                  labels={data.monthlyCashFlow.map((m) => formatMonth(m.month))}
                  up={data.monthlyCashFlow.map((m) => m.deposits)}
                  down={data.monthlyCashFlow.map((m) => m.withdrawals)}
                  upName="Deposits"
                  downName="Withdrawals"
                />
              </Card>

              {/* Cash Flow Insights Banner */}
              {data.cashFlow.net < 0 ? (
                <div className="bg-red-500/10 text-red-700 dark:text-red-400 border border-red-500/20 rounded-2xl p-5 text-sm space-y-2">
                  <h4 className="font-bold flex items-center gap-1.5">
                    <span>⚠️</span> Negative Cash Flow Detected
                  </h4>
                  <p className="opacity-90">
                    Your depository withdrawals and transfers out exceeded your inflows by{" "}
                    <strong>{formatCurrency(Math.abs(data.cashFlow.net))}</strong> in{" "}
                    {formatMonth(data.selectedMonth)}. Consider adjusting category limits, scaling
                    back discretionary spending, or auditing active recurring subscriptions to re-balance.
                  </p>
                </div>
              ) : (
                <div className="bg-green-500/10 text-green-700 dark:text-green-400 border border-green-500/20 rounded-2xl p-5 text-sm space-y-2">
                  <h4 className="font-bold flex items-center gap-1.5">
                    <span>✅</span> Positive Cash Flow Balanced
                  </h4>
                  <p className="opacity-90">
                    Great work! You saved or retained{" "}
                    <strong>{formatCurrency(data.cashFlow.net)}</strong> in net depository cash
                    during {formatMonth(data.selectedMonth)}. Retaining positive cash flows helps build
                    long-term emergency savings and investment capital.
                  </p>
                </div>
              )}

              {/* Depository Accounts list */}
              <Card title="Checking & Savings Accounts Summary">
                <ul className="divide-y divide-black/10 dark:divide-white/10 text-sm font-medium">
                  {data.accounts
                    .filter((a) => a.type === "depository")
                    .map((a) => (
                      <li key={a.id} className="flex justify-between py-3">
                        <span>
                          {a.name ?? "Checking"}
                          {a.mask ? ` ••${a.mask}` : ""}
                          <span className="text-xs ml-2 opacity-50 uppercase tracking-wide">
                            {titleCase(a.subtype ?? "")}
                          </span>
                        </span>
                        <span className="tabular-nums font-semibold">
                          {formatCurrency(a.current_balance, a.iso_currency_code ?? "USD")}
                        </span>
                      </li>
                    ))}
                </ul>
              </Card>
            </div>
          )}
        </>
      )}
    </main>
  );
}
