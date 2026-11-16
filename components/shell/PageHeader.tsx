import type { ReactNode } from "react";

/**
 * Every page's title + action row. Replaces the old eyebrow + `.display`
 * H1 + description paragraph — Monarch's own pages never carry a kicker or
 * a subhead here; anything load-bearing that used to live in a description
 * moves to section copy or a tooltip instead.
 *
 * It is the content column's top bar: 64px, page-coloured, pinned while the
 * cards scroll under it, with the title set 8px further in than the cards
 * below (docs/MONARCH_LOOK.md, "Top bar").
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
    <header className="sticky top-0 z-20 -mx-4 mb-0 flex flex-col gap-1 bg-background px-4 py-3.5 md:pl-6">
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-3 sm:gap-4">
        <h1 className="page-title min-w-0">{title}</h1>
        {actions && (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>
      {description && <p className="text-sm text-muted">{description}</p>}
    </header>
  );
}
