"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Panel from "@/components/ui/Panel";

/** Weekly email report opt-in/out (profiles.weekly_report_enabled, RLS-scoped). */
export default function ReportsSection({
  initialEnabled,
}: {
  initialEnabled: boolean;
}) {
  const supabase = createClient();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);

  async function toggle() {
    setSaving(true);
    const next = !enabled;
    const { data: userData } = await supabase.auth.getUser();
    await supabase
      .from("profiles")
      .update({ weekly_report_enabled: next })
      .eq("id", userData.user?.id ?? "");
    setEnabled(next);
    setSaving(false);
  }

  return (
    <Panel title="Reports" eyebrow="Weekly email">
      <p className="mb-4 text-sm text-muted">
        Every Sunday, get a PDF summary of your week: spend vs last week, top
        categories and merchants, cash flow, and balances.
      </p>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          onChange={toggle}
          disabled={saving}
        />
        Email me the weekly report
        <Badge tone={enabled ? "success" : "warning"}>{enabled ? "Enabled" : "Paused"}</Badge>
      </label>
      <Button type="button" variant="ghost" size="sm" onClick={toggle} disabled={saving} className="mt-4">
        {saving ? "Saving..." : enabled ? "Pause reports" : "Enable reports"}
      </Button>
    </Panel>
  );
}
