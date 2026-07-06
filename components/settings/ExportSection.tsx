"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

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

  const buttonClass = (gated: boolean) =>
    `inline-block rounded border border-black/15 dark:border-white/25 px-3 py-1.5 text-sm ${
      gated && !enabled ? "pointer-events-none opacity-40" : ""
    }`;

  return (
    <section className="rounded-lg border border-black/10 dark:border-white/15 p-4 space-y-3">
      <h2 className="font-semibold">Export your data</h2>
      <p className="text-sm opacity-80">
        Download your transactions as CSV or JSON (merchant, amount, date,
        category only — no account numbers or identifiers; feed them to any AI
        tool you choose), or grab this week&apos;s summary as a PDF.
      </p>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          onChange={toggle}
          disabled={saving}
        />
        Allow exporting my transaction data
      </label>

      <div className="flex flex-wrap gap-2">
        <a href="/api/export/csv" className={buttonClass(true)}>
          Download CSV
        </a>
        <a href="/api/export/json" className={buttonClass(true)}>
          Download JSON
        </a>
        {/* The PDF is the same summary the weekly email carries — not gated by
            the transaction-export toggle. */}
        <a href="/api/export/report" className={buttonClass(false)}>
          Weekly report (PDF)
        </a>
      </div>
    </section>
  );
}
