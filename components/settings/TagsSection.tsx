"use client";

import { useState } from "react";

export default function TagsSection({
  initialTags = [],
}: Readonly<{
  initialTags?: { id: string; name: string; color_slot: number }[];
}>) {
  const [tags, setTags] = useState(initialTags);
  const [newTag, setNewTag] = useState("");
  const [loading, setLoading] = useState(false);

  const handleAddTag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTag.trim()) return;

    setLoading(true);
    try {
      const res = await fetch("/api/settings/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newTag.trim() }),
      });
      const data = await res.json();
      if (data.tag) {
        setTags([...tags, data.tag]);
        setNewTag("");
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-panel border border-panel-border bg-panel p-6 space-y-6">
      <div>
        <h3 className="font-semibold text-foreground">Transaction Tags</h3>
        <p className="text-xs text-muted">Create custom tags for filtering and organizing transactions</p>
      </div>

      <form onSubmit={handleAddTag} className="flex gap-2 max-w-md">
        <input
          type="text"
          placeholder="New tag name (e.g. Tax-Deductible)"
          value={newTag}
          onChange={(e) => setNewTag(e.target.value)}
          className="flex-1 rounded border border-panel-border bg-background p-2 text-xs text-foreground"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded bg-accent px-3 py-2 text-xs font-semibold text-white hover:bg-accent/90"
        >
          Add Tag
        </button>
      </form>

      <div className="flex flex-wrap gap-2">
        {tags.length === 0 ? (
          <p className="text-xs text-muted">No custom tags created yet.</p>
        ) : (
          tags.map((t) => (
            <span
              key={t.id || t.name}
              className="rounded bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent"
            >
              #{t.name}
            </span>
          ))
        )}
      </div>
    </div>
  );
}
