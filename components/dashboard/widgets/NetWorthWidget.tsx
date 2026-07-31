import Link from "next/link";
import Sparkline from "@/components/charts/Sparkline";
import WidgetShell from "@/components/dashboard/widgets/WidgetShell";
import { formatCurrency } from "@/lib/format";

export interface NetWorthPoint {
  month: string;
  netWorth: number;
}

export default function NetWorthWidget({
  history,
  currency,
  error = null,
}: Readonly<{
  history: NetWorthPoint[];
  currency: string;
  error?: string | null;
}>) {
  const latest = history.at(-1);
  const previous = history.at(-2);
  // One month of history is a number, not a trend; only claim a change when
  // there is something to compare against.
  const change =
    latest && previous
      ? Math.round((latest.netWorth - previous.netWorth) * 100) / 100
      : null;

  return (
    <WidgetShell
      title="Net worth"
      hint="Assets minus liabilities"
      error={error}
      empty={latest ? null : "Connect an account to start tracking net worth."}
      action={
        <Link
          href="/accounts"
          className="text-sm font-semibold text-accent hover:underline"
        >
          Accounts
        </Link>
      }
    >
      <p className="metric-value text-2xl sm:text-3xl">
        {formatCurrency(latest?.netWorth ?? 0, currency)}
      </p>
      {change !== null && (
        <p
          className="mt-1 text-sm tabular-nums"
          style={{ color: change >= 0 ? "var(--viz-good)" : "var(--viz-bad)" }}
        >
          {change >= 0 ? "Up" : "Down"} {formatCurrency(Math.abs(change), currency)}{" "}
          in the last month
        </p>
      )}
      {history.length > 1 && (
        <div className="mt-3">
          <Sparkline values={history.map((point) => point.netWorth)} />
        </div>
      )}
    </WidgetShell>
  );
}
