/** Dashed panel inviting the first action of an empty area. */
export default function EmptyState({
  icon,
  title,
  description,
  action,
  headingLevel = 3,
}: Readonly<{
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  headingLevel?: 2 | 3;
}>) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <div className="rounded-card border border-dashed border-panel-border bg-panel px-4 py-14 text-center shadow-card">
      {icon && (
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent">
          {icon}
        </div>
      )}
      <Heading className="text-xl font-bold tracking-tight">{title}</Heading>
      {description && (
        <p className="mx-auto mb-5 mt-2 max-w-sm text-sm text-muted">
          {description}
        </p>
      )}
      {action}
    </div>
  );
}
