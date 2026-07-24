"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Button from "@/components/ui/Button";

interface SavedView {
  id: string;
  name: string;
  params: Record<string, string>;
}

/**
 * Saved ledger views (8.4): name and pin the current /transactions filter
 * combination. Filters are already URL params, so a view is just a stored
 * query string rendered as a chip.
 */
export default function SavedViewsBar({
  initialViews,
  currentParams,
}: {
  initialViews: SavedView[];
  currentParams: Record<string, string>;
}) {
  const supabase = createClient();
  const [views, setViews] = useState(initialViews);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const hasFilters = Object.keys(currentParams).length > 0;

  function viewHref(view: SavedView): string {
    const search = new URLSearchParams(view.params).toString();
    return search ? `/transactions?${search}` : "/transactions";
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return;
    const { data: userData } = await supabase.auth.getUser();
    const { data, error: insertError } = await supabase
      .from("saved_views")
      .insert({ user_id: userData.user?.id, name: name.trim(), params: currentParams })
      .select("id, name, params")
      .single();
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setViews((rows) => [...rows, data as SavedView]);
    setName("");
    setSaving(false);
  }

  async function remove(id: string) {
    await supabase.from("saved_views").delete().eq("id", id);
    setViews((rows) => rows.filter((row) => row.id !== id));
  }

  if (views.length === 0 && !hasFilters) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {views.map((view) => (
        <span
          key={view.id}
          className="inline-flex items-center gap-1 rounded-field border border-panel-border bg-panel-2 pl-2.5"
        >
          <Link
            href={viewHref(view)}
            className="py-1 font-semibold hover:text-accent focus-visible:outline-2"
          >
            {view.name}
          </Link>
          <button
            type="button"
            onClick={() => remove(view.id)}
            aria-label={`Delete saved view ${view.name}`}
            className="px-1.5 py-1 text-muted hover:text-danger focus-visible:outline-2"
          >
            ×
          </button>
        </span>
      ))}

      {hasFilters &&
        (saving ? (
          <form onSubmit={save} className="inline-flex items-center gap-1">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="View name"
              maxLength={80}
              className="w-32 rounded-field border border-panel-border bg-panel px-2 py-1"
            />
            <Button type="submit" variant="ghost" size="sm">
              Save
            </Button>
          </form>
        ) : (
          <Button onClick={() => setSaving(true)} variant="ghost" size="sm">
            Save this view
          </Button>
        ))}
      {error && <span className="text-red-600">{error}</span>}
    </div>
  );
}
