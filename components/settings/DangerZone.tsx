"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Button from "@/components/ui/Button";
import Panel from "@/components/ui/Panel";

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
    <Panel title="Danger zone" tone="danger">
      <p className="mb-4 text-sm text-muted">
        Deletes your account, removes all bank connections at Plaid, and erases
        all stored data.
      </p>
      <Button
        onClick={deleteAccount}
        disabled={busy}
        variant="danger"
        loading={busy}
      >
        {busy ? "Deleting..." : "Delete my account"}
      </Button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </Panel>
  );
}
