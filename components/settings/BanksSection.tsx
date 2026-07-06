"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Item {
  id: string;
  institution_name: string | null;
  status: string;
}

export default function BanksSection({ initialItems }: { initialItems: Item[] }) {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>(initialItems);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function disconnect(id: string) {
    if (!confirm("Disconnect this bank and delete its data?")) return;
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch("/api/plaid/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_id: id }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? "Disconnect failed");
      }
      setItems((list) => list.filter((i) => i.id !== id));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="rounded-lg border border-black/10 dark:border-white/15 p-4 space-y-3">
      <h2 className="font-semibold">Connected banks</h2>
      {items.length === 0 ? (
        <p className="text-sm opacity-60">No banks connected.</p>
      ) : (
        <ul className="text-sm space-y-1">
          {items.map((i) => (
            <li key={i.id} className="flex justify-between items-center">
              <span>
                {i.institution_name ?? "Bank"}
                {i.status !== "active" ? ` (${i.status})` : ""}
              </span>
              <button
                onClick={() => disconnect(i.id)}
                disabled={busyId === i.id}
                className="text-red-600 underline text-xs disabled:opacity-50"
              >
                {busyId === i.id ? "Disconnecting…" : "Disconnect"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  );
}
