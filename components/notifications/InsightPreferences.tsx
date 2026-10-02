"use client";
import { useState } from "react";
import { INSIGHT_TYPES, type InsightType } from "@/lib/insight-types";
import { titleCase } from "@/lib/format";
import Panel from "@/components/ui/Panel";
import Button from "@/components/ui/Button";
export default function InsightPreferences({
  initial,
}: Readonly<{ initial: Partial<Record<InsightType, boolean>> }>) {
  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  async function save() {
    setSaving(true);
    try {
      const response = await fetch("/api/insights/preferences", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          Object.fromEntries(
            INSIGHT_TYPES.map((type) => [type, values[type] === true]),
          ),
        ),
      });
      if (!response.ok) throw new Error("Could not save insight preferences.");
      setStatus("Insight preferences saved.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <Panel title="Explained insights" eyebrow="In-app only">
      <p className="mb-3 text-sm text-muted">
        Choose signals generated after daily sync. They stay in FundFlow.
      </p>
      <div className="space-y-2">
        {INSIGHT_TYPES.map((type) => (
          <label key={type} className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              checked={values[type] === true}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  [type]: event.target.checked,
                }))
              }
            />
            {titleCase(type)}
          </label>
        ))}
      </div>
      <Button className="mt-4" onClick={save} loading={saving}>
        Save insight preferences
      </Button>
      <p role="status" className="mt-3 text-sm">
        {status}
      </p>
    </Panel>
  );
}
