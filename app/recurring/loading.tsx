export default function RecurringLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading Recurring">
      <div className="h-10 w-48 animate-pulse rounded-field bg-panel-hover" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={index}
            className="h-28 animate-pulse rounded-card bg-panel-hover"
          />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-card bg-panel-hover" />
    </div>
  );
}
