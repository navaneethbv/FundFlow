"use client";

import { useState } from "react";

export default function ProfileSection({
  initialFullName = "",
  initialDisplayName = "",
}: Readonly<{
  initialFullName?: string;
  initialDisplayName?: string;
}>) {
  const [fullName, setFullName] = useState(initialFullName);
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setSaved(false);

    try {
      await fetch("/api/settings/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: fullName,
          display_name: displayName,
        }),
      });
      setSaved(true);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-panel border border-panel-border bg-panel p-6 space-y-6">
      <div>
        <h3 className="font-semibold text-foreground">Personal Profile</h3>
        <p className="text-xs text-muted">Manage your name and public display identity</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 text-xs max-w-md">
        <div>
          <label className="block font-medium text-foreground mb-1">Full Name</label>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full rounded border border-panel-border bg-background p-2 text-foreground"
          />
        </div>

        <div>
          <label className="block font-medium text-foreground mb-1">Display Name</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full rounded border border-panel-border bg-background p-2 text-foreground"
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={loading}
            className="rounded bg-accent px-4 py-2 font-semibold text-white hover:bg-accent/90"
          >
            Save Profile
          </button>
          {saved && <span className="text-xs text-emerald-500 font-medium">Saved successfully!</span>}
        </div>
      </form>
    </div>
  );
}
