"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import ButtonLink from "@/components/ui/ButtonLink";
import Panel from "@/components/ui/Panel";
import ExportReportButton from "@/components/review/ExportReportButton";
import TaxExportButton from "@/components/settings/TaxExportButton";
import { TAX_CATEGORIES } from "@/lib/tax-categories";

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
        Download your transactions as CSV or JSON (date, merchant, amount and
        category only - no balances, account numbers, masks or provider ids).
        Merchant names are your own transaction text and are kept as-is, so read
        the file before you hand it to an AI tool. Or grab this week&apos;s
        summary as a PDF.
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
        <ExportReportButton
          label="Export PDF report"
          className={!enabled ? "pointer-events-none opacity-40" : ""}
        />
        <TaxExportButton className={!enabled ? "pointer-events-none opacity-40" : ""} />
        <ButtonLink
          href="/api/export/csv?scope=tax"
          className={!enabled ? "pointer-events-none opacity-40" : ""}
        >
          Tax-tagged CSV
        </ButtonLink>
      </div>
      <p className="mt-4 text-sm text-muted">
        The tax year CSV groups a calendar year of transactions by tax line item.
        Tag transactions in the ledger with any of:{" "}
        {TAX_CATEGORIES.map((category) => category.lineItem.toLowerCase()).join(", ")} —
        or the plain tag <em>tax</em>. Splits are counted once. Data only, not tax advice.
      </p>
      <Button type="button" variant="ghost" size="sm" onClick={toggle} disabled={saving} className="mt-4">
        {toggleLabel}
      </Button>
    </Panel>
  );
}
