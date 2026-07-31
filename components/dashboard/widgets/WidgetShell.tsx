import Panel from "@/components/ui/Panel";

/**
 * Common framing for every dashboard widget.
 *
 * The `error` slot exists because the dashboard renders seven independent
 * widgets from several queries: one failing source must degrade to a message
 * inside its own card, never blank the page. A widget that has simply nothing
 * to show passes `empty` instead — "no data yet" and "we could not load this"
 * are different statements and must not look alike.
 */
export default function WidgetShell({
  title,
  hint,
  action,
  error = null,
  empty = null,
  stale = false,
  children,
}: Readonly<{
  title: string;
  hint?: string;
  action?: React.ReactNode;
  error?: string | null;
  empty?: string | null;
  stale?: boolean;
  children?: React.ReactNode;
}>) {
  return (
    <Panel eyebrow={hint} title={title} action={action} className="min-w-0">
      {stale && !error && (
        <p className="mb-3 text-xs text-muted">
          Showing the last successful sync; figures may be out of date.
        </p>
      )}
      {error ? (
        <p role="status" className="py-4 text-sm text-danger">
          {error}
        </p>
      ) : empty ? (
        <p className="py-4 text-sm text-muted">{empty}</p>
      ) : (
        children
      )}
    </Panel>
  );
}
