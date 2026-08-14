"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import ButtonLink from "@/components/ui/ButtonLink";
import Panel from "@/components/ui/Panel";

export default function ExportSection({
  initialEnabled,
}: Readonly<{
  initialEnabled: boolean;
}>) {
  const supabase = createClient();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setSaving(true);
    setError(null);
    const next = !enabled;
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      setError("You must be signed in to change this setting.");
      setSaving(false);
      return;
    }
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ ai_export_enabled: next })
      .eq("id", userData.user.id);
    setSaving(false);
    if (updateError) {
      setError("Could not save the export setting. Please try again.");
      return;
    }
    setEnabled(next);
  }

  let toggleLabel = "Enable exports";
  if (saving) toggleLabel = "Saving...";
  else if (enabled) toggleLabel = "Pause exports";

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
      {error && <p role="alert" className="mb-3 text-sm text-danger">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <ButtonLink href="/api/export/csv" className={!enabled ? "pointer-events-none opacity-40" : ""}>
          Export as CSV
        </ButtonLink>
        <ButtonLink href="/api/export/json" className={!enabled ? "pointer-events-none opacity-40" : ""}>
          Export as JSON
        </ButtonLink>
        <ButtonLink href="/api/export/qif" className={!enabled ? "pointer-events-none opacity-40" : ""}>
          Export as QIF
        </ButtonLink>
        <ButtonLink href="/api/export/report">Export PDF report</ButtonLink>
        <ButtonLink
          href="/api/export/csv?scope=tax"
          className={!enabled ? "pointer-events-none opacity-40" : ""}
        >
          Tax-tagged CSV
        </ButtonLink>
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={toggle} disabled={saving} className="mt-4">
        {toggleLabel}
      </Button>
    </Panel>
  );
}
