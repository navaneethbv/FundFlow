import { createClient } from "@/lib/supabase/server";
import AppShell from "@/components/shell/AppShell";
import { loadCanonicalProjection } from "@/lib/finance-query";
import { parseFinancialScope } from "@/lib/financial-scope";
import { summarizeTransactions, buildCashFlowSankeyData } from "@/lib/reports";
import SankeyChart from "@/components/charts/SankeyChart";
import { formatCurrency } from "@/lib/format";
import Link from "next/link";
import { Download, FileText } from "@/components/ui/icons";

import { notFound } from "next/navigation";
import { isFeatureEnabled } from "@/lib/feature-flags";

export default async function ReportsPage(
  props: Readonly<{ searchParams: Promise<{ start?: string; end?: string; scope?: string }> }>,
) {
  if (!isFeatureEnabled("reportsPage")) {
    notFound();
  }
  const searchParams = await props.searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return null;

  const now = new Date();
  const currentYear = now.getFullYear();
  const startDate = searchParams.start || `${currentYear}-01-01`;
  const endDate = searchParams.end || `${currentYear}-12-31`;

  const scope = parseFinancialScope({
    raw: searchParams.scope,
    ownerUserId: user.id,
    visibleHouseholdIds: [],
  });

  const { transactions: canonicalTxns } = await loadCanonicalProjection(supabase, {
    scope,
    window: { start: startDate, endExclusive: endDate },
  });

  const summary = summarizeTransactions(canonicalTxns);
  const sankeyData = buildCashFlowSankeyData(canonicalTxns);

  return (
    <AppShell active="reports" email={user.email}>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Reports</h1>
            <p className="text-sm text-muted">
              Interactive financial flow breakdown and saved definitions ({startDate} to {endDate})
            </p>
          </div>
          <div className="flex items-center gap-3">
            <a
              href={`/api/export/report-csv?start=${startDate}&end=${endDate}`}
              className="inline-flex items-center gap-2 rounded-field border border-panel-border bg-panel px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-panel-hover"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Export CSV</span>
            </a>
            <Link
              href="/wrapped"
              className="inline-flex items-center gap-2 rounded-field bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent/90"
            >
              <FileText className="h-3.5 w-3.5" />
              <span>Year in Money</span>
            </Link>
          </div>
        </div>

        {/* Summary Metrics */}
        <div className="grid gap-4 sm:grid-cols-4">
          <div className="rounded-panel border border-panel-border bg-panel p-4">
            <p className="text-xs font-medium text-muted">Total Income</p>
            <p className="mt-1 text-2xl font-bold text-foreground">
              {formatCurrency(summary.totalIncome)}
            </p>
          </div>
          <div className="rounded-panel border border-panel-border bg-panel p-4">
            <p className="text-xs font-medium text-muted">Total Spending</p>
            <p className="mt-1 text-2xl font-bold text-foreground">
              {formatCurrency(summary.totalSpending)}
            </p>
          </div>
          <div className="rounded-panel border border-panel-border bg-panel p-4">
            <p className="text-xs font-medium text-muted">Total Transactions</p>
            <p className="mt-1 text-2xl font-bold text-foreground">{summary.totalTransactions}</p>
          </div>
          <div className="rounded-panel border border-panel-border bg-panel p-4">
            <p className="text-xs font-medium text-muted">Largest Transaction</p>
            <p className="mt-1 text-2xl font-bold text-foreground">
              {formatCurrency(summary.largest)}
            </p>
          </div>
        </div>

        {/* Sankey Flow Diagram */}
        <div className="rounded-panel border border-panel-border bg-panel p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">Cash Flow Diagram</h2>
          <SankeyChart nodes={sankeyData.nodes} links={sankeyData.links} />
        </div>
      </div>
    </AppShell>
  );
}
