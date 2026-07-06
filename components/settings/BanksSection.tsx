"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ReconnectBankButton from "@/components/settings/ReconnectBankButton";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Panel from "@/components/ui/Panel";

interface Item {
  id: string;
  institution_name: string | null;
  status: string;
  error_code: string | null;
}

/** Broken now (status error) or breaking soon (consent expiring). */
function needsReconnect(item: Item): boolean {
  return item.status === "error" || item.error_code === "PENDING_EXPIRATION";
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
    <Panel title="Connected institutions" eyebrow="Banks">
      {items.length === 0 ? (
        <p className="text-sm text-muted">No banks connected.</p>
      ) : (
        <ul className="space-y-3 text-sm">
          {items.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-3 rounded-field border border-panel-border bg-panel-2 p-3">
              <span>
                <span className="block font-semibold">{i.institution_name ?? "Bank"}</span>
                {i.error_code === "PENDING_EXPIRATION" && (
                  <span className="text-xs text-warning">Consent expiring soon</span>
                )}
              </span>
              <span className="inline-flex items-center gap-2">
                <Badge tone={i.status === "active" ? "success" : "danger"}>
                  {i.status === "active" ? "Connected" : i.status}
                </Badge>
                {needsReconnect(i) && <ReconnectBankButton itemId={i.id} />}
                <Button
                  onClick={() => disconnect(i.id)}
                  disabled={busyId === i.id}
                  variant="danger"
                  size="sm"
                >
                  {busyId === i.id ? "Disconnecting..." : "Disconnect"}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </Panel>
  );
}
