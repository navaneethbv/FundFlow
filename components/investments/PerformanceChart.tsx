import { areaPath, linePath } from "@/lib/chart-utils";
import { formatCurrency } from "@/lib/format";
import { hasSufficientPerformanceData, type ReturnPoint } from "@/lib/investment-performance";
import type { InvestmentsPage } from "@/lib/investments";

const W = 320;
const H = 96;
const PAD = 6;

function sparkPath(values: number[]) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => ({
    x: PAD + (i / (values.length - 1)) * (W - PAD * 2),
    y: PAD + (1 - (v - min) / range) * (H - PAD * 2),
  }));
  return { pts, baseY: H - PAD };
}

/**
 * Shows time-weighted return once there's enough valuation and flow history
 * to compute it; until then, a raw balance trend labeled "Balance" — never
 * "Portfolio performance" for a number that hasn't actually removed deposits
 * and withdrawals yet.
 */
export default function PerformanceChart({
  balanceHistory,
  returns,
  currency,
}: Readonly<{
  balanceHistory: InvestmentsPage["balanceHistory"];
  returns: ReturnPoint[] | null;
  currency: string;
}>) {
  const sufficient = hasSufficientPerformanceData(balanceHistory) && returns != null;
  const values = sufficient ? returns!.map((p) => p.pct) : balanceHistory.map((p) => p.value);
  const geometry = sparkPath(values);

  if (!geometry) {
    return <p className="text-sm text-muted">Balance history builds up after a few days of syncing.</p>;
  }

  const latest = values[values.length - 1];

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">
          {sufficient ? "Portfolio performance" : "Balance"}
        </span>
        <span
          className={`tabular-nums font-medium ${sufficient ? (latest >= 0 ? "text-success" : "text-danger") : ""}`}
        >
          {sufficient ? `${latest >= 0 ? "+" : ""}${latest.toFixed(1)}%` : formatCurrency(latest, currency)}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-24 w-full" aria-hidden="true">
        <path d={areaPath(geometry.pts, geometry.baseY)} fill="var(--viz-1)" opacity={0.15} />
        <path d={linePath(geometry.pts)} fill="none" stroke="var(--viz-1)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {!sufficient && (
        <p className="text-xs text-muted">
          Portfolio performance (deposits and withdrawals removed) appears once there&apos;s enough history.
        </p>
      )}
      {/* Table twin */}
      <table className="sr-only">
        <caption>{sufficient ? "Portfolio performance" : "Balance"} history</caption>
        <thead>
          <tr>
            <th>Date</th>
            <th>{sufficient ? "Return" : "Value"}</th>
          </tr>
        </thead>
        <tbody>
          {sufficient
            ? returns!.map((p) => (
                <tr key={p.date}>
                  <td>{p.date}</td>
                  <td>{p.pct.toFixed(1)}%</td>
                </tr>
              ))
            : balanceHistory.map((p) => (
                <tr key={p.date}>
                  <td>{p.date}</td>
                  <td>{formatCurrency(p.value, currency)}</td>
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  );
}
