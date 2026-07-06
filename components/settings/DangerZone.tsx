"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function DangerZone() {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deleteAccount() {
    if (
      !confirm(
        "Permanently delete your account and all financial data? This cannot be undone.",
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account", { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? "Deletion failed");
      }
      await supabase.auth.signOut();
      router.push("/signup");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-red-500/40 p-4 space-y-3">
      <h2 className="font-semibold text-red-600">Danger zone</h2>
      <p className="text-sm opacity-80">
        Deletes your account, removes all bank connections at Plaid, and erases
        all stored data.
      </p>
      <button
        onClick={deleteAccount}
        disabled={busy}
        className="rounded bg-red-600 text-white px-3 py-1.5 text-sm disabled:opacity-50"
      >
        {busy ? "Deleting…" : "Delete my account"}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  );
}
