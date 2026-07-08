"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import Panel from "@/components/ui/Panel";

interface Insight {
  insightType: string;
  sourceMonth: string | null;
  summary: string;
}

/**
 * Generates deterministic, privacy-safe insight summaries from the same export
 * contract the AI export uses. No raw data leaves the server: the route filters
 * to the safe key set and only stores the generated summaries.
 */
export default function AiInsightsSection({ enabled }: { enabled: boolean }) {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function generate() {
    setStatus(null);
    setBusy(true);
    try {
      const res = await fetch("/api/ai/insights", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Could not generate insights.");
      const rows = (json.insights ?? []) as Insight[];
      setInsights(rows);
      if (rows.length === 0) {
        setStatus("Enable AI insights in preferences to generate summaries.");
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Could not generate insights.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="AI insights" eyebrow="Privacy-safe summaries">
      <p className="mb-4 text-sm text-muted">
        Deterministic summaries built only from export-safe fields (date, merchant, category,
        amount). {enabled ? "AI insights are enabled." : "Turn on AI insights in preferences to use this."}
      </p>
      <Button onClick={generate} loading={busy} variant="secondary" disabled={!enabled}>
        Generate insights
      </Button>
      {insights.length > 0 && (
        <ul className="mt-4 space-y-2 text-sm">
          {insights.map((insight) => (
            <li key={insight.insightType} className="rounded-field bg-panel-2 p-3">
              {insight.summary}
            </li>
          ))}
        </ul>
      )}
      {status && <p className="mt-3 text-sm text-muted">{status}</p>}
    </Panel>
  );
}
