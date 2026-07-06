"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import ButtonLink from "@/components/ui/ButtonLink";
import Panel from "@/components/ui/Panel";

export default function ExportSection({
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
      .update({ ai_export_enabled: next })
      .eq("id", userData.user?.id ?? "");
    setEnabled(next);
    setSaving(false);
  }

  return (
    <Panel title="Export data" eyebrow="Downloads">
      <p className="mb-4 text-sm text-muted">
        Download your transactions as CSV or JSON (merchant, amount, date,
        category only - no account numbers or identifiers; feed them to any AI
        tool you choose), or grab this week&apos;s summary as a PDF.
      </p>

      <label className="mb-4 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          onChange={toggle}
          disabled={saving}
        />
        Allow exporting my transaction data
        <Badge tone={enabled ? "success" : "warning"}>{enabled ? "Enabled" : "Paused"}</Badge>
      </label>

      <div className="flex flex-wrap gap-2">
        <ButtonLink href="/api/export/csv" className={!enabled ? "pointer-events-none opacity-40" : ""}>
          Export as CSV
        </ButtonLink>
        <ButtonLink href="/api/export/json" className={!enabled ? "pointer-events-none opacity-40" : ""}>
          Export as JSON
        </ButtonLink>
        <ButtonLink href="/api/export/report">Export PDF report</ButtonLink>
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={toggle} disabled={saving} className="mt-4">
        {saving ? "Saving..." : enabled ? "Pause exports" : "Enable exports"}
      </Button>
    </Panel>
  );
}
