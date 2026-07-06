import { formatCurrency } from "@/lib/format";

export default function BarList({
  items,
  max,
}: {
  items: { label: string; amount: number }[];
  max: number;
}) {
  if (items.length === 0) {
    return <p className="py-4 text-sm text-muted">No data yet.</p>;
  }

  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item.label} className="text-sm">
          <div className="mb-1.5 flex justify-between gap-4 font-medium">
            <span>{item.label}</span>
            <span className="tabular-nums font-semibold">{formatCurrency(item.amount)}</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-panel-hover">
            <div
              className="h-full rounded-full bg-accent transition-all duration-500 ease-out"
              style={{ width: `${max > 0 ? (item.amount / max) * 100 : 0}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
