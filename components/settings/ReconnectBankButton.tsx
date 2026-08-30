"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { saveResume, clearResume } from "@/lib/plaid-resume";
import Button from "@/components/ui/Button";
import PlaidLinkLauncher from "@/components/PlaidLinkLauncher";

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
      setLinkToken(null);
      router.refresh();
    } catch (err) {
      clearResume();
      setLinkToken(null);
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  }, [itemId, router]);

  const handleOpen = useCallback(async () => {
    setError(null);
    if (linkToken) return;

    setBusy(true);
    try {
      const res = await fetch("/api/plaid/link-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_id: itemId }),
      });
      if (!res.ok) throw new Error("Could not start reconnection");
      const json = await res.json();
      saveResume({ token: json.link_token, mode: "reconnect", itemId });
      setLinkToken(json.link_token);
    } catch (err) {
      clearResume();
      setLinkToken(null);
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  }, [itemId, linkToken]);

  const onExit = useCallback(() => {
    clearResume();
    setLinkToken(null);
  }, []);

  return (
    <span className="inline-flex items-center gap-2">
      <PlaidLinkLauncher
        token={linkToken}
        onSuccess={() => onSuccess()}
        onExit={onExit}
      />
      <Button
        onClick={handleOpen}
        disabled={busy || Boolean(linkToken)}
        loading={busy || Boolean(linkToken)}
        variant="secondary"
        size="sm"
      >
        {busy || linkToken ? "Opening..." : "Reconnect"}
      </Button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </span>
  );
}
