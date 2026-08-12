import Panel from "@/components/ui/Panel";

/**
 * Common framing for every dashboard widget.
 *
 * Header anatomy is Monarch's: a bold title with an inline muted value right
 * next to it on the same line ("Spending  $13,928.05 this month"), not the
 * old stacked eyebrow-above-title. `value` is optional prose, not a data
 * encoding, so it renders in `.card-title`'s inherited size/weight overridden
 * down to a plain muted caption — no privacy-blur hook needed here since it's
 * a widget-level total already unblurred elsewhere on the page.
 *
 * The `error` slot exists because the dashboard renders seven independent
 * widgets from several queries: one failing source must degrade to a message
 * inside its own card, never blank the page. A widget that has simply nothing
 * to show passes `empty` instead — "no data yet" and "we could not load this"
 * are different statements and must not look alike.
 */
export default function WidgetShell({
  title,
  value,
  action,
  error = null,
  empty = null,
  stale = false,
  children,
}: Readonly<{
  title: string;
  /** Inline muted value shown next to the title, e.g. "$13,928.05 this month". */
  value?: string;
  action?: React.ReactNode;
  error?: string | null;
  empty?: string | null;
  stale?: boolean;
  children?: React.ReactNode;
}>) {
  let body = children;
  if (empty) body = <p className="py-4 text-sm text-muted">{empty}</p>;
  if (error) {
    body = <output className="block py-4 text-sm text-danger">{error}</output>;
  }

  return (
    <Panel
      title={
        <span className="flex flex-wrap items-baseline gap-1.5">
          <span>{title}</span>
          {value && <span className="text-sm font-normal text-muted">{value}</span>}
        </span>
      }
      action={action}
      className="min-w-0"
    >
      {stale && !error && (
        <p className="mb-3 text-xs text-muted">
          Showing the last successful sync; figures may be out of date.
        </p>
      )}
      {body}
    </Panel>
  );
}
