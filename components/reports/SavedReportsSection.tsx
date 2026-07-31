"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Panel from "@/components/ui/Panel";
import {
  reportFiltersToSearchParams,
  type ReportFilters,
} from "@/lib/reports";

/**
 * Save / rename / load / delete for report definitions.
 *
 * Only this strip is a client component — the chart, summary, and table above
 * it stay server-rendered. Loading a saved report is a plain `<Link>` to the
 * URL its filters serialize to, so a saved report and a hand-built URL are the
 * same thing and nothing has to stay in sync.
 *
 * The current filters are sent to the API as-is; the route re-validates them
 * against the versioned schema, so this component is never the thing deciding
 * what is storable.
 */

export interface SavedReport {
  id: string;
  name: string;
  report_type: string;
  filters: unknown;
}

function hrefFor(filters: unknown): string | null {
  // A row written by an older or newer schema is shown but not loadable, rather
  // than silently loading a different row set than the user saved.
  if (typeof filters !== "object" || filters === null) return null;
  const candidate = filters as Partial<ReportFilters>;
  if (!candidate.start || !candidate.end || !candidate.tab) return null;
  return `/reports?${reportFiltersToSearchParams(candidate as ReportFilters).toString()}`;
}

export default function SavedReportsSection({
  reports,
  currentFilters,
}: Readonly<{ reports: SavedReport[]; currentFilters: ReportFilters }>) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(
    input: RequestInfo,
    init: RequestInit,
  ): Promise<boolean> {
    setError(null);
    setBusy(true);
    try {
      const response = await fetch(input, init);
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(body?.error ?? "That did not work. Please try again.");
        return false;
      }
      startTransition(() => router.refresh());
      return true;
    } catch {
      // A rejected fetch (offline, aborted) must surface, not vanish.
      setError("Could not reach the server. Check your connection.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function save(event: React.SyntheticEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give the report a name.");
      return;
    }
    const ok = await send("/api/reports/saved", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: trimmed,
        reportType: currentFilters.tab,
        filters: currentFilters,
      }),
    });
    if (ok) setName("");
  }

  async function rename(event: React.SyntheticEvent, id: string) {
    event.preventDefault();
    const trimmed = renameValue.trim();
    if (!trimmed) {
      setError("Enter a new name.");
      return;
    }
    const ok = await send("/api/reports/saved", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, name: trimmed }),
    });
    if (ok) {
      setRenamingId(null);
      setRenameValue("");
    }
  }

  async function remove(id: string) {
    await send(`/api/reports/saved?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  const disabled = busy || isPending;

  return (
    <Panel eyebrow="Saved" title="Saved reports">
      <form onSubmit={save} className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 text-sm font-semibold">
          <span className="mb-1 block text-xs text-muted">
            Save these filters as
          </span>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="July groceries"
            maxLength={80}
          />
        </label>
        <Button type="submit" disabled={disabled}>
          Save report
        </Button>
      </form>

      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}

      {reports.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          No saved reports yet. Set a range and filters above, then save them
          under a name to come back to.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {reports.map((report) => {
            const href = hrefFor(report.filters);
            return (
              <li
                key={report.id}
                className="flex flex-wrap items-center gap-2 border-t border-panel-border pt-2 first:border-t-0 first:pt-0"
              >
                {renamingId === report.id ? (
                  <form
                    onSubmit={(event) => rename(event, report.id)}
                    className="flex flex-1 flex-wrap items-center gap-2"
                  >
                    <Input
                      value={renameValue}
                      onChange={(event) => setRenameValue(event.target.value)}
                      aria-label={`New name for ${report.name}`}
                      maxLength={80}
                    />
                    <Button type="submit" size="sm" disabled={disabled}>
                      Save
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setRenamingId(null)}
                    >
                      Cancel
                    </Button>
                  </form>
                ) : (
                  <>
                    {href ? (
                      <Link
                        href={href}
                        className="min-w-0 flex-1 truncate text-sm font-semibold text-accent focus-visible:outline-2"
                      >
                        {report.name}
                      </Link>
                    ) : (
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                        {report.name}
                        <span className="ml-2 text-xs font-normal text-muted">
                          saved in an unsupported format
                        </span>
                      </span>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setRenamingId(report.id);
                        setRenameValue(report.name);
                      }}
                    >
                      Rename
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      disabled={disabled}
                      onClick={() => remove(report.id)}
                    >
                      Delete
                    </Button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
