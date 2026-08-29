"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ReconnectBankButton from "@/components/settings/ReconnectBankButton";
import Badge, { type BadgeTone } from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Panel from "@/components/ui/Panel";
import type { InstitutionSyncHealth, SyncHealthState } from "@/lib/sync-health";

interface Item {
  id: string;
  institution_name: string | null;
  status: string;
  error_code: string | null;
  shared_household_id?: string | null;
  health?: InstitutionSyncHealth | null;
}

/** Broken now (status error) or breaking soon (consent expiring). */
function needsReconnect(item: Item): boolean {
  return (
    item.status === "error" ||
    item.error_code === "PENDING_EXPIRATION" ||
    item.health?.transactions.state === "repair_required" ||
    item.health?.investments.state === "repair_required"
  );
}

const HEALTH_TONE: Record<SyncHealthState, BadgeTone> = {
  healthy: "success",
  stale: "warning",
  repair_required: "danger",
  rate_limited: "warning",
  product_unavailable: "neutral",
  never_synced: "neutral",
};

const HEALTH_LABEL: Record<SyncHealthState, string> = {
  healthy: "Healthy",
  stale: "Stale",
  repair_required: "Repair required",
  rate_limited: "Rate limited",
  product_unavailable: "Unavailable",
  never_synced: "Never synced",
};

function formatTimestamp(iso: string | null): string {
  if (!iso) return "Never";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return iso;
  }
}

export default function BanksSection({
  initialItems,
  householdId = null,
}: Readonly<{
  initialItems: Item[];
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
        <ul className="space-y-4 text-sm">
          {items.map((i) => {
            const health = i.health;
            const txnState = health?.transactions.state;
            const invState = health?.investments.state;

            return (
              <li
                key={i.id}
                className="flex min-w-0 flex-col items-stretch gap-3 rounded-field border border-panel-border bg-panel-2 p-3.5"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <span className="min-w-0">
                    <span className="block break-words font-semibold text-base">
                      {i.institution_name ?? "Bank"}
                    </span>
                    {i.error_code === "PENDING_EXPIRATION" && (
                      <span className="text-xs font-medium text-warning">Consent expiring soon</span>
                    )}
                  </span>
                  <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">
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
                  </div>
                </div>

                {health && (
                  <div className="mt-1 grid gap-2 border-t border-panel-border pt-2 text-xs sm:grid-cols-2">
                    <div className="rounded bg-panel p-2">
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-semibold text-muted">Transactions</span>
                        {txnState && (
                          <Badge tone={HEALTH_TONE[txnState]} className="px-2 py-0.5 text-[11px]">
                            {HEALTH_LABEL[txnState]}
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 text-muted">
                        Last sync: {formatTimestamp(health.transactions.lastSuccessAt)}
                      </p>
                      {health.oldestTransactionDate && health.newestTransactionDate && (
                        <p className="text-muted">
                          Range: {health.oldestTransactionDate} → {health.newestTransactionDate}
                        </p>
                      )}
                      {health.transactions.safeErrorCode && (
                        <p className="mt-0.5 font-mono text-[11px] text-danger">
                          Error: {health.transactions.safeErrorCode}
                        </p>
                      )}
                    </div>

                    <div className="rounded bg-panel p-2">
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-semibold text-muted">Investments</span>
                        {invState && (
                          <Badge tone={HEALTH_TONE[invState]} className="px-2 py-0.5 text-[11px]">
                            {HEALTH_LABEL[invState]}
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 text-muted">
                        Last sync: {formatTimestamp(health.investments.lastSuccessAt)}
                      </p>
                      {health.investments.safeErrorCode && (
                        <p className="mt-0.5 font-mono text-[11px] text-danger">
                          Status: {health.investments.safeErrorCode}
                        </p>
                      )}
                    </div>
                  </div>
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
              </li>
            );
          })}
        </ul>
      )}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </Panel>
  );
}
