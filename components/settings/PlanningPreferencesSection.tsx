"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Button from "@/components/ui/Button";
import Panel from "@/components/ui/Panel";

type AlertKey =
  | "broken_bank"
  | "budget_exceeded"
  | "goal_reached"
  | "large_transaction"
  | "low_cash_forecast";

type Preferences = Record<AlertKey, boolean>;

const labels: Array<{ key: AlertKey; label: string }> = [
  { key: "broken_bank", label: "Broken bank connection" },
  { key: "budget_exceeded", label: "Budget exceeded" },
  { key: "goal_reached", label: "Goal reached" },
  { key: "large_transaction", label: "Large transaction" },
  { key: "low_cash_forecast", label: "Low cash forecast" },
];

export default function PlanningPreferencesSection({
  initialPreferences,
  initialAiEnabled,
}: {
  initialPreferences: Partial<Preferences> | null;
  initialAiEnabled: boolean;
}) {
  const supabase = createClient();
  const [preferences, setPreferences] = useState<Preferences>({
    broken_bank: initialPreferences?.broken_bank ?? true,
    budget_exceeded: initialPreferences?.budget_exceeded ?? true,
    goal_reached: initialPreferences?.goal_reached ?? true,
    large_transaction: initialPreferences?.large_transaction ?? false,
    low_cash_forecast: initialPreferences?.low_cash_forecast ?? true,
  });
  const [aiEnabled, setAiEnabled] = useState(initialAiEnabled);
  const [status, setStatus] = useState<string | null>(null);

  async function save() {
    setStatus(null);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      setStatus("Sign in again to save preferences.");
      return;
    }

    const [{ error: alertError }, { error: aiError }] = await Promise.all([
      supabase
        .from("alert_preferences")
        .upsert({ user_id: userId, ...preferences }, { onConflict: "user_id" }),
      supabase
        .from("ai_settings")
        .upsert({ user_id: userId, enabled: aiEnabled }, { onConflict: "user_id" }),
    ]);

    setStatus(alertError?.message ?? aiError?.message ?? "Preferences saved.");
  }

  return (
    <Panel title="Planning preferences" eyebrow="Alerts and AI">
      <div className="space-y-3 text-sm">
        {labels.map((item) => (
          <label key={item.key} className="flex items-center justify-between gap-3 rounded-field bg-panel-2 p-3">
            <span>{item.label}</span>
            <input
              type="checkbox"
              checked={preferences[item.key]}
              onChange={(event) =>
                setPreferences((current) => ({ ...current, [item.key]: event.target.checked }))
              }
            />
          </label>
        ))}
        <label className="flex items-center justify-between gap-3 rounded-field border border-accent/20 bg-accent-soft p-3">
          <span>
            <span className="block font-semibold">Privacy-safe AI insights</span>
            <span className="block text-xs text-muted">Opt in to summaries generated from export-safe fields only.</span>
          </span>
          <input type="checkbox" checked={aiEnabled} onChange={(event) => setAiEnabled(event.target.checked)} />
        </label>
      </div>
      <Button className="mt-4" onClick={save}>
        Save preferences
      </Button>
      {status && <p className="mt-3 text-sm text-muted">{status}</p>}
    </Panel>
  );
}
