import type { InvestmentsPage } from "@/lib/investments";

export default function TopMovers({
  movers,
}: Readonly<{ movers: InvestmentsPage["topMovers"] }>) {
  if (!movers || movers.length === 0) {
    return <p className="text-sm text-muted">Price history builds up after a few days of syncing.</p>;
  }

  return (
    <ul className="space-y-2">
      {movers.map((m, index) => (
        <li
          key={m.id}
          className={`flex items-center justify-between rounded-field px-2 py-1 text-sm${
            index % 2 === 1 ? " bg-panel-2" : ""
          }`}
        >
          <span>
            {m.name}
            {m.ticker && <span className="ml-1 text-xs text-muted">{m.ticker}</span>}
          </span>
          <span
            data-money
            className="tabular-nums font-medium"
            style={{ color: m.changePct >= 0 ? "var(--viz-pos)" : "var(--viz-neg)" }}
          >
            {m.changePct >= 0 ? "+" : ""}
            {m.changePct.toFixed(1)}%
          </span>
        </li>
      ))}
    </ul>
  );
}
