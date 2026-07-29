export default function CashFlowLoading() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading Cash Flow"
      className="space-y-5 px-4 py-6 sm:px-6 lg:px-7"
    >
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
    </div>
  );
}
