import AreaSparkline from "@/components/charts/AreaSparkline";
import WidgetShell from "@/components/dashboard/widgets/WidgetShell";
import Badge from "@/components/ui/Badge";
import DropdownButton from "@/components/ui/DropdownButton";
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
      error={error}
      empty={latest ? null : "Connect an account to start tracking net worth."}
      action={
        <DropdownButton
          label="1 month"
          items={[{ label: "View accounts", href: "/accounts" }]}
        />
      }
    >
      <p data-money className="metric-value text-2xl sm:text-3xl">
        {formatCurrency(latest?.netWorth ?? 0, currency)}
      </p>
      {change !== null && (
        <Badge tone={change >= 0 ? "success" : "danger"} className="mt-2">
          {change >= 0 ? "Up" : "Down"} {formatCurrency(Math.abs(change), currency)} in
          the last month
        </Badge>
      )}
      {history.length > 1 && (
        <div className="mt-3">
          <AreaSparkline values={history.map((point) => point.netWorth)} color="var(--viz-1)" />
        </div>
      )}
    </WidgetShell>
  );
}
