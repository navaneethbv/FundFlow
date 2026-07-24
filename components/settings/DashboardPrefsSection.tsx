"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Button from "@/components/ui/Button";
import Panel from "@/components/ui/Panel";

export interface DashboardPrefs {
  hideRecent?: boolean;
  hideBreakdowns?: boolean;
  hideBillCalendar?: boolean;
  hideWhatIf?: boolean;
  hideDebt?: boolean;
}

const OPTIONS: Array<{ key: keyof DashboardPrefs; label: string; view: string }> = [
  { key: "hideRecent", label: "Recent activity & top merchants", view: "Monitor" },
  { key: "hideBreakdowns", label: "Category donut & recurring streams", view: "Monitor" },
  { key: "hideBillCalendar", label: "Bill calendar", view: "Plan" },
  { key: "hideWhatIf", label: "What-if simulator", view: "Plan" },
  { key: "hideDebt", label: "Debt payoff panel", view: "Plan" },
];

/**
 * Dashboard layout preferences (8.6): hide sections you don't use. Stored
 * in the client-writable profiles.dashboard_prefs column.
 */
export default function DashboardPrefsSection({
  initialPrefs,
}: {
  initialPrefs: DashboardPrefs;
}) {
  const supabase = createClient();
  const [prefs, setPrefs] = useState<DashboardPrefs>(initialPrefs);
  const [status, setStatus] = useState<string | null>(null);

  async function save() {
    setStatus(null);
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      setStatus("Sign in again to save preferences.");
      return;
    }
    const { error } = await supabase
      .from("profiles")
      .update({ dashboard_prefs: prefs })
      .eq("id", data.user.id);
    setStatus(error?.message ?? "Dashboard preferences saved.");
  }

  return (
    <Panel title="Dashboard sections" eyebrow="Show what you use">
      <div className="space-y-2">
        {OPTIONS.map((option) => (
          <label
            key={option.key}
            className="flex items-center justify-between gap-4 rounded-field bg-panel-2 p-3 text-sm"
          >
            <span>
              <span className="font-semibold">{option.label}</span>
              <span className="ml-2 text-xs text-muted">{option.view}</span>
            </span>
            <input
              type="checkbox"
              className="h-4 w-4 accent-accent"
              checked={!prefs[option.key]}
              onChange={(e) =>
                setPrefs((current) => ({ ...current, [option.key]: !e.target.checked }))
              }
            />
          </label>
        ))}
      </div>
      <Button className="mt-4" type="button" onClick={save}>
        Save layout
      </Button>
      {status && <p className="mt-2 text-sm text-muted">{status}</p>}
    </Panel>
  );
}
