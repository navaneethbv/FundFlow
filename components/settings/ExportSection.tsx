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

  return (
    <section className="rounded-lg border border-black/10 dark:border-white/15 p-4 space-y-3">
      <h2 className="font-semibold">Data export (for external AI)</h2>
      <p className="text-sm opacity-80">
        Download a CSV of your transactions (merchant, amount, date, category
        only). No account numbers or identifiers are included. You can feed this
        to any AI tool you choose.
      </p>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          onChange={toggle}
          disabled={saving}
        />
        Allow exporting my data
      </label>

      <a
        href="/api/export/csv"
        className={`inline-block rounded border border-black/15 dark:border-white/25 px-3 py-1.5 text-sm ${
          enabled ? "" : "pointer-events-none opacity-40"
        }`}
      >
        Download CSV
      </a>
    </section>
  );
}
