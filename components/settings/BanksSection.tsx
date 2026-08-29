"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ReconnectBankButton from "@/components/settings/ReconnectBankButton";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Panel from "@/components/ui/Panel";
import type { InstitutionSyncHealth, ProductSyncHealth, ProductSyncState } from "@/lib/sync-health";

interface Item {
  id: string;
  institution_name: string | null;
  status: string;
  error_code: string | null;
  shared_household_id?: string | null;
}

/** Broken now (status error) or breaking soon (consent expiring). */
function needsReconnect(item: Item): boolean {
  return item.status === "error" || item.error_code === "PENDING_EXPIRATION";
}

const HEALTH_LABELS: Record<ProductSyncState, string> = {
  healthy: "Healthy",
  stale: "Stale",
  repair_required: "Repair required",
  product_unavailable: "Not available",
  rate_limited: "Rate limited",
  never_synced: "Never synced",
};

function healthTone(state: ProductSyncState): "success" | "danger" | "warning" | "neutral" {
  if (state === "healthy") return "success";
  if (state === "repair_required") return "danger";
  if (state === "stale" || state === "rate_limited") return "warning";
  return "neutral";
}

function healthHelp(health: ProductSyncHealth): string {
  switch (health.state) {
    case "healthy":
      return health.lastSuccessAt ? `Last successful sync: ${health.lastSuccessAt}.` : "Sync is current.";
    case "stale":
      return "No successful sync completed in the last 48 hours.";
    case "repair_required":
      return "Reconnect this institution to restore access.";
    case "product_unavailable":
      return "This institution does not currently provide this product.";
    case "rate_limited":
      return "The provider asked FundFlow to retry later.";
    default:
      return "No successful sync has been recorded yet.";
  }
}

function HealthRow({ label, health }: Readonly<{ label: string; health: ProductSyncHealth }>) {
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <dt className="text-xs font-semibold text-muted">{label}</dt>
        <dd><Badge tone={healthTone(health.state)}>{HEALTH_LABELS[health.state]}</Badge></dd>
      </div>
      <dd className="mt-1 text-xs text-muted">{healthHelp(health)}</dd>
    </div>
  );
}

export default function BanksSection({
  initialItems,
  healthByItem = {},
  householdId = null,
}: Readonly<{
  initialItems: Item[];
  healthByItem?: Record<string, InstitutionSyncHealth>;
  householdId?: string | null;
}>) {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>(initialItems);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggleShare(id: string, share: boolean) {
    if (share && !householdId) {
      setError("Create or join a household first.");
      return;
    }
    setError(null);
    const res = await fetch("/api/plaid/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId: id, share, householdId }),
    });
    const json = (await res.json().catch(() => null)) as {
      householdId?: string | null;
      error?: string;
    } | null;
    if (!res.ok) {
      setError(json?.error ?? "Could not update sharing.");
      return;
    }
    setItems((list) =>
      list.map((item) =>
        item.id === id
          ? { ...item, shared_household_id: share ? (json?.householdId ?? "shared") : null }
          : item,
      ),
    );
  }

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
          {items.map((i) => {
            const health = healthByItem[i.id];
            const needsAttention = health &&
              (health.transactions.state !== "healthy" || health.investments.state !== "healthy");
            return (
            <li
              key={i.id}
              id={`institution-${i.id}`}
              className="flex min-w-0 flex-col items-stretch gap-3 rounded-field border border-panel-border bg-panel-2 p-3 sm:flex-row sm:items-start sm:justify-between"
            >
              <span className="min-w-0">
                <span className="block break-words font-semibold">
                  {i.institution_name ?? "Bank"}
                </span>
                {i.error_code === "PENDING_EXPIRATION" && (
                  <span className="text-xs text-warning">Consent expiring soon</span>
                )}
                {health && (
                  <>
                    <dl className="mt-3 grid max-w-sm gap-2">
                      <HealthRow label="Transactions" health={health.transactions} />
                      <HealthRow label="Investments" health={health.investments} />
                    </dl>
                    <p className="mt-2 text-xs text-muted">
                      Transaction coverage: {health.oldestTransactionDate ?? "not available"} to {health.newestTransactionDate ?? "not available"}.
                    </p>
                    {needsAttention && (
                      <output className="mt-2 block rounded-field border border-warning/30 bg-warning/10 p-2 text-xs text-foreground">
                        {health.institutionName} may have incomplete data.
                        {" "}<Link className="font-semibold underline" href="/cash-flow">Review Cash Flow</Link>
                        {" "}or{" "}<Link className="font-semibold underline" href="/investments">Investments</Link>.
                      </output>
                    )}
                  </>
                )}
                {householdId && (
                  <label className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                    <input
                      type="checkbox"
                      checked={Boolean(i.shared_household_id)}
                      onChange={(e) => toggleShare(i.id, e.target.checked)}
                    />
                    <span>Share with household</span>
                  </label>
                )}
              </span>
              <span className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">
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
          );})}
        </ul>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </Panel>
  );
}
