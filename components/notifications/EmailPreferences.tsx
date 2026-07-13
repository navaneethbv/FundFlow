"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Panel from "@/components/ui/Panel";
import Select from "@/components/ui/Select";

const TIMEZONES = [
  { value: "America/Los_Angeles", label: "Pacific Time" },
  { value: "America/Denver", label: "Mountain Time" },
  { value: "America/Chicago", label: "Central Time" },
  { value: "America/New_York", label: "Eastern Time" },
  { value: "UTC", label: "UTC" },
  { value: "Europe/London", label: "London" },
  { value: "Asia/Kolkata", label: "India Standard Time" },
] as const;

export default function EmailPreferences({
  email,
  initialWeeklyEnabled,
  initialDailyEnabled,
  initialTimezone,
}: {
  email: string;
  initialWeeklyEnabled: boolean;
  initialDailyEnabled: boolean;
  initialTimezone: string;
}) {
  const supabase = createClient();
  const [weeklyEnabled, setWeeklyEnabled] = useState(initialWeeklyEnabled);
  const [dailyEnabled, setDailyEnabled] = useState(initialDailyEnabled);
  const [timezone, setTimezone] = useState(initialTimezone);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setStatus(null);
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        setStatus("Sign in again to save email preferences.");
        return;
      }
      const { error } = await supabase
        .from("profiles")
        .update({
          timezone,
          weekly_report_enabled: weeklyEnabled,
          daily_digest_email_enabled: dailyEnabled,
        })
        .eq("id", data.user.id);
      setStatus(error?.message ?? "Email preferences saved.");
    } catch {
      setStatus("Choose a valid delivery timezone.");
    } finally {
      setSaving(false);
    }
  }

  const rows = [
    {
      title: "Weekly spending report",
      description: "A Monday email with category, bank, credit card, budget, merchant, and cash-flow insights. Includes a PDF.",
      checked: weeklyEnabled,
      onChange: setWeeklyEnabled,
    },
    {
      title: "Daily financial digest",
      description: "One daily summary when optional planning alerts are waiting for you.",
      checked: dailyEnabled,
      onChange: setDailyEnabled,
    },
  ];

  return (
    <Panel title="Email delivery" eyebrow="Your inbox" padding="lg">
      <p className="mb-5 text-sm text-muted">
        Messages are sent to <span className="font-semibold text-foreground">{email}</span>, the email used for your FundFlow account.
      </p>
      <div className="space-y-3">
        {rows.map((row) => (
          <label key={row.title} className="flex items-start justify-between gap-4 rounded-field border border-panel-border bg-panel-2 p-4">
            <span>
              <span className="block text-sm font-semibold">{row.title}</span>
              <span className="mt-1 block max-w-xl text-xs leading-5 text-muted">{row.description}</span>
            </span>
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 accent-accent"
              checked={row.checked}
              onChange={(event) => row.onChange(event.target.checked)}
            />
          </label>
        ))}

        <div className="rounded-field border border-success/25 bg-success/[0.06] p-4">
          <div className="flex items-start justify-between gap-4">
            <span>
              <span className="block text-sm font-semibold">Bank connection and sync alerts</span>
              <span className="mt-1 block text-xs leading-5 text-muted">Critical action is required when a bank disconnects or a sync fails.</span>
            </span>
            <Badge tone="success">Always enabled</Badge>
          </div>
        </div>
        <div className="rounded-field border border-panel-border bg-panel-2 p-4">
          <div className="flex items-start justify-between gap-4">
            <span>
              <span className="block text-sm font-semibold">Account and security messages</span>
              <span className="mt-1 block text-xs leading-5 text-muted">Sign-in, verification, password, and security notices protect your account.</span>
            </span>
            <Badge tone="neutral">Always enabled</Badge>
          </div>
        </div>
      </div>

      <label className="mt-5 block max-w-sm text-sm font-semibold">
        Weekly delivery timezone
        <Select className="mt-2" value={timezone} onChange={(event) => setTimezone(event.target.value)}>
          {TIMEZONES.map((zone) => (
            <option key={zone.value} value={zone.value}>{zone.label}</option>
          ))}
        </Select>
        <span className="mt-2 block text-xs font-normal text-muted">Weekly reports are prepared around 8:00 AM Monday in this timezone.</span>
      </label>

      <div className="mt-5 flex items-center gap-3">
        <Button type="button" onClick={save} disabled={saving}>
          {saving ? "Saving..." : "Save email preferences"}
        </Button>
        {status && <p className="text-sm text-muted" role="status">{status}</p>}
      </div>
    </Panel>
  );
}
