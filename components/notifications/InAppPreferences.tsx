"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Button from "@/components/ui/Button";
import Panel from "@/components/ui/Panel";

type AlertKey =
  | "budget_exceeded"
  | "goal_reached"
  | "large_transaction"
  | "low_cash_forecast";

type Preferences = Record<AlertKey, boolean>;

const OPTIONS: Array<{ key: AlertKey; title: string; description: string }> = [
  { key: "budget_exceeded", title: "Budget pace", description: "Know when a category crosses its monthly limit." },
  { key: "goal_reached", title: "Goal milestones", description: "Celebrate when a savings goal reaches its target." },
  { key: "large_transaction", title: "Large transactions", description: "Flag unusually large posted transactions." },
  { key: "low_cash_forecast", title: "Low cash forecast", description: "Get advance notice when projected cash runs low." },
];

export default function InAppPreferences({
  initialPreferences,
}: {
  initialPreferences: Partial<Preferences> | null;
}) {
  const supabase = createClient();
  const [preferences, setPreferences] = useState<Preferences>({
    budget_exceeded: initialPreferences?.budget_exceeded ?? true,
    goal_reached: initialPreferences?.goal_reached ?? true,
    large_transaction: initialPreferences?.large_transaction ?? false,
    low_cash_forecast: initialPreferences?.low_cash_forecast ?? true,
  });
  const [status, setStatus] = useState<string | null>(null);

  async function save() {
    setStatus(null);
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      setStatus("Sign in again to save alert preferences.");
      return;
    }
    const { error } = await supabase.from("alert_preferences").upsert(
      { user_id: data.user.id, broken_bank: true, ...preferences },
      { onConflict: "user_id" },
    );
    setStatus(error?.message ?? "In-app preferences saved.");
  }

  return (
    <Panel title="In-app alerts" eyebrow="Planning signals" padding="lg">
      <p className="mb-5 text-sm text-muted">Choose which planning signals appear in your notification feed. Critical bank alerts always appear.</p>
      <div className="space-y-3">
        {OPTIONS.map((option) => (
          <label key={option.key} className="flex items-start justify-between gap-4 rounded-field bg-panel-2 p-4">
            <span>
              <span className="block text-sm font-semibold">{option.title}</span>
              <span className="mt-1 block text-xs leading-5 text-muted">{option.description}</span>
            </span>
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 accent-accent"
              checked={preferences[option.key]}
              onChange={(event) => setPreferences((current) => ({ ...current, [option.key]: event.target.checked }))}
            />
          </label>
        ))}
      </div>
      <Button className="mt-5" type="button" onClick={save}>Save alert preferences</Button>
      {status && <p className="mt-3 text-sm text-muted" role="status">{status}</p>}
    </Panel>
  );
}
