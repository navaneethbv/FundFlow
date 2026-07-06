"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function RefreshButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/plaid/sync", { method: "POST" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? "Refresh failed");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inline-flex flex-col gap-1">
      <button
        onClick={refresh}
        disabled={busy}
        className="rounded-full border border-black/15 bg-white/55 px-5 py-2.5 text-sm font-semibold shadow-sm backdrop-blur transition-all duration-150 hover:-translate-y-0.5 hover:border-black/25 hover:bg-white/80 hover:shadow-md focus-visible:outline-2 disabled:translate-y-0 disabled:opacity-45 disabled:shadow-none dark:border-white/15 dark:bg-white/[0.08] dark:hover:border-white/25 dark:hover:bg-white/[0.12]"
      >
        {busy ? "Refreshing…" : "Refresh"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
