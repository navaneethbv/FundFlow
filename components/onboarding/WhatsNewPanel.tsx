"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import ButtonLink from "@/components/ui/ButtonLink";
import Panel from "@/components/ui/Panel";
import { createClient } from "@/lib/supabase/client";
import { RELEASE_HIGHLIGHTS_VERSION, type ReleaseHighlight } from "@/lib/release-highlights";

export default function WhatsNewPanel({
  highlights,
}: Readonly<{ highlights: readonly ReleaseHighlight[] }>) {
  const [visible, setVisible] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function dismiss() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const client = createClient();
      const { data: auth } = await client.auth.getUser();
      if (!auth.user) return;
      const { data: profile, error: readError } = await client.from("profiles").select("dashboard_prefs").eq("id", auth.user.id).maybeSingle();
      if (readError) throw readError;
      const current = profile?.dashboard_prefs && typeof profile.dashboard_prefs === "object" && !Array.isArray(profile.dashboard_prefs)
        ? profile.dashboard_prefs as Record<string, unknown>
        : {};
      const { error } = await client.from("profiles").update({ dashboard_prefs: { ...current, releaseHighlightsSeen: RELEASE_HIGHLIGHTS_VERSION } }).eq("id", auth.user.id);
      if (error) throw error;
      setVisible(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this release as read.");
    } finally {
      setSaving(false);
    }
  }

  if (!visible) return null;
  return (
    <Panel title="What’s new" eyebrow={`Release highlights · ${RELEASE_HIGHLIGHTS_VERSION}`} action={<Button variant="ghost" size="sm" onClick={() => void dismiss()} disabled={saving}>Dismiss</Button>}>
      <ul className="grid gap-3 md:grid-cols-3" aria-label="Release highlights">
        {highlights.map((highlight) => (
          <li key={highlight.title} className="rounded-field bg-panel-2 p-3">
            <h3 className="text-sm font-semibold">{highlight.title}</h3>
            <p className="mt-1 text-xs leading-5 text-muted">{highlight.description}</p>
            <ButtonLink className="mt-3" href={highlight.href} variant="ghost" size="sm">Explore</ButtonLink>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
    </Panel>
  );
}
