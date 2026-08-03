"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import Input from "@/components/ui/Input";
import Panel from "@/components/ui/Panel";

export interface ProfileSectionProps {
  fullName: string | null;
  displayName: string | null;
  birthday: string | null;
  avatarUrl: string | null;
}

/**
 * Full name, display name, birthday, and an avatar photo. Birthday is
 * collected for its own sake (e.g. a future birthday-month nudge) — Phase 11's
 * Advice explicitly never uses it for eligibility without a separate,
 * visible explanation, and this section makes no such use of it either.
 */
export default function ProfileSection({
  fullName,
  displayName,
  birthday,
  avatarUrl,
}: Readonly<ProfileSectionProps>) {
  const router = useRouter();
  const [fullNameValue, setFullNameValue] = useState(fullName ?? "");
  const [displayNameValue, setDisplayNameValue] = useState(displayName ?? "");
  const [birthdayValue, setBirthdayValue] = useState(birthday ?? "");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(event: React.SyntheticEvent) {
    event.preventDefault();
    setError(null);
    setStatus(null);
    setBusy(true);
    try {
      const response = await fetch("/api/settings/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "profile",
          fullName: fullNameValue || null,
          displayName: displayNameValue || null,
          birthday: birthdayValue || null,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Could not save your profile.");
        return;
      }
      setStatus("Saved.");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function uploadAvatar(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/settings/profile", { method: "POST", body: form });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Could not upload the photo.");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function removeAvatar() {
    setBusy(true);
    try {
      await fetch("/api/settings/profile", { method: "DELETE" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Profile" eyebrow="You">
      <div className="mb-4 flex items-center gap-4">
        <div className="h-16 w-16 overflow-hidden rounded-full border border-panel-border bg-panel-2">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not worth Next's image pipeline
            <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : null}
        </div>
        <div className="space-y-1">
          <label className="inline-block cursor-pointer text-sm font-semibold text-accent hover:underline">
            Upload photo
            <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={uploadAvatar} disabled={busy} />
          </label>
          {avatarUrl && (
            <button type="button" onClick={removeAvatar} disabled={busy} className="block text-xs text-muted hover:underline">
              Remove
            </button>
          )}
        </div>
      </div>

      <form onSubmit={save} className="space-y-3">
        <Field label="Full name">
          <Input value={fullNameValue} onChange={(e) => setFullNameValue(e.target.value)} maxLength={120} />
        </Field>
        <Field label="Display name" hint="Used for greetings around the app.">
          <Input value={displayNameValue} onChange={(e) => setDisplayNameValue(e.target.value)} maxLength={80} />
        </Field>
        <Field label="Birthday (optional)">
          <Input
            type="date"
            value={birthdayValue}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setBirthdayValue(e.target.value)}
          />
        </Field>
        {error && <p className="text-sm text-danger">{error}</p>}
        {status && <p className="text-sm text-success">{status}</p>}
        <Button type="submit" size="lg" disabled={busy}>
          {busy ? "Saving…" : "Update Profile"}
        </Button>
      </form>
    </Panel>
  );
}
