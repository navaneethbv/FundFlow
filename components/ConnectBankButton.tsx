"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePlaidLink } from "react-plaid-link";

export default function ConnectBankButton() {
  const router = useRouter();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch a link_token from our backend on mount.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/plaid/link-token", { method: "POST" });
        if (!res.ok) throw new Error("Could not start bank connection");
        const json = await res.json();
        if (active) setLinkToken(json.link_token);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Error");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const onSuccess = useCallback(
    async (publicToken: string) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/plaid/exchange", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ public_token: publicToken }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error ?? "Failed to connect bank");
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error");
      } finally {
        setBusy(false);
      }
    },
    [router],
  );

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: (public_token) => onSuccess(public_token),
  });

  return (
    <div className="inline-flex flex-col gap-1">
      <button
        onClick={() => open()}
        disabled={!ready || !linkToken || busy}
        className="rounded bg-foreground text-background px-4 py-2 font-medium disabled:opacity-50"
      >
        {busy ? "Connecting…" : "Connect a bank"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
