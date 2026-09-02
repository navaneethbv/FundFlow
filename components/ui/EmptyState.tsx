import { cn } from "@/lib/cn";

/** Dashed panel inviting the first action of an empty area. */
export default function EmptyState({
  icon,
  title,
  description,
  action,
  headingLevel = 3,
  className,
}: Readonly<{
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  headingLevel?: 2 | 3;
  className?: string;
}>) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <div
      className={cn(
        "group rounded-card border border-dashed border-panel-border bg-panel px-4 py-14 text-center shadow-card transition-all duration-200 hover:border-accent/30",
        className,
      )}
    >
      {icon && (
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent transition-transform duration-200 group-hover:scale-105">
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
