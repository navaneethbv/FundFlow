import type { ReactNode } from "react";

/**
 * Every page's title + action row. Replaces the old eyebrow + `.display`
 * H1 + description paragraph — Monarch's own pages never carry a kicker or
 * a subhead here; anything load-bearing that used to live in a description
 * moves to section copy or a tooltip instead.
 */
export default function PageHeader({
  title,
  actions,
  description,
}: Readonly<{
  title: ReactNode;
  actions?: ReactNode;
  description?: ReactNode;
}>) {
  return (
    <header className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4">
        <h1 className="page-title min-w-0">{title}</h1>
        {actions && (
          <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">{actions}</div>
        )}
      </div>
      {description && <p className="text-sm text-muted">{description}</p>}
    </header>
  );
}
