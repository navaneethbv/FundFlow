"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

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
    <section className="rounded-lg border border-black/10 dark:border-white/15 p-4 space-y-3">
      <h2 className="font-semibold">Weekly email report</h2>
      <p className="text-sm opacity-80">
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
      </label>
    </section>
  );
}
