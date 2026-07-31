"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { usePlaidLink } from "react-plaid-link";
import { saveResume, clearResume } from "@/lib/plaid-resume";
import Button from "@/components/ui/Button";

/**
 * Repairs a broken bank connection via Plaid Link update mode. Link fixes the
 * credentials in place; /api/plaid/reconnect then clears our error state and
 * resyncs.
 *
 * The update-mode link token is minted on click, not on mount. One of these
 * renders per broken item, so an on-mount fetch spent a Plaid call per broken
 * bank on every Settings visit — and left the button disabled, with no visible
 * reason, for the whole round trip.
 */
export default function ReconnectBankButton({ itemId }: Readonly<{ itemId: string }>) {
  const router = useRouter();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wantsOpenRef = useRef(false);

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
  // it on the dashboard. Set at open time so multiple broken-bank buttons do
  // not overwrite each other.
  const openFor = useCallback(
    (token: string) => {
      saveResume({ token, mode: "reconnect", itemId });
      open();
    },
    [itemId, open],
  );

  const handleOpen = useCallback(async () => {
    setError(null);
    if (linkToken) {
      if (ready) openFor(linkToken);
      else wantsOpenRef.current = true;
      return;
    }

    wantsOpenRef.current = true;
    setBusy(true);
    try {
      const res = await fetch("/api/plaid/link-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_id: itemId }),
      });
      if (!res.ok) throw new Error("Could not start reconnection");
      const json = await res.json();
      setLinkToken(json.link_token);
    } catch (err) {
      wantsOpenRef.current = false;
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  }, [itemId, linkToken, ready, openFor]);

  useEffect(() => {
    if (!wantsOpenRef.current || !ready || !linkToken) return;
    wantsOpenRef.current = false;
    openFor(linkToken);
  }, [ready, linkToken, openFor]);

  return (
    <span className="inline-flex items-center gap-2">
      <Button
        onClick={handleOpen}
        disabled={busy}
        loading={busy}
        variant="secondary"
        size="sm"
      >
        {busy ? "Reconnecting..." : "Reconnect"}
      </Button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </span>
  );
}
