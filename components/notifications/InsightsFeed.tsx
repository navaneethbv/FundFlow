"use client";
import { useRef, useState } from "react";
import type { NotificationRow } from "@/components/notifications/NotificationFeed";
import Panel from "@/components/ui/Panel";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import { formatTimestampUtc } from "@/lib/format-date";
const priorities = { danger: 0, warning: 1, info: 2, success: 3 };
export default function InsightsFeed({
  initial,
}: Readonly<{ initial: NotificationRow[] }>) {
  const filter = useRef<HTMLSelectElement>(null);
  const [overrides, setOverrides] = useState<Record<string, string | null>>({});
  const [view, setView] = useState("active");
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const rows = initial
    .map((row) => ({
      ...row,
      read_at: Object.hasOwn(overrides, row.id)
        ? overrides[row.id]!
        : row.read_at,
    }))
    .filter(
      (row) =>
        view === "all" || (view === "active" ? !row.read_at : !!row.read_at),
    )
    .toSorted(
      (a, b) =>
        priorities[a.severity] - priorities[b.severity] ||
        b.created_at.localeCompare(a.created_at),
    );
  async function change(id: string, action: "acknowledge" | "restore") {
    setBusy(id);
    setStatus("");
    try {
      const response = await fetch("/api/insights/acknowledge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      if (!response.ok)
        throw new Error("Could not update this insight. Try again.");
      const result = await response.json();
      filter.current?.focus();
      setOverrides((current) => ({ ...current, [id]: result.read_at }));
      setStatus(
        action === "acknowledge"
          ? "Insight acknowledged. Find it under Acknowledged to restore it."
          : "Insight restored.",
      );
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Could not update insight.",
      );
    } finally {
      setBusy(null);
    }
  }
  return (
    <Panel title="Insights" eyebrow="Recent activity, highest priority first">
      <label className="mb-4 flex items-center gap-3 text-sm">
        Show
        <select
          ref={filter}
          value={view}
          onChange={(event) => setView(event.target.value)}
          className="rounded-field border border-panel-border bg-panel p-2"
        >
          <option value="active">Active</option>
          <option value="acknowledged">Acknowledged</option>
          <option value="all">All</option>
        </select>
      </label>
      <p role="status" className="mb-3 text-sm">
        {status}
      </p>
      <div className="space-y-3">
        {rows.map((row) => (
          <article
            key={row.id}
            className="rounded-field border border-panel-border p-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold" data-money>
                {row.title}
              </h3>
              <Badge tone={row.severity === "info" ? "neutral" : row.severity}>
                {row.read_at ? "Acknowledged" : row.severity}
              </Badge>
            </div>
            <p className="mt-2 text-sm leading-6 text-muted" data-money>
              {row.body}
            </p>
            <time
              dateTime={row.created_at}
              className="mt-2 block text-xs text-muted"
            >
              {formatTimestampUtc(row.created_at)}
            </time>
            <div className="mt-3">
              {row.read_at ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => change(row.id, "restore")}
                >
                  Restore
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => change(row.id, "acknowledge")}
                >
                  Acknowledge
                </Button>
              )}
            </div>
          </article>
        ))}
        {!rows.length && (
          <p className="text-sm text-muted">No insights in this view.</p>
        )}
      </div>
      <p className="mt-4 text-xs text-muted">
        Showing the latest 200 notifications. Signals describe loaded history,
        which may be incomplete.
      </p>
    </Panel>
  );
}
