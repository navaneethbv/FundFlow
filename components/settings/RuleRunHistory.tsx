"use client";
import { useEffect, useState } from "react";
import Panel from "@/components/ui/Panel";
import Button from "@/components/ui/Button";
import { formatTimestampUtc } from "@/lib/format-date";
interface Run {
  id: string;
  rule_id: string | null;
  trigger: string;
  matched: number;
  changed: number | null;
  status: string;
  error: string | null;
  created_at: string;
}
export default function RuleRunHistory() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState("");
  async function refresh() {
    try {
      const response = await fetch("/api/rules/history");
      if (!response.ok) throw new Error("Could not load run history.");
      setRuns((await response.json()).runs);
      setError("");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not load run history.",
      );
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/rules/history", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load run history.");
        setRuns((await response.json()).runs);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message);
      });
    return () => controller.abort();
  }, []);
  return (
    <Panel title="Rule run history" eyebrow="Latest 100 runs">
      <Button variant="secondary" size="sm" onClick={refresh}>
        Refresh history
      </Button>
      <p role="status" className="my-3 text-sm">
        {error}
      </p>
      <ul className="space-y-3">
        {runs.map((run) => (
          <li
            key={run.id}
            className="rounded-field border border-panel-border p-3 text-sm"
          >
            <p className="font-semibold">
              Rule {run.rule_id?.slice(0, 8) ?? "deleted"}: {run.status}
            </p>
            <p className="text-muted">
              {run.trigger} · {run.matched} matched · {run.changed ?? "unknown"}{" "}
              changed
            </p>
            <time dateTime={run.created_at} className="text-xs">
              {formatTimestampUtc(run.created_at)}
            </time>
            {run.error && <p className="mt-2">{run.error}</p>}
          </li>
        ))}
      </ul>
      {!runs.length && !error && (
        <p className="text-sm text-muted">No recorded rule runs yet.</p>
      )}
    </Panel>
  );
}
