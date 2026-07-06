"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePlaidLink } from "react-plaid-link";
import { saveResume, clearResume } from "@/lib/plaid-resume";

/**
 * Repairs a broken bank connection via Plaid Link update mode. Rendered only
 * for items that need attention, so the update-mode link token is fetched on
 * mount (mirrors ConnectBankButton). Link fixes the credentials in place;
 * /api/plaid/reconnect then clears our error state and resyncs.
 *
 * OAuth banks redirect the browser to the registered redirect_uri (the
 * dashboard) mid-flow, unmounting this button. So on click we stash the
 * reconnect context; ConnectBankButton on the dashboard reads it back and
 * finalizes. Non-OAuth banks never redirect and finish inline via onSuccess.
 */
export default function ReconnectBankButton({ itemId }: { itemId: string }) {
  const router = useRouter();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/plaid/link-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ item_id: itemId }),
        });
        if (!res.ok) throw new Error("Could not start reconnection");
        const json = await res.json();
        if (active) setLinkToken(json.link_token);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Error");
      }
    })();
    return () => {
      active = false;
    };
  }, [itemId]);

  const onSuccess = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/plaid/reconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_id: itemId }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? "Failed to finish reconnection");
      }
      clearResume();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  }, [itemId, router]);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: () => onSuccess(),
  });

  // Stash this item's context before opening, so an OAuth redirect can resume
  // it on the dashboard. Set on click (not mount) so multiple broken-bank
  // buttons don't overwrite each other — the clicked one wins.
  const handleOpen = useCallback(() => {
    if (linkToken) saveResume({ token: linkToken, mode: "reconnect", itemId });
    open();
  }, [linkToken, itemId, open]);

  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={handleOpen}
        disabled={!ready || !linkToken || busy}
        className="text-xs rounded border border-black/15 dark:border-white/25 px-2 py-1 disabled:opacity-50"
      >
        {busy ? "Reconnecting…" : "Reconnect"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
