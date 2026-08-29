"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Panel from "@/components/ui/Panel";

export interface TagRow {
  id: string;
  name: string;
}

/**
 * Rename, merge, and remove tags. Renaming to an existing tag's name merges
 * the two — the server treats identity as the name, so this UI doesn't need
 * a separate "merge" mode, just a rename that happens to collide.
 */
export default function TagsSection({ initialTags }: Readonly<{ initialTags: TagRow[] }>) {
  const router = useRouter();
  const [tags, setTags] = useState(initialTags);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function createTag(event: React.SyntheticEvent) {
    event.preventDefault();
    setError(null);
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const response = await fetch("/api/settings/tags", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const payload = (await response.json().catch(() => ({}))) as { tag?: TagRow; error?: string };
      if (!response.ok || !payload.tag) {
        setError(payload.error ?? "Could not add the tag.");
        return;
      }
      setTags((current) => [...current, payload.tag!]);
      setNewName("");
    } finally {
      setBusy(false);
    }
  }

  async function rename(tag: TagRow) {
    const target = renaming[tag.id]?.trim();
    if (!target || target === tag.name) return;
    setError(null);
    setBusy(true);
    try {
      const response = await fetch("/api/settings/tags", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ oldName: tag.name, newName: target }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Could not rename the tag.");
        return;
      }
      // Renaming to an existing tag's name merges: the row becomes the target
      // name if it is free, otherwise the row disappears into the other tag.
      setTags((current) => {
        const otherHasTarget = current.some(
          (t) => t.id !== tag.id && t.name === target,
        );
        if (otherHasTarget) return current.filter((t) => t.id !== tag.id);
        return current.map((t) => (t.id === tag.id ? { ...t, name: target } : t));
      });
      setRenaming((current) => ({ ...current, [tag.id]: "" }));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(tag: TagRow) {
    setError(null);
    setBusy(true);
    try {
      const response = await fetch("/api/settings/tags", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: tag.name }),
      });
      if (!response.ok) {
        setError("Could not delete the tag.");
        return;
      }
      setTags((current) => current.filter((t) => t.id !== tag.id));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Tags" eyebrow="Ledger organization">
      <p className="mb-3 text-sm text-muted">
        Rename a tag to an existing name to merge the two everywhere they appear on your ledger.
      </p>
      <ul className="space-y-2">
        {tags.map((tag) => (
          <li key={tag.id} className="flex items-center gap-2">
            <label htmlFor={`tag-rename-${tag.id}`} className="sr-only">
              Rename {tag.name}
            </label>
            <Input
              id={`tag-rename-${tag.id}`}
              value={renaming[tag.id] ?? tag.name}
              onChange={(e) => setRenaming((current) => ({ ...current, [tag.id]: e.target.value }))}
              maxLength={40}
              className="max-w-48"
            />
            <Button type="button" variant="secondary" size="sm" onClick={() => rename(tag)} disabled={busy}>
              Save
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => remove(tag)} disabled={busy}>
              Delete
            </Button>
          </li>
        ))}
      </ul>
      {/* The empty message is list-adjacent copy, not a list item: a bare p
          inside a ul is invalid markup that axe reports as a list violation. */}
      {tags.length === 0 && <p className="text-sm text-muted">No tags yet.</p>}
      <form onSubmit={createTag} className="mt-4 flex gap-2">
        <label htmlFor="new-tag-name" className="sr-only">
          New tag name
        </label>
        <Input
          id="new-tag-name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New tag name"
          maxLength={40}
          className="max-w-48"
        />
        <Button type="submit" size="sm" disabled={busy}>
          Add
        </Button>
      </form>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </Panel>
  );
}
