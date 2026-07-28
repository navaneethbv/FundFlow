"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import Input from "@/components/ui/Input";
import Panel from "@/components/ui/Panel";

interface OverrideRow {
  id: string;
  source_category: string;
  display_category: string;
}

/**
 * Custom category renames/merges (1.13). Overrides are a display-time
 * mapping layer — stored transactions keep their Plaid category, so a
 * re-sync can never fight a user's edits and deleting an override
 * instantly restores the original taxonomy.
 */
export default function CategoryOverridesSection({
  initialOverrides,
}: {
  initialOverrides: OverrideRow[];
}) {
  const supabase = createClient();
  const [overrides, setOverrides] = useState<OverrideRow[]>(initialOverrides);
  const [source, setSource] = useState("");
  const [display, setDisplay] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const sourceValue = source.trim().toUpperCase();
    const displayValue = display.trim();
    if (!sourceValue || !displayValue) {
      setError("Enter the Plaid category and the name you want to see.");
      return;
    }
    const { data: userData } = await supabase.auth.getUser();
    const { data, error: insertError } = await supabase
      .from("category_overrides")
      .insert({
        user_id: userData.user?.id,
        source_category: sourceValue,
        display_category: displayValue,
      })
      .select("id, source_category, display_category")
      .single();
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setOverrides((rows) => [...rows, data as OverrideRow]);
    setSource("");
    setDisplay("");
  }

  async function remove(id: string) {
    await supabase.from("category_overrides").delete().eq("id", id);
    setOverrides((rows) => rows.filter((row) => row.id !== id));
  }

  return (
    <Panel title="Category names" eyebrow="Rename or merge">
      <p className="mb-4 text-sm text-muted">
        Rename Plaid categories or merge several into one — map both
        FOOD_AND_DRINK and ENTERTAINMENT to &ldquo;Fun money&rdquo; and every
        chart follows. Display-only: your data is untouched.
      </p>

      {overrides.length > 0 && (
        <ul className="mb-4 space-y-2 text-sm">
          {overrides.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate">
                <span className="font-semibold">{row.source_category}</span>
                <span className="text-muted"> → {row.display_category}</span>
              </span>
              <Button onClick={() => remove(row.id)} variant="ghost" size="sm">
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="flex flex-wrap items-end gap-2">
        <Field label="Plaid category">
          <Input
            placeholder="FOOD_AND_DRINK"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
        </Field>
        <Field label="Show as">
          <Input
            placeholder="Eating out"
            value={display}
            onChange={(e) => setDisplay(e.target.value)}
          />
        </Field>
        <Button type="submit" size="md">
          Add
        </Button>
      </form>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </Panel>
  );
}
