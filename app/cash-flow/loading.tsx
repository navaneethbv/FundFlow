import RouteSkeleton from "@/components/shell/RouteSkeleton";

export default function CashFlowLoading() {
  return (
    <RouteSkeleton active="cashflow" label="Cash Flow">
      <div className="h-4 w-40 animate-pulse rounded bg-panel-hover" />
      <div className="h-10 w-64 animate-pulse rounded bg-panel-hover" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {["income", "expenses", "savings", "rate"].map((key) => (
          <div
            key={key}
            className="h-28 animate-pulse rounded-card border border-panel-border bg-panel"
          />
        ))}
      </div>
      <div className="h-80 animate-pulse rounded-card border border-panel-border bg-panel" />
    </RouteSkeleton>
  );
}
