import type { InvestmentsPage } from "@/lib/investments";

export default function TopMovers({
  movers,
}: Readonly<{ movers: InvestmentsPage["topMovers"] }>) {
  if (!movers || movers.length === 0) {
    return <p className="text-sm text-muted">Price history builds up after a few days of syncing.</p>;
  }

  return (
    <ul className="space-y-2">
      {movers.map((m) => (
        <li key={`${m.name}-${m.ticker ?? ""}`} className="flex items-center justify-between text-sm">
          <span>
            {m.name}
            {m.ticker && <span className="ml-1 text-xs text-muted">{m.ticker}</span>}
          </span>
          <span
            data-money
            className={m.changePct >= 0 ? "tabular-nums font-medium text-success" : "tabular-nums font-medium text-danger"}
          >
            {m.changePct >= 0 ? "+" : ""}
            {m.changePct.toFixed(1)}%
          </span>
        </li>
      ))}
    </ul>
  );
}
